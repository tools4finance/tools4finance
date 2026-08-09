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

function expenseCategoryLabel(cat: ExpenseCategory): string {
  return [cat.main_segment, cat.sub_segment, cat.name].filter(Boolean).join(" / ");
}

function incomeCategoryLabel(cat: IncomeCategory): string {
  return [cat.group_name, cat.name].filter(Boolean).join(" / ");
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

  // "Relevant-first" presentation: only categories in these sets render in the
  // "Bütçelenen Kalemler" list. Seeded from existing nonzero budget_lines on
  // every fetch; categories added via the "Kategori Ekle" picker are appended
  // here immediately so they appear in the list before the user hits Kaydet.
  const [visibleExpenseIds, setVisibleExpenseIds] = useState<Set<string>>(new Set());
  const [visibleIncomeIds, setVisibleIncomeIds] = useState<Set<string>>(new Set());

  const [showExpensePicker, setShowExpensePicker] = useState(false);
  const [expensePickerSearch, setExpensePickerSearch] = useState("");
  const [expensePickerOpen, setExpensePickerOpen] = useState(false);

  const [showIncomePicker, setShowIncomePicker] = useState(false);
  const [incomePickerSearch, setIncomePickerSearch] = useState("");
  const [incomePickerOpen, setIncomePickerOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);
    setSaveMessage(null);
    setShowExpensePicker(false);
    setExpensePickerSearch("");
    setExpensePickerOpen(false);
    setShowIncomePicker(false);
    setIncomePickerSearch("");
    setIncomePickerOpen(false);

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
    const visibleExp = new Set<string>();
    for (const cat of expCats) {
      const line = expLinesMap.get(cat.id);
      expValues[cat.id] = line && line.budget_amount ? String(line.budget_amount) : "";
      if (line && line.budget_amount) visibleExp.add(cat.id);
    }
    const incValues: Record<string, string> = {};
    const visibleInc = new Set<string>();
    for (const cat of incCats) {
      const line = incLinesMap.get(cat.id);
      incValues[cat.id] = line && line.budget_amount ? String(line.budget_amount) : "";
      if (line && line.budget_amount) visibleInc.add(cat.id);
    }

    setExpenseCategories(expCats);
    setIncomeCategories(incCats);
    setExpenseLines(expLinesMap);
    setIncomeLines(incLinesMap);
    setExpenseValues(expValues);
    setIncomeValues(incValues);
    setVisibleExpenseIds(visibleExp);
    setVisibleIncomeIds(visibleInc);
    setLoading(false);
  }, [selectedSiteId, year, month]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const visibleExpenseCategories = useMemo(
    () => expenseCategories.filter((c) => visibleExpenseIds.has(c.id)),
    [expenseCategories, visibleExpenseIds]
  );
  const visibleIncomeCategories = useMemo(
    () => incomeCategories.filter((c) => visibleIncomeIds.has(c.id)),
    [incomeCategories, visibleIncomeIds]
  );

  const availableExpenseCategories = useMemo(
    () => expenseCategories.filter((c) => !visibleExpenseIds.has(c.id)),
    [expenseCategories, visibleExpenseIds]
  );
  const availableIncomeCategories = useMemo(
    () => incomeCategories.filter((c) => !visibleIncomeIds.has(c.id)),
    [incomeCategories, visibleIncomeIds]
  );

  const filteredExpensePickerItems = useMemo(() => {
    const q = expensePickerSearch.trim().toLocaleLowerCase("tr");
    if (!q) return availableExpenseCategories;
    return availableExpenseCategories.filter((c) => expenseCategoryLabel(c).toLocaleLowerCase("tr").includes(q));
  }, [availableExpenseCategories, expensePickerSearch]);

  const filteredIncomePickerItems = useMemo(() => {
    const q = incomePickerSearch.trim().toLocaleLowerCase("tr");
    if (!q) return availableIncomeCategories;
    return availableIncomeCategories.filter((c) => incomeCategoryLabel(c).toLocaleLowerCase("tr").includes(q));
  }, [availableIncomeCategories, incomePickerSearch]);

  function addExpenseCategory(catId: string) {
    setVisibleExpenseIds((prev) => {
      const next = new Set(prev);
      next.add(catId);
      return next;
    });
    setExpensePickerSearch("");
  }

  function removeExpenseCategory(catId: string) {
    setVisibleExpenseIds((prev) => {
      const next = new Set(prev);
      next.delete(catId);
      return next;
    });
    setExpenseValues((prev) => ({ ...prev, [catId]: "" }));
  }

  function addIncomeCategory(catId: string) {
    setVisibleIncomeIds((prev) => {
      const next = new Set(prev);
      next.add(catId);
      return next;
    });
    setIncomePickerSearch("");
  }

  function removeIncomeCategory(catId: string) {
    setVisibleIncomeIds((prev) => {
      const next = new Set(prev);
      next.delete(catId);
      return next;
    });
    setIncomeValues((prev) => ({ ...prev, [catId]: "" }));
  }

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
          <div className="panel-title">Gider Bütçesi — Bütçelenen Kalemler ({periodLabel})</div>
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

        {visibleExpenseCategories.length === 0 ? (
          <div className="empty-state">
            Bu dönem için henüz bütçelenmiş gider kalemi yok. Aşağıdaki &quot;Kategori Ekle&quot; ile ekleyebilirsiniz.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ana Segment</th>
                  <th>Alt Segment</th>
                  <th>Kategori</th>
                  <th>Tür</th>
                  <th className="num">Bütçe Tutarı</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {visibleExpenseCategories.map((cat) => (
                  <tr key={cat.id}>
                    <td className="wrap">{cat.main_segment || "—"}</td>
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
                    {canWrite && (
                      <td>
                        <button type="button" className="btn-secondary" onClick={() => removeExpenseCategory(cat.id)}>
                          Kaldır
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, fontSize: 13, fontWeight: 500 }}>
          Gider Bütçesi Toplamı: {formatCurrency(expenseTotal)}
        </div>

        {canWrite && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "0.5px solid var(--border)" }}>
            {!showExpensePicker ? (
              <button type="button" className="btn-secondary" onClick={() => setShowExpensePicker(true)}>
                + Kategori Ekle
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <label className="auth-field" style={{ position: "relative", maxWidth: 420, flex: 1 }}>
                  <span>Kategori Ara</span>
                  <input
                    type="text"
                    autoFocus
                    value={expensePickerSearch}
                    placeholder="Segment, alt segment veya kategori adı yazın…"
                    onFocus={() => setExpensePickerOpen(true)}
                    onChange={(e) => {
                      setExpensePickerSearch(e.target.value);
                      setExpensePickerOpen(true);
                    }}
                    onBlur={() => setTimeout(() => setExpensePickerOpen(false), 150)}
                  />
                  {expensePickerOpen && (
                    <div className="unit-picker-dropdown">
                      {filteredExpensePickerItems.length === 0 ? (
                        <div className="unit-picker-empty">
                          {availableExpenseCategories.length === 0
                            ? "Tüm kategoriler zaten eklendi."
                            : "Eşleşen kategori yok."}
                        </div>
                      ) : (
                        filteredExpensePickerItems.map((cat) => (
                          <button
                            type="button"
                            key={cat.id}
                            className="unit-picker-item"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addExpenseCategory(cat.id)}
                          >
                            {expenseCategoryLabel(cat)}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setShowExpensePicker(false);
                    setExpensePickerSearch("");
                    setExpensePickerOpen(false);
                  }}
                  style={{ marginTop: 20 }}
                >
                  Kapat
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Gelir Bütçesi — Bütçelenen Kalemler ({periodLabel})</div>
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

        {visibleIncomeCategories.length === 0 ? (
          <div className="empty-state">
            Bu dönem için henüz bütçelenmiş gelir kalemi yok. Aşağıdaki &quot;Kategori Ekle&quot; ile ekleyebilirsiniz.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Grup</th>
                  <th>Kategori</th>
                  <th className="num">Bütçe Tutarı</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {visibleIncomeCategories.map((cat) => (
                  <tr key={cat.id}>
                    <td className="wrap">{cat.group_name || "—"}</td>
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
                    {canWrite && (
                      <td>
                        <button type="button" className="btn-secondary" onClick={() => removeIncomeCategory(cat.id)}>
                          Kaldır
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, fontSize: 13, fontWeight: 500 }}>
          Gelir Bütçesi Toplamı: {formatCurrency(incomeTotal)}
        </div>

        {canWrite && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "0.5px solid var(--border)" }}>
            {!showIncomePicker ? (
              <button type="button" className="btn-secondary" onClick={() => setShowIncomePicker(true)}>
                + Kategori Ekle
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <label className="auth-field" style={{ position: "relative", maxWidth: 420, flex: 1 }}>
                  <span>Kategori Ara</span>
                  <input
                    type="text"
                    autoFocus
                    value={incomePickerSearch}
                    placeholder="Grup veya kategori adı yazın…"
                    onFocus={() => setIncomePickerOpen(true)}
                    onChange={(e) => {
                      setIncomePickerSearch(e.target.value);
                      setIncomePickerOpen(true);
                    }}
                    onBlur={() => setTimeout(() => setIncomePickerOpen(false), 150)}
                  />
                  {incomePickerOpen && (
                    <div className="unit-picker-dropdown">
                      {filteredIncomePickerItems.length === 0 ? (
                        <div className="unit-picker-empty">
                          {availableIncomeCategories.length === 0
                            ? "Tüm kategoriler zaten eklendi."
                            : "Eşleşen kategori yok."}
                        </div>
                      ) : (
                        filteredIncomePickerItems.map((cat) => (
                          <button
                            type="button"
                            key={cat.id}
                            className="unit-picker-item"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addIncomeCategory(cat.id)}
                          >
                            {incomeCategoryLabel(cat)}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setShowIncomePicker(false);
                    setIncomePickerSearch("");
                    setIncomePickerOpen(false);
                  }}
                  style={{ marginTop: 20 }}
                >
                  Kapat
                </button>
              </div>
            )}
          </div>
        )}
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
