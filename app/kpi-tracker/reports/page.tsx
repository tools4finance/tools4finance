"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";
import { companyScore, individualScore, finalScore, sumWeights } from "@/lib/kpiScoring";
import { exportRowsToExcel, type ExportColumn } from "@/lib/exportTable";

type Period = {
  id: string;
  name: string;
  year: number;
  status: "draft" | "active" | "closed";
  company_weight_pct: number;
  individual_weight_pct: number;
};
type Department = { id: string; name: string };
type Member = { id: string; full_name: string; department_id: string | null; role: "hr_admin" | "employee" };
type CompanyGoal = { id: string; title: string; weight_pct: number; achievement_pct: number | null };
type IndividualGoal = {
  member_id: string;
  title: string;
  weight_pct: number;
  self_rating: number | null;
  manager_rating: number | null;
};

type MemberRow = {
  member: Member;
  departmentName: string;
  companyScoreVal: number;
  individualGoals: IndividualGoal[];
  individualScoreVal: number;
  individualWeightTotal: number;
  finalScoreVal: number;
  reviewedCount: number;
  goalDetail: string;
};

function formatScore(n: number) {
  return n.toFixed(1);
}

// Broad, one-row-per-person export report for İK — pulls together
// department, the shared company-goal results, and a per-person rollup of
// individual goals (which vary in title/count per person, so unlike company
// goals they can't be flattened into fixed columns — summarized instead as
// a count/weight/score plus a detail string listing each goal and its
// realized rating).
export default function KpiReportsPage() {
  const { selectedMembership, canManage } = useKpi();
  const orgId = selectedMembership?.org_id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [companyGoals, setCompanyGoals] = useState<CompanyGoal[]>([]);
  const [individualGoals, setIndividualGoals] = useState<IndividualGoal[]>([]);

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

  const fetchAll = useCallback(async () => {
    if (!orgId || !selectedPeriodId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [deptRes, memberRes, cgRes, igRes] = await Promise.all([
      supabase.from("KPI_departments").select("id, name").eq("org_id", orgId),
      supabase.from("KPI_members").select("id, full_name, department_id, role").eq("org_id", orgId).order("full_name"),
      supabase.from("KPI_company_goals").select("id, title, weight_pct, achievement_pct").eq("period_id", selectedPeriodId).order("display_order"),
      supabase.from("KPI_individual_goals").select("member_id, title, weight_pct, self_rating, manager_rating").eq("period_id", selectedPeriodId),
    ]);
    if (deptRes.error) setError(deptRes.error.message);
    if (memberRes.error) setError(memberRes.error.message);
    if (cgRes.error) setError(cgRes.error.message);
    if (igRes.error) setError(igRes.error.message);
    setDepartments((deptRes.data ?? []) as Department[]);
    setMembers((memberRes.data ?? []) as Member[]);
    setCompanyGoals((cgRes.data ?? []) as CompanyGoal[]);
    setIndividualGoals((igRes.data ?? []) as IndividualGoal[]);
    setLoading(false);
  }, [orgId, selectedPeriodId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const period = periods.find((p) => p.id === selectedPeriodId) ?? null;
  const departmentsById = new Map(departments.map((d) => [d.id, d.name]));
  const companyScoreVal = useMemo(() => companyScore(companyGoals), [companyGoals]);

  const rows: MemberRow[] = useMemo(() => {
    return members.map((member) => {
      const goals = individualGoals.filter((g) => g.member_id === member.id);
      const individualScoreVal = individualScore(goals);
      const reviewedCount = goals.filter((g) => g.manager_rating !== null).length;
      const goalDetail = goals
        .map((g) => `${g.title} (%${(g.manager_rating ?? g.self_rating)?.toFixed(0) ?? "—"})`)
        .join("; ");
      return {
        member,
        departmentName: member.department_id ? departmentsById.get(member.department_id) ?? "—" : "—",
        companyScoreVal,
        individualGoals: goals,
        individualScoreVal,
        individualWeightTotal: sumWeights(goals),
        finalScoreVal: period ? finalScore(companyScoreVal, individualScoreVal, period) : 0,
        reviewedCount,
        goalDetail: goalDetail || "—",
      };
    });
  }, [members, individualGoals, departmentsById, companyScoreVal, period]);

  function buildExportColumns(): ExportColumn[] {
    const cols: ExportColumn[] = [
      { header: "Ad Soyad", value: (r) => (r as unknown as MemberRow).member.full_name },
      { header: "Departman", value: (r) => (r as unknown as MemberRow).departmentName },
      { header: "Rol", value: (r) => ((r as unknown as MemberRow).member.role === "hr_admin" ? "İK Yöneticisi" : "Çalışan") },
    ];
    for (const g of companyGoals) {
      cols.push({ header: `${g.title} (Şirket) %`, value: () => g.achievement_pct ?? "" });
    }
    cols.push(
      { header: "Şirket Skoru", value: (r) => Number(formatScore((r as unknown as MemberRow).companyScoreVal)) },
      { header: "Bireysel Hedef Sayısı", value: (r) => (r as unknown as MemberRow).individualGoals.length },
      { header: "Bireysel Ağırlık Toplamı %", value: (r) => (r as unknown as MemberRow).individualWeightTotal },
      { header: "Bireysel Skoru", value: (r) => Number(formatScore((r as unknown as MemberRow).individualScoreVal)) },
      { header: "Final Skor", value: (r) => Number(formatScore((r as unknown as MemberRow).finalScoreVal)) },
      {
        header: "Değerlendirme Durumu",
        value: (r) => {
          const row = r as unknown as MemberRow;
          return row.individualGoals.length === 0 ? "—" : `${row.reviewedCount}/${row.individualGoals.length}`;
        },
      },
      { header: "Bireysel Hedefler Detayı", value: (r) => (r as unknown as MemberRow).goalDetail }
    );
    return cols;
  }

  function handleExportExcel() {
    exportRowsToExcel(rows as unknown as Record<string, unknown>[], buildExportColumns(), {
      title: "Performans Raporu",
      subtitle: period ? `${period.name} (${period.year})` : undefined,
    });
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }
  if (!canManage) {
    return <div className="empty-state">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Personel Bazlı Performans Raporu</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select value={selectedPeriodId ?? ""} onChange={(e) => setSelectedPeriodId(e.target.value)}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.year})</option>
              ))}
            </select>
            <button className="btn-secondary" onClick={handleExportExcel} disabled={rows.length === 0}>
              Excel İndir
            </button>
          </div>
        </div>

        {periods.length === 0 ? (
          <div className="empty-state">Bu organizasyonda henüz duyurulmuş bir dönem yok.</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Bu organizasyonda henüz kişi yok.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="wrap">Ad Soyad</th>
                  <th>Departman</th>
                  {companyGoals.map((g) => (
                    <th key={g.id} className="wrap">{g.title} %</th>
                  ))}
                  <th>Şirket Skoru</th>
                  <th>Bireysel Ağırlık</th>
                  <th>Bireysel Skoru</th>
                  <th>Final Skor</th>
                  <th>Değerlendirme</th>
                  <th className="wrap">Bireysel Hedefler</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.member.id}>
                    <td className="wrap">
                      {r.member.full_name}
                      {r.member.role === "hr_admin" && <span className="pill pill-blue" style={{ marginLeft: 6 }}>İK</span>}
                    </td>
                    <td>{r.departmentName}</td>
                    {companyGoals.map((g) => (
                      <td key={g.id}>{g.achievement_pct ?? "—"}</td>
                    ))}
                    <td>{formatScore(r.companyScoreVal)}</td>
                    <td>
                      {r.individualGoals.length === 0 ? (
                        "—"
                      ) : (
                        <span className={`pill ${Math.abs(r.individualWeightTotal - 100) < 0.01 ? "pill-green" : "pill-amber"}`}>
                          %{r.individualWeightTotal.toFixed(0)}
                        </span>
                      )}
                    </td>
                    <td>{formatScore(r.individualScoreVal)}</td>
                    <td><strong>{formatScore(r.finalScoreVal)}</strong></td>
                    <td>
                      {r.individualGoals.length === 0 ? "—" : `${r.reviewedCount}/${r.individualGoals.length}`}
                    </td>
                    <td className="wrap" style={{ fontSize: 12, color: "var(--text2)" }}>{r.goalDetail}</td>
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
