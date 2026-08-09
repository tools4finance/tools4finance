"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

const MONTH_NAMES = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const MONTH_ABBR = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

// Hard cap on the picker range. Unlike the trend page (one row per month,
// 24-month cap is fine), each month here becomes a table *column* — beyond
// ~12 side-by-side columns the statement stops being readable, so the cap
// is tighter.
const MAX_MONTHS = 12;

// Financial (non-operational) income is separately trackable via the
// "Finansal Gelirler" income_category group (e.g. deposit interest) — see
// income_categories seed data and app/aidat/reports/page.tsx. There is no
// equivalent isolated main_segment for financial *expenses*: bank charges
// live inside the "8. Yönetim Giderleri" main_segment mixed with unrelated
// management costs, so we cannot honestly split them out at the
// main_segment granularity this report otherwise uses. P is therefore
// always shown as 0 with a note rather than guessing at a split the schema
// doesn't support.
const FINANCIAL_INCOME_GROUP = "Finansal Gelirler";

function unwrap<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

function stripSegmentPrefix(segment: string): string {
  return segment.replace(/^\d+\.\s*/, "");
}

function segmentOrder(segment: string): number {
  const match = segment.match(/^(\d+)\./);
  return match ? parseInt(match[1], 10) : 999;
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

type IncomeCategoryJoin = { group_name: string };
type IncomeRow = {
  amount: number;
  fiscal_period_id: string;
  income_category: IncomeCategoryJoin | IncomeCategoryJoin[] | null;
};

type ExpenseCategoryJoin = { main_segment: string; name: string; opex_capex: string };
type ExpenseRow = {
  amount: number;
  fiscal_period_id: string;
  expense_category: ExpenseCategoryJoin | ExpenseCategoryJoin[] | null;
};

type PeriodKey = { year: number; month: number };

// Per-period computed A-Q figures, keyed by the period's position in the
// (chronological) column list.
type PeriodTotals = {
  year: number;
  month: number;
  periodId: string | null;
  aidatGelirleri: number; // A
  digerOperasyonelGelirler: number; // B
  toplamGelir: number; // C = A + B
  opexBySegment: Map<string, number>; // D-L, keyed by main_segment
  toplamOperasyonelGider: number; // M
  faaliyetSonucu: number; // N = C - M
  finansalGelirler: number; // O
  finansalGiderler: number; // P (always 0, see note)
  donemSonucu: number; // Q = N + O - P
  capexByCategory: Map<string, number>;
  capexTotal: number;
};

function periodLabel(year: number, month: number): string {
  return `${MONTH_ABBR[month - 1]} ${year}`;
}

function periodLabelFull(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export default function ComparisonReportPage() {
  const { selectedSiteId, year: shellYear, month: shellMonth } = useAidat();

  // Range picker — defaults to the trailing 6 months ending at the shell's
  // currently-selected period (narrower than the trend page's 12, since
  // each month becomes a column here rather than a row).
  const defaultEnd = useMemo(() => ({ year: shellYear, month: shellMonth }), [shellYear, shellMonth]);
  const defaultStart = useMemo(() => shiftMonths(defaultEnd.year, defaultEnd.month, -5), [defaultEnd]);

  const [startYear, setStartYear] = useState(defaultStart.year);
  const [startMonth, setStartMonth] = useState(defaultStart.month);
  const [endYear, setEndYear] = useState(defaultEnd.year);
  const [endMonth, setEndMonth] = useState(defaultEnd.month);

  function resetToTrailing6() {
    setStartYear(defaultStart.year);
    setStartMonth(defaultStart.month);
    setEndYear(defaultEnd.year);
    setEndMonth(defaultEnd.month);
  }

  // If the user picks a start after the end, self-correct the PICKER'S OWN
  // state by swapping start/end — not just the internal query range below —
  // so the dropdowns never keep showing an inverted, confusing selection.
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
    const list: PeriodKey[] = [];
    for (let idx = startIdx; idx <= endIdx; idx++) {
      list.push(fromMonthIndex(idx));
    }
    return { months: list, clamped: wasClamped };
  }, [startYear, startMonth, endYear, endMonth]);

  const yearOptions = useMemo(() => {
    const base = shellYear;
    return Array.from({ length: 10 }, (_, i) => base - 7 + i);
  }, [shellYear]);

  const [periodTotals, setPeriodTotals] = useState<PeriodTotals[]>([]);
  const [opexSegments, setOpexSegments] = useState<string[]>([]);
  const [capexCategories, setCapexCategories] = useState<string[]>([]);
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
      // (get_or_create_fiscal_period is a write RPC and would fail RLS for
      // viewer-role users — see app/aidat/reports/page.tsx). One
      // range-bounded query covers every month in the picker instead of a
      // per-month query.
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

      const periodIdByYm = new Map<string, string>();
      for (const p of periods) {
        periodIdByYm.set(`${p.year}-${p.month}`, p.id);
      }
      const periodIds = periods.map((p) => p.id);

      const aidatByPeriod = new Map<string, number>();
      const digerOperByPeriod = new Map<string, number>();
      const finansalGelirByPeriod = new Map<string, number>();
      const opexByPeriodSegment = new Map<string, Map<string, number>>();
      const capexByPeriodCategory = new Map<string, Map<string, number>>();

      if (periodIds.length > 0) {
        const [accrualsRes, incomesRes, expensesRes] = await Promise.all([
          supabase
            .from("accruals")
            .select("amount, fiscal_period_id")
            .eq("site_id", selectedSiteId)
            .eq("status", "active")
            .in("fiscal_period_id", periodIds),
          supabase
            .from("incomes")
            .select("amount, fiscal_period_id, income_category:income_categories(group_name)")
            .eq("site_id", selectedSiteId)
            .eq("status", "active")
            .in("fiscal_period_id", periodIds),
          supabase
            .from("expenses")
            .select("amount, fiscal_period_id, expense_category:expense_categories!inner(main_segment, name, opex_capex)")
            .eq("site_id", selectedSiteId)
            .eq("status", "active")
            .in("fiscal_period_id", periodIds),
        ]);

        if (accrualsRes.error) throw accrualsRes.error;
        if (incomesRes.error) throw incomesRes.error;
        if (expensesRes.error) throw expensesRes.error;

        for (const row of (accrualsRes.data ?? []) as AccrualRow[]) {
          aidatByPeriod.set(row.fiscal_period_id, (aidatByPeriod.get(row.fiscal_period_id) ?? 0) + row.amount);
        }

        for (const row of (incomesRes.data ?? []) as IncomeRow[]) {
          const cat = unwrap(row.income_category);
          if (cat?.group_name === FINANCIAL_INCOME_GROUP) {
            finansalGelirByPeriod.set(
              row.fiscal_period_id,
              (finansalGelirByPeriod.get(row.fiscal_period_id) ?? 0) + row.amount
            );
          } else {
            digerOperByPeriod.set(
              row.fiscal_period_id,
              (digerOperByPeriod.get(row.fiscal_period_id) ?? 0) + row.amount
            );
          }
        }

        for (const row of (expensesRes.data ?? []) as ExpenseRow[]) {
          const cat = unwrap(row.expense_category);
          if (!cat) continue;
          if (cat.opex_capex === "OPEX") {
            const bySegment = opexByPeriodSegment.get(row.fiscal_period_id) ?? new Map<string, number>();
            bySegment.set(cat.main_segment, (bySegment.get(cat.main_segment) ?? 0) + row.amount);
            opexByPeriodSegment.set(row.fiscal_period_id, bySegment);
          } else if (cat.opex_capex === "CAPEX") {
            const byCategory = capexByPeriodCategory.get(row.fiscal_period_id) ?? new Map<string, number>();
            byCategory.set(cat.name, (byCategory.get(cat.name) ?? 0) + row.amount);
            capexByPeriodCategory.set(row.fiscal_period_id, byCategory);
          }
        }
      }

      // Union of segments/categories with nonzero spend in ANY period in
      // the range, so a line doesn't disappear just because one particular
      // month had zero for it.
      const segmentUnion = new Set<string>();
      for (const bySegment of opexByPeriodSegment.values()) {
        for (const [segment, amount] of bySegment.entries()) {
          if (amount !== 0) segmentUnion.add(segment);
        }
      }
      const sortedSegments = Array.from(segmentUnion).sort((a, b) => segmentOrder(a) - segmentOrder(b));

      const capexCategoryTotals = new Map<string, number>();
      for (const byCategory of capexByPeriodCategory.values()) {
        for (const [name, amount] of byCategory.entries()) {
          capexCategoryTotals.set(name, (capexCategoryTotals.get(name) ?? 0) + amount);
        }
      }
      const sortedCapexCategories = Array.from(capexCategoryTotals.entries())
        .filter(([, amount]) => amount !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);

      const totals: PeriodTotals[] = rangeMonths.map(({ year, month }) => {
        const periodId = periodIdByYm.get(`${year}-${month}`) ?? null;
        const aidatGelirleri = periodId ? aidatByPeriod.get(periodId) ?? 0 : 0;
        const digerOperasyonelGelirler = periodId ? digerOperByPeriod.get(periodId) ?? 0 : 0;
        const toplamGelir = aidatGelirleri + digerOperasyonelGelirler;
        const bySegment = (periodId ? opexByPeriodSegment.get(periodId) : undefined) ?? new Map<string, number>();
        const toplamOperasyonelGider = Array.from(bySegment.values()).reduce((s, v) => s + v, 0);
        const faaliyetSonucu = toplamGelir - toplamOperasyonelGider;
        const finansalGelirler = periodId ? finansalGelirByPeriod.get(periodId) ?? 0 : 0;
        const finansalGiderler = 0; // P — see FINANCIAL_INCOME_GROUP comment above
        const donemSonucu = faaliyetSonucu + finansalGelirler - finansalGiderler;
        const byCategory = (periodId ? capexByPeriodCategory.get(periodId) : undefined) ?? new Map<string, number>();
        const capexTotal = Array.from(byCategory.values()).reduce((s, v) => s + v, 0);

        return {
          year,
          month,
          periodId,
          aidatGelirleri,
          digerOperasyonelGelirler,
          toplamGelir,
          opexBySegment: bySegment,
          toplamOperasyonelGider,
          faaliyetSonucu,
          finansalGelirler,
          finansalGiderler,
          donemSonucu,
          capexByCategory: byCategory,
          capexTotal,
        };
      });

      setPeriodTotals(totals);
      setOpexSegments(sortedSegments);
      setCapexCategories(sortedCapexCategories);
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

  const rangeLabel = rangeMonths.length === 1
    ? periodLabelFull(rangeMonths[0].year, rangeMonths[0].month)
    : `${periodLabelFull(rangeMonths[0].year, rangeMonths[0].month)} — ${periodLabelFull(rangeMonths[rangeMonths.length - 1].year, rangeMonths[rangeMonths.length - 1].month)}`;

  const allZero = periodTotals.every(
    (p) => p.toplamGelir === 0 && p.toplamOperasyonelGider === 0 && p.finansalGelirler === 0 && p.capexTotal === 0
  );

  const capexGrandTotal = periodTotals.reduce((s, p) => s + p.capexTotal, 0);
  const resultColor = (v: number) => (v >= 0 ? "var(--green)" : "var(--coral)");
  const strongCell = (content: React.ReactNode) => <strong>{content}</strong>;

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Dönem Aralığı</div>
          <button className="btn-secondary" type="button" onClick={resetToTrailing6}>
            Son 6 Aya Dön
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
          {clamped && ` — aralık en fazla ${MAX_MONTHS} ay ile sınırlıdır, başlangıç otomatik olarak öne çekildi.`}
        </p>
      </div>

      {allZero && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Seçili aralıkta ({rangeLabel}) henüz gelir veya gider kaydı yok.
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Dönem Aralıklı Gelir Tablosu — {rangeLabel}</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
          fiscal_periods kaydı bulunmayan aylar sıfır olarak gösterilir. CAPEX bu tablonun (A–Q) dışında ayrıca
          takip edilir ve faaliyet sonucuna dahil edilmez.
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kalem</th>
                {periodTotals.map((p) => (
                  <th className="num" key={`${p.year}-${p.month}`}>{periodLabel(p.year, p.month)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>A. Aidat Gelirleri</td>
                {periodTotals.map((p) => (
                  <td className="num" key={`${p.year}-${p.month}`}>{currency.format(p.aidatGelirleri)}</td>
                ))}
              </tr>
              <tr>
                <td>B. Diğer Operasyonel Gelirler</td>
                {periodTotals.map((p) => (
                  <td className="num" key={`${p.year}-${p.month}`}>{currency.format(p.digerOperasyonelGelirler)}</td>
                ))}
              </tr>
              <tr>
                <td>{strongCell("C. Toplam Gelir (A + B)")}</td>
                {periodTotals.map((p) => (
                  <td className="num" key={`${p.year}-${p.month}`}>{strongCell(currency.format(p.toplamGelir))}</td>
                ))}
              </tr>

              {opexSegments.length === 0 ? (
                <tr>
                  <td colSpan={periodTotals.length + 1} className="wrap" style={{ color: "var(--text3)" }}>
                    Seçili aralık için operasyonel gider kaydı yok.
                  </td>
                </tr>
              ) : (
                opexSegments.map((segment) => (
                  <tr key={segment}>
                    <td className="wrap">{stripSegmentPrefix(segment)}</td>
                    {periodTotals.map((p) => (
                      <td className="num" key={`${p.year}-${p.month}`}>
                        {currency.format(p.opexBySegment.get(segment) ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))
              )}

              <tr>
                <td>{strongCell("M. Toplam Operasyonel Gider")}</td>
                {periodTotals.map((p) => (
                  <td className="num" key={`${p.year}-${p.month}`}>{strongCell(currency.format(p.toplamOperasyonelGider))}</td>
                ))}
              </tr>
              <tr>
                <td>{strongCell("N. Faaliyet Fazlası / (Açığı) (C − M)")}</td>
                {periodTotals.map((p) => (
                  <td className="num" key={`${p.year}-${p.month}`} style={{ color: resultColor(p.faaliyetSonucu) }}>
                    {strongCell(currency.format(p.faaliyetSonucu))}
                  </td>
                ))}
              </tr>
              <tr>
                <td>O. Finansal Gelirler</td>
                {periodTotals.map((p) => (
                  <td className="num" key={`${p.year}-${p.month}`}>{currency.format(p.finansalGelirler)}</td>
                ))}
              </tr>
              <tr>
                <td className="wrap">
                  P. Finansal Giderler
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                    Şema bankacılık/finansal giderleri ayrı bir ana segment olarak izlemiyor (banka masrafları
                    &quot;Yönetim Giderleri&quot; ana segmentinin bir alt kalemi) — bu nedenle burada 0 gösteriliyor.
                  </div>
                </td>
                {periodTotals.map((p) => (
                  <td className="num" key={`${p.year}-${p.month}`}>{currency.format(p.finansalGiderler)}</td>
                ))}
              </tr>
              <tr>
                <td>{strongCell("Q. Dönem Fazlası / (Açığı) (N + O − P)")}</td>
                {periodTotals.map((p) => (
                  <td className="num" key={`${p.year}-${p.month}`} style={{ color: resultColor(p.donemSonucu) }}>
                    {strongCell(currency.format(p.donemSonucu))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Sermaye Harcamaları (CAPEX) — {rangeLabel}</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
          CAPEX, yukarıdaki gelir tablosunun (A–Q) dışında ayrıca takip edilir ve faaliyet sonucuna dahil edilmez.
        </p>

        {capexGrandTotal === 0 && capexCategories.length === 0 ? (
          <div className="empty-state">Seçili aralık için CAPEX kaydı yok.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kategori</th>
                  {periodTotals.map((p) => (
                    <th className="num" key={`${p.year}-${p.month}`}>{periodLabel(p.year, p.month)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capexCategories.length > 1 &&
                  capexCategories.map((name) => (
                    <tr key={name}>
                      <td className="wrap">{name}</td>
                      {periodTotals.map((p) => (
                        <td className="num" key={`${p.year}-${p.month}`}>
                          {currency.format(p.capexByCategory.get(name) ?? 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                <tr>
                  <td>{strongCell("Toplam CAPEX")}</td>
                  {periodTotals.map((p) => (
                    <td className="num" key={`${p.year}-${p.month}`}>{strongCell(currency.format(p.capexTotal))}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
