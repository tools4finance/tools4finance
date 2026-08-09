// Shared Customer Segmentation scoring engine.
//
// This is a faithful port of the site owner's existing Excel model
// ("Parametrik Risk Skoru Modeli") — every page that computes or displays a
// customer's score (the list, the scorecard) MUST import and use these
// functions rather than reimplementing the formula, so the numbers are
// guaranteed to match everywhere. The formula itself is fixed; everything
// it reads (weights, bands, thresholds) is 100% user-editable data coming
// from the CS_* parameter tables.

export type CustomerRow = {
  risk_class: string | null;
  overdue_rate: number | null; // fraction 0..1
  overdue_days: number | null;
  years_active: number | null;
  payment_habit: string | null;
  strategic_customer: boolean | null;
};

export type CriteriaWeight = {
  criterion_key: "risk_class" | "overdue_rate" | "overdue_days" | "tenure" | "payment_habit" | "strategic" | "annual_revenue";
  label: string;
  weight: number;
  active: boolean;
  formula_type: "lookup" | "linear" | "band" | "excluded";
};

export type RiskClassScore = {
  risk_class: string;
  points: number;
  special_rule: "force_100" | "force_0" | null;
  active: boolean;
};

export type OverdueDaysBand = { upper_bound_days: number | null; points: number };
export type TenureBand = { label: string; min_years: number; points: number };
export type PaymentHabitScore = { habit_label: string; points: number };
export type StrategicScore = { is_strategic: boolean; points: number };
export type GradeThreshold = {
  min_score: number;
  max_score: number;
  grade_label: string;
  action_signal: string;
  recommended_action: string | null;
};

export type ScoringConfig = {
  weights: CriteriaWeight[];
  riskClassScores: RiskClassScore[];
  overdueDaysBands: OverdueDaysBand[]; // must be pre-sorted ascending by upper_bound_days (nulls last)
  tenureBands: TenureBand[]; // must be pre-sorted descending by min_years (so first match wins)
  paymentHabitScores: PaymentHabitScore[];
  strategicScores: StrategicScore[];
  gradeThresholds: GradeThreshold[];
};

export type CriterionBreakdown = {
  key: CriteriaWeight["criterion_key"];
  label: string;
  max: number;
  inputDisplay: string;
  points: number;
  active: boolean;
};

export type ScoreResult = {
  totalScore: number;
  forced: "force_100" | "force_0" | null;
  breakdown: CriterionBreakdown[];
  grade: string | null;
  actionSignal: string | null;
  recommendedAction: string | null;
};

function weightFor(config: ScoringConfig, key: CriteriaWeight["criterion_key"]): CriteriaWeight | undefined {
  return config.weights.find((w) => w.criterion_key === key);
}

// Riskclass/payment-habit lookups are case/whitespace tolerant since this
// data is often pasted in from Excel with inconsistent casing.
function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLocaleLowerCase("tr");
}

export function computeScore(customer: CustomerRow, config: ScoringConfig): ScoreResult {
  const breakdown: CriterionBreakdown[] = [];
  let forced: "force_100" | "force_0" | null = null;

  // --- Risk Class (lookup, may force the whole total) ---
  const riskW = weightFor(config, "risk_class");
  if (riskW) {
    const match = config.riskClassScores.find((r) => norm(r.risk_class) === norm(customer.risk_class));
    const points = riskW.active ? match?.points ?? 0 : 0;
    if (riskW.active && match?.special_rule) forced = match.special_rule;
    breakdown.push({
      key: "risk_class",
      label: riskW.label,
      max: riskW.weight,
      inputDisplay: customer.risk_class ?? "—",
      points,
      active: riskW.active,
    });
  }

  // --- Overdue Rate (linear: weight * (1 - rate), clamped) ---
  const odRateW = weightFor(config, "overdue_rate");
  if (odRateW) {
    const rate = customer.overdue_rate ?? 0;
    const raw = odRateW.weight * (1 - rate);
    const points = odRateW.active ? Math.max(0, Math.min(odRateW.weight, raw)) : 0;
    breakdown.push({
      key: "overdue_rate",
      label: odRateW.label,
      max: odRateW.weight,
      inputDisplay: `${(rate * 100).toFixed(1)}%`,
      points,
      active: odRateW.active,
    });
  }

  // --- Overdue Days (band lookup) ---
  const odDaysW = weightFor(config, "overdue_days");
  if (odDaysW) {
    const days = customer.overdue_days ?? 0;
    const sorted = [...config.overdueDaysBands].sort((a, b) => {
      if (a.upper_bound_days === null) return 1;
      if (b.upper_bound_days === null) return -1;
      return a.upper_bound_days - b.upper_bound_days;
    });
    const band = sorted.find((b) => b.upper_bound_days === null || days <= b.upper_bound_days);
    const points = odDaysW.active ? band?.points ?? 0 : 0;
    breakdown.push({
      key: "overdue_days",
      label: odDaysW.label,
      max: odDaysW.weight,
      inputDisplay: `${days} gün`,
      points,
      active: odDaysW.active,
    });
  }

  // --- Tenure / Çalışma Yılı (band lookup, highest min_years <= years wins) ---
  const tenureW = weightFor(config, "tenure");
  if (tenureW) {
    const years = customer.years_active ?? 0;
    const sorted = [...config.tenureBands].sort((a, b) => b.min_years - a.min_years);
    const band = sorted.find((b) => years >= b.min_years);
    const points = tenureW.active ? band?.points ?? 0 : 0;
    breakdown.push({
      key: "tenure",
      label: tenureW.label,
      max: tenureW.weight,
      inputDisplay: `${years} yıl`,
      points,
      active: tenureW.active,
    });
  }

  // --- Payment Habit (lookup) ---
  const habitW = weightFor(config, "payment_habit");
  if (habitW) {
    const match = config.paymentHabitScores.find((h) => norm(h.habit_label) === norm(customer.payment_habit));
    const points = habitW.active ? match?.points ?? 0 : 0;
    breakdown.push({
      key: "payment_habit",
      label: habitW.label,
      max: habitW.weight,
      inputDisplay: customer.payment_habit ?? "—",
      points,
      active: habitW.active,
    });
  }

  // --- Strategic customer (lookup) ---
  const stratW = weightFor(config, "strategic");
  if (stratW) {
    const isStrategic = !!customer.strategic_customer;
    const match = config.strategicScores.find((s) => s.is_strategic === isStrategic);
    const points = stratW.active ? match?.points ?? 0 : 0;
    breakdown.push({
      key: "strategic",
      label: stratW.label,
      max: stratW.weight,
      inputDisplay: isStrategic ? "Yes" : "No",
      points,
      active: stratW.active,
    });
  }

  // annual_revenue is deliberately excluded from scoring (matches the
  // spreadsheet's own "Ciro skoru devre dışıdır" note) — still shown in the
  // breakdown if the weight row exists and is active, but formula_type
  // 'excluded' means it never contributes points regardless.
  const revenueW = weightFor(config, "annual_revenue");
  if (revenueW && revenueW.formula_type !== "excluded" && revenueW.active) {
    breakdown.push({
      key: "annual_revenue",
      label: revenueW.label,
      max: revenueW.weight,
      inputDisplay: "—",
      points: 0,
      active: revenueW.active,
    });
  }

  const summedScore = breakdown.reduce((s, b) => s + b.points, 0);
  const totalScore = forced === "force_100" ? 100 : forced === "force_0" ? 0 : summedScore;

  const gradeMatch = config.gradeThresholds.find((g) => totalScore >= g.min_score && totalScore <= g.max_score);

  return {
    totalScore,
    forced,
    breakdown,
    grade: gradeMatch?.grade_label ?? null,
    actionSignal: gradeMatch?.action_signal ?? null,
    recommendedAction: gradeMatch?.recommended_action ?? null,
  };
}

// ----------------------------------------------------------------------------
// Default parameter template — exact values from the source spreadsheet's
// "Parametreler" sheet (Tablo 1-6). Used both to seed the demo account and
// to power the "Varsayılan Parametreleri Yükle" (load defaults) action any
// user can trigger to start from a sensible template instead of a blank
// slate.
// ----------------------------------------------------------------------------

export const DEFAULT_CRITERIA_WEIGHTS: Omit<CriteriaWeight, "">[] & { description: string; display_order: number }[] = [
  { criterion_key: "risk_class", label: "Risk Class (Credit Reform)", weight: 25, active: true, formula_type: "lookup", description: "Risk Class (AAA/BBB/CCC/DDD) puanı.", display_order: 0 },
  { criterion_key: "overdue_rate", label: "Overdue Rate", weight: 25, active: true, formula_type: "linear", description: "Vadesi geçmiş oran. Lineer: Puan = Ağırlık × (1 − OD Rate)", display_order: 1 },
  { criterion_key: "overdue_days", label: "Overdue Days", weight: 30, active: true, formula_type: "band", description: "Vadesi geçmiş gün (DSO − Sales Term). Eşik tablosundan okunur.", display_order: 2 },
  { criterion_key: "tenure", label: "Çalışma Yılı", weight: 5, active: true, formula_type: "band", description: "Çalışma yılı kademeli puan.", display_order: 3 },
  { criterion_key: "payment_habit", label: "Payment Habit", weight: 10, active: true, formula_type: "lookup", description: "Ödeme alışkanlığı.", display_order: 4 },
  { criterion_key: "strategic", label: "Stratejik Müşteri", weight: 5, active: true, formula_type: "lookup", description: "Stratejik müşteri. Yes=ağırlık, No=0.", display_order: 5 },
  { criterion_key: "annual_revenue", label: "Yıllık Ciro", weight: 0, active: false, formula_type: "excluded", description: "Skor dışı bırakıldı; formülde kullanılmaz.", display_order: 6 },
] as unknown as (Omit<CriteriaWeight, "">[] & { description: string; display_order: number }[]);

export const DEFAULT_RISK_CLASS_SCORES = [
  { risk_class: "MMM", points: 25, special_rule: "force_100" as const, description: "Major müşteri — direkt 100 puan", display_order: 0 },
  { risk_class: "GGG", points: 25, special_rule: "force_100" as const, description: "Kamu müşterisi — direkt 100 puan", display_order: 1 },
  { risk_class: "AAA", points: 25, special_rule: null, description: "En iyi CR notu (100-175)", display_order: 2 },
  { risk_class: "BBB", points: 20, special_rule: null, description: "İyi CR notu (176-275)", display_order: 3 },
  { risk_class: "CCC", points: 10, special_rule: null, description: "Orta CR notu (276-325)", display_order: 4 },
  { risk_class: "DDD", points: 5, special_rule: null, description: "Riskli CR notu (326-600)", display_order: 5 },
  { risk_class: "SSS", points: 0, special_rule: "force_0" as const, description: "Limit gelmedi — sıfır puan", display_order: 6 },
  { risk_class: "NNB", points: 0, special_rule: "force_0" as const, description: "Yeni müşteri — sıfır puan", display_order: 7 },
  { risk_class: "LLL", points: 0, special_rule: "force_0" as const, description: "Yasal takip — sıfır puan", display_order: 8 },
  { risk_class: "NNN", points: 0, special_rule: "force_0" as const, description: "Uzun aradan dönen — sıfır puan", display_order: 9 },
];

export const DEFAULT_OVERDUE_DAYS_BANDS = [
  { upper_bound_days: 7, points: 30, display_order: 0 },
  { upper_bound_days: 30, points: 15, display_order: 1 },
  { upper_bound_days: 60, points: 7, display_order: 2 },
  { upper_bound_days: 90, points: 0, display_order: 3 },
  { upper_bound_days: null, points: 0, display_order: 4 },
];

export const DEFAULT_TENURE_BANDS = [
  { label: "1-4 yıl", min_years: 1, points: 1, display_order: 0 },
  { label: "5-9 yıl", min_years: 5, points: 3, display_order: 1 },
  { label: "≥10 yıl", min_years: 10, points: 5, display_order: 2 },
];

export const DEFAULT_PAYMENT_HABIT_SCORES = [
  { habit_label: "Good Payer", points: 10, display_order: 0 },
  { habit_label: "Neutral", points: 5, display_order: 1 },
  { habit_label: "Bad Payer", points: 0, display_order: 2 },
];

export const DEFAULT_STRATEGIC_SCORES = [
  { is_strategic: true, points: 5 },
  { is_strategic: false, points: 0 },
];

export const DEFAULT_GRADE_THRESHOLDS = [
  { min_score: 85, max_score: 100, grade_label: "A+", action_signal: "Green", recommended_action: "Normal ticaret / limit artırımı değerlendirilebilir", display_order: 0 },
  { min_score: 70, max_score: 84.99, grade_label: "A", action_signal: "Light Green", recommended_action: "Normal ticaret; periyodik takip", display_order: 1 },
  { min_score: 50, max_score: 69.99, grade_label: "B", action_signal: "Yellow", recommended_action: "Yakın takip; limit, vade ve tahsilat gözden geçirilmeli", display_order: 2 },
  { min_score: 0, max_score: 49.99, grade_label: "C", action_signal: "Red", recommended_action: "Risk aksiyonu: tahsilat, limit kısıtı veya durdurma", display_order: 3 },
];

export const ACTION_SIGNAL_PILL: Record<string, string> = {
  Green: "pill-green",
  "Light Green": "pill-green",
  Yellow: "pill-amber",
  Red: "pill-coral",
};
