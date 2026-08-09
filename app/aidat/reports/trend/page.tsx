"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";
import { exportRowsToExcel, exportRowsToPdf, type ExportColumn } from "@/lib/exportTable";

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

const MONTH_NAMES = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

// Hard cap on the picker range so a mis-set start/end can never trigger an
// unbounded fiscal_periods scan or an oversized in-memory table.
const MAX_MONTHS = 24;

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function unwrap<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

function stripSegmentPrefix(segment: string): string {
  return segment.replace(/^\d+\.\s*/, "");
}

// year*12 + (month-1) — a simple linear index over (year, month) pairs so
// range math (length, clamping, iteration) is plain integer arithmetic.
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromMonthIndex(idx: number): { year: number; month: number } {
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

function shiftMonths(year: number, month: number, delta: number): { year: number; month: number } {
  return fromMonthIndex(monthIndex(year, month) + delta);
}

type PeriodRow = { id: string; year: number; month: number };
type AccrualRow = { amount: number; fiscal_period_id: string };
type ExpenseCategoryJoin = { opex_capex: string; main_segment: string };
type ExpenseRow = { amount: number; fiscal_period_id: string; expense_category: ExpenseCategoryJoin | ExpenseCategoryJoin[] | null };
type AllocAccrualJoin = { fiscal_period_id: string; site_id: string; status: string };
type AllocPaymentJoin = { status: string };
type AllocationRow = {
  amount: number;
  accruals: AllocAccrualJoin | AllocAccrualJoin[] | null;
  payments: AllocPaymentJoin | AllocPaymentJoin[] | null;
};

type MonthRow = {
  year: number;
  month: number;
  periodId: string | null;
  accrued: number;
  collected: number;
  opex: number;
  capex: number;
  result: number; // Aidat Tahakkuku - Toplam Gider (OPEX)
};

type SegmentShare = { key: string; label: string; amount: number; pct: number };

export default function TrendReportPage() {
  const { selectedSiteId, year: shellYear, month: shellMonth } = useAidat();

  // Range picker state — defaults to the trailing 12 months ending at the
  // shell's currently-selected period. Left untouched, start === end - 11;
  // narrowed down to a single month (start === end) it degrades gracefully
  // to a one-row trend, no special-casing needed downstream.
  const defaultEnd = useMemo(() => ({ year: shellYear, month: shellMonth }), [shellYear, shellMonth]);
  const defaultStart = useMemo(() => shiftMonths(defaultEnd.year, defaultEnd.month, -11), [defaultEnd]);

  const [startYear, setStartYear] = useState(defaultStart.year);
  const [startMonth, setStartMonth] = useState(defaultStart.month);
  const [endYear, setEndYear] = useState(defaultEnd.year);
  const [endMonth, setEndMonth] = useState(defaultEnd.month);

  function resetToTrailing12() {
    setStartYear(defaultStart.year);
    setStartMonth(defaultStart.month);
    setEndYear(defaultEnd.year);
    setEndMonth(defaultEnd.month);
  }

  // If the user picks a start after the end (either field, either
  // direction), self-correct the PICKER'S OWN state by swapping start/end —
  // not just the internal query range below. Without this, the dropdowns
  // themselves could keep showing an inverted, confusing selection (e.g.
  // "Başlangıç: Eylül 2026" / "Bitiş: Ağustos 2026") even though the query
  // silently used the swapped, valid range underneath.
  useEffect(() => {
    const startIdx = monthIndex(startYear, startMonth);
    const endIdx = monthIndex(endYear, endMonth);
    if (startIdx > endIdx) {
      setStartYear(endYear);
      setStartMonth(endMonth);
      setEndYear(startYear);
      setEndMonth(startMonth);
    }
  }, [startYear, startMonth, endYear, endMonth]);

  // Normalize + clamp the picker into an ascending, capped list of (year,
  // month) pairs. Trims from the front if the span exceeds MAX_MONTHS, so
  // the query side never has to worry about it. (Reversed start/end is
  // handled above by correcting the picker state directly, not here.)
  const { months: rangeMonths, clamped } = useMemo(() => {
    let startIdx = monthIndex(startYear, startMonth);
    let endIdx = monthIndex(endYear, endMonth);
    let wasClamped = false;
    if (endIdx - startIdx + 1 > MAX_MONTHS) {
      startIdx = endIdx - (MAX_MONTHS - 1);
      wasClamped = true;
    }
    const list: { year: number; month: number }[] = [];
    for (let idx = startIdx; idx <= endIdx; idx++) {
      list.push(fromMonthIndex(idx));
    }
    return { months: list, clamped: wasClamped };
  }, [startYear, startMonth, endYear, endMonth]);

  const yearOptions = useMemo(() => {
    const base = shellYear;
    return Array.from({ length: 10 }, (_, i) => base - 7 + i);
  }, [shellYear]);

  const [monthRows, setMonthRows] = useState<MonthRow[]>([]);
  const [segmentShares, setSegmentShares] = useState<SegmentShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);

    try {
      const rangeStartYear = rangeMonths[0].year;
      const rangeEndYear = rangeMonths[rangeMonths.length - 1].year;
      const rangeStartIdx = monthIndex(rangeMonths[0].year, rangeMonths[0].month);
      const rangeEndIdx = monthIndex(rangeMonths[rangeMonths.length - 1].year, rangeMonths[rangeMonths.length - 1].month);

      // Read-only page: resolve fiscal_periods rows without creating any
      // (get_or_create_fiscal_period is a write RPC — see app/aidat/reports/page.tsx
      // for why that's unsafe to call from a page that's just being viewed).
      // A single range-bounded query covers every month in the picker instead
      // of one query per month.
      const periodsRes = await supabase
        .from("fiscal_periods")
        .select("id, year, month")
        .eq("site_id", selectedSiteId)
        .gte("year", rangeStartYear)
        .lte("year", rangeEndYear);
      if (periodsRes.error) throw periodsRes.error;

      const periods = ((periodsRes.data ?? []) as PeriodRow[]).filter((p) => {
        const idx = monthIndex(p.year, p.month);
        return idx >= rangeStartIdx && idx <= rangeEndIdx;
      });

      const periodById = new Map<string, PeriodRow>();
      const periodIdByYm = new Map<string, string>(); // "year-month" -> id
      for (const p of periods) {
        periodById.set(p.id, p);
        periodIdByYm.set(`${p.year}-${p.month}`, p.id);
      }
      const periodIds = periods.map((p) => p.id);

      const accruedByPeriod = new Map<string, number>();
      const opexByPeriod = new Map<string, number>();
      const capexByPeriod = new Map<string, number>();
      const collectedByPeriod = new Map<string, number>();
      const segmentTotals = new Map<string, number>();

      if (periodIds.length > 0) {
        const [accrualsRes, expensesRes, allocRes] = await Promise.all([
          supabase
            .from("accruals")
            .select("amount, fiscal_period_id")
            .eq("site_id", selectedSiteId)
            .eq("status", "active")
            .in("fiscal_period_id", periodIds),
          supabase
            .from("expenses")
            .select("amount, fiscal_period_id, expense_category:expense_categories!inner(opex_capex, main_segment)")
            .eq("site_id", selectedSiteId)
            .eq("status", "active")
            .in("fiscal_period_id", periodIds),
          // Same allocation-based collection definition as the dashboard:
          // payment_allocations tied to active accruals in these periods,
          // restricted to active (non-voided) payments.
          supabase
            .from("payment_allocations")
            .select("amount, accruals!inner(fiscal_period_id, site_id, status), payments!inner(status)")
            .in("accruals.fiscal_period_id", periodIds)
            .eq("accruals.site_id", selectedSiteId)
            .eq("accruals.status", "active")
            .eq("payments.status", "active"),
        ]);

        if (accrualsRes.error) throw accrualsRes.error;
        if (expensesRes.error) throw expensesRes.error;
        if (allocRes.error) throw allocRes.error;

        for (const row of (accrualsRes.data ?? []) as AccrualRow[]) {
          accruedByPeriod.set(row.fiscal_period_id, (accruedByPeriod.get(row.fiscal_period_id) ?? 0) + row.amount);
        }

        for (const row of (expensesRes.data ?? []) as ExpenseRow[]) {
          const cat = unwrap(row.expense_category);
          if (!cat) continue;
          if (cat.opex_capex === "OPEX") {
            opexByPeriod.set(row.fiscal_period_id, (opexByPeriod.get(row.fiscal_period_id) ?? 0) + row.amount);
            segmentTotals.set(cat.main_segment, (segmentTotals.get(cat.main_segment) ?? 0) + row.amount);
          } else if (cat.opex_capex === "CAPEX") {
            capexByPeriod.set(row.fiscal_period_id, (capexByPeriod.get(row.fiscal_period_id) ?? 0) + row.amount);
          }
        }

        for (const row of (allocRes.data ?? []) as AllocationRow[]) {
          const accrual = unwrap(row.accruals);
          if (!accrual) continue;
          collectedByPeriod.set(
            accrual.fiscal_period_id,
            (collectedByPeriod.get(accrual.fiscal_period_id) ?? 0) + row.amount
          );
        }
      }

      const rows: MonthRow[] = rangeMonths.map(({ year, month }) => {
        const periodId = periodIdByYm.get(`${year}-${month}`) ?? null;
        const accrued = periodId ? accruedByPeriod.get(periodId) ?? 0 : 0;
        const collected = periodId ? collectedByPeriod.get(periodId) ?? 0 : 0;
        const opex = periodId ? opexByPeriod.get(periodId) ?? 0 : 0;
        const capex = periodId ? capexByPeriod.get(periodId) ?? 0 : 0;
        return { year, month, periodId, accrued, collected, opex, capex, result: accrued - opex };
      });
      rows.reverse(); // newest first — management view convention

      const segmentTotalSum = Array.from(segmentTotals.values()).reduce((s, v) => s + v, 0);
      const shares: SegmentShare[] = Array.from(segmentTotals.entries())
        .filter(([, amount]) => amount !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([segment, amount]) => ({
          key: segment,
          label: stripSegmentPrefix(segment),
          amount,
          pct: segmentTotalSum > 0 ? (amount / segmentTotalSum) * 100 : 0,
        }));

      setMonthRows(rows);
      setSegmentShares(shares);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rapor yüklenirken hata oluştu.");
      setLoading(false);
    }
    // rangeMonths is a derived array (new identity each render); depend on
    // its underlying primitives instead so this only re-runs when the
    // picker's actual bounds change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId, startYear, startMonth, endYear, endMonth]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  const totalAccrued = monthRows.reduce((s, r) => s + r.accrued, 0);
  const totalCollected = monthRows.reduce((s, r) => s + r.collected, 0);
  const totalOpex = monthRows.reduce((s, r) => s + r.opex, 0);
  const totalCapex = monthRows.reduce((s, r) => s + r.capex, 0);
  const allZero = totalAccrued === 0 && totalCollected === 0 && totalOpex === 0 && totalCapex === 0;

  const maxOpex = Math.max(0, ...monthRows.map((r) => r.opex));
  const maxCollected = Math.max(0, ...monthRows.map((r) => r.collected));

  const rangeLabel = rangeMonths.length === 1
    ? `${MONTH_NAMES[rangeMonths[0].month - 1]} ${rangeMonths[0].year}`
    : `${MONTH_NAMES[rangeMonths[0].month - 1]} ${rangeMonths[0].year} — ${MONTH_NAMES[rangeMonths[rangeMonths.length - 1].month - 1]} ${rangeMonths[rangeMonths.length - 1].year}`;

  const trendExportRows = monthRows.map((row) => {
    const collectionRate = row.accrued > 0 ? (row.collected / row.accrued) * 100 : null;
    return {
      period: `${MONTH_NAMES[row.month - 1]} ${row.year}`,
      accrued: row.accrued,
      collected: row.collected,
      collectionRate: collectionRate === null ? "—" : formatPercent(collectionRate),
      opex: row.opex,
      capex: row.capex,
      result: row.result,
    };
  });

  const trendExportColumns: ExportColumn[] = [
    { header: "Dönem", value: (row) => row.period as string },
    { header: "Aidat Tahakkuku", value: (row) => row.accrued as number },
    { header: "Tahsilat", value: (row) => row.collected as number },
    { header: "Tahsilat Oranı", value: (row) => row.collectionRate as string },
    { header: "Gider (OPEX)", value: (row) => row.opex as number },
    { header: "Gider (CAPEX)", value: (row) => row.capex as number },
    { header: "Faaliyet Fazlası/Açığı", value: (row) => row.result as number },
  ];

  function handleExportTrendExcel() {
    if (trendExportRows.length === 0) return;
    exportRowsToExcel(trendExportRows, trendExportColumns, {
      title: "Trend Analizi",
      subtitle: rangeLabel,
      sheetName: "Trend",
    });
  }

  function handleExportTrendPdf() {
    if (trendExportRows.length === 0) return;
    exportRowsToPdf(trendExportRows, trendExportColumns, {
      title: "Trend Analizi",
      subtitle: rangeLabel,
    });
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Dönem Aralığı</div>
          <button className="btn-secondary" type="button" onClick={resetToTrailing12}>
            Son 12 Aya Dön
          </button>
        </div>
        <div className="form-grid">
          <label className="auth-field">
            <span>Başlangıç Ayı</span>
            <select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Başlangıç Yılı</span>
            <select value={startYear} onChange={(e) => setStartYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Bitiş Ayı</span>
            <select value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Bitiş Yılı</span>
            <select value={endYear} onChange={(e) => setEndYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
        <p style={{ fontSize: 12, color: "var(--text3)" }}>
          Seçili aralık: {rangeLabel} ({rangeMonths.length} ay)
          {clamped && " — aralık en fazla 24 ay ile sınırlıdır, başlangıç otomatik olarak öne çekildi."}
        </p>
      </div>

      {allZero && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Seçili aralıkta ({rangeLabel}) henüz tahakkuk, tahsilat veya gider kaydı yok.
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Aylık Karşılaştırma — {rangeLabel}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={trendExportRows.length === 0}
              onClick={handleExportTrendExcel}
            >
              Excel İndir
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={trendExportRows.length === 0}
              onClick={handleExportTrendPdf}
            >
              PDF İndir
            </button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
          Faaliyet Fazlası/Açığı = Aidat Tahakkuku − Toplam Gider (OPEX). CAPEX ve diğer gelir/gider kalemleri bu
          hesaba dahil değildir; ayrıntılı gelir tablosu için Raporlar sayfasına bakınız. fiscal_periods kaydı
          bulunmayan aylar sıfır olarak gösterilir.
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Dönem</th>
                <th className="num">Aidat Tahakkuku</th>
                <th className="num">Tahsilat</th>
                <th className="num">Tahsilat Oranı</th>
                <th className="num">Gider (OPEX)</th>
                <th className="num">Gider (CAPEX)</th>
                <th className="num">Faaliyet Fazlası/Açığı</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((row) => {
                const collectionRate = row.accrued > 0 ? (row.collected / row.accrued) * 100 : null;
                const opexBarPct = maxOpex > 0 ? (row.opex / maxOpex) * 100 : 0;
                const collectedBarPct = maxCollected > 0 ? (row.collected / maxCollected) * 100 : 0;
                return (
                  <tr key={`${row.year}-${row.month}`}>
                    <td>{MONTH_NAMES[row.month - 1]} {row.year}</td>
                    <td className="num">{currency.format(row.accrued)}</td>
                    <td className="num">
                      <div>{currency.format(row.collected)}</div>
                      <div style={{ height: 4, background: "var(--bg3)", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${collectedBarPct}%`, background: "var(--green)", borderRadius: 2 }} />
                      </div>
                    </td>
                    <td className="num">{collectionRate === null ? "—" : formatPercent(collectionRate)}</td>
                    <td className="num">
                      <div>{currency.format(row.opex)}</div>
                      <div style={{ height: 4, background: "var(--bg3)", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${opexBarPct}%`, background: "var(--coral)", borderRadius: 2 }} />
                      </div>
                    </td>
                    <td className="num">{currency.format(row.capex)}</td>
                    <td className="num" style={{ color: row.result >= 0 ? "var(--green)" : "var(--coral)" }}>
                      {currency.format(row.result)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Gider Dağılımı (OPEX) — {rangeLabel}</div>
        </div>
        {segmentShares.length === 0 ? (
          <div className="empty-state">Seçili aralık için OPEX gider kaydı yok.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {segmentShares.map((seg) => (
              <div key={seg.key}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span>{seg.label}</span>
                  <span style={{ color: "var(--text2)" }}>
                    {currency.format(seg.amount)} <span style={{ color: "var(--text3)" }}>({formatPercent(seg.pct)})</span>
                  </span>
                </div>
                <div style={{ height: 10, background: "var(--bg3)", borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${seg.pct}%`, background: "var(--blue)", borderRadius: 5 }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
