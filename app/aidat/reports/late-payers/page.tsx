"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("tr-TR");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type RawBlock = { name: string };
type RawUnitRow = { id: string; unit_number: string; block: RawBlock | RawBlock[] | null };

function unwrap<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

type UnitInfo = { id: string; unit_number: string; block_name: string | null };

function unitLabel(u: UnitInfo | undefined) {
  if (!u) return "—";
  return u.block_name ? `${u.block_name} — ${u.unit_number}` : u.unit_number;
}

// ---- Section 1: currently outstanding ----

type OutstandingRow = {
  unit_id: string;
  balance: number;
  oldestDueDate: string | null;
};

// ---- Section 2: 12-month lateness frequency ----

type LatenessRow = {
  unit_id: string;
  lateCount: number;
  totalCount: number;
  mostRecentLateDate: string | null;
};

type RawAccrual = {
  id: string;
  unit_id: string;
  amount: number;
  due_date: string | null;
};

type RawAllocation = {
  amount: number;
  accrual_id: string;
  payments: { status: string; payment_date: string } | { status: string; payment_date: string }[] | null;
};

export default function LatePayersPage() {
  const { selectedSiteId } = useAidat();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unitsById, setUnitsById] = useState<Record<string, UnitInfo>>({});
  const [outstanding, setOutstanding] = useState<OutstandingRow[]>([]);
  const [lateness, setLateness] = useState<LatenessRow[]>([]);
  const [hasAnyAccrualHistory, setHasAnyAccrualHistory] = useState(false);

  const [filterUnitId, setFilterUnitId] = useState("");
  const [filterUnitSearch, setFilterUnitSearch] = useState("");
  const [filterUnitPickerOpen, setFilterUnitPickerOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);

    try {
      // Units + blocks for label resolution, reused across both sections.
      const unitsRes = await supabase
        .from("units")
        .select("id, unit_number, block:blocks(name)")
        .eq("site_id", selectedSiteId)
        .eq("active", true)
        .order("unit_number", { ascending: true });
      if (unitsRes.error) throw unitsRes.error;

      const unitMap: Record<string, UnitInfo> = {};
      for (const row of (unitsRes.data ?? []) as unknown as RawUnitRow[]) {
        const block = unwrap(row.block);
        unitMap[row.id] = { id: row.id, unit_number: row.unit_number, block_name: block?.name ?? null };
      }
      setUnitsById(unitMap);

      // ---- Section 1: currently outstanding balances ----
      const balancesRes = await supabase
        .from("v_unit_balances")
        .select("unit_id, balance")
        .eq("site_id", selectedSiteId);
      if (balancesRes.error) throw balancesRes.error;

      const debtorRows = ((balancesRes.data ?? []) as { unit_id: string; balance: number }[]).filter(
        (b) => b.balance > 0.01
      );

      let outstandingWithOldest: OutstandingRow[] = debtorRows.map((b) => ({
        unit_id: b.unit_id,
        balance: b.balance,
        oldestDueDate: null,
      }));

      if (debtorRows.length > 0) {
        // Oldest unpaid accrual due_date per debtor unit — nice-to-have context.
        // Pull all active accruals with a due_date for these units and reduce
        // client-side to the earliest one per unit (accruals lists tend to be
        // small per unit so this is cheap).
        const debtorUnitIds = debtorRows.map((b) => b.unit_id);
        const oldestRes = await supabase
          .from("accruals")
          .select("unit_id, due_date")
          .eq("site_id", selectedSiteId)
          .eq("status", "active")
          .not("due_date", "is", null)
          .in("unit_id", debtorUnitIds)
          .order("due_date", { ascending: true });
        if (oldestRes.error) throw oldestRes.error;

        const oldestByUnit = new Map<string, string>();
        for (const row of (oldestRes.data ?? []) as { unit_id: string; due_date: string }[]) {
          if (!oldestByUnit.has(row.unit_id)) oldestByUnit.set(row.unit_id, row.due_date);
        }
        outstandingWithOldest = debtorRows.map((b) => ({
          unit_id: b.unit_id,
          balance: b.balance,
          oldestDueDate: oldestByUnit.get(b.unit_id) ?? null,
        }));
      }

      outstandingWithOldest.sort((a, b) => b.balance - a.balance);
      setOutstanding(outstandingWithOldest);

      // ---- Section 2: 12-month lateness frequency ----
      const today = todayIso();
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      const windowStart = twelveMonthsAgo.toISOString().slice(0, 10);

      const accrualsRes = await supabase
        .from("accruals")
        .select("id, unit_id, amount, due_date")
        .eq("site_id", selectedSiteId)
        .eq("accrual_type", "monthly_dues")
        .eq("status", "active")
        .not("due_date", "is", null)
        .gte("due_date", windowStart)
        .lte("due_date", today);
      if (accrualsRes.error) throw accrualsRes.error;

      const windowAccruals = (accrualsRes.data ?? []) as RawAccrual[];
      setHasAnyAccrualHistory(windowAccruals.length > 0 || outstandingWithOldest.length > 0);

      if (windowAccruals.length === 0) {
        setLateness([]);
        setLoading(false);
        return;
      }

      const accrualIds = windowAccruals.map((a) => a.id);

      // Pull all allocations for these accruals, restricted to active
      // payments (voided payments do not retroactively delete their
      // allocation rows — see other pages in this module for the same
      // caveat), along with each allocation's payment_date.
      const allocRes = await supabase
        .from("payment_allocations")
        .select("amount, accrual_id, payments!inner(status, payment_date)")
        .in("accrual_id", accrualIds)
        .eq("payments.status", "active");
      if (allocRes.error) throw allocRes.error;

      const allocsByAccrual = new Map<string, { amount: number; payment_date: string }[]>();
      for (const row of (allocRes.data ?? []) as RawAllocation[]) {
        const payment = unwrap(row.payments);
        if (!payment) continue;
        const list = allocsByAccrual.get(row.accrual_id) ?? [];
        list.push({ amount: row.amount, payment_date: payment.payment_date });
        allocsByAccrual.set(row.accrual_id, list);
      }

      // Late-payment reconstruction: accruals table has no "paid_date" column.
      // For each accrual we sum its allocations ordered from OLDEST
      // payment_date forward and take the payment_date at which the running
      // total first reaches/exceeds the accrual amount — that's the payment
      // whose contribution actually closed the accrual out. This is the
      // precise "oldest-payment-crossing-threshold" reconstruction (handles
      // partial payments correctly), as opposed to the simpler "most recent
      // contributing payment_date" proxy. An accrual is "paid late" if that
      // settlement date is after due_date. An accrual that is not yet fully
      // settled and whose due_date has already passed also counts as late
      // (still-open past-due dues), even though it has no settlement date.
      const byUnit = new Map<string, { total: number; late: number; mostRecent: string | null }>();
      for (const accrual of windowAccruals) {
        const entry = byUnit.get(accrual.unit_id) ?? { total: 0, late: 0, mostRecent: null };
        entry.total++;
        byUnit.set(accrual.unit_id, entry);
      }

      for (const accrual of windowAccruals) {
        const allocs = (allocsByAccrual.get(accrual.id) ?? [])
          .slice()
          .sort((a, b) => a.payment_date.localeCompare(b.payment_date));

        let running = 0;
        let settledDate: string | null = null;
        for (const alloc of allocs) {
          running += alloc.amount;
          if (running >= accrual.amount - 0.01) {
            settledDate = alloc.payment_date;
            break;
          }
        }

        const dueDate = accrual.due_date as string;
        let isLate = false;
        let lateDateForDisplay: string | null = null;
        if (settledDate) {
          if (settledDate > dueDate) {
            isLate = true;
            lateDateForDisplay = settledDate;
          }
        } else if (dueDate < today) {
          isLate = true;
          lateDateForDisplay = dueDate;
        }

        const entry = byUnit.get(accrual.unit_id)!;
        if (isLate) {
          entry.late++;
          if (!entry.mostRecent || (lateDateForDisplay && lateDateForDisplay > entry.mostRecent)) {
            entry.mostRecent = lateDateForDisplay;
          }
        }
      }

      const latenessRows: LatenessRow[] = Array.from(byUnit.entries()).map(([unit_id, v]) => ({
        unit_id,
        lateCount: v.late,
        totalCount: v.total,
        mostRecentLateDate: v.mostRecent,
      }));
      latenessRows.sort((a, b) => b.lateCount - a.lateCount);
      setLateness(latenessRows);

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rapor yüklenirken hata oluştu.");
      setLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  const allUnits = Object.values(unitsById).sort((a, b) => unitLabel(a).localeCompare(unitLabel(b), "tr"));
  const filteredUnitOptions = (() => {
    const q = filterUnitSearch.trim().toLocaleLowerCase("tr");
    if (!q) return allUnits;
    return allUnits.filter((u) => unitLabel(u).toLocaleLowerCase("tr").includes(q));
  })();

  const visibleOutstanding = filterUnitId ? outstanding.filter((r) => r.unit_id === filterUnitId) : outstanding;
  const visibleLateness = filterUnitId ? lateness.filter((r) => r.unit_id === filterUnitId) : lateness;

  const showEmptyState = outstanding.length === 0 && !hasAnyAccrualHistory;

  // Rows here only exist for units with >=1 monthly_dues accrual in the
  // trailing-12-month window (see byUnit construction above), so a 0 here
  // always means "0 gecikme, veri var" rather than "no history" — units with
  // no accrual history in the window are omitted from the table entirely.
  function lateCountPillClass(count: number) {
    if (count === 0) return "pill-green";
    if (count <= 2) return "pill-amber";
    return "pill-coral";
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      {showEmptyState ? (
        <div className="panel">
          <div className="empty-state">Bu site için henüz tahakkuk geçmişi bulunmuyor.</div>
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Daire Filtresi</div>
              {filterUnitId && (
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setFilterUnitId("");
                    setFilterUnitSearch("");
                  }}
                >
                  Filtreyi Temizle
                </button>
              )}
            </div>
            <label className="auth-field" style={{ position: "relative", maxWidth: 320 }}>
              <span>Daire</span>
              <input
                type="text"
                value={filterUnitSearch}
                placeholder="Blok veya daire no yazın…"
                onFocus={() => setFilterUnitPickerOpen(true)}
                onChange={(e) => {
                  setFilterUnitSearch(e.target.value);
                  setFilterUnitPickerOpen(true);
                  if (filterUnitId) setFilterUnitId("");
                }}
                onBlur={() => setTimeout(() => setFilterUnitPickerOpen(false), 150)}
              />
              {filterUnitPickerOpen && (
                <div className="unit-picker-dropdown">
                  <button
                    type="button"
                    className="unit-picker-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setFilterUnitId("");
                      setFilterUnitSearch("");
                      setFilterUnitPickerOpen(false);
                    }}
                  >
                    Tüm daireler
                  </button>
                  {filteredUnitOptions.length === 0 ? (
                    <div className="unit-picker-empty">Eşleşen daire yok.</div>
                  ) : (
                    filteredUnitOptions.map((u) => (
                      <button
                        type="button"
                        key={u.id}
                        className="unit-picker-item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setFilterUnitId(u.id);
                          setFilterUnitSearch(unitLabel(u));
                          setFilterUnitPickerOpen(false);
                        }}
                      >
                        {unitLabel(u)}
                      </button>
                    ))
                  )}
                </div>
              )}
            </label>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Güncel Borçlu Daireler</div>
            </div>
            {visibleOutstanding.length === 0 ? (
              <div className="empty-state">
                {filterUnitId ? "Bu daire için borç kaydı yok." : "Şu anda borçlu daire bulunmuyor."}
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Daire</th>
                      <th className="num">Güncel Borç</th>
                      <th>En Eski Vadesi Geçen Tahakkuk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOutstanding.map((row) => (
                      <tr key={row.unit_id}>
                        <td>{unitLabel(unitsById[row.unit_id])}</td>
                        <td className="num">
                          <span className="pill pill-coral">{currency.format(row.balance)}</span>
                        </td>
                        <td>{row.oldestDueDate ? formatDate(row.oldestDueDate) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Son 12 Ayda Aidat Gecikme Sıklığı</div>
            </div>
            <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
              Aylık aidat tahakkuklarının vade tarihinden sonra ödendiği (veya hâlâ ödenmemiş ve vadesi geçmiş
              olduğu) durumlar sayılır. Kısmi ödemelerde, tahakkuku kapatan en eski ödemelerden başlayarak
              biriken tutarın tahakkuk tutarına ulaştığı ödeme tarihi &quot;ödeme tarihi&quot; olarak kabul
              edilir (basit &quot;son ödeme tarihi&quot; yaklaşımı yerine).
            </p>
            {visibleLateness.length === 0 ? (
              <div className="empty-state">
                {filterUnitId
                  ? "Bu daire için son 12 ayda aylık aidat tahakkuku yok."
                  : "Son 12 ayda aylık aidat tahakkuku bulunan daire yok."}
              </div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Daire</th>
                      <th className="num">Son 12 Ayda Geciken Ödeme Sayısı</th>
                      <th>Son Gecikme Tarihi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLateness.map((row) => (
                      <tr key={row.unit_id}>
                        <td>{unitLabel(unitsById[row.unit_id])}</td>
                        <td className="num">
                          <span className={`pill ${lateCountPillClass(row.lateCount)}`}>
                            {row.lateCount} kez
                          </span>
                        </td>
                        <td>{row.mostRecentLateDate ? formatDate(row.mostRecentLateDate) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
