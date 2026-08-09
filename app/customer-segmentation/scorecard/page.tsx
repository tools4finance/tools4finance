"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCs } from "@/lib/csContext";
import { supabase } from "@/lib/supabase";
import { loadScoringConfig, hasAnyParameters } from "@/lib/csData";
import { computeScore, ACTION_SIGNAL_PILL, type CustomerRow, type ScoringConfig } from "@/lib/customerScoring";
import CriterionInput from "@/components/CriterionInput";

const GRADE_COLOR: Record<string, string> = {
  "A+": "var(--green)",
  A: "var(--blue)",
  B: "var(--amber)",
  C: "var(--coral)",
};

// Standalone "what-if" score calculator — mirrors the source spreadsheet's
// "Tekil Müşteri" sheet: type criteria in, see the score/grade instantly,
// with no requirement that the customer already exists in CS_customers. The
// input fields shown are whatever the user's active criteria actually read
// from (criteria are fully user-defined, so this can't be a fixed form).
// Optionally persists the inputs as a new customer row.
export default function CsScorecardCalculatorPage() {
  const { user } = useCs();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasParams, setHasParams] = useState(true);
  const [config, setConfig] = useState<ScoringConfig | null>(null);

  const [name, setName] = useState("");
  const [inputs, setInputs] = useState<CustomerRow>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const paramsExist = await hasAnyParameters(user.id);
      setHasParams(paramsExist);
      if (paramsExist) setConfig(await loadScoringConfig(user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parametreler yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const result = useMemo(() => (config ? computeScore(inputs, config) : null), [inputs, config]);

  function handleReset() {
    setName("");
    setInputs({});
    setSaved(false);
    setSaveError(null);
  }

  async function handleSaveAsCustomer() {
    if (!user || !name.trim()) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const { data, error: insertError } = await supabase
      .from("CS_customers")
      .insert({ ...inputs, name: name.trim(), user_id: user.id })
      .select("id")
      .single();
    setSaving(false);
    if (insertError) {
      setSaveError(insertError.message);
      return;
    }
    const newId = (data as { id: string } | null)?.id;
    if (newId) router.push(`/customer-segmentation/customers/${newId}`);
    else setSaved(true);
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!hasParams && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Skor hesaplanabilmesi için önce <Link href="/customer-segmentation/parameters">Parametreler sayfasından</Link> bir
          skorlama şablonu yükleyin.
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Tekil Skor Hesapla</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Kayıtlı bir müşteri seçmeden, kriterleri elle girip skoru anında görün — Excel&apos;deki &quot;Tekil
          Müşteri&quot; hesaplayıcısının karşılığı. İsterseniz sonucu yeni bir müşteri kaydı olarak saklayabilirsiniz.
        </p>

        <label className="auth-field" style={{ maxWidth: 320, marginBottom: 18 }}>
          <span>Ad / Ünvan (kaydetmek için gerekli)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="opsiyonel — sadece kaydetmek için" />
        </label>

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
                    <CriterionInput
                      field={b.sourceField}
                      value={inputs[b.sourceField] ?? null}
                      onChange={(value) => setInputs({ ...inputs, [b.sourceField]: value })}
                    />
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

        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn-primary" onClick={handleSaveAsCustomer} disabled={saving || !name.trim()}>
            {saving ? "Kaydediliyor…" : "Müşteri Olarak Kaydet"}
          </button>
          <button className="btn-secondary" onClick={handleReset}>Sıfırla</button>
          {saveError && <span className="auth-error">{saveError}</span>}
          {saved && <span className="auth-info">Kaydedildi.</span>}
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
              <div className="kpi-sub">{result.forced ? `Özel kural uygulandı: ${result.forced}` : "0-100 arası"}</div>
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
                  <span className={`pill ${ACTION_SIGNAL_PILL[result.actionSignal] ?? "pill-neutral"}`}>{result.actionSignal}</span>
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
