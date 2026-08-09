"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";
import { companyScore, individualScore, finalScore, isFullyWeighted } from "@/lib/kpiScoring";

type Period = { id: string; name: string; year: number; status: string; company_weight_pct: number; individual_weight_pct: number };
type CompanyGoal = { id: string; title: string; weight_pct: number; achievement_pct: number | null; hr_comment: string | null };
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
      supabase.from("KPI_company_goals").select("id, title, weight_pct, achievement_pct, hr_comment").eq("period_id", selectedPeriodId).order("display_order"),
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
    const { error: updateError } = await supabase
      .from("KPI_company_goals")
      .update({ achievement_pct: goal.achievement_pct, hr_comment: goal.hr_comment })
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
                    {companyGoals.map((g) => (
                      <tr key={g.id}>
                        <td className="wrap">{g.title}</td>
                        <td>{g.weight_pct}</td>
                        <td>
                          <input
                            type="number"
                            step="any"
                            min={0}
                            max={100}
                            value={g.achievement_pct ?? ""}
                            onChange={(e) => setCompanyGoals(companyGoals.map((x) => (x.id === g.id ? { ...x, achievement_pct: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                            style={{ width: 80 }}
                          />
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
                    ))}
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
                                          <tr key={g.id}>
                                            <td className="wrap">{g.title}</td>
                                            <td>{g.weight_pct}</td>
                                            <td>{g.self_rating ?? "—"}</td>
                                            <td className="wrap">{g.self_comment || "—"}</td>
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
                                            <td>
                                              <button className="btn-secondary" onClick={() => handleUpdateIndividualGoal(g)}>Kaydet</button>
                                            </td>
                                          </tr>
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
