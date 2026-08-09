"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

type ExpenseCategoryJoin = { opex_capex: string | null };
type ExpenseWithCategory = { amount: number; expense_category: ExpenseCategoryJoin | ExpenseCategoryJoin[] | null };
type BudgetLineWithCategory = { budget_amount: number; expense_category: ExpenseCategoryJoin | ExpenseCategoryJoin[] | null };
type AccrualJoin = { fiscal_period_id: string | null; site_id: string; status: string };
type PaymentJoin = { status: string };
type AllocationWithJoins = {
  amount: number;
  accruals: AccrualJoin | AccrualJoin[] | null;
  payments: PaymentJoin | PaymentJoin[] | null;
};

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
};

export default function AidatDashboardPage() {
  const { selectedSiteId, year, month } = useAidat();

  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          .select("amount, expense_category:expense_categories!inner(opex_capex)")
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
      const opexTotal = ((opexRes.data ?? []) as ExpenseWithCategory[]).reduce((s, r) => s + r.amount, 0);
      const capexTotal = ((capexRes.data ?? []) as ExpenseWithCategory[]).reduce((s, r) => s + r.amount, 0);
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

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

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
    </div>
  );
}
