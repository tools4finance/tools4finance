"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useCs } from "@/lib/csContext";
import { supabase } from "@/lib/supabase";
import { loadScoringConfig, hasAnyParameters, loadDefaultParameters } from "@/lib/csData";
import { computeScore, type CustomerRow, type ScoringConfig } from "@/lib/customerScoring";
import { DonutChart } from "@/components/DonutChart";

type CustomerListRow = CustomerRow & { id: string };

const GRADE_COLORS: Record<string, string> = {
  "A+": "var(--green)",
  A: "var(--blue)",
  B: "var(--amber)",
  C: "var(--coral)",
};

function formatScore(n: number) {
  return n.toFixed(1);
}
function formatPct(n: number) {
  return `${n.toFixed(1)}%`;
}

export default function CsDashboardPage() {
  const { user } = useCs();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasParams, setHasParams] = useState(true);
  const [customers, setCustomers] = useState<CustomerListRow[]>([]);
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [loadingDefaults, setLoadingDefaults] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const paramsExist = await hasAnyParameters(user.id);
      setHasParams(paramsExist);
      if (!paramsExist) {
        setCustomers([]);
        setConfig(null);
        setLoading(false);
        return;
      }
      const [cfg, custRes] = await Promise.all([
        loadScoringConfig(user.id),
        supabase
          .from("CS_customers")
          .select("id, risk_class, overdue_rate, overdue_days, years_active, payment_habit, strategic_customer")
          .eq("user_id", user.id),
      ]);
      if (custRes.error) throw custRes.error;
      setConfig(cfg);
      setCustomers((custRes.data ?? []) as CustomerListRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Veriler yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleLoadDefaults() {
    if (!user) return;
    setLoadingDefaults(true);
    setError(null);
    try {
      await loadDefaultParameters(user.id);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Varsayılan parametreler yüklenirken hata oluştu.");
    } finally {
      setLoadingDefaults(false);
    }
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  if (!hasParams) {
    return (
      <div className="aidat-empty">
        <h2>Önce skorlama parametrelerini tanımlayın</h2>
        <p>
          Customer Segmentation modülü, müşterileri Risk Class, Overdue Rate, Overdue Days, Çalışma Yılı,
          Payment Habit ve Stratejik Müşteri kriterlerine göre puanlar. Başlamak için hazır bir şablon
          yükleyebilir, sonra Parametreler sayfasından tamamen düzenleyebilirsiniz.
        </p>
        {error && <div className="auth-error">{error}</div>}
        <button className="btn-primary" onClick={handleLoadDefaults} disabled={loadingDefaults}>
          {loadingDefaults ? "Yükleniyor…" : "Varsayılan Parametreleri Yükle"}
        </button>
      </div>
    );
  }

  const results = config ? customers.map((c) => computeScore(c, config)) : [];
  const totalCustomers = customers.length;
  const avgScore = totalCustomers > 0 ? results.reduce((s, r) => s + r.totalScore, 0) / totalCustomers : 0;

  const gradeCounts = new Map<string, number>();
  for (const r of results) {
    const g = r.grade ?? "—";
    gradeCounts.set(g, (gradeCounts.get(g) ?? 0) + 1);
  }
  const gradeOrder = ["A+", "A", "B", "C"];
  const gradeSlices = gradeOrder
    .filter((g) => gradeCounts.has(g))
    .map((g) => ({
      key: g,
      label: `Not ${g}`,
      amount: gradeCounts.get(g) ?? 0,
      pct: totalCustomers > 0 ? ((gradeCounts.get(g) ?? 0) / totalCustomers) * 100 : 0,
      color: GRADE_COLORS[g] ?? "var(--text3)",
    }));

  const redCount = results.filter((r) => r.actionSignal === "Red").length;
  const yellowCount = results.filter((r) => r.actionSignal === "Yellow").length;
  const greenCount = results.filter((r) => r.actionSignal === "Green" || r.actionSignal === "Light Green").length;

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      {totalCustomers === 0 ? (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Henüz müşteri eklenmedi.{" "}
          <Link href="/customer-segmentation/customers">Müşteriler sayfasından</Link> tek tek ekleyebilir ya da
          Excel ile toplu yükleyebilirsiniz.
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">Toplam Müşteri</div>
              <div className="kpi-value">{totalCustomers}</div>
              <div className="kpi-sub">CS_customers</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Ortalama Skor</div>
              <div className="kpi-value">{formatScore(avgScore)}</div>
              <div className="kpi-sub">0-100 arası, tüm müşteriler</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Green / Normal</div>
              <div className="kpi-value positive">{greenCount}</div>
              <div className="kpi-sub">Not A+ / A — normal ticaret</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Yellow — Yakın Takip</div>
              <div className="kpi-value">{yellowCount}</div>
              <div className="kpi-sub">Not B</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Red — Risk Aksiyonu</div>
              <div className="kpi-value negative">{redCount}</div>
              <div className="kpi-sub">Not C</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Skor Notu Dağılımı</div>
            </div>
            <DonutChart
              slices={gradeSlices}
              centerLabel="Toplam Müşteri"
              centerValue={String(totalCustomers)}
              formatAmount={(n) => `${n} müşteri`}
              formatPct={formatPct}
            />
          </div>
        </>
      )}
    </div>
  );
}
