"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";
import { exportRowsToExcel, exportRowsToPdf, type ExportColumn } from "@/lib/exportTable";

type Block = {
  id: string;
  name: string;
};

type Unit = {
  id: string;
  site_id: string;
  block_id: string | null;
  unit_number: string;
  active: boolean;
};

type PaymentMethod = "bank" | "cash" | "credit_card" | "other";
type PaymentStatus = "active" | "void";

type Payment = {
  id: string;
  site_id: string;
  unit_id: string;
  resident_id: string | null;
  payment_date: string;
  amount: number;
  method: PaymentMethod;
  description: string | null;
  status: PaymentStatus;
  voided_reason: string | null;
  created_at: string;
};

type Accrual = {
  id: string;
  site_id: string;
  unit_id: string;
  fiscal_period_id: string | null;
  accrual_type: string | null;
  description: string | null;
  amount: number;
  accrual_date: string;
  due_date: string | null;
  status: string;
};

type AllocationRow = {
  id: string;
  payment_id: string;
  accrual_id: string;
  amount: number;
};

type AccrualOutstanding = Accrual & {
  allocated: number;
  outstanding: number;
};

type Resident = {
  id: string;
  first_name: string;
  last_name: string;
};

type UnitResidentLink = {
  unit_id: string;
  resident_id: string;
  end_date: string | null;
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank: "Banka",
  cash: "Nakit",
  credit_card: "Kredi Kartı",
  other: "Diğer",
};

const METHOD_PILL: Record<PaymentMethod, string> = {
  bank: "pill-blue",
  cash: "pill-green",
  credit_card: "pill-amber",
  other: "pill-neutral",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amount);
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("tr-TR");
}

export default function PaymentsPage() {
  const { selectedSiteId, canWrite } = useAidat();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [unitResidentLinks, setUnitResidentLinks] = useState<UnitResidentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tahsilat Listesi filters
  const [filterUnitId, setFilterUnitId] = useState("");
  const [filterUnitSearch, setFilterUnitSearch] = useState("");
  const [filterUnitPickerOpen, setFilterUnitPickerOpen] = useState(false);
  const [filterResidentId, setFilterResidentId] = useState("");
  const [filterResidentSearch, setFilterResidentSearch] = useState("");
  const [filterResidentPickerOpen, setFilterResidentPickerOpen] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Create-payment form
  const [showForm, setShowForm] = useState(false);
  const [formUnitId, setFormUnitId] = useState("");
  const [formDate, setFormDate] = useState(todayStr());
  const [formAmount, setFormAmount] = useState("");
  const [formMethod, setFormMethod] = useState<PaymentMethod>("bank");
  const [formDescription, setFormDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Allocation step
  const [openAccruals, setOpenAccruals] = useState<AccrualOutstanding[]>([]);
  const [loadingAccruals, setLoadingAccruals] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({}); // accrual_id -> amount string
  // While true, entering an amount auto-fills the allocation split oldest-accrual-first —
  // this is the default so a site manager can just type "Daire, Tarih, Tutar" and have it
  // close out the oldest open dues automatically, without an extra manual step. Turned off
  // the moment the user edits an individual allocation cell by hand, so we never clobber a
  // deliberate manual split; the "Önerilen Dağıtımı Uygula" button re-enables it.
  const [autoAllocate, setAutoAllocate] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);

    const [blocksRes, unitsRes, paymentsRes, residentsRes] = await Promise.all([
      supabase.from("blocks").select("id, name").eq("site_id", selectedSiteId),
      supabase
        .from("units")
        .select("id, site_id, block_id, unit_number, active")
        .eq("site_id", selectedSiteId)
        .order("unit_number", { ascending: true }),
      supabase
        .from("payments")
        .select("id, site_id, unit_id, resident_id, payment_date, amount, method, description, status, voided_reason, created_at")
        .eq("site_id", selectedSiteId)
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("residents")
        .select("id, first_name, last_name")
        .eq("site_id", selectedSiteId)
        .order("first_name", { ascending: true }),
    ]);

    if (blocksRes.error) {
      setError(blocksRes.error.message);
    } else if (unitsRes.error) {
      setError(unitsRes.error.message);
    } else if (paymentsRes.error) {
      setError(paymentsRes.error.message);
    } else if (residentsRes.error) {
      setError(residentsRes.error.message);
    } else {
      const unitList = (unitsRes.data ?? []) as Unit[];
      setBlocks((blocksRes.data ?? []) as Block[]);
      setUnits(unitList);
      setPayments((paymentsRes.data ?? []) as Payment[]);
      setResidents((residentsRes.data ?? []) as Resident[]);

      const unitIds = unitList.map((u) => u.id);
      if (unitIds.length > 0) {
        const linksRes = await supabase
          .from("unit_residents")
          .select("unit_id, resident_id, end_date")
          .in("unit_id", unitIds);
        if (linksRes.error) {
          setError(linksRes.error.message);
        } else {
          setUnitResidentLinks((linksRes.data ?? []) as UnitResidentLink[]);
        }
      } else {
        setUnitResidentLinks([]);
      }
    }
    setLoading(false);
  }, [selectedSiteId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const blockName = useCallback(
    (blockId: string | null) => blocks.find((b) => b.id === blockId)?.name ?? null,
    [blocks]
  );

  const unitLabel = useCallback(
    (unitId: string) => {
      const unit = units.find((u) => u.id === unitId);
      if (!unit) return "—";
      const bName = blockName(unit.block_id);
      return bName ? `${bName} — ${unit.unit_number}` : unit.unit_number;
    },
    [units, blockName]
  );

  const residentLabel = useCallback(
    (residentId: string) => {
      const r = residents.find((x) => x.id === residentId);
      return r ? `${r.first_name} ${r.last_name}` : "—";
    },
    [residents]
  );

  // Units currently (end_date null) or ever linked to a resident — used to
  // resolve "kişi" filter -> the unit ids that resident's payments would be
  // under. payments.resident_id itself is rarely populated (payments are
  // recorded per-unit, not per-resident), so filtering by person has to go
  // through unit_residents rather than a direct column match.
  const unitIdsByResident = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of unitResidentLinks) {
      if (!map.has(link.resident_id)) map.set(link.resident_id, new Set());
      map.get(link.resident_id)!.add(link.unit_id);
    }
    return map;
  }, [unitResidentLinks]);

  const filteredUnitsForPicker = useMemo(() => {
    const q = filterUnitSearch.trim().toLocaleLowerCase("tr");
    if (!q) return units;
    return units.filter((u) => unitLabel(u.id).toLocaleLowerCase("tr").includes(q));
  }, [units, filterUnitSearch, unitLabel]);

  const filteredResidentsForPicker = useMemo(() => {
    const q = filterResidentSearch.trim().toLocaleLowerCase("tr");
    if (!q) return residents;
    return residents.filter((r) => `${r.first_name} ${r.last_name}`.toLocaleLowerCase("tr").includes(q));
  }, [residents, filterResidentSearch]);

  const filteredPayments = useMemo(() => {
    const residentUnitIds = filterResidentId ? unitIdsByResident.get(filterResidentId) : null;
    return payments.filter((p) => {
      if (filterUnitId && p.unit_id !== filterUnitId) return false;
      if (residentUnitIds && !residentUnitIds.has(p.unit_id)) return false;
      if (filterDateFrom && p.payment_date < filterDateFrom) return false;
      if (filterDateTo && p.payment_date > filterDateTo) return false;
      return true;
    });
  }, [payments, filterUnitId, filterResidentId, unitIdsByResident, filterDateFrom, filterDateTo]);

  function clearFilters() {
    setFilterUnitId("");
    setFilterUnitSearch("");
    setFilterResidentId("");
    setFilterResidentSearch("");
    setFilterDateFrom("");
    setFilterDateTo("");
  }

  const hasActiveFilters = !!(filterUnitId || filterResidentId || filterDateFrom || filterDateTo);

  function openForm() {
    setFormUnitId(units[0]?.id ?? "");
    setFormDate(todayStr());
    setFormAmount("");
    setFormMethod("bank");
    setFormDescription("");
    setAllocations({});
    setOpenAccruals([]);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setFormUnitId("");
    setFormAmount("");
    setFormDescription("");
    setAllocations({});
    setOpenAccruals([]);
  }

  // Load outstanding accruals for the selected unit whenever unit changes while form is open.
  const loadOutstandingAccruals = useCallback(
    async (unitId: string) => {
      if (!unitId || !selectedSiteId) {
        setOpenAccruals([]);
        return;
      }
      setLoadingAccruals(true);
      const accrualsRes = await supabase
        .from("accruals")
        .select("id, site_id, unit_id, fiscal_period_id, accrual_type, description, amount, accrual_date, due_date, status")
        .eq("site_id", selectedSiteId)
        .eq("unit_id", unitId)
        .eq("status", "active")
        .order("accrual_date", { ascending: true });

      if (accrualsRes.error) {
        setError(accrualsRes.error.message);
        setLoadingAccruals(false);
        return;
      }

      const accrualsData = (accrualsRes.data ?? []) as Accrual[];
      const accrualIds = accrualsData.map((a) => a.id);

      const allocatedByAccrual = new Map<string, number>();
      if (accrualIds.length > 0) {
        const allocRes = await supabase
          .from("payment_allocations")
          .select("id, payment_id, accrual_id, amount")
          .in("accrual_id", accrualIds);

        if (allocRes.error) {
          setError(allocRes.error.message);
          setLoadingAccruals(false);
          return;
        }

        const allAllocations = (allocRes.data ?? []) as AllocationRow[];
        for (const alloc of allAllocations) {
          allocatedByAccrual.set(alloc.accrual_id, (allocatedByAccrual.get(alloc.accrual_id) ?? 0) + alloc.amount);
        }
      }

      const withOutstanding: AccrualOutstanding[] = accrualsData
        .map((a) => {
          const allocated = allocatedByAccrual.get(a.id) ?? 0;
          const outstanding = Math.max(0, a.amount - allocated);
          return { ...a, allocated, outstanding };
        })
        .filter((a) => a.outstanding > 0);

      setOpenAccruals(withOutstanding);
      setLoadingAccruals(false);
    },
    [selectedSiteId]
  );

  useEffect(() => {
    if (showForm && formUnitId) {
      loadOutstandingAccruals(formUnitId);
      setAllocations({});
      setAutoAllocate(true);
    } else {
      setOpenAccruals([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formUnitId, showForm]);

  const suggestAllocations = useCallback(() => {
    const total = Number(formAmount);
    if (!total || total <= 0 || openAccruals.length === 0) {
      setAllocations({});
      return;
    }
    let remaining = total;
    const next: Record<string, string> = {};
    for (const a of openAccruals) {
      if (remaining <= 0) break;
      const take = Math.min(a.outstanding, remaining);
      if (take > 0) {
        next[a.id] = String(Math.round(take * 100) / 100);
        remaining -= take;
      }
    }
    setAllocations(next);
  }, [formAmount, openAccruals]);

  // Default flow: as soon as amount + open accruals are known, auto-close the oldest open
  // dues first — the site manager doesn't have to touch the allocation table at all for the
  // common case of "one payment settles the oldest outstanding month(s)".
  useEffect(() => {
    if (autoAllocate) suggestAllocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formAmount, openAccruals, autoAllocate]);

  function applySuggestedAllocations() {
    setAutoAllocate(true);
    suggestAllocations();
  }

  function updateAllocation(accrualId: string, value: string) {
    setAutoAllocate(false);
    setAllocations((prev) => ({ ...prev, [accrualId]: value }));
  }

  const allocationTotal = useMemo(() => {
    return Object.values(allocations).reduce((sum, v) => {
      const n = Number(v);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [allocations]);

  const paymentAmountNum = Number(formAmount) || 0;
  const allocationExceedsPayment = allocationTotal > paymentAmountNum + 0.001;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !formUnitId || !formAmount) return;
    const amountNum = Number(formAmount);
    if (!(amountNum > 0)) {
      setError("Tutar 0'dan büyük olmalı.");
      return;
    }
    if (allocationExceedsPayment) {
      setError("Dağıtılan tutar ödeme tutarını aşamaz.");
      return;
    }

    setSaving(true);
    setError(null);

    const { data: userData } = await supabase.auth.getUser();

    const { data: inserted, error: insertError } = await supabase
      .from("payments")
      .insert({
        site_id: selectedSiteId,
        unit_id: formUnitId,
        payment_date: formDate,
        amount: amountNum,
        method: formMethod,
        description: formDescription.trim() || null,
        status: "active",
        created_by: userData.user?.id ?? null,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      setSaving(false);
      setError(insertError?.message ?? "Ödeme kaydedilemedi.");
      return;
    }

    const allocationEntries = Object.entries(allocations)
      .map(([accrualId, val]) => ({ accrual_id: accrualId, amount: Number(val) }))
      .filter((a) => a.amount > 0);

    if (allocationEntries.length > 0) {
      const { error: allocError } = await supabase.from("payment_allocations").insert(
        allocationEntries.map((a) => ({
          payment_id: inserted.id,
          accrual_id: a.accrual_id,
          amount: a.amount,
        }))
      );
      if (allocError) {
        setSaving(false);
        setError(
          `Ödeme kaydedildi ancak dağıtım sırasında hata oluştu: ${allocError.message}`
        );
        await fetchAll();
        return;
      }
    }

    setSaving(false);
    closeForm();
    await fetchAll();
  }

  function buildPaymentsExportColumns(): ExportColumn[] {
    return [
      { header: "Daire", value: (row) => unitLabel((row as unknown as Payment).unit_id) },
      { header: "Tarih", value: (row) => formatDate((row as unknown as Payment).payment_date) },
      { header: "Tutar", value: (row) => (row as unknown as Payment).amount },
      { header: "Yöntem", value: (row) => METHOD_LABELS[(row as unknown as Payment).method] },
      { header: "Açıklama", value: (row) => (row as unknown as Payment).description ?? "—" },
      {
        header: "Durum",
        value: (row) => ((row as unknown as Payment).status === "active" ? "Aktif" : "İptal"),
      },
    ];
  }

  function handleExportPaymentsExcel() {
    exportRowsToExcel(filteredPayments as unknown as Record<string, unknown>[], buildPaymentsExportColumns(), {
      title: "Tahsilatlar",
    });
  }

  function handleExportPaymentsPdf() {
    exportRowsToPdf(filteredPayments as unknown as Record<string, unknown>[], buildPaymentsExportColumns(), {
      title: "Tahsilatlar",
    });
  }

  async function handleVoid(payment: Payment) {
    if (!canWrite) return;
    const reason = window.prompt("İptal nedeni:");
    if (reason === null) return;
    setError(null);
    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "void", voided_reason: reason || null })
      .eq("id", payment.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await fetchAll();
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  return (
    <div>
      {error && (
        <div className="auth-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Tahsilatlar</div>
          {canWrite && (
            <button className="btn-secondary" onClick={() => (showForm ? closeForm() : openForm())}>
              {showForm ? "Vazgeç" : "+ Tahsilat Ekle"}
            </button>
          )}
        </div>

        {showForm && canWrite && (
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <label className="auth-field">
                <span>Daire{units.length === 0 ? " (yok)" : ""}</span>
                <select
                  value={formUnitId}
                  onChange={(e) => setFormUnitId(e.target.value)}
                  required
                  disabled={units.length === 0}
                >
                  <option value="" disabled>
                    Seçiniz
                  </option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {unitLabel(u.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-field">
                <span>Tarih</span>
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} required />
              </label>
              <label className="auth-field">
                <span>Tutar</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  required
                  placeholder="0.00"
                />
              </label>
              <label className="auth-field">
                <span>Yöntem</span>
                <select value={formMethod} onChange={(e) => setFormMethod(e.target.value as PaymentMethod)}>
                  {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-field">
                <span>Açıklama</span>
                <input
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="opsiyonel"
                />
              </label>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  className="btn-primary"
                  type="submit"
                  disabled={saving || !formUnitId || !formAmount || allocationExceedsPayment}
                >
                  {saving ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div className="panel-title" style={{ fontSize: 13 }}>
                  Açık Tahakkuklara Dağıtım {autoAllocate ? "(otomatik — en eski borçtan kapatılıyor)" : "(manuel)"}
                </div>
                {openAccruals.length > 0 && !autoAllocate && (
                  <button type="button" className="btn-secondary" onClick={applySuggestedAllocations}>
                    Önerilen Dağıtımı Uygula
                  </button>
                )}
              </div>

              {!formUnitId ? (
                <div className="empty-state">Önce daire seçin.</div>
              ) : loadingAccruals ? (
                <div className="empty-state">Yükleniyor…</div>
              ) : openAccruals.length === 0 ? (
                <div className="empty-state">Bu dairenin açık tahakkuku yok.</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Tarih</th>
                        <th>Açıklama</th>
                        <th className="num">Tutar</th>
                        <th className="num">Kalan</th>
                        <th className="num">Dağıtılan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openAccruals.map((a) => (
                        <tr key={a.id}>
                          <td>{formatDate(a.accrual_date)}</td>
                          <td className="wrap">{a.description ?? a.accrual_type ?? "—"}</td>
                          <td className="num">{formatCurrency(a.amount)}</td>
                          <td className="num">{formatCurrency(a.outstanding)}</td>
                          <td className="num">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max={a.outstanding}
                              value={allocations[a.id] ?? ""}
                              onChange={(e) => updateAllocation(a.id, e.target.value)}
                              style={{ width: 100 }}
                              placeholder="0.00"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {openAccruals.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: allocationExceedsPayment ? "var(--coral)" : "var(--text3)" }}>
                  Dağıtılan toplam: {formatCurrency(allocationTotal)} / Ödeme tutarı: {formatCurrency(paymentAmountNum)}
                  {allocationExceedsPayment && " — dağıtım tutarı ödeme tutarını aşıyor!"}
                </div>
              )}
            </div>
          </form>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Tahsilat Listesi</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={filteredPayments.length === 0}
              onClick={handleExportPaymentsExcel}
            >
              Excel İndir
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={filteredPayments.length === 0}
              onClick={handleExportPaymentsPdf}
            >
              PDF İndir
            </button>
            {hasActiveFilters && (
              <button className="btn-secondary" onClick={clearFilters}>
                Filtreleri Temizle
              </button>
            )}
          </div>
        </div>

        <div className="form-grid">
          <label className="auth-field" style={{ position: "relative" }}>
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
                {filteredUnitsForPicker.length === 0 ? (
                  <div className="unit-picker-empty">Eşleşen daire yok.</div>
                ) : (
                  filteredUnitsForPicker.map((u) => (
                    <button
                      type="button"
                      key={u.id}
                      className="unit-picker-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setFilterUnitId(u.id);
                        setFilterUnitSearch(unitLabel(u.id));
                        setFilterUnitPickerOpen(false);
                      }}
                    >
                      {unitLabel(u.id)}
                    </button>
                  ))
                )}
              </div>
            )}
          </label>

          <label className="auth-field" style={{ position: "relative" }}>
            <span>Kişi (Sakin)</span>
            <input
              type="text"
              value={filterResidentSearch}
              placeholder="Ad soyad yazın…"
              disabled={residents.length === 0}
              onFocus={() => setFilterResidentPickerOpen(true)}
              onChange={(e) => {
                setFilterResidentSearch(e.target.value);
                setFilterResidentPickerOpen(true);
                if (filterResidentId) setFilterResidentId("");
              }}
              onBlur={() => setTimeout(() => setFilterResidentPickerOpen(false), 150)}
            />
            {filterResidentPickerOpen && (
              <div className="unit-picker-dropdown">
                <button
                  type="button"
                  className="unit-picker-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setFilterResidentId("");
                    setFilterResidentSearch("");
                    setFilterResidentPickerOpen(false);
                  }}
                >
                  Tüm sakinler
                </button>
                {filteredResidentsForPicker.length === 0 ? (
                  <div className="unit-picker-empty">Eşleşen sakin yok.</div>
                ) : (
                  filteredResidentsForPicker.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      className="unit-picker-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setFilterResidentId(r.id);
                        setFilterResidentSearch(residentLabel(r.id));
                        setFilterResidentPickerOpen(false);
                      }}
                    >
                      {residentLabel(r.id)}
                    </button>
                  ))
                )}
              </div>
            )}
          </label>

          <label className="auth-field">
            <span>Başlangıç Tarihi</span>
            <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
          </label>
          <label className="auth-field">
            <span>Bitiş Tarihi</span>
            <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
          </label>
        </div>

        {payments.length === 0 ? (
          <div className="empty-state">Henüz tahsilat kaydı yok.</div>
        ) : filteredPayments.length === 0 ? (
          <div className="empty-state">Filtrelere uyan tahsilat yok.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Daire</th>
                  <th>Tarih</th>
                  <th className="num">Tutar</th>
                  <th>Yöntem</th>
                  <th>Açıklama</th>
                  <th>Durum</th>
                  {canWrite && <th>Aksiyon</th>}
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((p) => (
                  <tr key={p.id}>
                    <td>{unitLabel(p.unit_id)}</td>
                    <td>{formatDate(p.payment_date)}</td>
                    <td className="num">{formatCurrency(p.amount)}</td>
                    <td>
                      <span className={`pill ${METHOD_PILL[p.method]}`}>{METHOD_LABELS[p.method]}</span>
                    </td>
                    <td className="wrap">
                      {p.description ?? "—"}
                      {p.status === "void" && p.voided_reason && (
                        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                          İptal nedeni: {p.voided_reason}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${p.status === "active" ? "pill-green" : "pill-neutral"}`}>
                        {p.status === "active" ? "Aktif" : "İptal"}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        {p.status === "active" && (
                          <button className="btn-danger" onClick={() => handleVoid(p)}>
                            İptal Et
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
