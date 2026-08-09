"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useKpi } from "@/lib/kpiContext";
import { supabase } from "@/lib/supabase";
import { companyScore, individualScore, finalScore, isFullyWeighted } from "@/lib/kpiScoring";

type Period = {
  id: string;
  name: string;
  year: number;
  status: "draft" | "active" | "closed";
  company_weight_pct: number;
  individual_weight_pct: number;
};

type CompanyGoal = { weight_pct: number; achievement_pct: number | null };
type IndividualGoal = { weight_pct: number; self_rating: number | null; manager_rating: number | null };

export default function KpiDashboardPage() {
  const { selectedMembership, memberships } = useKpi();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [departmentCount, setDepartmentCount] = useState(0);
  const [memberCount, setMemberCount] = useState(0);

  const [companyGoals, setCompanyGoals] = useState<CompanyGoal[]>([]);
  const [individualGoals, setIndividualGoals] = useState<IndividualGoal[]>([]);

  const orgId = selectedMembership?.org_id ?? null;
  const isHr = selectedMembership?.role === "hr_admin";

  const fetchAll = useCallback(async () => {
    if (!orgId || !selectedMembership) return;
    setLoading(true);
    setError(null);
    try {
      const [periodsRes, deptRes, memberRes] = await Promise.all([
        supabase
          .from("KPI_periods")
          .select("id, name, year, status, company_weight_pct, individual_weight_pct")
          .eq("org_id", orgId)
          .order("year", { ascending: false }),
        supabase.from("KPI_departments").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        supabase.from("KPI_members").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      ]);
      if (periodsRes.error) throw periodsRes.error;
      setPeriods((periodsRes.data ?? []) as Period[]);
      setDepartmentCount(deptRes.count ?? 0);
      setMemberCount(memberRes.count ?? 0);

      const current = ((periodsRes.data ?? []) as Period[]).find((p) => p.status !== "draft") ?? null;
      if (current) {
        const [cgRes, igRes] = await Promise.all([
          supabase.from("KPI_company_goals").select("weight_pct, achievement_pct").eq("period_id", current.id),
          supabase
            .from("KPI_individual_goals")
            .select("weight_pct, self_rating, manager_rating")
            .eq("period_id", current.id)
            .eq("member_id", selectedMembership.id),
        ]);
        setCompanyGoals((cgRes.data ?? []) as CompanyGoal[]);
        setIndividualGoals((igRes.data ?? []) as IndividualGoal[]);
      } else {
        setCompanyGoals([]);
        setIndividualGoals([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Veriler yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [orgId, selectedMembership]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  const currentPeriod = periods.find((p) => p.status !== "draft") ?? null;
  const draftPeriod = periods.find((p) => p.status === "draft") ?? null;

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      {memberships.length > 1 && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Birden fazla organizasyona üyesiniz: <strong>{selectedMembership?.org.name}</strong> için görüntüleniyor.
        </div>
      )}

      {isHr && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Departman</div>
            <div className="kpi-value">{departmentCount}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Kişi</div>
            <div className="kpi-value">{memberCount}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Aktif Dönem</div>
            <div className="kpi-value">{currentPeriod ? `${currentPeriod.name}` : "—"}</div>
            <div className="kpi-sub">{currentPeriod ? currentPeriod.status : "Henüz duyurulmadı"}</div>
          </div>
        </div>
      )}

      {draftPeriod && isHr && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          <strong>{draftPeriod.name}</strong> dönemi taslak durumda. Şirket hedeflerini girip{" "}
          <Link href={`/kpi-tracker/periods/${draftPeriod.id}`}>Dönemler sayfasından</Link> duyurabilirsiniz.
        </div>
      )}

      {!currentPeriod && !draftPeriod && (
        <div className="empty-state">
          {isHr ? (
            <>Henüz dönem açılmadı. <Link href="/kpi-tracker/periods">Dönemler sayfasından</Link> ilk dönemi oluşturun.</>
          ) : (
            "Henüz açık bir dönem yok. İK yöneticiniz dönemi duyurduğunda burada göreceksiniz."
          )}
        </div>
      )}

      {currentPeriod && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">{currentPeriod.name} — Benim Skorum</div>
            <Link className="btn-secondary" href="/kpi-tracker/my-goals">Hedeflerim</Link>
          </div>
          {(() => {
            const cScore = companyScore(companyGoals);
            const iScore = individualScore(individualGoals);
            const f = finalScore(cScore, iScore, currentPeriod);
            const weighted = isFullyWeighted(individualGoals);
            return (
              <div className="kpi-grid">
                <div className="kpi-card">
                  <div className="kpi-label">Şirket Skoru ({currentPeriod.company_weight_pct}%)</div>
                  <div className="kpi-value">{cScore.toFixed(1)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Bireysel Skor ({currentPeriod.individual_weight_pct}%)</div>
                  <div className="kpi-value">{iScore.toFixed(1)}</div>
                  {!weighted && individualGoals.length > 0 && (
                    <div className="kpi-sub" style={{ color: "var(--amber)" }}>Ağırlıklar toplamı %100 değil</div>
                  )}
                  {individualGoals.length === 0 && (
                    <div className="kpi-sub" style={{ color: "var(--amber)" }}>Henüz hedef girilmedi</div>
                  )}
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

      {isHr && currentPeriod && (
        <div className="empty-state">
          Tüm ekibin skorlarını görmek için <Link href="/kpi-tracker/results">Sonuçlar sayfasına</Link> gidin.
        </div>
      )}
    </div>
  );
}
