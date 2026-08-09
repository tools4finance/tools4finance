"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";
import { exportRowsToExcel, exportRowsToPdf, type ExportColumn } from "@/lib/exportTable";

type OpexCapex = "OPEX" | "CAPEX";

type ExpenseCategory = {
  id: string;
  main_segment: string;
  sub_segment: string;
  name: string;
  opex_capex: OpexCapex;
  display_order: number;
  active: boolean;
};

type Vendor = {
  id: string;
  site_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tax_no: string | null;
  active: boolean;
};

type PaymentMethod = "bank" | "cash" | "credit_card" | "other";

type ExpenseStatus = "active" | "void";

type Expense = {
  id: string;
  site_id: string;
  expense_category_id: string;
  fiscal_period_id: string;
  vendor_id: string | null;
  expense_date: string;
  amount: number;
  description: string | null;
  payment_method: PaymentMethod | null;
  invoice_no: string | null;
  status: ExpenseStatus;
  voided_reason: string | null;
  created_at: string;
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank: "Banka",
  cash: "Nakit",
  credit_card: "Kredi Kartı",
  other: "Diğer",
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

function groupCategories(categories: ExpenseCategory[]): Map<string, Map<string, ExpenseCategory[]>> {
  const map = new Map<string, Map<string, ExpenseCategory[]>>();
  for (const c of categories) {
    if (!map.has(c.main_segment)) map.set(c.main_segment, new Map());
    const subMap = map.get(c.main_segment)!;
    if (!subMap.has(c.sub_segment)) subMap.set(c.sub_segment, []);
    subMap.get(c.sub_segment)!.push(c);
  }
  return map;
}

export default function ExpensesPage() {
  const { selectedSiteId, canWrite, year, month } = useAidat();

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayStr());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [vendorId, setVendorId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [saving, setSaving] = useState(false);

  // quick-add vendor
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorPhone, setNewVendorPhone] = useState("");
  const [newVendorEmail, setNewVendorEmail] = useState("");
  const [newVendorTaxNo, setNewVendorTaxNo] = useState("");
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorError, setVendorError] = useState<string | null>(null);

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const vendorsById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const groupedCategories = useMemo(() => groupCategories(categories), [categories]);

  const loadCategories = useCallback(async () => {
    const { data, error: catError } = await supabase
      .from("expense_categories")
      .select("id, main_segment, sub_segment, name, opex_capex, display_order, active")
      .eq("active", true)
      .order("display_order", { ascending: true });
    if (!catError) setCategories((data ?? []) as ExpenseCategory[]);
  }, []);

  const loadVendors = useCallback(async () => {
    if (!selectedSiteId) {
      setVendors([]);
      return;
    }
    const { data, error: vendorError2 } = await supabase
      .from("vendors")
      .select("id, site_id, name, phone, email, tax_no, active")
      .eq("site_id", selectedSiteId)
      .eq("active", true)
      .order("name", { ascending: true });
    if (!vendorError2) setVendors((data ?? []) as Vendor[]);
  }, [selectedSiteId]);

  const loadExpenses = useCallback(async () => {
    if (!selectedSiteId) {
      setExpenses([]);
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
    const { data, error: expError } = await supabase
      .from("expenses")
      .select(
        "id, site_id, expense_category_id, fiscal_period_id, vendor_id, expense_date, amount, description, payment_method, invoice_no, status, voided_reason, created_at"
      )
      .eq("site_id", selectedSiteId)
      .eq("fiscal_period_id", pId as string)
      .order("expense_date", { ascending: false });
    if (expError) {
      setError(expError.message);
    } else {
      setExpenses((data ?? []) as Expense[]);
    }
    setLoading(false);
  }, [selectedSiteId, year, month]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadVendors();
    loadExpenses();
  }, [loadVendors, loadExpenses]);

  async function handleCreateExpense(e: React.FormEvent) {
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
    const { error: insertError } = await supabase.from("expenses").insert({
      site_id: selectedSiteId,
      expense_category_id: categoryId,
      fiscal_period_id: pId as string,
      vendor_id: vendorId || null,
      expense_date: expenseDate,
      amount: Number(amount),
      description: description.trim() || null,
      payment_method: paymentMethod || null,
      invoice_no: invoiceNo.trim() || null,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setCategoryId("");
    setExpenseDate(todayStr());
    setAmount("");
    setDescription("");
    setPaymentMethod("");
    setVendorId("");
    setInvoiceNo("");
    await loadExpenses();
  }

  async function handleVoid(expense: Expense) {
    if (!canWrite) return;
    const reason = window.prompt("İptal nedeni girin:");
    if (reason === null) return;
    setError(null);
    const { error: updateError } = await supabase
      .from("expenses")
      .update({ status: "void", voided_reason: reason || null })
      .eq("id", expense.id)
      .eq("site_id", selectedSiteId ?? "");
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadExpenses();
  }

  async function handleCreateVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !canWrite || !newVendorName.trim()) return;
    setVendorSaving(true);
    setVendorError(null);
    const { data, error: insertError } = await supabase
      .from("vendors")
      .insert({
        site_id: selectedSiteId,
        name: newVendorName.trim(),
        phone: newVendorPhone.trim() || null,
        email: newVendorEmail.trim() || null,
        tax_no: newVendorTaxNo.trim() || null,
        active: true,
      })
      .select("id, site_id, name, phone, email, tax_no, active")
      .single();
    setVendorSaving(false);
    if (insertError) {
      setVendorError(insertError.message);
      return;
    }
    const newVendor = data as Vendor;
    setVendors((prev) => [...prev, newVendor].sort((a, b) => a.name.localeCompare(b.name, "tr")));
    setVendorId(newVendor.id);
    setNewVendorName("");
    setNewVendorPhone("");
    setNewVendorEmail("");
    setNewVendorTaxNo("");
    setShowVendorForm(false);
  }

  const periodLabel = `${month}/${year}`;

  const expenseExportRows = useMemo(
    () =>
      expenses.map((expense) => {
        const cat = categoriesById.get(expense.expense_category_id);
        const vendor = expense.vendor_id ? vendorsById.get(expense.vendor_id) : undefined;
        return {
          date: expense.expense_date,
          category: cat ? `${cat.main_segment} / ${cat.sub_segment} / ${cat.name}` : "—",
          type: cat ? cat.opex_capex : "—",
          amount: expense.amount,
          vendor: vendor ? vendor.name : "—",
          status:
            expense.status === "active"
              ? "Aktif"
              : `İptal${expense.voided_reason ? ` (${expense.voided_reason})` : ""}`,
        };
      }),
    [expenses, categoriesById, vendorsById]
  );

  const expenseExportColumns: ExportColumn[] = [
    { header: "Tarih", value: (row) => row.date as string },
    { header: "Gider Kalemi", value: (row) => row.category as string },
    { header: "Tür", value: (row) => row.type as string },
    { header: "Tutar", value: (row) => row.amount as number },
    { header: "Tedarikçi", value: (row) => row.vendor as string },
    { header: "Durum", value: (row) => row.status as string },
  ];

  function handleExportExpensesExcel() {
    if (expenseExportRows.length === 0) return;
    exportRowsToExcel(expenseExportRows, expenseExportColumns, {
      title: "Giderler",
      subtitle: periodLabel,
      sheetName: "Giderler",
    });
  }

  function handleExportExpensesPdf() {
    if (expenseExportRows.length === 0) return;
    exportRowsToPdf(expenseExportRows, expenseExportColumns, {
      title: "Giderler",
      subtitle: periodLabel,
    });
  }

  const activeExpenses = expenses.filter((e) => e.status === "active");
  const totalOpex = activeExpenses.reduce((sum, e) => {
    const cat = categoriesById.get(e.expense_category_id);
    return cat?.opex_capex === "OPEX" ? sum + e.amount : sum;
  }, 0);
  const totalCapex = activeExpenses.reduce((sum, e) => {
    const cat = categoriesById.get(e.expense_category_id);
    return cat?.opex_capex === "CAPEX" ? sum + e.amount : sum;
  }, 0);

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Dönem OPEX Toplamı</div>
          <div className="kpi-value">{formatMoney(totalOpex)}</div>
          <div className="kpi-sub">İşletme giderleri</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Dönem CAPEX Toplamı</div>
          <div className="kpi-value">{formatMoney(totalCapex)}</div>
          <div className="kpi-sub">Yatırım giderleri (opex&apos;ten ayrı tutulur)</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Gider Ekle</div>
        </div>

        {canWrite && (
          <form onSubmit={handleCreateExpense} className="form-grid">
            <label className="auth-field">
              <span>Gider Kalemi</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                <option value="">Seçiniz…</option>
                {Array.from(groupedCategories.entries()).map(([main, subMap]) => (
                  <optgroup key={main} label={main}>
                    {Array.from(subMap.entries()).map(([sub, items]) =>
                      items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {sub} / {item.name} ({item.opex_capex})
                        </option>
                      ))
                    )}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span>Tarih</span>
              <input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                required
              />
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
              <span>Ödeme Yöntemi</span>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}>
                <option value="">Belirtilmedi</option>
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((pm) => (
                  <option key={pm} value={pm}>
                    {PAYMENT_METHOD_LABELS[pm]}
                  </option>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span>Tedarikçi (opsiyonel)</span>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Belirtilmedi</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span>Fatura No (opsiyonel)</span>
              <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="opsiyonel" />
            </label>
            <label className="auth-field">
              <span>Açıklama (opsiyonel)</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="opsiyonel" />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <button className="btn-primary" type="submit" disabled={saving || !categoryId || !amount}>
                {saving ? "Kaydediliyor…" : "Gider Ekle"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowVendorForm(!showVendorForm)}>
                {showVendorForm ? "Vazgeç" : "+ Yeni Tedarikçi"}
              </button>
            </div>
          </form>
        )}

        {showVendorForm && canWrite && (
          <form onSubmit={handleCreateVendor} className="form-grid" style={{ marginTop: 4, marginBottom: 8 }}>
            <label className="auth-field">
              <span>Tedarikçi Adı</span>
              <input value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} required />
            </label>
            <label className="auth-field">
              <span>Telefon (opsiyonel)</span>
              <input value={newVendorPhone} onChange={(e) => setNewVendorPhone(e.target.value)} placeholder="opsiyonel" />
            </label>
            <label className="auth-field">
              <span>E-posta (opsiyonel)</span>
              <input value={newVendorEmail} onChange={(e) => setNewVendorEmail(e.target.value)} placeholder="opsiyonel" />
            </label>
            <label className="auth-field">
              <span>Vergi No (opsiyonel)</span>
              <input value={newVendorTaxNo} onChange={(e) => setNewVendorTaxNo(e.target.value)} placeholder="opsiyonel" />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn-primary" type="submit" disabled={vendorSaving || !newVendorName.trim()}>
                {vendorSaving ? "Kaydediliyor…" : "Tedarikçi Ekle"}
              </button>
            </div>
          </form>
        )}

        {vendorError && <div className="auth-error">{vendorError}</div>}
        {error && <div className="auth-error">{error}</div>}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Giderler</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={expenseExportRows.length === 0}
              onClick={handleExportExpensesExcel}
            >
              Excel İndir
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={expenseExportRows.length === 0}
              onClick={handleExportExpensesPdf}
            >
              PDF İndir
            </button>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Yükleniyor…</div>
        ) : !periodId || expenses.length === 0 ? (
          <div className="empty-state">Bu dönem için henüz gider kaydı bulunmuyor.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Gider Kalemi</th>
                  <th>Tür</th>
                  <th className="num">Tutar</th>
                  <th>Tedarikçi</th>
                  <th>Durum</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => {
                  const cat = categoriesById.get(expense.expense_category_id);
                  const vendor = expense.vendor_id ? vendorsById.get(expense.vendor_id) : undefined;
                  return (
                    <tr key={expense.id}>
                      <td>{expense.expense_date}</td>
                      <td className="wrap">
                        {cat ? `${cat.main_segment} / ${cat.sub_segment} / ${cat.name}` : "—"}
                      </td>
                      <td>
                        {cat ? (
                          <span className={`pill ${cat.opex_capex === "CAPEX" ? "pill-amber" : "pill-blue"}`}>
                            {cat.opex_capex}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">{formatMoney(expense.amount)}</td>
                      <td className="wrap">{vendor ? vendor.name : "—"}</td>
                      <td>
                        {expense.status === "active" ? (
                          <span className="pill pill-green">Aktif</span>
                        ) : (
                          <span className="pill pill-coral" title={expense.voided_reason ?? undefined}>
                            İptal
                          </span>
                        )}
                      </td>
                      <td>
                        {canWrite && expense.status === "active" && (
                          <button className="btn-danger" onClick={() => handleVoid(expense)}>
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
