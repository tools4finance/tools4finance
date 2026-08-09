"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { useCs } from "@/lib/csContext";
import { supabase } from "@/lib/supabase";
import { loadScoringConfig, hasAnyParameters } from "@/lib/csData";
import { computeScore, ACTION_SIGNAL_PILL, type ScoringConfig } from "@/lib/customerScoring";

type Customer = {
  id: string;
  customer_code: string | null;
  name: string;
  city: string | null;
  sum_undue: number | null;
  sum_0_7: number | null;
  sum_8_30: number | null;
  sum_31_60: number | null;
  sum_61_90: number | null;
  sum_91_plus: number | null;
  sum_overdue: number | null;
  sum_amount_local: number | null;
  risk_class: string | null;
  credit_limit: number | null;
  overdue_rate: number | null;
  overdue_days: number | null;
  dso: number | null;
  sales_term: number | null;
  years_active: number | null;
  payment_habit: string | null;
  annual_revenue_target: number | null;
  strategic_customer: boolean | null;
};

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

function emptyForm(): Omit<Customer, "id"> {
  return {
    customer_code: "",
    name: "",
    city: "",
    sum_undue: null,
    sum_0_7: null,
    sum_8_30: null,
    sum_31_60: null,
    sum_61_90: null,
    sum_91_plus: null,
    sum_overdue: null,
    sum_amount_local: null,
    risk_class: "",
    credit_limit: null,
    overdue_rate: null,
    overdue_days: null,
    dso: null,
    sales_term: null,
    years_active: null,
    payment_habit: "",
    annual_revenue_target: null,
    strategic_customer: false,
  };
}

// ---------------------------------------------------------------------------
// Excel bulk-import — accepts either this app's own Turkish template headers
// or the original ERP-style headers the source spreadsheet used (so users
// can paste straight from an ageing export without relabeling columns).
// ---------------------------------------------------------------------------

const TEMPLATE_HEADERS = [
  "Müşteri Kodu",
  "Ad / Ünvan*",
  "Şehir",
  "Risk Class",
  "Overdue Rate (%)",
  "Overdue Days",
  "DSO",
  "Sales Term",
  "Çalışma Yılı",
  "Payment Habit",
  "Kredi Limiti",
  "Yıllık Ciro Hedefi",
  "Stratejik Müşteri (Yes/No)",
] as const;

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return String(value).trim();
}
function cellToNumber(value: unknown): number | null {
  const s = cellToString(value);
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  return isFinite(n) ? n : null;
}
function cellToRate(value: unknown): number | null {
  const n = cellToNumber(value);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
}
function cellToBool(value: unknown): boolean {
  const s = cellToString(value).toLowerCase();
  return s === "yes" || s === "evet" || s === "true";
}
function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") return raw[k];
  }
  return null;
}

type ParsedRow = { rowNumber: number; data: Omit<Customer, "id">; status: "ready" | "skip"; message: string };

function buildParsedRow(raw: Record<string, unknown>, index: number): ParsedRow {
  const name = cellToString(pick(raw, "Ad / Ünvan*", "Ad / Ünvan", "Name", "Ad"));
  const rowNumber = index + 2;
  if (!name) {
    return { rowNumber, status: "skip", message: "Ad / Ünvan zorunludur, bu satır atlanacak.", data: emptyForm() };
  }
  const data: Omit<Customer, "id"> = {
    customer_code: cellToString(pick(raw, "Müşteri Kodu", "Customer", "Customer Code")) || null,
    name,
    city: cellToString(pick(raw, "Şehir", "City")) || null,
    sum_undue: cellToNumber(pick(raw, "Sum of undue")),
    sum_0_7: cellToNumber(pick(raw, "Sum of -0 To -7")),
    sum_8_30: cellToNumber(pick(raw, "Sum of -8 To -30")),
    sum_31_60: cellToNumber(pick(raw, "Sum of -31 To -60")),
    sum_61_90: cellToNumber(pick(raw, "Sum of -61 To -90")),
    sum_91_plus: cellToNumber(pick(raw, "Sum of -91 To -9999")),
    sum_overdue: cellToNumber(pick(raw, "Sum of overdue")),
    sum_amount_local: cellToNumber(pick(raw, "Sum of Amt.in loc.cur.")),
    risk_class: cellToString(pick(raw, "Risk Class")) || null,
    credit_limit: cellToNumber(pick(raw, "Kredi Limiti", "Credit Limit")),
    overdue_rate: cellToRate(pick(raw, "Overdue Rate (%)", "Overdue Rate")),
    overdue_days: cellToNumber(pick(raw, "Overdue Days")),
    dso: cellToNumber(pick(raw, "DSO")),
    sales_term: cellToNumber(pick(raw, "Sales Term")),
    years_active: cellToNumber(pick(raw, "Çalışma Yılı", "Years Active")),
    payment_habit: cellToString(pick(raw, "Payment Habit")) || null,
    annual_revenue_target: cellToNumber(pick(raw, "Yıllık Ciro Hedefi", "Annual Revenue Target")),
    strategic_customer: cellToBool(pick(raw, "Stratejik Müşteri (Yes/No)", "Stratejik Müşteri", "Strategic Customer")),
  };
  return { rowNumber, status: "ready", message: "Hazır.", data };
}

function handleDownloadTemplate() {
  const exampleRow: Record<(typeof TEMPLATE_HEADERS)[number], string> = {
    "Müşteri Kodu": "C-1001",
    "Ad / Ünvan*": "Örnek A.Ş.",
    Şehir: "İstanbul",
    "Risk Class": "AAA",
    "Overdue Rate (%)": "15",
    "Overdue Days": "12",
    DSO: "42",
    "Sales Term": "30",
    "Çalışma Yılı": "6",
    "Payment Habit": "Good Payer",
    "Kredi Limiti": "500000",
    "Yıllık Ciro Hedefi": "2000000",
    "Stratejik Müşteri (Yes/No)": "No",
  };
  const sheet = XLSX.utils.json_to_sheet([exampleRow], { header: [...TEMPLATE_HEADERS] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Müşteriler");
  XLSX.writeFile(workbook, "musteriler_sablonu.xlsx");
}

export default function CsCustomersPage() {
  const { user } = useCs();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasParams, setHasParams] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState<Omit<Customer, "id">>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const paramsExist = await hasAnyParameters(user.id);
      setHasParams(paramsExist);
      const [cfg, custRes] = await Promise.all([
        paramsExist ? loadScoringConfig(user.id) : Promise.resolve(null),
        supabase.from("CS_customers").select("*").eq("user_id", user.id).order("name"),
      ]);
      if (custRes.error) throw custRes.error;
      setConfig(cfg);
      setCustomers((custRes.data ?? []) as Customer[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Müşteriler yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !form.name.trim()) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from("CS_customers").insert({ ...form, user_id: user.id });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setForm(emptyForm());
    setShowForm(false);
    await fetchAll();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Bu müşteriyi silmek istediğinize emin misiniz?")) return;
    const { error: deleteError } = await supabase.from("CS_customers").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setCustomers(customers.filter((c) => c.id !== id));
  }

  async function handleBulkFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setBulkError(null);
    setParsedRows([]);
    setBulkParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
      if (!sheet) throw new Error("Excel dosyasında okunabilir bir sayfa bulunamadı.");
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const rows = rawRows.map((raw, idx) => buildParsedRow(raw, idx));
      if (rows.length === 0) setBulkError("Dosyada satır bulunamadı.");
      setParsedRows(rows);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Dosya okunamadı. Lütfen .xlsx/.xls formatında yükleyin.");
    } finally {
      setBulkParsing(false);
    }
  }

  async function handleImportRows() {
    if (!user) return;
    const readyRows = parsedRows.filter((r) => r.status === "ready");
    if (readyRows.length === 0) return;
    setBulkImporting(true);
    setBulkError(null);
    setImportProgress({ done: 0, total: readyRows.length });

    const BATCH = 100;
    let created = 0;
    for (let i = 0; i < readyRows.length; i += BATCH) {
      const batch = readyRows.slice(i, i + BATCH).map((r) => ({ ...r.data, user_id: user.id }));
      const { error: insertError } = await supabase.from("CS_customers").insert(batch);
      if (insertError) {
        setBulkError(insertError.message);
        break;
      }
      created += batch.length;
      setImportProgress({ done: Math.min(i + BATCH, readyRows.length), total: readyRows.length });
    }

    setBulkImporting(false);
    setImportProgress(null);
    setParsedRows([]);
    if (created > 0) await fetchAll();
  }

  const scored = useMemo(() => {
    if (!config) return [];
    return customers.map((c) => ({ customer: c, result: computeScore(c, config) }));
  }, [customers, config]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    if (!q) return scored;
    return scored.filter(
      ({ customer }) =>
        customer.name.toLocaleLowerCase("tr").includes(q) ||
        (customer.customer_code ?? "").toLocaleLowerCase("tr").includes(q) ||
        (customer.city ?? "").toLocaleLowerCase("tr").includes(q)
    );
  }, [scored, search]);

  const DISPLAY_CAP = 200;
  const shown = filtered.slice(0, DISPLAY_CAP);

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      {!hasParams && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Skor hesaplanabilmesi için önce{" "}
          <Link href="/customer-segmentation/parameters">Parametreler sayfasından</Link> bir skorlama şablonu
          yükleyin. Müşterileri yine de ekleyebilirsiniz.
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Excel ile Toplu Yükle</div>
        </div>
        <div className="auth-info" style={{ marginBottom: 14 }}>
          Şablonu indirip doldurun ya da doğrudan mevcut ageing/ERP export dosyanızı (Customer, Name, City, Risk
          Class, Overdue Rate, Overdue Days, DSO, Sales Term, Payment Habit, vb. başlıklarıyla) seçin — kolon
          başlıkları otomatik eşleşir.
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <button type="button" className="btn-secondary" onClick={handleDownloadTemplate}>
            Excel Şablonu İndir
          </button>
          <label className="auth-field" style={{ flex: "1 1 240px", minWidth: 240 }}>
            <span>Excel Dosyası Seç (.xlsx / .xls)</span>
            <input type="file" accept=".xlsx,.xls" onChange={handleBulkFileSelected} disabled={bulkParsing || bulkImporting} />
          </label>
        </div>

        {bulkParsing && <div className="empty-state">Dosya okunuyor…</div>}
        {bulkError && <div className="auth-error">{bulkError}</div>}

        {parsedRows.length > 0 && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
              <span className="pill pill-green">{parsedRows.filter((r) => r.status === "ready").length} hazır</span>
              <span className="pill pill-coral">{parsedRows.filter((r) => r.status === "skip").length} atlanacak</span>
            </div>
            <div className="table-scroll" style={{ marginBottom: 14 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Satır</th>
                    <th>Durum</th>
                    <th className="wrap">Ad / Ünvan</th>
                    <th>Risk Class</th>
                    <th>Not</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 50).map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>
                        {row.status === "ready" ? (
                          <span className="pill pill-green">Hazır</span>
                        ) : (
                          <span className="pill pill-coral">Atlanacak</span>
                        )}
                      </td>
                      <td className="wrap">{row.data.name || "—"}</td>
                      <td>{row.data.risk_class || "—"}</td>
                      <td className="wrap">{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 50 && (
                <div className="empty-state">…ve {parsedRows.length - 50} satır daha (önizleme ilk 50 ile sınırlı, tümü içe aktarılacak).</div>
              )}
            </div>

            {importProgress && (
              <div className="empty-state">İçe aktarılıyor… ({importProgress.done}/{importProgress.total})</div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleImportRows}
                disabled={bulkImporting || parsedRows.filter((r) => r.status === "ready").length === 0}
              >
                {bulkImporting ? "Kaydediliyor…" : `İçe Aktar (${parsedRows.filter((r) => r.status === "ready").length})`}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setParsedRows([])} disabled={bulkImporting}>
                Vazgeç
              </button>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Müşteriler ({filtered.length})</div>
          <button className="btn-secondary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Vazgeç" : "+ Müşteri Ekle"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="form-grid" style={{ marginBottom: 16 }}>
            <label className="auth-field">
              <span>Ad / Ünvan</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="auth-field">
              <span>Müşteri Kodu</span>
              <input value={form.customer_code ?? ""} onChange={(e) => setForm({ ...form, customer_code: e.target.value })} />
            </label>
            <label className="auth-field">
              <span>Şehir</span>
              <input value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </label>
            <label className="auth-field">
              <span>Risk Class</span>
              <input value={form.risk_class ?? ""} onChange={(e) => setForm({ ...form, risk_class: e.target.value })} placeholder="AAA, BBB, MMM…" />
            </label>
            <label className="auth-field">
              <span>Overdue Rate (0-1 arası, örn 0.15)</span>
              <input type="number" step="any" value={form.overdue_rate ?? ""} onChange={(e) => setForm({ ...form, overdue_rate: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label className="auth-field">
              <span>Overdue Days</span>
              <input type="number" step="any" value={form.overdue_days ?? ""} onChange={(e) => setForm({ ...form, overdue_days: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label className="auth-field">
              <span>DSO</span>
              <input type="number" step="any" value={form.dso ?? ""} onChange={(e) => setForm({ ...form, dso: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label className="auth-field">
              <span>Sales Term</span>
              <input type="number" step="any" value={form.sales_term ?? ""} onChange={(e) => setForm({ ...form, sales_term: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label className="auth-field">
              <span>Çalışma Yılı</span>
              <input type="number" step="any" value={form.years_active ?? ""} onChange={(e) => setForm({ ...form, years_active: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label className="auth-field">
              <span>Payment Habit</span>
              <input value={form.payment_habit ?? ""} onChange={(e) => setForm({ ...form, payment_habit: e.target.value })} placeholder="Good Payer, Neutral, Bad Payer…" />
            </label>
            <label className="auth-field">
              <span>Kredi Limiti</span>
              <input type="number" step="any" value={form.credit_limit ?? ""} onChange={(e) => setForm({ ...form, credit_limit: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label className="auth-field">
              <span>Yıllık Ciro Hedefi</span>
              <input type="number" step="any" value={form.annual_revenue_target ?? ""} onChange={(e) => setForm({ ...form, annual_revenue_target: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label className="auth-field">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={!!form.strategic_customer} onChange={(e) => setForm({ ...form, strategic_customer: e.target.checked })} />
                Stratejik Müşteri
              </span>
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn-primary" type="submit" disabled={saving || !form.name.trim()}>
                {saving ? "Kaydediliyor…" : "Müşteri Ekle"}
              </button>
            </div>
          </form>
        )}

        <label className="auth-field" style={{ maxWidth: 320, marginBottom: 14 }}>
          <span>Ara (Ad, Kod, Şehir)</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ara…" />
        </label>

        {customers.length === 0 ? (
          <div className="empty-state">Henüz müşteri eklenmedi.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="wrap">Ad / Ünvan</th>
                  <th>Şehir</th>
                  <th>Risk Class</th>
                  <th>Skor</th>
                  <th>Not</th>
                  <th>Aksiyon</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ customer, result }) => (
                  <tr key={customer.id}>
                    <td className="wrap">
                      <Link href={`/customer-segmentation/customers/${customer.id}`}>{customer.name}</Link>
                      {customer.customer_code && <span style={{ color: "var(--text3)" }}> · {customer.customer_code}</span>}
                    </td>
                    <td>{customer.city || "—"}</td>
                    <td>{customer.risk_class || "—"}</td>
                    <td>{config ? result.totalScore.toFixed(1) : "—"}</td>
                    <td>{config ? result.grade ?? "—" : "—"}</td>
                    <td>
                      {config && result.actionSignal && (
                        <span className={`pill ${ACTION_SIGNAL_PILL[result.actionSignal] ?? "pill-neutral"}`}>
                          {result.actionSignal}
                        </span>
                      )}
                    </td>
                    <td>
                      <button className="btn-danger" onClick={() => handleDelete(customer.id)}>Sil</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > DISPLAY_CAP && (
              <div className="empty-state">
                {filtered.length} sonuçtan ilk {DISPLAY_CAP} tanesi gösteriliyor — daraltmak için arama kutusunu kullanın.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
