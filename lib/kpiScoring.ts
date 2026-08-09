// Pure KPI Tracker scoring formula — no Supabase dependency, mirrors the
// discipline of lib/customerScoring.ts (one formula module every page that
// needs a score imports, instead of five slightly-different reimplementations).

export type IndividualGoalScoreInput = {
  weight_pct: number;
  self_rating: number | null;
  manager_rating: number | null;
};

export type CompanyGoalScoreInput = {
  weight_pct: number;
  achievement_pct: number | null;
};

export type PeriodWeights = {
  company_weight_pct: number;
  individual_weight_pct: number;
};

// A goal's realized score prefers the manager's rating (final word) and
// falls back to the employee's own self-rating, then 0 if neither exists
// yet — matches the spec's "manager_rating ?? self_rating ?? 0".
export function individualScore(goals: IndividualGoalScoreInput[]): number {
  return goals.reduce((sum, g) => {
    const rating = g.manager_rating ?? g.self_rating ?? 0;
    return sum + (g.weight_pct / 100) * rating;
  }, 0);
}

// Company goals have one shared achievement_pct for the whole org (HR fills
// it once), so this is the same value for every member unless the caller
// passes a per-member weight override via PeriodWeights.
export function companyScore(goals: CompanyGoalScoreInput[]): number {
  return goals.reduce((sum, g) => sum + (g.weight_pct / 100) * (g.achievement_pct ?? 0), 0);
}

export function finalScore(
  company: number,
  individual: number,
  weights: PeriodWeights
): number {
  return (weights.company_weight_pct / 100) * company + (weights.individual_weight_pct / 100) * individual;
}

export function sumWeights(items: { weight_pct: number }[]): number {
  return items.reduce((s, i) => s + (i.weight_pct || 0), 0);
}

// Weight totals are allowed a small float-rounding tolerance rather than
// requiring an exact 100 — matches how the UI warns rather than hard-blocks.
export function isFullyWeighted(items: { weight_pct: number }[]): boolean {
  const total = sumWeights(items);
  return Math.abs(total - 100) < 0.01;
}
