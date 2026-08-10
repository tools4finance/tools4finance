"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";

type Period = {
  id: string;
  name: string;
  year: number;
  status: "draft" | "active" | "closed";
  company_weight_pct: number;
  individual_weight_pct: number;
};

const STATUS_PILL: Record<Period["status"], string> = {
  draft: "pill-neutral",
  active: "pill-green",
  closed: "pill-blue",
};
const STATUS_LABEL: Record<Period["status"], string> = {
  draft: "Taslak",
  active: "Aktif",
  closed: "Kapandı",
};

export default function KpiPeriodsPage() {
  const { selectedMembership, canManage } = useKpi();
  const orgId = selectedMembership?.org_id ?? null;

  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [companyWeight, setCompanyWeight] = useState(40);
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("KPI_periods")
      .select("id, name, year, status, company_weight_pct, individual_weight_pct")
      .eq("org_id", orgId)
      .order("year", { ascending: false });
    if (fetchError) setError(fetchError.message);
    setPeriods((data ?? []) as Period[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !name.trim()) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from("KPI_periods").insert({
      org_id: orgId,
      name: name.trim(),
      year,
      company_weight_pct: companyWeight,
      individual_weight_pct: 100 - companyWeight,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName("");
    await fetchAll();
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }
  if (!canManage) {
    return <div className="empty-state">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  }

  return (
    <div>
      {canManage && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Yeni Dönem</div>
          </div>
          {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
          <form onSubmit={handleCreate} className="form-grid">
            <label className="auth-field">
              <span>Dönem Adı</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="örn. 2026 Hedefler" />
            </label>
            <label className="auth-field">
              <span>Yıl</span>
              <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} required />
            </label>
            <label className="auth-field">
              <span>Şirket Ağırlığı (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={companyWeight}
                onChange={(e) => setCompanyWeight(Number(e.target.value))}
              />
            </label>
            <label className="auth-field">
              <span>Bireysel Ağırlığı (%)</span>
              <input type="number" value={100 - companyWeight} disabled />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn-primary" type="submit" disabled={saving || !name.trim()}>
                {saving ? "Kaydediliyor…" : "Dönem Oluştur"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Dönemler</div>
        </div>
        {periods.length === 0 ? (
          <div className="empty-state">Henüz dönem oluşturulmadı.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dönem</th>
                  <th>Yıl</th>
                  <th>Durum</th>
                  <th>Şirket / Bireysel</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.year}</td>
                    <td><span className={`pill ${STATUS_PILL[p.status]}`}>{STATUS_LABEL[p.status]}</span></td>
                    <td>{p.company_weight_pct}% / {p.individual_weight_pct}%</td>
                    <td><Link className="btn-secondary" href={`/kpi-tracker/periods/${p.id}`}>Aç</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
