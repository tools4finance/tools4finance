"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";
import { exportRowsToExcel, exportRowsToPdf, type ExportColumn } from "@/lib/exportTable";

type ExpenseCategory = {
  id: string;
  main_segment: string;
  sub_segment: string | null;
  name: string;
  opex_capex: string | null;
  display_order: number;
  active: boolean;
};

type IncomeCategory = {
  id: string;
  group_name: string;
  name: string;
  display_order: number;
  active: boolean;
};

type BudgetLine = {
  id: string;
  site_id: string;
  fiscal_period_id: string;
  category_type: "expense" | "income";
  expense_category_id: string | null;
  income_category_id: string | null;
  budget_amount: number;
};

const currencyFormatter = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

function groupByKey<T>(items: T[], keyFn: (item: T) => string): Array<{ key: string; items: T[] }> {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(item);
  }
  return order.map((key) => ({ key, items: map.get(key)! }));
}

export default function BudgetPage() {
  const { selectedSiteId, canWrite, year, month, user } = useAidat();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [fiscalPeriodId, setFiscalPeriodId] = useState<string | null>(null);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([]);
  const [expenseLines, setExpenseLines] = useState<Map<string, BudgetLine>>(new Map());
  const [incomeLines, setIncomeLines] = useState<Map<string, BudgetLine>>(new Map());
  const [expenseValues, setExpenseValues] = useState<Record<string, string>>({});
  const [incomeValues, setIncomeValues] = useState<Record<string, string>>({});

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);
    setSaveMessage(null);

    const { data: periodId, error: periodError } = await supabase.rpc("get_or_create_fiscal_period", {
      p_site_id: selectedSiteId,
      p_year: year,
      p_month: month,
    });

    if (periodError || !periodId) {
      setError(periodError?.message ?? "Dönem bilgisi alınamadı.");
      setFiscalPeriodId(null);
      setLoading(false);
      return;
    }

    const fpId = periodId as string;
    setFiscalPeriodId(fpId);

    const [expCatRes, incCatRes, budgetRes] = await Promise.all([
      supabase
        .from("expense_categories")
        .select("id, main_segment, sub_segment, name, opex_capex, display_order, active")
        .eq("active", true)
        .order("main_segment", { ascending: true })
        .order("display_order", { ascending: true }),
      supabase
        .from("income_categories")
        .select("id, group_name, name, display_order, active")
        .eq("active", true)
        .order("group_name", { ascending: true })
        .order("display_order", { ascending: true }),
      supabase
        .from("budget_lines")
        .select("id, site_id, fiscal_period_id, category_type, expense_category_id, income_category_id, budget_amount")
        .eq("site_id", selectedSiteId)
        .eq("fiscal_period_id", fpId),
    ]);

    if (expCatRes.error) {
      setError(expCatRes.error.message);
      setLoading(false);
      return;
    }
    if (incCatRes.error) {
      setError(incCatRes.error.message);
      setLoading(false);
      return;
    }
    if (budgetRes.error) {
      setError(budgetRes.error.message);
      setLoading(false);
      return;
    }

    const expCats = (expCatRes.data ?? []) as ExpenseCategory[];
    const incCats = (incCatRes.data ?? []) as IncomeCategory[];
    const lines = (budgetRes.data ?? []) as BudgetLine[];

    const expLinesMap = new Map<string, BudgetLine>();
    const incLinesMap = new Map<string, BudgetLine>();
    for (const line of lines) {
      if (line.category_type === "expense" && line.expense_category_id) {
        expLinesMap.set(line.expense_category_id, line);
      } else if (line.category_type === "income" && line.income_category_id) {
        incLinesMap.set(line.income_category_id, line);
      }
    }

    const expValues: Record<string, string> = {};
    for (const cat of expCats) {
      const line = expLinesMap.get(cat.id);
      expValues[cat.id] = line && line.budget_amount ? String(line.budget_amount) : "";
    }
    const incValues: Record<string, string> = {};
    for (const cat of incCats) {
      const line = incLinesMap.get(cat.id);
      incValues[cat.id] = line && line.budget_amount ? String(line.budget_amount) : "";
    }

    setExpenseCategories(expCats);
    setIncomeCategories(incCats);
    setExpenseLines(expLinesMap);
    setIncomeLines(incLinesMap);
    setExpenseValues(expValues);
    setIncomeValues(incValues);
    setLoading(false);
  }, [selectedSiteId, year, month]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const expenseGroups = useMemo(
    () => groupByKey(expenseCategories, (c) => c.main_segment || "Diğer"),
    [expenseCategories]
  );
  const incomeGroups = useMemo(
    () => groupByKey(incomeCategories, (c) => c.group_name || "Diğer"),
    [incomeCategories]
  );

  const expenseTotal = useMemo(
    () => Object.values(expenseValues).reduce((sum, v) => sum + (parseFloat(v) || 0), 0),
    [expenseValues]
  );
  const incomeTotal = useMemo(
    () => Object.values(incomeValues).reduce((sum, v) => sum + (parseFloat(v) || 0), 0),
    [incomeValues]
  );

  const periodLabel = `${month}/${year}`;

  const expenseExportRows = useMemo(
    () =>
      expenseCategories
        .map((cat) => ({ cat, amount: parseFloat(expenseValues[cat.id] ?? "") || 0 }))
        .filter(({ amount }) => amount > 0)
        .map(({ cat, amount }) => ({
          segment: cat.main_segment || "—",
          subSegment: cat.sub_segment ?? "—",
          category: cat.name,
          type: cat.opex_capex ?? "—",
          amount,
        })),
    [expenseCategories, expenseValues]
  );

  const incomeExportRows = useMemo(
    () =>
      incomeCategories
        .map((cat) => ({ cat, amount: parseFloat(incomeValues[cat.id] ?? "") || 0 }))
        .filter(({ amount }) => amount > 0)
        .map(({ cat, amount }) => ({
          group: cat.group_name || "—",
          category: cat.name,
          amount,
        })),
    [incomeCategories, incomeValues]
  );

  const expenseExportColumns: ExportColumn[] = [
    { header: "Ana Segment", value: (row) => row.segment as string },
    { header: "Alt Segment", value: (row) => row.subSegment as string },
    { header: "Kategori", value: (row) => row.category as string },
    { header: "Tür", value: (row) => row.type as string },
    { header: "Bütçe Tutarı", value: (row) => row.amount as number },
  ];

  const incomeExportColumns: ExportColumn[] = [
    { header: "Grup", value: (row) => row.group as string },
    { header: "Kategori", value: (row) => row.category as string },
    { header: "Bütçe Tutarı", value: (row) => row.amount as number },
  ];

  function handleExportExpenseBudgetExcel() {
    if (expenseExportRows.length === 0) return;
    exportRowsToExcel(expenseExportRows, expenseExportColumns, {
      title: "Bütçe (Gider)",
      subtitle: periodLabel,
      sheetName: "Gider Bütçesi",
    });
  }

  function handleExportExpenseBudgetPdf() {
    if (expenseExportRows.length === 0) return;
    exportRowsToPdf(expenseExportRows, expenseExportColumns, {
      title: "Bütçe (Gider)",
      subtitle: periodLabel,
    });
  }

  function handleExportIncomeBudgetExcel() {
    if (incomeExportRows.length === 0) return;
    exportRowsToExcel(incomeExportRows, incomeExportColumns, {
      title: "Bütçe (Gelir)",
      subtitle: periodLabel,
      sheetName: "Gelir Bütçesi",
    });
  }

  function handleExportIncomeBudgetPdf() {
    if (incomeExportRows.length === 0) return;
    exportRowsToPdf(incomeExportRows, incomeExportColumns, {
      title: "Bütçe (Gelir)",
      subtitle: periodLabel,
    });
  }

  function segmentBudgetedCount(items: ExpenseCategory[]): number {
    return items.filter((c) => (parseFloat(expenseValues[c.id] ?? "") || 0) > 0).length;
  }

  function groupBudgetedCount(items: IncomeCategory[]): number {
    return items.filter((c) => (parseFloat(incomeValues[c.id] ?? "") || 0) > 0).length;
  }

  async function handleSave() {
    if (!canWrite || !fiscalPeriodId || !selectedSiteId) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      for (const cat of expenseCategories) {
        const raw = expenseValues[cat.id];
        const amount = raw ? Math.max(0, parseFloat(raw) || 0) : 0;
        const existing = expenseLines.get(cat.id);
        if (amount > 0) {
          if (existing) {
            if (existing.budget_amount !== amount) {
              const { error: updErr } = await supabase
                .from("budget_lines")
                .update({ budget_amount: amount })
                .eq("id", existing.id);
              if (updErr) throw updErr;
            }
          } else {
            const { error: insErr } = await supabase.from("budget_lines").insert({
              site_id: selectedSiteId,
              fiscal_period_id: fiscalPeriodId,
              category_type: "expense",
              expense_category_id: cat.id,
              income_category_id: null,
              budget_amount: amount,
              created_by: user?.id ?? null,
            });
            if (insErr) throw insErr;
          }
        } else if (existing) {
          const { error: delErr } = await supabase.from("budget_lines").delete().eq("id", existing.id);
          if (delErr) throw delErr;
        }
      }

      for (const cat of incomeCategories) {
        const raw = incomeValues[cat.id];
        const amount = raw ? Math.max(0, parseFloat(raw) || 0) : 0;
        const existing = incomeLines.get(cat.id);
        if (amount > 0) {
          if (existing) {
            if (existing.budget_amount !== amount) {
              const { error: updErr } = await supabase
                .from("budget_lines")
                .update({ budget_amount: amount })
                .eq("id", existing.id);
              if (updErr) throw updErr;
            }
          } else {
            const { error: insErr } = await supabase.from("budget_lines").insert({
              site_id: selectedSiteId,
              fiscal_period_id: fiscalPeriodId,
              category_type: "income",
              expense_category_id: null,
              income_category_id: cat.id,
              budget_amount: amount,
              created_by: user?.id ?? null,
            });
            if (insErr) throw insErr;
          }
        } else if (existing) {
          const { error: delErr } = await supabase.from("budget_lines").delete().eq("id", existing.id);
          if (delErr) throw delErr;
        }
      }

      setSaveMessage("Bütçe kaydedildi.");
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaydetme sırasında bir hata oluştu.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  if (!selectedSiteId) {
    return <div className="empty-state">Site seçilmedi.</div>;
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}
      {saveMessage && (
        <div className="pill pill-green" style={{ marginBottom: 16 }}>{saveMessage}</div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Gider Bütçesi</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={expenseExportRows.length === 0}
              onClick={handleExportExpenseBudgetExcel}
            >
              Excel İndir
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={expenseExportRows.length === 0}
              onClick={handleExportExpenseBudgetPdf}
            >
              PDF İndir
            </button>
          </div>
        </div>

        {expenseGroups.length === 0 ? (
          <div className="empty-state">Gider kategorisi bulunamadı.</div>
        ) : (
          expenseGroups.map((group, idx) => {
            const budgetedCount = segmentBudgetedCount(group.items);
            return (
              <details key={group.key} open={idx === 0} style={{ marginBottom: 10 }}>
                <summary
                  style={{
                    cursor: "pointer",
                    padding: "8px 4px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {group.key}
                  {budgetedCount > 0 && (
                    <span className="pill pill-blue">{budgetedCount} kalem bütçeli</span>
                  )}
                </summary>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Alt Segment</th>
                        <th>Kategori</th>
                        <th>Tür</th>
                        <th className="num">Bütçe Tutarı</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((cat) => (
                        <tr key={cat.id}>
                          <td className="wrap">{cat.sub_segment ?? "—"}</td>
                          <td className="wrap">{cat.name}</td>
                          <td>
                            {cat.opex_capex ? (
                              <span className={`pill ${cat.opex_capex === "CAPEX" ? "pill-amber" : "pill-neutral"}`}>
                                {cat.opex_capex}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="num">
                            {canWrite ? (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={expenseValues[cat.id] ?? ""}
                                onChange={(e) =>
                                  setExpenseValues((prev) => ({ ...prev, [cat.id]: e.target.value }))
                                }
                                placeholder="0"
                                style={{ width: 120, textAlign: "right" }}
                              />
                            ) : (
                              formatCurrency(parseFloat(expenseValues[cat.id] ?? "") || 0)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, fontSize: 13, fontWeight: 500 }}>
          Gider Bütçesi Toplamı: {formatCurrency(expenseTotal)}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Gelir Bütçesi</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={incomeExportRows.length === 0}
              onClick={handleExportIncomeBudgetExcel}
            >
              Excel İndir
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={incomeExportRows.length === 0}
              onClick={handleExportIncomeBudgetPdf}
            >
              PDF İndir
            </button>
          </div>
        </div>

        {incomeGroups.length === 0 ? (
          <div className="empty-state">Gelir kategorisi bulunamadı.</div>
        ) : (
          incomeGroups.map((group, idx) => {
            const budgetedCount = groupBudgetedCount(group.items);
            return (
              <details key={group.key} open={idx === 0} style={{ marginBottom: 10 }}>
                <summary
                  style={{
                    cursor: "pointer",
                    padding: "8px 4px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {group.key}
                  {budgetedCount > 0 && (
                    <span className="pill pill-blue">{budgetedCount} kalem bütçeli</span>
                  )}
                </summary>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kategori</th>
                        <th className="num">Bütçe Tutarı</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((cat) => (
                        <tr key={cat.id}>
                          <td className="wrap">{cat.name}</td>
                          <td className="num">
                            {canWrite ? (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={incomeValues[cat.id] ?? ""}
                                onChange={(e) =>
                                  setIncomeValues((prev) => ({ ...prev, [cat.id]: e.target.value }))
                                }
                                placeholder="0"
                                style={{ width: 120, textAlign: "right" }}
                              />
                            ) : (
                              formatCurrency(parseFloat(incomeValues[cat.id] ?? "") || 0)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, fontSize: 13, fontWeight: 500 }}>
          Gelir Bütçesi Toplamı: {formatCurrency(incomeTotal)}
        </div>
      </div>

      {canWrite && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      )}
    </div>
  );
}
