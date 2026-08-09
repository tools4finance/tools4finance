// Supabase read/write helpers for the Customer Segmentation module.
// Kept separate from lib/customerScoring.ts, which is pure formula logic
// with zero Supabase dependency — this file is the only place that talks
// to the CS_* tables for configuration loading.

import { supabase } from "@/lib/supabase";
import {
  type ScoringConfig,
  type Criterion,
  type LookupValue,
  type Band,
  DEFAULT_CRITERIA_TEMPLATE,
  DEFAULT_GRADE_THRESHOLDS,
} from "@/lib/customerScoring";

export async function loadScoringConfig(userId: string): Promise<ScoringConfig> {
  const criteriaRes = await supabase
    .from("CS_criteria")
    .select("id, label, source_field, formula_type, direction, linear_min, linear_max, weight, active, display_order, description")
    .eq("user_id", userId)
    .order("display_order");
  if (criteriaRes.error) throw criteriaRes.error;
  const criteria = (criteriaRes.data ?? []) as Criterion[];
  const criterionIds = criteria.map((c) => c.id);

  const [lookupRes, bandRes, gradeRes] = await Promise.all([
    criterionIds.length > 0
      ? supabase
          .from("CS_criterion_lookup_values")
          .select("id, criterion_id, match_value, points, special_rule, description, display_order")
          .in("criterion_id", criterionIds)
          .order("display_order")
      : Promise.resolve({ data: [], error: null }),
    criterionIds.length > 0
      ? supabase
          .from("CS_criterion_bands")
          .select("id, criterion_id, min_value, max_value, points, display_order")
          .in("criterion_id", criterionIds)
          .order("display_order")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("CS_grade_thresholds")
      .select("min_score, max_score, grade_label, action_signal, recommended_action")
      .eq("user_id", userId)
      .order("display_order"),
  ]);
  if (lookupRes.error) throw lookupRes.error;
  if (bandRes.error) throw bandRes.error;
  if (gradeRes.error) throw gradeRes.error;

  const lookupValues: Record<string, LookupValue[]> = {};
  for (const row of (lookupRes.data ?? []) as LookupValue[]) {
    (lookupValues[row.criterion_id] ??= []).push(row);
  }
  const bands: Record<string, Band[]> = {};
  for (const row of (bandRes.data ?? []) as Band[]) {
    (bands[row.criterion_id] ??= []).push(row);
  }

  return {
    criteria,
    lookupValues,
    bands,
    gradeThresholds: (gradeRes.data ?? []) as ScoringConfig["gradeThresholds"],
  };
}

export async function hasAnyParameters(userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("CS_criteria")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// Inserts the suggested default criteria template (and, if none exist yet,
// the default grade thresholds) for this user. Not upsert/dedupe — calling
// it repeatedly adds more rows alongside whatever's already there, same as
// before; the parameters page warns about that before calling it again.
export async function loadDefaultParameters(userId: string): Promise<void> {
  for (const { criterion, lookupValues, bands } of DEFAULT_CRITERIA_TEMPLATE) {
    const { data: criterionRow, error: criterionError } = await supabase
      .from("CS_criteria")
      .insert({ ...criterion, user_id: userId })
      .select("id")
      .single();
    if (criterionError) throw criterionError;
    const criterionId = (criterionRow as { id: string }).id;

    if (lookupValues && lookupValues.length > 0) {
      const { error } = await supabase
        .from("CS_criterion_lookup_values")
        .insert(lookupValues.map((v) => ({ ...v, criterion_id: criterionId })));
      if (error) throw error;
    }
    if (bands && bands.length > 0) {
      const { error } = await supabase
        .from("CS_criterion_bands")
        .insert(bands.map((b) => ({ ...b, criterion_id: criterionId })));
      if (error) throw error;
    }
  }

  const { count } = await supabase
    .from("CS_grade_thresholds")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (!count || count === 0) {
    const { error } = await supabase
      .from("CS_grade_thresholds")
      .insert(DEFAULT_GRADE_THRESHOLDS.map((g) => ({ ...g, user_id: userId })));
    if (error) throw error;
  }
}
