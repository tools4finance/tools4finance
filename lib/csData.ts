// Supabase read/write helpers for the Customer Segmentation module.
// Kept separate from lib/customerScoring.ts, which is pure formula logic
// with zero Supabase dependency — this file is the only place that talks
// to the CS_* tables for configuration loading.

import { supabase } from "@/lib/supabase";
import {
  type ScoringConfig,
  DEFAULT_CRITERIA_WEIGHTS,
  DEFAULT_RISK_CLASS_SCORES,
  DEFAULT_OVERDUE_DAYS_BANDS,
  DEFAULT_TENURE_BANDS,
  DEFAULT_PAYMENT_HABIT_SCORES,
  DEFAULT_STRATEGIC_SCORES,
  DEFAULT_GRADE_THRESHOLDS,
} from "@/lib/customerScoring";

export async function loadScoringConfig(userId: string): Promise<ScoringConfig> {
  const [weightsRes, riskRes, odDaysRes, tenureRes, habitRes, stratRes, gradeRes] = await Promise.all([
    supabase.from("CS_criteria_weights").select("criterion_key, label, weight, active, formula_type").eq("user_id", userId),
    supabase.from("CS_risk_class_scores").select("risk_class, points, special_rule, active").eq("user_id", userId).order("display_order"),
    supabase.from("CS_overdue_days_bands").select("upper_bound_days, points").eq("user_id", userId).order("display_order"),
    supabase.from("CS_tenure_bands").select("label, min_years, points").eq("user_id", userId).order("display_order"),
    supabase.from("CS_payment_habit_scores").select("habit_label, points").eq("user_id", userId).order("display_order"),
    supabase.from("CS_strategic_scores").select("is_strategic, points").eq("user_id", userId),
    supabase.from("CS_grade_thresholds").select("min_score, max_score, grade_label, action_signal, recommended_action").eq("user_id", userId).order("display_order"),
  ]);

  for (const r of [weightsRes, riskRes, odDaysRes, tenureRes, habitRes, stratRes, gradeRes]) {
    if (r.error) throw r.error;
  }

  return {
    weights: (weightsRes.data ?? []) as ScoringConfig["weights"],
    riskClassScores: ((riskRes.data ?? []) as (ScoringConfig["riskClassScores"][number] & { active: boolean })[]).filter((r) => r.active),
    overdueDaysBands: (odDaysRes.data ?? []) as ScoringConfig["overdueDaysBands"],
    tenureBands: (tenureRes.data ?? []) as ScoringConfig["tenureBands"],
    paymentHabitScores: (habitRes.data ?? []) as ScoringConfig["paymentHabitScores"],
    strategicScores: (stratRes.data ?? []) as ScoringConfig["strategicScores"],
    gradeThresholds: (gradeRes.data ?? []) as ScoringConfig["gradeThresholds"],
  };
}

export async function hasAnyParameters(userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("CS_criteria_weights")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// Inserts the spreadsheet-derived default template into every CS_ parameter
// table for this user. Safe to call only when the tables are empty for that
// user (callers should check hasAnyParameters first) — it does not upsert or
// dedupe, it just inserts the default rows.
export async function loadDefaultParameters(userId: string): Promise<void> {
  const weights = DEFAULT_CRITERIA_WEIGHTS.map((w) => ({ ...w, user_id: userId }));
  const risk = DEFAULT_RISK_CLASS_SCORES.map((r) => ({ ...r, user_id: userId }));
  const odDays = DEFAULT_OVERDUE_DAYS_BANDS.map((b) => ({ ...b, user_id: userId }));
  const tenure = DEFAULT_TENURE_BANDS.map((t) => ({ ...t, user_id: userId }));
  const habit = DEFAULT_PAYMENT_HABIT_SCORES.map((h) => ({ ...h, user_id: userId }));
  const strat = DEFAULT_STRATEGIC_SCORES.map((s) => ({ ...s, user_id: userId }));
  const grade = DEFAULT_GRADE_THRESHOLDS.map((g) => ({ ...g, user_id: userId }));

  const results = await Promise.all([
    supabase.from("CS_criteria_weights").insert(weights),
    supabase.from("CS_risk_class_scores").insert(risk),
    supabase.from("CS_overdue_days_bands").insert(odDays),
    supabase.from("CS_tenure_bands").insert(tenure),
    supabase.from("CS_payment_habit_scores").insert(habit),
    supabase.from("CS_strategic_scores").insert(strat),
    supabase.from("CS_grade_thresholds").insert(grade),
  ]);
  for (const r of results) {
    if (r.error) throw r.error;
  }
}
