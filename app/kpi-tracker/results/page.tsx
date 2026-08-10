"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";
import { companyScore, individualScore, finalScore, isFullyWeighted, computeAchievementPct, type GoalDirection } from "@/lib/kpiScoring";

const DIRECTION_LABEL: Record<GoalDirection, string> = {
  higher_better: "yüksek iyi",
  lower_better: "düşük iyi",
};

type Period = { id: string; name: string; year: number; status: string; company_weight_pct: number; individual_weight_pct: number };
type CompanyGoal = {
  id: string;
  title: string;
  weight_pct: number;
  achievement_pct: number | null;
  hr_comment: string | null;
  direction: GoalDirection | null;
  target_value: number | null;
  actual_value: number | null;
  unit: string | null;
};
type Member = { id: string; full_name: string; email: string };
type IndividualGoal = {
  id: string;
  member_id: string;
  title: string;
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

type HistoryEntry = {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
};

const HISTORY_FIELD_LABELS: Record<string, string> = {
  self_rating: "Kişi Puanı",
  self_comment: "Kişi Yorumu",
  manager_rating: "Yönetici Puanı",
  manager_comment: "Yönetici Yorumu",
  weight_pct: "Ağırlık %",
  title: "Başlık",
};

export default function KpiResultsPage() {
  const { selectedMembership, canManage } = useKpi();
  const orgId = selectedMembership?.org_id ?? null;

  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [companyGoals, setCompanyGoals] = useState<CompanyGoal[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [goalsByMember, setGoalsByMember] = useState<Map<string, IndividualGoal[]>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const fetchDetail = useCallback(async () => {
    if (!orgId || !selectedPeriodId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [cgRes, memberRes, igRes] = await Promise.all([
      supabase.from("KPI_company_goals").select("id, title, weight_pct, achievement_pct, hr_comment, direction, target_value, actual_value, unit").eq("period_id", selectedPeriodId).order("display_order"),
      supabase.from("KPI_members").select("id, full_name, email").eq("org_id", orgId).order("full_name"),
      supabase.from("KPI_individual_goals").select("*").eq("period_id", selectedPeriodId),
    ]);
    if (cgRes.error) setError(cgRes.error.message);
    setCompanyGoals((cgRes.data ?? []) as CompanyGoal[]);
    setMembers((memberRes.data ?? []) as Member[]);
    const map = new Map<string, IndividualGoal[]>();
    for (const g of (igRes.data ?? []) as IndividualGoal[]) {
      const list = map.get(g.member_id) ?? [];
      list.push(g);
      map.set(g.member_id, list);
    }
    setGoalsByMember(map);
    setLoading(false);
  }, [orgId, selectedPeriodId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const period = periods.find((p) => p.id === selectedPeriodId) ?? null;
  const cScore = useMemo(() => companyScore(companyGoals), [companyGoals]);

  async function handleUpdateCompanyGoal(goal: CompanyGoal) {
    const hasTarget = goal.target_value !== null;
    const achievement_pct = hasTarget
      ? computeAchievementPct(goal.direction, goal.target_value, goal.actual_value)
      : goal.achievement_pct;
    const { error: updateError } = await supabase
      .from("KPI_company_goals")
      .update({ achievement_pct, hr_comment: goal.hr_comment, actual_value: goal.actual_value })
      .eq("id", goal.id);
    if (updateError) setError(updateError.message);
    else await fetchDetail();
  }

  async function handleUpdateIndividualGoal(goal: IndividualGoal) {
    const { error: updateError } = await supabase
      .from("KPI_individual_goals")
      .update({ manager_rating: goal.manager_rating, manager_comment: goal.manager_comment })
      .eq("id", goal.id);
    if (updateError) setError(updateError.message);
    else await fetchDetail();
  }

  async function handleToggleHistory(goalId: string) {
    if (historyGoalId === goalId) {
      setHistoryGoalId(null);
      return;
    }
    setHistoryGoalId(goalId);
    setHistoryLoading(true);
    const { data, error: historyError } = await supabase
      .from("KPI_individual_goal_history")
      .select("id, field, old_value, new_value, changed_at")
      .eq("goal_id", goalId)
      .order("changed_at", { ascending: false });
    if (historyError) setError(historyError.message);
    setHistoryEntries((data ?? []) as HistoryEntry[]);
    setHistoryLoading(false);
  }

  if (!canManage) {
    return <div className="empty-state">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  }

  if (loading && periods.length === 0) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  if (periods.length === 0) {
    return <div className="empty-state">Henüz duyurulmuş bir dönem yok.</div>;
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Sonuçlar</div>
          <select value={selectedPeriodId ?? ""} onChange={(e) => setSelectedPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.year})</option>
            ))}
          </select>
        </div>
        {error && <div className="auth-error">{error}</div>}
      </div>

      {period && (
        <>
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Şirket Hedefleri — Gerçekleşme (tüm organizasyon için ortak)</div>
            </div>
            {companyGoals.length === 0 ? (
              <div className="empty-state">Bu dönem için şirket hedefi yok.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th className="wrap">Başlık</th><th>Ağırlık %</th><th>Gerçekleşme %</th><th className="wrap">İK Yorumu</th><th></th></tr>
                  </thead>
                  <tbody>
                    {companyGoals.map((g) => {
                      const hasTarget = g.target_value !== null;
                      const computed = hasTarget ? computeAchievementPct(g.direction, g.target_value, g.actual_value) : null;
                      return (
                      <tr key={g.id}>
                        <td className="wrap">
                          {g.title}
                          {hasTarget && (
                            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                              Hedef: {g.target_value}{g.unit ? ` ${g.unit}` : ""}
                              {g.direction && ` (${DIRECTION_LABEL[g.direction]})`}
                            </div>
                          )}
                        </td>
                        <td>{g.weight_pct}</td>
                        <td>
                          {hasTarget ? (
                            <div>
                              <input
                                type="number"
                                step="any"
                                placeholder="Gerçekleşen değer"
                                value={g.actual_value ?? ""}
                                onChange={(e) => setCompanyGoals(companyGoals.map((x) => (x.id === g.id ? { ...x, actual_value: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                                style={{ width: 90 }}
                              />
                              <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 3 }}>
                                = %{computed !== null ? computed.toFixed(1) : "—"}
                              </div>
                            </div>
                          ) : (
                          <input
                            type="number"
                            step="any"
                            min={0}
                            max={100}
                            value={g.achievement_pct ?? ""}
                            onChange={(e) => setCompanyGoals(companyGoals.map((x) => (x.id === g.id ? { ...x, achievement_pct: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                            style={{ width: 80 }}
                          />
                          )}
                        </td>
                        <td className="wrap">
                          <input
                            value={g.hr_comment ?? ""}
                            onChange={(e) => setCompanyGoals(companyGoals.map((x) => (x.id === g.id ? { ...x, hr_comment: e.target.value } : x)))}
                            style={{ width: "100%", minWidth: 160 }}
                          />
                        </td>
                        <td><button className="btn-secondary" onClick={() => handleUpdateCompanyGoal(g)}>Kaydet</button></td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="kpi-sub" style={{ marginTop: 10 }}>Şirket Skoru: {cScore.toFixed(1)}</div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Kişi Bazında Sonuçlar</div>
            </div>
            {members.length === 0 ? (
              <div className="empty-state">Henüz kişi yok.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="wrap">Ad Soyad</th>
                      <th>Bireysel Hedef Sayısı</th>
                      <th>Ağırlık Toplamı</th>
                      <th>Bireysel Skor</th>
                      <th>Toplam Skor</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const memberGoals = goalsByMember.get(m.id) ?? [];
                      const iScore = individualScore(memberGoals);
                      const f = finalScore(cScore, iScore, period);
                      const weighted = isFullyWeighted(memberGoals);
                      return (
                        <Fragment key={m.id}>
                          <tr onClick={() => setExpandedId(expandedId === m.id ? null : m.id)} style={{ cursor: "pointer" }}>
                            <td className="wrap">{m.full_name}</td>
                            <td>{memberGoals.length}</td>
                            <td>
                              {memberGoals.length === 0 ? "—" : (
                                <span className={weighted ? "pill pill-green" : "pill pill-amber"}>
                                  {memberGoals.reduce((s, g) => s + g.weight_pct, 0).toFixed(0)}%
                                </span>
                              )}
                            </td>
                            <td>{iScore.toFixed(1)}</td>
                            <td><strong>{f.toFixed(1)}</strong></td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <button className="btn-secondary" onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}>
                                {expandedId === m.id ? "Kapat" : "Detay"}
                              </button>
                            </td>
                          </tr>
                          {expandedId === m.id && (
                            <tr>
                              <td colSpan={6} style={{ background: "var(--bg2)", cursor: "default" }}>
                                {memberGoals.length === 0 ? (
                                  <div className="empty-state">Bu kişi henüz bireysel hedef girmedi.</div>
                                ) : (
                                  <div className="table-scroll" style={{ padding: "10px 0" }}>
                                    <table className="data-table">
                                      <thead>
                                        <tr>
                                          <th className="wrap">Hedef</th>
                                          <th>Ağırlık %</th>
                                          <th>Kişi Puanı</th>
                                          <th className="wrap">Kişi Yorumu</th>
                                          <th>Yönetici Puanı</th>
                                          <th className="wrap">Yönetici Yorumu</th>
                                          <th></th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {memberGoals.map((g) => (
                                          <Fragment key={g.id}>
                                          <tr>
                                            <td className="wrap">
                                              {g.title}
                                              {g.target_value !== null && (
                                                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                                                  Hedef: {g.target_value}{g.unit ? ` ${g.unit}` : ""}
                                                  {g.direction && ` (${DIRECTION_LABEL[g.direction]})`} · Gerçekleşen: {g.actual_value ?? "—"}
                                                </div>
                                              )}
                                            </td>
                                            <td>{g.weight_pct}</td>
                                            <td>{g.self_rating ?? <span className="cell-pending">Bekleniyor</span>}</td>
                                            <td className="wrap">{g.self_comment || <span className="cell-pending">Bekleniyor</span>}</td>
                                            <td>
                                              <input
                                                type="number"
                                                step="any"
                                                min={0}
                                                max={100}
                                                value={g.manager_rating ?? ""}
                                                onChange={(e) => {
                                                  const val = e.target.value === "" ? null : Number(e.target.value);
                                                  const updated = memberGoals.map((x) => (x.id === g.id ? { ...x, manager_rating: val } : x));
                                                  setGoalsByMember(new Map(goalsByMember).set(m.id, updated));
                                                }}
                                                style={{ width: 80 }}
                                              />
                                            </td>
                                            <td className="wrap">
                                              <input
                                                value={g.manager_comment ?? ""}
                                                onChange={(e) => {
                                                  const updated = memberGoals.map((x) => (x.id === g.id ? { ...x, manager_comment: e.target.value } : x));
                                                  setGoalsByMember(new Map(goalsByMember).set(m.id, updated));
                                                }}
                                                style={{ width: "100%", minWidth: 160 }}
                                              />
                                            </td>
                                            <td style={{ whiteSpace: "nowrap" }}>
                                              <button className="btn-secondary" onClick={() => handleUpdateIndividualGoal(g)}>Kaydet</button>{" "}
                                              <button className="btn-secondary" onClick={() => handleToggleHistory(g.id)}>
                                                {historyGoalId === g.id ? "Kapat" : "Geçmiş"}
                                              </button>
                                            </td>
                                          </tr>
                                          {historyGoalId === g.id && (
                                            <tr>
                                              <td colSpan={7} style={{ background: "var(--bg2)" }}>
                                                {historyLoading ? (
                                                  <div className="empty-state">Yükleniyor…</div>
                                                ) : historyEntries.length === 0 ? (
                                                  <div className="empty-state">Bu hedefte henüz bir değişiklik kaydı yok.</div>
                                                ) : (
                                                  <div style={{ padding: "8px 4px" }}>
                                                    {historyEntries.map((h) => (
                                                      <div key={h.id} style={{ fontSize: 12, padding: "4px 0", borderBottom: "0.5px solid var(--border)" }}>
                                                        <strong>{HISTORY_FIELD_LABELS[h.field] ?? h.field}</strong>{": "}
                                                        <span style={{ color: "var(--text2)" }}>{h.old_value ?? "—"}</span>
                                                        {" → "}
                                                        <span>{h.new_value ?? "—"}</span>
                                                        <span style={{ color: "var(--text3)", marginLeft: 8 }}>
                                                          {new Date(h.changed_at).toLocaleString("tr-TR")}
                                                        </span>
                                                      </div>
                                                    ))}
                                                  </div>
                                                )}
                                              </td>
                                            </tr>
                                          )}
                                          </Fragment>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
