"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";
import { seedDemoData, type SeedSummary } from "@/lib/seedDemoData";
import { DonutChart } from "@/components/DonutChart";

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

type ExpenseCategoryJoin = { main_segment: string | null; opex_capex: string | null };
type ExpenseWithCategory = { amount: number; expense_category: ExpenseCategoryJoin | ExpenseCategoryJoin[] | null };
type BudgetLineCategoryJoin = { opex_capex: string | null };
type BudgetLineWithCategory = { budget_amount: number; expense_category: BudgetLineCategoryJoin | BudgetLineCategoryJoin[] | null };
type AccrualJoin = { fiscal_period_id: string | null; site_id: string; status: string };
type PaymentJoin = { status: string };
type AllocationWithJoins = {
  amount: number;
  accruals: AccrualJoin | AccrualJoin[] | null;
  payments: PaymentJoin | PaymentJoin[] | null;
};

// expense_category comes back from the PostgREST embed as either a single
// object or a one-element array depending on the inferred relationship
// cardinality — normalise it here rather than at every call site.
function firstJoin<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

type ExpenseSegment = { segment: string; amount: number };

type DashboardData = {
  periodExists: boolean;
  accrued: number;
  collected: number;
  opexTotal: number;
  capexTotal: number;
  otherIncomeTotal: number;
  outstandingTotal: number;
  debtorCount: number;
  budgetOpexTotal: number;
  expenseSegments: ExpenseSegment[];
};

const EMPTY_DATA: DashboardData = {
  periodExists: false,
  accrued: 0,
  collected: 0,
  opexTotal: 0,
  capexTotal: 0,
  otherIncomeTotal: 0,
  outstandingTotal: 0,
  debtorCount: 0,
  budgetOpexTotal: 0,
  expenseSegments: [],
};

// Cycles through the app's chart color tokens; anything past this many
// distinct segments is folded into a muted "Diğer" slice.
const PIE_COLORS = ["var(--blue)", "var(--purple)", "var(--coral)", "var(--amber)", "var(--green)"];
const PIE_OTHER_COLOR = "var(--text3)";

export default function AidatDashboardPage() {
  const { selectedSiteId, year, month, canWrite } = useAidat();

  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unitsCount, setUnitsCount] = useState<number | null>(null);

  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<SeedSummary | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);

    try {
      // Outstanding receivables + debtor count are not period-scoped — always
      // read across the whole site regardless of whether a fiscal_periods row
      // exists for the selected month.
      const balancesRes = await supabase
        .from("v_unit_balances")
        .select("unit_id, balance")
        .eq("site_id", selectedSiteId);
      if (balancesRes.error) throw balancesRes.error;

      const balances = (balancesRes.data ?? []) as { unit_id: string; balance: number }[];
      const outstandingTotal = balances.filter((b) => b.balance > 0).reduce((s, b) => s + b.balance, 0);
      const debtorCount = balances.filter((b) => b.balance > 0.01).length;

      // Used only to decide whether to surface the demo-data seeder
      // prominently (brand-new, empty site) or tucked into a small panel.
      const unitsCountRes = await supabase
        .from("units")
        .select("id", { count: "exact", head: true })
        .eq("site_id", selectedSiteId);
      if (!unitsCountRes.error) setUnitsCount(unitsCountRes.count ?? 0);

      // Resolve (but do not create) the fiscal_periods row for the selected
      // month. This page is read-only, so we deliberately avoid calling the
      // get_or_create_fiscal_period RPC here (that RPC inserts a row, which
      // would fail RLS for viewer-role users and would create empty period
      // rows just from browsing the dashboard). If no period exists yet, all
      // period-scoped figures below are simply zero.
      const periodRes = await supabase
        .from("fiscal_periods")
        .select("id")
        .eq("site_id", selectedSiteId)
        .eq("year", year)
        .eq("month", month)
        .maybeSingle();
      if (periodRes.error) throw periodRes.error;

      const periodId = periodRes.data?.id as string | undefined;

      if (!periodId) {
        setData({ ...EMPTY_DATA, outstandingTotal, debtorCount });
        setLoading(false);
        return;
      }

      const [accrualsRes, opexRes, capexRes, incomesRes, budgetRes, allocRes] = await Promise.all([
        supabase
          .from("accruals")
          .select("amount")
          .eq("site_id", selectedSiteId)
          .eq("fiscal_period_id", periodId)
          .eq("status", "active"),
        supabase
          .from("expenses")
          .select("amount, expense_category:expense_categories!inner(main_segment, opex_capex)")
          .eq("site_id", selectedSiteId)
          .eq("fiscal_period_id", periodId)
          .eq("status", "active")
          .eq("expense_category.opex_capex", "OPEX"),
        supabase
          .from("expenses")
          .select("amount, expense_category:expense_categories!inner(opex_capex)")
          .eq("site_id", selectedSiteId)
          .eq("fiscal_period_id", periodId)
          .eq("status", "active")
          .eq("expense_category.opex_capex", "CAPEX"),
        supabase
          .from("incomes")
          .select("amount")
          .eq("site_id", selectedSiteId)
          .eq("fiscal_period_id", periodId)
          .eq("status", "active"),
        supabase
          .from("budget_lines")
          .select("budget_amount, expense_category:expense_categories!inner(opex_capex)")
          .eq("site_id", selectedSiteId)
          .eq("fiscal_period_id", periodId)
          .eq("category_type", "expense")
          .eq("expense_category.opex_capex", "OPEX"),
        // Preferred collection-rate definition: sum of payment_allocations tied
        // to this period's accruals, restricted to active accruals AND active
        // (non-voided) payments — voiding a payment does not retroactively
        // delete its payment_allocations rows (see migration notes), so the
        // payments.status filter is required to avoid counting reversed cash.
        supabase
          .from("payment_allocations")
          .select("amount, accruals!inner(fiscal_period_id, site_id, status), payments!inner(status)")
          .eq("accruals.fiscal_period_id", periodId)
          .eq("accruals.site_id", selectedSiteId)
          .eq("accruals.status", "active")
          .eq("payments.status", "active"),
      ]);

      if (accrualsRes.error) throw accrualsRes.error;
      if (opexRes.error) throw opexRes.error;
      if (capexRes.error) throw capexRes.error;
      if (incomesRes.error) throw incomesRes.error;
      if (budgetRes.error) throw budgetRes.error;
      if (allocRes.error) throw allocRes.error;

      const accrued = ((accrualsRes.data ?? []) as { amount: number }[]).reduce((s, r) => s + r.amount, 0);
      const opexRows = (opexRes.data ?? []) as ExpenseWithCategory[];
      const opexTotal = opexRows.reduce((s, r) => s + r.amount, 0);
      const capexTotal = ((capexRes.data ?? []) as ExpenseWithCategory[]).reduce((s, r) => s + r.amount, 0);

      // Group OPEX expenses by main_segment for the "Gider Dağılımı" pie
      // chart, largest first; anything past the top 5 (one per color token)
      // is folded into a single "Diğer" slice so the legend stays readable.
      const segmentTotals = new Map<string, number>();
      for (const row of opexRows) {
        const cat = firstJoin(row.expense_category);
        const segment = cat?.main_segment ?? "Diğer";
        segmentTotals.set(segment, (segmentTotals.get(segment) ?? 0) + row.amount);
      }
      const sortedSegments = Array.from(segmentTotals.entries())
        .map(([segment, amount]) => ({ segment, amount }))
        .sort((a, b) => b.amount - a.amount);
      const topSegments = sortedSegments.slice(0, PIE_COLORS.length);
      const otherTotal = sortedSegments.slice(PIE_COLORS.length).reduce((s, r) => s + r.amount, 0);
      const expenseSegments: ExpenseSegment[] =
        otherTotal > 0 ? [...topSegments, { segment: "Diğer", amount: otherTotal }] : topSegments;
      const otherIncomeTotal = ((incomesRes.data ?? []) as { amount: number }[]).reduce((s, r) => s + r.amount, 0);
      const budgetOpexTotal = ((budgetRes.data ?? []) as BudgetLineWithCategory[]).reduce(
        (s, r) => s + r.budget_amount,
        0
      );
      const collected = ((allocRes.data ?? []) as AllocationWithJoins[]).reduce((s, r) => s + r.amount, 0);

      setData({
        periodExists: true,
        accrued,
        collected,
        opexTotal,
        capexTotal,
        otherIncomeTotal,
        outstandingTotal,
        debtorCount,
        budgetOpexTotal,
        expenseSegments,
      });
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Veriler yüklenirken hata oluştu.");
      setLoading(false);
    }
  }, [selectedSiteId, year, month]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleSeedDemoData() {
    if (!selectedSiteId || !canWrite || seeding) return;
    const confirmed = window.confirm(
      "Bu işlem seçili siteye örnek bloklar, daireler, sakinler, tahakkuk, tahsilat, gider, gelir ve bütçe kayıtları ekleyecek (gerçek veritabanı yazımı). Devam edilsin mi?"
    );
    if (!confirmed) return;

    setSeeding(true);
    setSeedError(null);
    setSeedResult(null);
    try {
      const result = await seedDemoData(selectedSiteId, year, month);
      setSeedResult(result);
      await fetchAll();
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : "Örnek veri oluşturulurken hata oluştu.");
    } finally {
      setSeeding(false);
    }
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  const {
    accrued,
    collected,
    opexTotal,
    capexTotal,
    otherIncomeTotal,
    outstandingTotal,
    debtorCount,
    budgetOpexTotal,
    expenseSegments,
  } = data;

  const collectionRate = accrued > 0 ? (collected / accrued) * 100 : null;
  const operatingResult = accrued + otherIncomeTotal - opexTotal;
  const budgetVariance = budgetOpexTotal - opexTotal;

  const allZero =
    !data.periodExists &&
    accrued === 0 &&
    collected === 0 &&
    opexTotal === 0 &&
    capexTotal === 0 &&
    otherIncomeTotal === 0 &&
    outstandingTotal === 0 &&
    debtorCount === 0 &&
    budgetOpexTotal === 0;

  const expenseTotal = expenseSegments.reduce((s, r) => s + r.amount, 0);
  // expenseSegments holds at most PIE_COLORS.length "real" segments plus one
  // trailing "Diğer" aggregate (see grouping logic in fetchAll) — the last
  // slice only ever gets the muted color when it's actually that aggregate.
  const isOtherSlice = (i: number) => i === expenseSegments.length - 1 && i >= PIE_COLORS.length;
  const pieSlices = expenseSegments.map((seg, i) => ({
    ...seg,
    color: isOtherSlice(i) ? PIE_OTHER_COLOR : PIE_COLORS[i % PIE_COLORS.length],
    pct: expenseTotal > 0 ? (seg.amount / expenseTotal) * 100 : 0,
  }));
  const isNewSite = unitsCount === 0;

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      {canWrite && (
        <div className="panel" style={isNewSite ? { borderColor: "var(--accent)" } : undefined}>
          <div className="panel-header">
            <div className="panel-title">
              {isNewSite ? "Bu site henüz boş — örnek verilerle doldurun" : "Geliştirici / Demo"}
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
            Tek tek daire, sakin, tahakkuk ve tahsilat girmek yerine; 3 blok, 24 daire, ~20-24 sakin ve son 6 aya
            yayılan tahakkuk / tahsilat / gider / gelir / bütçe kayıtlarını rastgele ama gerçekçi verilerle tek
            tıkla oluşturun. Bu, seçili siteye gerçek veritabanı kayıtları ekler.
          </p>
          <button className="btn-primary" onClick={handleSeedDemoData} disabled={seeding}>
            {seeding ? "Oluşturuluyor…" : "Örnek Veri ile Doldur"}
          </button>

          {seedError && (
            <div className="auth-error" style={{ marginTop: 12 }}>
              {seedError}
            </div>
          )}

          {seedResult && (
            <div className="auth-info" style={{ marginTop: 12, lineHeight: 1.7 }}>
              {seedResult.blocksCreated} blok, {seedResult.unitsCreated} daire, {seedResult.residentsCreated} sakin,{" "}
              {seedResult.accrualsCreated} tahakkuk, {seedResult.paymentsCreated} tahsilat,{" "}
              {seedResult.expensesCreated} gider, {seedResult.incomesCreated} gelir, {seedResult.budgetLinesCreated}{" "}
              bütçe satırı oluşturuldu.
              {seedResult.warnings.length > 0 && (
                <div style={{ marginTop: 6, color: "var(--amber)" }}>
                  Uyarılar: {seedResult.warnings.join(" ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {allZero && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Bu dönem ({month}/{year}) için henüz veri girilmedi. Tahakkuk, tahsilat, gider veya gelir kaydı
          oluşturuldukça bu panel otomatik olarak dolacak.
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Tahakkuk Eden Aidat</div>
          <div className="kpi-value">{currency.format(accrued)}</div>
          <div className="kpi-sub">{month}/{year} — tüm tahakkuk türleri (aylık, ek, özel, ceza, diğer)</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Toplanan Aidat</div>
          <div className="kpi-value">{currency.format(collected)}</div>
          <div className="kpi-sub">Bu dönem tahakkuklarına yapılan tahsilat dağıtımları (payment_allocations)</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Tahsilat Oranı</div>
          <div className="kpi-value">{collectionRate === null ? "—" : formatPercent(collectionRate)}</div>
          <div className="kpi-sub">
            {collectionRate === null ? "Bu dönem için tahakkuk yok" : "Toplanan Aidat / Tahakkuk Eden Aidat"}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Toplam Gider (OPEX)</div>
          <div className="kpi-value">{currency.format(opexTotal)}</div>
          <div className="kpi-sub">İşletme giderleri — CAPEX hariç</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">CAPEX (Yatırım Giderleri)</div>
          <div className="kpi-value">{currency.format(capexTotal)}</div>
          <div className="kpi-sub">İşletme giderinden ayrı takip edilir</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Faaliyet Fazlası / Açığı</div>
          <div className={`kpi-value ${operatingResult >= 0 ? "positive" : "negative"}`}>
            {currency.format(operatingResult)}
          </div>
          <div className="kpi-sub">(Tahakkuk Eden Aidat + Diğer Gelirler) − OPEX</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Toplam Cari Borç</div>
          <div className="kpi-value">{currency.format(outstandingTotal)}</div>
          <div className="kpi-sub">Sitedeki tüm dairelerin toplam açık bakiyesi</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Borçlu Daire Sayısı</div>
          <div className="kpi-value">{debtorCount}</div>
          <div className="kpi-sub">Bakiyesi 0,01₺ üzeri olan daireler</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Bütçe vs Gerçekleşen (OPEX) — {month}/{year}</div>
        </div>
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Bütçe</div>
            <div className="kpi-value">{currency.format(budgetOpexTotal)}</div>
            <div className="kpi-sub">budget_lines — category_type=expense, OPEX</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Gerçekleşen</div>
            <div className="kpi-value">{currency.format(opexTotal)}</div>
            <div className="kpi-sub">expenses — OPEX, aktif kayıtlar</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Fark</div>
            <div className={`kpi-value ${budgetVariance >= 0 ? "positive" : "negative"}`}>
              {currency.format(budgetVariance)}
            </div>
            <div className="kpi-sub">Bütçe − Gerçekleşen (pozitif = bütçe altında kalındı)</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Gider Dağılımı (OPEX) — {month}/{year}</div>
        </div>

        {pieSlices.length === 0 ? (
          <div className="empty-state">Bu dönem için gider kaydı yok.</div>
        ) : (
          <DonutChart
            slices={pieSlices.map((seg) => ({ key: seg.segment, label: seg.segment, amount: seg.amount, pct: seg.pct, color: seg.color }))}
            centerLabel="Toplam OPEX"
            centerValue={currency.format(expenseTotal)}
            formatAmount={currency.format}
            formatPct={formatPercent}
          />
        )}
      </div>
    </div>
  );
}
