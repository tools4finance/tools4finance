"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";
import { exportRowsToExcel, exportRowsToPdf, type ExportColumn } from "@/lib/exportTable";

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

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

type SegmentLine = { key: string; label: string; amount: number };

type IncomeCategoryJoin = { group_name: string };
type IncomeRow = { amount: number; income_category: IncomeCategoryJoin | IncomeCategoryJoin[] | null };

type ExpenseCategoryJoin = { main_segment: string; name: string; opex_capex: string };
type ExpenseRow = { amount: number; expense_category: ExpenseCategoryJoin | ExpenseCategoryJoin[] | null };

// Financial (non-operational) income is separately trackable via the
// "Finansal Gelirler" income_category group (e.g. deposit interest) — see
// income_categories seed data. There is no equivalent isolated main_segment
// for financial *expenses*: bank charges live inside the "8. Yönetim
// Giderleri" main_segment mixed with unrelated management costs, so we
// cannot honestly split them out at the main_segment granularity this
// report otherwise uses. P is therefore always shown as 0 with a note
// rather than guessing at a split the schema doesn't support.
const FINANCIAL_INCOME_GROUP = "Finansal Gelirler";

type ReportData = {
  periodExists: boolean;
  aidatGelirleri: number; // A
  digerOperasyonelGelirler: number; // B (excludes financial income)
  opexLines: SegmentLine[]; // D-L
  finansalGelirler: number; // O
  capexLines: SegmentLine[];
};

const EMPTY_DATA: ReportData = {
  periodExists: false,
  aidatGelirleri: 0,
  digerOperasyonelGelirler: 0,
  opexLines: [],
  finansalGelirler: 0,
  capexLines: [],
};

export default function AidatReportsPage() {
  const { selectedSiteId, year, month } = useAidat();

  const [data, setData] = useState<ReportData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);

    try {
      // Read-only page: resolve the fiscal_periods row without creating one
      // (get_or_create_fiscal_period is a write RPC and would fail RLS for
      // viewer-role users, and would create empty period rows just from
      // opening this report).
      const periodRes = await supabase
        .from("fiscal_periods")
        .select("id")
        .eq("site_id", selectedSiteId)
        .eq("year", year)
        .eq("month", month)
        .maybeSingle();
      if (periodRes.error) throw periodRes.error;

      const periodId = periodRes.data?.id as string | undefined;
      if (!periodId) {
        setData(EMPTY_DATA);
        setLoading(false);
        return;
      }

      const [accrualsRes, incomesRes, opexRes, capexRes] = await Promise.all([
        supabase
          .from("accruals")
          .select("amount")
          .eq("site_id", selectedSiteId)
          .eq("fiscal_period_id", periodId)
          .eq("status", "active"),
        supabase
          .from("incomes")
          .select("amount, income_category:income_categories(group_name)")
          .eq("site_id", selectedSiteId)
          .eq("fiscal_period_id", periodId)
          .eq("status", "active"),
        supabase
          .from("expenses")
          .select("amount, expense_category:expense_categories!inner(main_segment, name, opex_capex)")
          .eq("site_id", selectedSiteId)
          .eq("fiscal_period_id", periodId)
          .eq("status", "active")
          .eq("expense_category.opex_capex", "OPEX"),
        supabase
          .from("expenses")
          .select("amount, expense_category:expense_categories!inner(main_segment, name, opex_capex)")
          .eq("site_id", selectedSiteId)
          .eq("fiscal_period_id", periodId)
          .eq("status", "active")
          .eq("expense_category.opex_capex", "CAPEX"),
      ]);

      if (accrualsRes.error) throw accrualsRes.error;
      if (incomesRes.error) throw incomesRes.error;
      if (opexRes.error) throw opexRes.error;
      if (capexRes.error) throw capexRes.error;

      const aidatGelirleri = ((accrualsRes.data ?? []) as { amount: number }[]).reduce((s, r) => s + r.amount, 0);

      let digerOperasyonelGelirler = 0;
      let finansalGelirler = 0;
      for (const row of (incomesRes.data ?? []) as IncomeRow[]) {
        const cat = unwrap(row.income_category);
        if (cat?.group_name === FINANCIAL_INCOME_GROUP) {
          finansalGelirler += row.amount;
        } else {
          digerOperasyonelGelirler += row.amount;
        }
      }

      const opexBySegment = new Map<string, number>();
      for (const row of (opexRes.data ?? []) as ExpenseRow[]) {
        const cat = unwrap(row.expense_category);
        if (!cat) continue;
        opexBySegment.set(cat.main_segment, (opexBySegment.get(cat.main_segment) ?? 0) + row.amount);
      }
      const opexLines: SegmentLine[] = Array.from(opexBySegment.entries())
        .filter(([, amount]) => amount !== 0)
        .sort((a, b) => segmentOrder(a[0]) - segmentOrder(b[0]))
        .map(([segment, amount]) => ({ key: segment, label: stripSegmentPrefix(segment), amount }));

      const capexByCategory = new Map<string, number>();
      for (const row of (capexRes.data ?? []) as ExpenseRow[]) {
        const cat = unwrap(row.expense_category);
        if (!cat) continue;
        capexByCategory.set(cat.name, (capexByCategory.get(cat.name) ?? 0) + row.amount);
      }
      const capexLines: SegmentLine[] = Array.from(capexByCategory.entries())
        .filter(([, amount]) => amount !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([name, amount]) => ({ key: name, label: name, amount }));

      setData({
        periodExists: true,
        aidatGelirleri,
        digerOperasyonelGelirler,
        opexLines,
        finansalGelirler,
        capexLines,
      });
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rapor yüklenirken hata oluştu.");
      setLoading(false);
    }
  }, [selectedSiteId, year, month]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  const { aidatGelirleri, digerOperasyonelGelirler, opexLines, finansalGelirler, capexLines } = data;

  const toplamGelir = aidatGelirleri + digerOperasyonelGelirler; // C = A + B
  const toplamOperasyonelGider = opexLines.reduce((s, l) => s + l.amount, 0); // M
  const faaliyetSonucu = toplamGelir - toplamOperasyonelGider; // N = C - M
  const finansalGiderler = 0; // P — see FINANCIAL_INCOME_GROUP comment above
  const donemSonucu = faaliyetSonucu + finansalGelirler - finansalGiderler; // Q = N + O - P
  const capexTotal = capexLines.reduce((s, l) => s + l.amount, 0);

  const allZero =
    !data.periodExists &&
    aidatGelirleri === 0 &&
    digerOperasyonelGelirler === 0 &&
    opexLines.length === 0 &&
    finansalGelirler === 0 &&
    capexLines.length === 0;

  const totalRowStyle: React.CSSProperties = { fontWeight: 600 };
  const resultColor = (v: number) => (v >= 0 ? "var(--green)" : "var(--coral)");

  const periodLabel = `${month}/${year}`;

  const statementExportRows: { label: string; amount: number | null }[] = [
    { label: "A. Aidat Gelirleri", amount: aidatGelirleri },
    { label: "B. Diğer Operasyonel Gelirler", amount: digerOperasyonelGelirler },
    { label: "C. Toplam Gelir (A + B)", amount: toplamGelir },
    ...opexLines.map((line) => ({ label: line.label, amount: line.amount })),
    { label: "M. Toplam Operasyonel Gider", amount: toplamOperasyonelGider },
    { label: "N. Faaliyet Fazlası / (Açığı) (C − M)", amount: faaliyetSonucu },
    { label: "O. Finansal Gelirler", amount: finansalGelirler },
    { label: "P. Finansal Giderler", amount: finansalGiderler },
    { label: "Q. Dönem Fazlası / (Açığı) (N + O − P)", amount: donemSonucu },
    { label: "— Sermaye Harcamaları (CAPEX) —", amount: null },
    ...capexLines.map((line) => ({ label: line.label, amount: line.amount })),
    { label: "Toplam CAPEX", amount: capexTotal },
  ];

  const statementExportColumns: ExportColumn[] = [
    { header: "Kalem", value: (row) => row.label as string },
    { header: "Tutar", value: (row) => (row.amount === null ? "" : (row.amount as number)) },
  ];

  const hasExportableData = !allZero;

  function handleExportStatementExcel() {
    if (!hasExportableData) return;
    exportRowsToExcel(statementExportRows, statementExportColumns, {
      title: "Gelir Tablosu",
      subtitle: periodLabel,
      sheetName: "Gelir Tablosu",
    });
  }

  function handleExportStatementPdf() {
    if (!hasExportableData) return;
    exportRowsToPdf(statementExportRows, statementExportColumns, {
      title: "Gelir Tablosu",
      subtitle: periodLabel,
    });
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      {allZero && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Bu dönem ({month}/{year}) için henüz gelir veya gider kaydı bulunmuyor.
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Aylık Gelir Tablosu — {month}/{year}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={!hasExportableData}
              onClick={handleExportStatementExcel}
            >
              Excel İndir
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!hasExportableData}
              onClick={handleExportStatementPdf}
            >
              PDF İndir
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kalem</th>
                <th className="num">Tutar</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>A. Aidat Gelirleri</td>
                <td className="num">{currency.format(aidatGelirleri)}</td>
              </tr>
              <tr>
                <td>B. Diğer Operasyonel Gelirler</td>
                <td className="num">{currency.format(digerOperasyonelGelirler)}</td>
              </tr>
              <tr style={totalRowStyle}>
                <td>C. Toplam Gelir (A + B)</td>
                <td className="num">{currency.format(toplamGelir)}</td>
              </tr>

              {opexLines.length === 0 ? (
                <tr>
                  <td colSpan={2} className="wrap" style={{ color: "var(--text3)" }}>
                    Bu dönem için operasyonel gider kaydı yok.
                  </td>
                </tr>
              ) : (
                opexLines.map((line) => (
                  <tr key={line.key}>
                    <td className="wrap">{line.label}</td>
                    <td className="num">{currency.format(line.amount)}</td>
                  </tr>
                ))
              )}

              <tr style={totalRowStyle}>
                <td>M. Toplam Operasyonel Gider</td>
                <td className="num">{currency.format(toplamOperasyonelGider)}</td>
              </tr>
              <tr style={totalRowStyle}>
                <td>N. Faaliyet Fazlası / (Açığı) (C − M)</td>
                <td className="num" style={{ color: resultColor(faaliyetSonucu) }}>
                  {currency.format(faaliyetSonucu)}
                </td>
              </tr>
              <tr>
                <td>O. Finansal Gelirler</td>
                <td className="num">{currency.format(finansalGelirler)}</td>
              </tr>
              <tr>
                <td className="wrap">
                  P. Finansal Giderler
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                    Şema bankacılık/finansal giderleri ayrı bir ana segment olarak izlemiyor (banka masrafları
                    &quot;Yönetim Giderleri&quot; ana segmentinin bir alt kalemi) — bu nedenle burada 0 gösteriliyor.
                  </div>
                </td>
                <td className="num">{currency.format(finansalGiderler)}</td>
              </tr>
              <tr style={totalRowStyle}>
                <td>Q. Dönem Fazlası / (Açığı) (N + O − P)</td>
                <td className="num" style={{ color: resultColor(donemSonucu) }}>
                  {currency.format(donemSonucu)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Sermaye Harcamaları (CAPEX) — {month}/{year}</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
          CAPEX, yukarıdaki gelir tablosunun (A–Q) dışında ayrıca takip edilir ve faaliyet sonucuna dahil edilmez.
        </p>

        {capexLines.length === 0 ? (
          <div className="empty-state">Bu dönem için CAPEX kaydı yok.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kategori</th>
                  <th className="num">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {capexLines.length > 1 &&
                  capexLines.map((line) => (
                    <tr key={line.key}>
                      <td className="wrap">{line.label}</td>
                      <td className="num">{currency.format(line.amount)}</td>
                    </tr>
                  ))}
                <tr style={totalRowStyle}>
                  <td>Toplam CAPEX</td>
                  <td className="num">{currency.format(capexTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
