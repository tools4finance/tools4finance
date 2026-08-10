"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";
import { sumWeights, isFullyWeighted, companyScore, individualScore, finalScore, computeAchievementPct, type GoalDirection } from "@/lib/kpiScoring";

const DIRECTION_LABEL: Record<GoalDirection, string> = {
  higher_better: "yüksek iyi",
  lower_better: "düşük iyi",
};

type Period = {
  id: string;
  name: string;
  year: number;
  status: "draft" | "active" | "closed";
  company_weight_pct: number;
  individual_weight_pct: number;
};

type CompanyGoal = { id: string; title: string; description: string | null; weight_pct: number; achievement_pct: number | null; hr_comment: string | null };
type IndividualGoal = {
  id: string;
  title: string;
  description: string | null;
  weight_pct: number;
  self_rating: number | null;
  self_comment: string | null;
  manager_rating: number | null;
  manager_comment: string | null;
  direction: GoalDirection | null;
  target_value: number | null;
  actual_value: number | null;
  unit: string | null;
};

function emptyGoal() {
  return { title: "", description: "", weight_pct: 0, direction: "" as GoalDirection | "", target_value: "", unit: "" };
}

export default function KpiMyGoalsPage() {
  const { selectedMembership } = useKpi();

  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [companyGoals, setCompanyGoals] = useState<CompanyGoal[]>([]);
  const [goals, setGoals] = useState<IndividualGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newGoal, setNewGoal] = useState(emptyGoal());
  const [adding, setAdding] = useState(false);

  const orgId = selectedMembership?.org_id ?? null;
  const memberId = selectedMembership?.id ?? null;

  const fetchPeriods = useCallback(async () => {
    if (!orgId) return;
    const { data, error: fetchError } = await supabase
      .from("KPI_periods")
      .select("id, name, year, status, company_weight_pct, individual_weight_pct")
      .eq("org_id", orgId)
      .neq("status", "draft")
      .order("year", { ascending: false });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    const rows = (data ?? []) as Period[];
    setPeriods(rows);
    setSelectedPeriodId((prev) => (prev && rows.some((p) => p.id === prev) ? prev : rows[0]?.id ?? null));
  }, [orgId]);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  const fetchGoals = useCallback(async () => {
    if (!selectedPeriodId || !memberId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [cgRes, igRes] = await Promise.all([
      supabase.from("KPI_company_goals").select("*").eq("period_id", selectedPeriodId).order("display_order"),
      supabase
        .from("KPI_individual_goals")
        .select("*")
        .eq("period_id", selectedPeriodId)
        .eq("member_id", memberId)
        .order("display_order"),
    ]);
    if (cgRes.error) setError(cgRes.error.message);
    setCompanyGoals((cgRes.data ?? []) as CompanyGoal[]);
    setGoals((igRes.data ?? []) as IndividualGoal[]);
    setLoading(false);
  }, [selectedPeriodId, memberId]);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const period = periods.find((p) => p.id === selectedPeriodId) ?? null;
  const weightTotal = useMemo(() => sumWeights(goals), [goals]);
  const fullyWeighted = useMemo(() => isFullyWeighted(goals), [goals]);
  const isClosed = period?.status === "closed";

  async function handleAddGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!period || !memberId || !orgId || !newGoal.title.trim()) return;
    setAdding(true);
    setError(null);
    const direction = newGoal.direction || null;
    const target_value = newGoal.target_value === "" ? null : Number(newGoal.target_value);
    const { error: insertError } = await supabase.from("KPI_individual_goals").insert({
      org_id: orgId,
      period_id: period.id,
      member_id: memberId,
      title: newGoal.title.trim(),
      description: newGoal.description || null,
      weight_pct: newGoal.weight_pct,
      display_order: goals.length,
      direction,
      target_value,
      unit: newGoal.unit || null,
    });
    setAdding(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewGoal(emptyGoal());
    await fetchGoals();
  }

  async function handleUpdateGoal(goal: IndividualGoal) {
    // A goal with a target has its self_rating CALCULATED from
    // direction+target+actual rather than typed in — see
    // computeAchievementPct in lib/kpiScoring.ts. Goals without a target
    // (target_value null) keep the manual percentage the employee typed.
    const hasTarget = goal.target_value !== null;
    const self_rating = hasTarget
      ? computeAchievementPct(goal.direction, goal.target_value, goal.actual_value)
      : goal.self_rating;
    const { error: updateError } = await supabase
      .from("KPI_individual_goals")
      .update({
        title: goal.title,
        description: goal.description,
        weight_pct: goal.weight_pct,
        self_rating,
        self_comment: goal.self_comment,
        direction: goal.direction,
        target_value: goal.target_value,
        actual_value: goal.actual_value,
        unit: goal.unit,
      })
      .eq("id", goal.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    // A goal already rated by the manager has its weight_pct/title/description
    // frozen server-side (see kpi_guard_individual_goal_fields) — refetch so
    // the UI reflects what was actually persisted rather than the optimistic
    // edit the employee typed in.
    await fetchGoals();
  }

  async function handleDeleteGoal(id: string) {
    const { error: deleteError } = await supabase.from("KPI_individual_goals").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setGoals(goals.filter((g) => g.id !== id));
  }

  if (!orgId) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  if (periods.length === 0) {
    return <div className="empty-state">Henüz açık bir dönem yok.</div>;
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Hedeflerim</div>
          <select value={selectedPeriodId ?? ""} onChange={(e) => setSelectedPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.year})</option>
            ))}
          </select>
        </div>
        {error && <div className="auth-error">{error}</div>}
      </div>

      {loading ? (
        <div className="empty-state">Yükleniyor…</div>
      ) : (
        period && (
          <>
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">Şirket Hedefleri (%{period.company_weight_pct} ağırlık) — Salt Okunur</div>
              </div>
              {companyGoals.length === 0 ? (
                <div className="empty-state">Bu dönem için şirket hedefi girilmedi.</div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr><th className="wrap">Başlık</th><th className="wrap">Açıklama</th><th>Ağırlık %</th><th>Gerçekleşme %</th><th className="wrap">İK Yorumu</th></tr>
                    </thead>
                    <tbody>
                      {companyGoals.map((g) => (
                        <tr key={g.id}>
                          <td className="wrap">{g.title}</td>
                          <td className="wrap">{g.description || "—"}</td>
                          <td>{g.weight_pct}</td>
                          <td>{g.achievement_pct ?? "—"}</td>
                          <td className="wrap">{g.hr_comment || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  Bireysel Hedeflerim (%{period.individual_weight_pct} ağırlık) — Toplam: %{weightTotal.toFixed(1)}
                  {!fullyWeighted && goals.length > 0 && <span className="pill pill-amber" style={{ marginLeft: 8 }}>100 olmalı</span>}
                </div>
              </div>

              {goals.length === 0 ? (
                <div className="empty-state">Henüz bireysel hedef girmediniz.</div>
              ) : (
                <div className="table-scroll" style={{ marginBottom: isClosed ? 0 : 16 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="wrap">Başlık</th>
                        <th>Ağırlık %</th>
                        <th>Gerçekleşme % (Ben)</th>
                        <th className="wrap">Yorumum</th>
                        <th>Yönetici Puanı</th>
                        <th className="wrap">Yönetici Yorumu</th>
                        {!isClosed && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {goals.map((g) => {
                        // Once HR has rated a goal, its title/weight are frozen
                        // server-side (see kpi_guard_individual_goal_fields) so
                        // an employee can't silently invalidate the review by
                        // reweighting/retitling/deleting it afterward — mirror
                        // that lock in the UI instead of letting an edit look
                        // like it worked and then get reverted on refetch.
                        const reviewed = g.manager_rating !== null;
                        const structuralLocked = isClosed || reviewed;
                        const hasTarget = g.target_value !== null;
                        const computed = hasTarget ? computeAchievementPct(g.direction, g.target_value, g.actual_value) : null;
                        return (
                        <tr key={g.id}>
                          <td className="wrap">
                            {structuralLocked ? g.title : (
                              <input
                                value={g.title}
                                onChange={(e) => setGoals(goals.map((x) => (x.id === g.id ? { ...x, title: e.target.value } : x)))}
                                style={{ width: "100%", minWidth: 140 }}
                              />
                            )}
                            {hasTarget && (
                              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                                Hedef: {g.target_value}{g.unit ? ` ${g.unit}` : ""}
                                {g.direction && ` (${DIRECTION_LABEL[g.direction]})`}
                              </div>
                            )}
                          </td>
                          <td>
                            {structuralLocked ? g.weight_pct : (
                              <input
                                type="number"
                                step="any"
                                value={g.weight_pct}
                                onChange={(e) => setGoals(goals.map((x) => (x.id === g.id ? { ...x, weight_pct: Number(e.target.value) } : x)))}
                                style={{ width: 70 }}
                              />
                            )}
                          </td>
                          <td>
                            {hasTarget ? (
                              <div>
                                {isClosed ? (
                                  <div style={{ fontSize: 12 }}>{g.actual_value ?? "—"}{g.unit ? ` ${g.unit}` : ""}</div>
                                ) : (
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="Gerçekleşen değer"
                                    value={g.actual_value ?? ""}
                                    onChange={(e) => setGoals(goals.map((x) => (x.id === g.id ? { ...x, actual_value: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                                    style={{ width: 90 }}
                                  />
                                )}
                                <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 3 }}>
                                  = %{computed !== null ? computed.toFixed(1) : "—"}
                                </div>
                              </div>
                            ) : isClosed ? (
                              g.self_rating ?? "—"
                            ) : (
                              <input
                                type="number"
                                step="any"
                                min={0}
                                max={100}
                                value={g.self_rating ?? ""}
                                onChange={(e) => setGoals(goals.map((x) => (x.id === g.id ? { ...x, self_rating: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                                style={{ width: 70 }}
                              />
                            )}
                          </td>
                          <td className="wrap">
                            {isClosed ? (g.self_comment || "—") : (
                              <input
                                value={g.self_comment ?? ""}
                                onChange={(e) => setGoals(goals.map((x) => (x.id === g.id ? { ...x, self_comment: e.target.value } : x)))}
                                style={{ width: "100%", minWidth: 140 }}
                              />
                            )}
                          </td>
                          <td>
                            {g.manager_rating ?? "—"}
                            {reviewed && !isClosed && <span className="pill pill-green" style={{ marginLeft: 6 }}>Değerlendirildi</span>}
                          </td>
                          <td className="wrap">{g.manager_comment || "—"}</td>
                          {!isClosed && (
                            <td style={{ whiteSpace: "nowrap" }}>
                              <button className="btn-secondary" onClick={() => handleUpdateGoal(g)}>Kaydet</button>{" "}
                              <button className="btn-danger" onClick={() => handleDeleteGoal(g.id)} disabled={reviewed} title={reviewed ? "Değerlendirilmiş hedef silinemez" : undefined}>
                                Sil
                              </button>
                            </td>
                          )}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!isClosed && (
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
                  <label className="auth-field">
                    <span>Yön (opsiyonel — ölçülebilir hedef için)</span>
                    <select value={newGoal.direction} onChange={(e) => setNewGoal({ ...newGoal, direction: e.target.value as GoalDirection | "" })}>
                      <option value="">— Manuel gerçekleşme % gireceğim</option>
                      <option value="higher_better">Yüksek değer iyi (ör. ciro)</option>
                      <option value="lower_better">Düşük değer iyi (ör. LTIFR, hata oranı)</option>
                    </select>
                  </label>
                  {newGoal.direction && (
                    <>
                      <label className="auth-field">
                        <span>Hedef Değer</span>
                        <input
                          type="number"
                          step="any"
                          value={newGoal.target_value}
                          onChange={(e) => setNewGoal({ ...newGoal, target_value: e.target.value })}
                        />
                      </label>
                      <label className="auth-field">
                        <span>Birim</span>
                        <input
                          value={newGoal.unit}
                          onChange={(e) => setNewGoal({ ...newGoal, unit: e.target.value })}
                          placeholder="%, TL, adet, gün…"
                        />
                      </label>
                    </>
                  )}
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <button className="btn-primary" type="submit" disabled={adding || !newGoal.title.trim()}>
                      {adding ? "Kaydediliyor…" : "+ Hedef Ekle"}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {isClosed && (
              <div className="panel">
                <div className="panel-header"><div className="panel-title">Sonuç</div></div>
                {(() => {
                  const cScore = companyScore(companyGoals);
                  const iScore = individualScore(goals);
                  const f = finalScore(cScore, iScore, period);
                  return (
                    <div className="kpi-grid">
                      <div className="kpi-card">
                        <div className="kpi-label">Şirket Skoru</div>
                        <div className="kpi-value">{cScore.toFixed(1)}</div>
                      </div>
                      <div className="kpi-card">
                        <div className="kpi-label">Bireysel Skor</div>
                        <div className="kpi-value">{iScore.toFixed(1)}</div>
                      </div>
                      <div className="kpi-card">
                        <div className="kpi-label">Toplam Skor</div>
                        <div className="kpi-value">{f.toFixed(1)}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
