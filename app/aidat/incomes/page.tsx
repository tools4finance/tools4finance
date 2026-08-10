"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";
import { exportRowsToExcel, exportRowsToPdf, type ExportColumn } from "@/lib/exportTable";

type IncomeCategory = {
  id: string;
  group_name: string;
  name: string;
  display_order: number;
  active: boolean;
};

type IncomeStatus = "active" | "void";

type Income = {
  id: string;
  site_id: string;
  income_category_id: string;
  fiscal_period_id: string;
  income_date: string;
  amount: number;
  description: string | null;
  status: IncomeStatus;
  voided_reason: string | null;
  created_at: string;
};

const currencyFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
});

function formatMoney(amount: number): string {
  return currencyFormatter.format(amount);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function groupCategories(categories: IncomeCategory[]): Map<string, IncomeCategory[]> {
  const map = new Map<string, IncomeCategory[]>();
  for (const c of categories) {
    if (!map.has(c.group_name)) map.set(c.group_name, []);
    map.get(c.group_name)!.push(c);
  }
  return map;
}

export default function IncomesPage() {
  const { selectedSiteId, canWrite, year, month } = useAidat();

  const [categories, setCategories] = useState<IncomeCategory[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [categoryId, setCategoryId] = useState("");
  const [incomeDate, setIncomeDate] = useState(todayStr());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const groupedCategories = useMemo(() => groupCategories(categories), [categories]);

  const loadCategories = useCallback(async () => {
    const { data, error: catError } = await supabase
      .from("income_categories")
      .select("id, group_name, name, display_order, active")
      .eq("active", true)
      .order("display_order", { ascending: true });
    if (!catError) setCategories((data ?? []) as IncomeCategory[]);
  }, []);

  const loadIncomes = useCallback(async () => {
    if (!selectedSiteId) {
      setIncomes([]);
      setPeriodId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: pId, error: rpcError } = await supabase.rpc("get_or_create_fiscal_period", {
      p_site_id: selectedSiteId,
      p_year: year,
      p_month: month,
    });
    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }
    setPeriodId(pId as string);
    const { data, error: incError } = await supabase
      .from("incomes")
      .select("id, site_id, income_category_id, fiscal_period_id, income_date, amount, description, status, voided_reason, created_at")
      .eq("site_id", selectedSiteId)
      .eq("fiscal_period_id", pId as string)
      .order("income_date", { ascending: false });
    if (incError) {
      setError(incError.message);
    } else {
      setIncomes((data ?? []) as Income[]);
    }
    setLoading(false);
  }, [selectedSiteId, year, month]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadIncomes();
  }, [loadIncomes]);

  async function handleCreateIncome(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !canWrite || !categoryId || !amount) return;
    setSaving(true);
    setError(null);
    const { data: pId, error: rpcError } = await supabase.rpc("get_or_create_fiscal_period", {
      p_site_id: selectedSiteId,
      p_year: year,
      p_month: month,
    });
    if (rpcError) {
      setError(rpcError.message);
      setSaving(false);
      return;
    }
    const { error: insertError } = await supabase.from("incomes").insert({
      site_id: selectedSiteId,
      income_category_id: categoryId,
      fiscal_period_id: pId as string,
      income_date: incomeDate,
      amount: Number(amount),
      description: description.trim() || null,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setCategoryId("");
    setIncomeDate(todayStr());
    setAmount("");
    setDescription("");
    await loadIncomes();
  }

  async function handleVoid(income: Income) {
    if (!canWrite) return;
    const reason = window.prompt("İptal nedeni girin:");
    if (reason === null) return;
    setError(null);
    const { error: updateError } = await supabase
      .from("incomes")
      .update({ status: "void", voided_reason: reason || null })
      .eq("id", income.id)
      .eq("site_id", selectedSiteId ?? "");
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadIncomes();
  }

  const totalIncome = incomes
    .filter((i) => i.status === "active")
    .reduce((sum, i) => sum + i.amount, 0);

  const periodLabel = `${month}/${year}`;

  const incomeExportRows = useMemo(
    () =>
      incomes.map((income) => {
        const cat = categoriesById.get(income.income_category_id);
        return {
          date: income.income_date,
          category: cat ? `${cat.group_name} / ${cat.name}` : "—",
          amount: income.amount,
          status:
            income.status === "active"
              ? "Aktif"
              : `İptal${income.voided_reason ? ` (${income.voided_reason})` : ""}`,
        };
      }),
    [incomes, categoriesById]
  );

  const incomeExportColumns: ExportColumn[] = [
    { header: "Tarih", value: (row) => row.date as string },
    { header: "Grup / Kategori", value: (row) => row.category as string },
    { header: "Tutar", value: (row) => row.amount as number },
    { header: "Durum", value: (row) => row.status as string },
  ];

  function handleExportIncomesExcel() {
    if (incomeExportRows.length === 0) return;
    exportRowsToExcel(incomeExportRows, incomeExportColumns, {
      title: "Diğer Gelirler",
      subtitle: periodLabel,
      sheetName: "Gelirler",
    });
  }

  function handleExportIncomesPdf() {
    if (incomeExportRows.length === 0) return;
    exportRowsToPdf(incomeExportRows, incomeExportColumns, {
      title: "Diğer Gelirler",
      subtitle: periodLabel,
    });
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Diğer Gelirler</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
              Bu sayfa, belirli bir daireye bağlı olmayan gelirler (kira, otopark, faiz vb.) içindir. Aidat
              tahsilatları &quot;Aidatlar&quot; sayfasında takip edilir.
            </div>
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Dönem Gelir Toplamı</div>
          <div className="kpi-value">{formatMoney(totalIncome)}</div>
          <div className="kpi-sub">Aidat dışı gelirler</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Gelir Ekle</div>
        </div>

        {canWrite && (
          <form onSubmit={handleCreateIncome} className="form-grid">
            <label className="auth-field">
              <span>Gelir Kategorisi</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                <option value="">Seçiniz…</option>
                {Array.from(groupedCategories.entries()).map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span>Tarih</span>
              <input type="date" lang="tr" value={incomeDate} onChange={(e) => setIncomeDate(e.target.value)} required />
            </label>
            <label className="auth-field">
              <span>Tutar (TRY)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>
            <label className="auth-field">
              <span>Açıklama (opsiyonel)</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="opsiyonel" />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn-primary" type="submit" disabled={saving || !categoryId || !amount}>
                {saving ? "Kaydediliyor…" : "Gelir Ekle"}
              </button>
            </div>
          </form>
        )}

        {error && <div className="auth-error">{error}</div>}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Gelirler</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={incomeExportRows.length === 0}
              onClick={handleExportIncomesExcel}
            >
              Excel İndir
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={incomeExportRows.length === 0}
              onClick={handleExportIncomesPdf}
            >
              PDF İndir
            </button>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Yükleniyor…</div>
        ) : !periodId || incomes.length === 0 ? (
          <div className="empty-state">Bu dönem için henüz gelir kaydı bulunmuyor.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Grup / Kategori</th>
                  <th className="num">Tutar</th>
                  <th>Durum</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {incomes.map((income) => {
                  const cat = categoriesById.get(income.income_category_id);
                  return (
                    <tr key={income.id}>
                      <td>{income.income_date}</td>
                      <td className="wrap">{cat ? `${cat.group_name} / ${cat.name}` : "—"}</td>
                      <td className="num">{formatMoney(income.amount)}</td>
                      <td>
                        {income.status === "active" ? (
                          <span className="pill pill-green">Aktif</span>
                        ) : (
                          <span className="pill pill-coral" title={income.voided_reason ?? undefined}>
                            İptal
                          </span>
                        )}
                      </td>
                      <td>
                        {canWrite && income.status === "active" && (
                          <button className="btn-danger" onClick={() => handleVoid(income)}>
                            İptal Et
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
