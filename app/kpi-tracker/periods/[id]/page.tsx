"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";
import { sumWeights, isFullyWeighted } from "@/lib/kpiScoring";

type Period = {
  id: string;
  org_id: string;
  name: string;
  year: number;
  status: "draft" | "active" | "closed";
  company_weight_pct: number;
  individual_weight_pct: number;
};

type CompanyGoal = {
  id: string;
  title: string;
  description: string | null;
  weight_pct: number;
  achievement_pct: number | null;
  hr_comment: string | null;
};

function emptyGoal() {
  return { title: "", description: "", weight_pct: 0 };
}

export default function KpiPeriodDetailPage() {
  const { selectedMembership, canManage } = useKpi();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [period, setPeriod] = useState<Period | null>(null);
  const [goals, setGoals] = useState<CompanyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newGoal, setNewGoal] = useState(emptyGoal());
  const [adding, setAdding] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    setError(null);
    const [periodRes, goalsRes] = await Promise.all([
      supabase.from("KPI_periods").select("*").eq("id", params.id).single(),
      supabase.from("KPI_company_goals").select("*").eq("period_id", params.id).order("display_order"),
    ]);
    if (periodRes.error) {
      setError(periodRes.error.message);
      setLoading(false);
      return;
    }
    setPeriod(periodRes.data as Period);
    setGoals((goalsRes.data ?? []) as CompanyGoal[]);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const weightTotal = useMemo(() => sumWeights(goals), [goals]);
  const fullyWeighted = useMemo(() => isFullyWeighted(goals), [goals]);

  async function handleAddGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!period || !newGoal.title.trim()) return;
    setAdding(true);
    setError(null);
    const { error: insertError } = await supabase.from("KPI_company_goals").insert({
      org_id: period.org_id,
      period_id: period.id,
      title: newGoal.title.trim(),
      description: newGoal.description || null,
      weight_pct: newGoal.weight_pct,
      display_order: goals.length,
    });
    setAdding(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewGoal(emptyGoal());
    await fetchAll();
  }

  async function handleUpdateGoal(goal: CompanyGoal) {
    const { error: updateError } = await supabase
      .from("KPI_company_goals")
      .update({ title: goal.title, description: goal.description, weight_pct: goal.weight_pct })
      .eq("id", goal.id);
    if (updateError) setError(updateError.message);
  }

  async function handleDeleteGoal(id: string) {
    const { error: deleteError } = await supabase.from("KPI_company_goals").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setGoals(goals.filter((g) => g.id !== id));
  }

  async function handleAnnounce() {
    if (!period) return;
    if (!fullyWeighted) {
      const confirmed = window.confirm(
        `Şirket hedeflerinin ağırlık toplamı %${weightTotal.toFixed(1)} (100 olmalı). Yine de duyurmak istiyor musunuz?`
      );
      if (!confirmed) return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("kpi_announce_period", { p_period_id: period.id });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await fetchAll();
  }

  async function handleClose() {
    if (!period) return;
    if (!window.confirm("Dönemi kapatmak istediğinize emin misiniz? Bu işlem tüm üyelere sonuç bildirimi gönderir.")) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("kpi_close_period", { p_period_id: period.id });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await fetchAll();
  }

  async function handleDeletePeriod() {
    if (!period) return;
    if (!window.confirm(`"${period.name}" dönemini silmek istediğinize emin misiniz?`)) return;
    const { error: deleteError } = await supabase.from("KPI_periods").delete().eq("id", period.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    router.push("/kpi-tracker/periods");
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }
  if (!period) {
    return <div className="empty-state">Dönem bulunamadı.</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <Link href="/kpi-tracker/periods">← Dönemlere Dön</Link>
      </div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            {period.name} ({period.year}) — {period.status === "draft" ? "Taslak" : period.status === "active" ? "Aktif" : "Kapandı"}
          </div>
          {canManage && (
            <div style={{ display: "flex", gap: 8 }}>
              {period.status === "draft" && (
                <button className="btn-primary" onClick={handleAnnounce} disabled={busy || goals.length === 0}>
                  {busy ? "…" : "Duyur"}
                </button>
              )}
              {period.status === "active" && (
                <button className="btn-primary" onClick={handleClose} disabled={busy}>
                  {busy ? "…" : "Dönemi Kapat"}
                </button>
              )}
              {period.status === "draft" && (
                <button className="btn-danger" onClick={handleDeletePeriod}>Dönemi Sil</button>
              )}
            </div>
          )}
        </div>
        <p style={{ fontSize: 12, color: "var(--text2)" }}>
          Şirket Ağırlığı %{period.company_weight_pct} / Bireysel Ağırlığı %{period.individual_weight_pct}
          {period.status === "draft" && " — dönem taslakken şirket hedeflerini düzenleyebilirsiniz."}
        </p>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            Şirket Hedefleri — Ağırlık Toplamı: %{weightTotal.toFixed(1)}
            {!fullyWeighted && <span className="pill pill-amber" style={{ marginLeft: 8 }}>100 olmalı</span>}
          </div>
        </div>
        {!canManage && goals.length === 0 && <div className="empty-state">Henüz şirket hedefi girilmedi.</div>}
        {goals.length > 0 && (
          <div className="table-scroll" style={{ marginBottom: canManage ? 16 : 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="wrap">Başlık</th>
                  <th className="wrap">Açıklama</th>
                  <th>Ağırlık %</th>
                  {!canManage && <th>Gerçekleşme %</th>}
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {goals.map((g) => (
                  <tr key={g.id}>
                    <td className="wrap">
                      {canManage ? (
                        <input
                          value={g.title}
                          onChange={(e) => setGoals(goals.map((x) => (x.id === g.id ? { ...x, title: e.target.value } : x)))}
                          style={{ width: "100%", minWidth: 140 }}
                        />
                      ) : (
                        g.title
                      )}
                    </td>
                    <td className="wrap">
                      {canManage ? (
                        <input
                          value={g.description ?? ""}
                          onChange={(e) => setGoals(goals.map((x) => (x.id === g.id ? { ...x, description: e.target.value } : x)))}
                          style={{ width: "100%", minWidth: 160 }}
                        />
                      ) : (
                        g.description || "—"
                      )}
                    </td>
                    <td>
                      {canManage ? (
                        <input
                          type="number"
                          step="any"
                          value={g.weight_pct}
                          onChange={(e) => setGoals(goals.map((x) => (x.id === g.id ? { ...x, weight_pct: Number(e.target.value) } : x)))}
                          style={{ width: 80 }}
                        />
                      ) : (
                        g.weight_pct
                      )}
                    </td>
                    {!canManage && <td>{g.achievement_pct ?? "—"}</td>}
                    {canManage && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn-secondary" onClick={() => handleUpdateGoal(g)}>Kaydet</button>{" "}
                        <button className="btn-danger" onClick={() => handleDeleteGoal(g.id)}>Sil</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage && (
          <form onSubmit={handleAddGoal} className="form-grid">
            <label className="auth-field">
              <span>Başlık</span>
              <input value={newGoal.title} onChange={(e) => setNewGoal({ ...newGoal, title: e.target.value })} required />
            </label>
            <label className="auth-field">
              <span>Açıklama</span>
              <input value={newGoal.description} onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })} />
            </label>
            <label className="auth-field">
              <span>Ağırlık %</span>
              <input
                type="number"
                step="any"
                value={newGoal.weight_pct}
                onChange={(e) => setNewGoal({ ...newGoal, weight_pct: Number(e.target.value) })}
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn-primary" type="submit" disabled={adding || !newGoal.title.trim()}>
                {adding ? "Kaydediliyor…" : "+ Hedef Ekle"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
