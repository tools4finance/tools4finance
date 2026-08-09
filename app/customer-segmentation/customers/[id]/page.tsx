"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCs } from "@/lib/csContext";
import { supabase } from "@/lib/supabase";
import { loadScoringConfig, hasAnyParameters } from "@/lib/csData";
import { computeScore, ACTION_SIGNAL_PILL, type CustomerRow, type ScoringConfig } from "@/lib/customerScoring";

type Customer = CustomerRow & {
  id: string;
  customer_code: string | null;
  name: string;
  city: string | null;
  credit_limit: number | null;
  dso: number | null;
  sales_term: number | null;
  annual_revenue_target: number | null;
};

const GRADE_COLOR: Record<string, string> = {
  "A+": "var(--green)",
  A: "var(--blue)",
  B: "var(--amber)",
  C: "var(--coral)",
};

export default function CsCustomerScorecardPage() {
  const { user } = useCs();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasParams, setHasParams] = useState(true);
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user || !params.id) return;
    setLoading(true);
    setError(null);
    try {
      const paramsExist = await hasAnyParameters(user.id);
      setHasParams(paramsExist);
      const [cfg, custRes] = await Promise.all([
        paramsExist ? loadScoringConfig(user.id) : Promise.resolve(null),
        supabase.from("CS_customers").select("*").eq("id", params.id).eq("user_id", user.id).single(),
      ]);
      if (custRes.error) throw custRes.error;
      setConfig(cfg);
      setCustomer(custRes.data as Customer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Müşteri yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [user, params.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const result = useMemo(() => {
    if (!customer || !config) return null;
    return computeScore(customer, config);
  }, [customer, config]);

  async function handleSave() {
    if (!customer) return;
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase
      .from("CS_customers")
      .update({
        customer_code: customer.customer_code,
        name: customer.name,
        city: customer.city,
        risk_class: customer.risk_class,
        overdue_rate: customer.overdue_rate,
        overdue_days: customer.overdue_days,
        dso: customer.dso,
        sales_term: customer.sales_term,
        years_active: customer.years_active,
        payment_habit: customer.payment_habit,
        credit_limit: customer.credit_limit,
        annual_revenue_target: customer.annual_revenue_target,
        strategic_customer: customer.strategic_customer,
      })
      .eq("id", customer.id);
    setSaving(false);
    if (updateError) setError(updateError.message);
  }

  async function handleDelete() {
    if (!customer) return;
    if (!window.confirm(`"${customer.name}" silinsin mi?`)) return;
    const { error: deleteError } = await supabase.from("CS_customers").delete().eq("id", customer.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    router.push("/customer-segmentation/customers");
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  if (!customer) {
    return <div className="empty-state">Müşteri bulunamadı.</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <Link href="/customer-segmentation/customers">← Müşteri Listesine Dön</Link>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!hasParams && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Skor hesaplanabilmesi için önce <Link href="/customer-segmentation/parameters">Parametreler sayfasından</Link> bir
          skorlama şablonu yükleyin.
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Müşteri Bilgileri</div>
          <button className="btn-danger" onClick={handleDelete}>Müşteriyi Sil</button>
        </div>
        <div className="form-grid">
          <label className="auth-field">
            <span>Ad / Ünvan</span>
            <input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
          </label>
          <label className="auth-field">
            <span>Müşteri Kodu</span>
            <input value={customer.customer_code ?? ""} onChange={(e) => setCustomer({ ...customer, customer_code: e.target.value })} />
          </label>
          <label className="auth-field">
            <span>Şehir</span>
            <input value={customer.city ?? ""} onChange={(e) => setCustomer({ ...customer, city: e.target.value })} />
          </label>
          <label className="auth-field">
            <span>Kredi Limiti</span>
            <input type="number" step="any" value={customer.credit_limit ?? ""} onChange={(e) => setCustomer({ ...customer, credit_limit: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          <label className="auth-field">
            <span>DSO</span>
            <input type="number" step="any" value={customer.dso ?? ""} onChange={(e) => setCustomer({ ...customer, dso: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          <label className="auth-field">
            <span>Sales Term</span>
            <input type="number" step="any" value={customer.sales_term ?? ""} onChange={(e) => setCustomer({ ...customer, sales_term: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          <label className="auth-field">
            <span>Yıllık Ciro Hedefi</span>
            <input type="number" step="any" value={customer.annual_revenue_target ?? ""} onChange={(e) => setCustomer({ ...customer, annual_revenue_target: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Skor Kartı — Kriter Girdileri</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Aşağıdaki girdileri değiştirin, skor anında yeniden hesaplanır. Kaydetmek için &quot;Kaydet&quot;e basın.
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kriter</th>
                <th>Max</th>
                <th>Girdi</th>
                <th>Skor</th>
                <th className="wrap">Puan Çubuğu</th>
              </tr>
            </thead>
            <tbody>
              {result?.breakdown.map((b) => (
                <tr key={b.key}>
                  <td className="wrap">
                    {b.label}
                    {!b.active && <span className="pill pill-neutral" style={{ marginLeft: 8 }}>Pasif</span>}
                  </td>
                  <td>{b.max}</td>
                  <td>
                    {b.key === "risk_class" && (
                      <input value={customer.risk_class ?? ""} onChange={(e) => setCustomer({ ...customer, risk_class: e.target.value })} style={{ width: 100 }} />
                    )}
                    {b.key === "overdue_rate" && (
                      <input
                        type="number"
                        step="any"
                        value={customer.overdue_rate ?? ""}
                        onChange={(e) => setCustomer({ ...customer, overdue_rate: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ width: 100 }}
                      />
                    )}
                    {b.key === "overdue_days" && (
                      <input
                        type="number"
                        step="any"
                        value={customer.overdue_days ?? ""}
                        onChange={(e) => setCustomer({ ...customer, overdue_days: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ width: 100 }}
                      />
                    )}
                    {b.key === "tenure" && (
                      <input
                        type="number"
                        step="any"
                        value={customer.years_active ?? ""}
                        onChange={(e) => setCustomer({ ...customer, years_active: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ width: 100 }}
                      />
                    )}
                    {b.key === "payment_habit" && (
                      <input value={customer.payment_habit ?? ""} onChange={(e) => setCustomer({ ...customer, payment_habit: e.target.value })} style={{ width: 130 }} />
                    )}
                    {b.key === "strategic" && (
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={!!customer.strategic_customer}
                          onChange={(e) => setCustomer({ ...customer, strategic_customer: e.target.checked })}
                        />
                        Yes
                      </label>
                    )}
                    {b.key === "annual_revenue" && <span style={{ color: "var(--text3)" }}>skor dışı</span>}
                  </td>
                  <td>{b.points.toFixed(1)}</td>
                  <td className="wrap">
                    <div style={{ background: "var(--bg2)", borderRadius: 6, height: 10, width: "100%", minWidth: 120, overflow: "hidden" }}>
                      <div
                        style={{
                          background: "var(--accent)",
                          height: "100%",
                          width: `${b.max > 0 ? Math.min(100, (b.points / b.max) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {!result && (
                <tr>
                  <td colSpan={5} className="wrap">Parametreler yüklenmediği için skor hesaplanamıyor.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 16 }}>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </div>

      {result && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Sonuç</div>
          </div>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">Toplam Skor</div>
              <div className="kpi-value" style={{ color: result.grade ? GRADE_COLOR[result.grade] : undefined }}>
                {result.totalScore.toFixed(1)}
              </div>
              <div className="kpi-sub">
                {result.forced ? `Özel kural uygulandı: ${result.forced}` : "0-100 arası"}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Skor Notu</div>
              <div className="kpi-value">{result.grade ?? "—"}</div>
              <div className="kpi-sub">Grade Thresholds tablosuna göre</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Aksiyon Sinyali</div>
              <div className="kpi-value">
                {result.actionSignal ? (
                  <span className={`pill ${ACTION_SIGNAL_PILL[result.actionSignal] ?? "pill-neutral"}`}>
                    {result.actionSignal}
                  </span>
                ) : (
                  "—"
                )}
              </div>
              <div className="kpi-sub wrap">{result.recommendedAction ?? ""}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
