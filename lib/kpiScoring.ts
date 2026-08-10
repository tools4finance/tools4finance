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

export type GoalDirection = "higher_better" | "lower_better";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Calculates an achievement % from a target/actual pair instead of having it
// typed in directly. Returns null when any input is missing — callers fall
// back to whatever the user typed manually (see the goal-entry pages: target
// entry is optional, so a goal with no target keeps the old manual-percentage
// behavior untouched).
//
// higher_better (e.g. "Ciro Hedefi", target 1,000,000 / actual 800,000):
//   actual/target*100, clamped to [0,100] — 800000/1000000*100 = 80.
//
// lower_better (e.g. LTIFR — 0 incidents is best, target 1% / actual 0.5%):
//   target/actual*100, clamped to [0,100] — 1/0.5*100 = 200, clamped to 100
//   ("hedef tutmuş", not an uncapped 200% overachievement number — capping
//   keeps every goal's contribution within its allotted weight so the 0-100
//   grade scale stays meaningful). actual=0 is treated as a perfect 100 (you
//   can't beat zero incidents) regardless of target. target=0 (a genuine
//   zero-tolerance metric) only reaches 100 if actual is also exactly 0 —
//   anything else against a zero target is a miss (0), checked before the
//   division so a zero target never divides by itself.
export function computeAchievementPct(
  direction: GoalDirection | null,
  target: number | null,
  actual: number | null
): number | null {
  if (direction === null || target === null || actual === null) return null;
  if (direction === "higher_better") {
    if (target === 0) return actual >= 0 ? 100 : 0;
    return clamp((actual / target) * 100, 0, 100);
  }
  // lower_better
  if (actual === 0) return 100;
  if (target === 0) return 0;
  return clamp((target / actual) * 100, 0, 100);
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
