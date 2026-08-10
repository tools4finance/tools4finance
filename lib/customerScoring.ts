// Shared Customer Segmentation scoring engine.
//
// Every page that computes or displays a customer's score (the list, the
// scorecard, the standalone calculator) MUST import and use these
// functions rather than reimplementing the formula, so the numbers are
// guaranteed to match everywhere.
//
// Unlike the first version of this module, NOTHING here is hardcoded to a
// fixed set of criteria — a criterion is just a row a user creates, pointing
// at one of the fields below, with a formula_type that says how to turn that
// field's raw value into points. The "Risk Class / Overdue Rate / Overdue
// Days / Tenure / Payment Habit / Strategic" set is only a suggested
// starting template (DEFAULT_CRITERIA_TEMPLATE) — fully deletable, editable,
// extensible, like every other criterion a user might add.
//
// This mirrors the standard points-based credit-scorecard pattern (WoE /
// FICO-style: bin a numeric field into ranges, each bin worth N points; look
// up a categorical field's value against a point table; sum weighted
// contributions) and the rules-based lead-scoring pattern used by CRM tools
// (HubSpot/Zoho-style: one point-value per attribute rule, independently
// configurable) — both use exactly this lookup/linear/band-per-criterion,
// weighted-sum shape.

export type CustomerFieldName =
  | "risk_class"
  | "overdue_rate"
  | "overdue_days"
  | "dso"
  | "sales_term"
  | "years_active"
  | "payment_habit"
  | "credit_limit"
  | "annual_revenue_target"
  | "strategic_customer"
  | "city"
  | "sum_overdue"
  | "sum_amount_local";

export type FieldKind = "text" | "number" | "fraction" | "boolean";

export const SOURCE_FIELD_OPTIONS: { value: CustomerFieldName; label: string; kind: FieldKind }[] = [
  { value: "risk_class", label: "Risk Class", kind: "text" },
  { value: "overdue_rate", label: "Overdue Rate (oran, 0-1 arası)", kind: "fraction" },
  { value: "overdue_days", label: "Overdue Days (gün)", kind: "number" },
  { value: "dso", label: "DSO (gün)", kind: "number" },
  { value: "sales_term", label: "Sales Term (gün)", kind: "number" },
  { value: "years_active", label: "Çalışma Yılı", kind: "number" },
  { value: "payment_habit", label: "Payment Habit", kind: "text" },
  { value: "credit_limit", label: "Kredi Limiti", kind: "number" },
  { value: "annual_revenue_target", label: "Yıllık Ciro Hedefi", kind: "number" },
  { value: "strategic_customer", label: "Stratejik Müşteri (Evet/Hayır)", kind: "boolean" },
  { value: "city", label: "Şehir", kind: "text" },
  { value: "sum_overdue", label: "Toplam Vadesi Geçmiş Tutar", kind: "number" },
  { value: "sum_amount_local", label: "Toplam Tutar", kind: "number" },
];

const SOURCE_FIELD_KIND: Record<CustomerFieldName, FieldKind> = Object.fromEntries(
  SOURCE_FIELD_OPTIONS.map((f) => [f.value, f.kind])
) as Record<CustomerFieldName, FieldKind>;

export function fieldKind(field: CustomerFieldName): FieldKind {
  return SOURCE_FIELD_KIND[field];
}

export function fieldLabel(field: CustomerFieldName): string {
  return SOURCE_FIELD_OPTIONS.find((f) => f.value === field)?.label ?? field;
}

export type CustomerRow = Partial<Record<CustomerFieldName, string | number | boolean | null>>;

export type CriterionFormulaType = "lookup" | "linear" | "band";
export type CriterionDirection = "higher_better" | "lower_better";

export type Criterion = {
  id: string;
  label: string;
  source_field: CustomerFieldName;
  formula_type: CriterionFormulaType;
  direction: CriterionDirection | null; // only meaningful for 'linear'
  linear_min: number | null; // only meaningful for 'linear'
  linear_max: number | null; // only meaningful for 'linear'
  weight: number;
  active: boolean;
  display_order: number;
  description: string | null;
};

export type LookupValue = {
  id: string;
  criterion_id: string;
  match_value: string;
  points: number;
  special_rule: "force_100" | "force_0" | null;
  description: string | null;
  display_order: number;
};

export type Band = {
  id: string;
  criterion_id: string;
  min_value: number;
  max_value: number | null; // null = open-ended
  points: number;
  display_order: number;
};

export type GradeThreshold = {
  min_score: number;
  max_score: number;
  grade_label: string;
  action_signal: string;
  recommended_action: string | null;
};

export type ScoringConfig = {
  criteria: Criterion[];
  lookupValues: Record<string, LookupValue[]>; // keyed by criterion_id
  bands: Record<string, Band[]>; // keyed by criterion_id
  gradeThresholds: GradeThreshold[];
};

export type CriterionBreakdown = {
  key: string; // criterion id
  label: string;
  sourceField: CustomerFieldName;
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

// Lookup/text matching is case/whitespace tolerant since this data is often
// pasted in from Excel with inconsistent casing.
function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLocaleLowerCase("tr");
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function rawToString(raw: CustomerRow[CustomerFieldName]): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw);
}

function rawToNumber(raw: CustomerRow[CustomerFieldName]): number {
  const n = Number(raw ?? 0);
  return isFinite(n) ? n : 0;
}

function formatInput(field: CustomerFieldName, raw: CustomerRow[CustomerFieldName]): string {
  const kind = fieldKind(field);
  if (raw === null || raw === undefined || raw === "") return "—";
  if (kind === "boolean") return raw ? "Yes" : "No";
  if (kind === "fraction") return `${(rawToNumber(raw) * 100).toFixed(1)}%`;
  return String(raw);
}

export function computeScore(customer: CustomerRow, config: ScoringConfig): ScoreResult {
  const breakdown: CriterionBreakdown[] = [];
  let forced: "force_100" | "force_0" | null = null;

  const sortedCriteria = [...config.criteria].sort((a, b) => a.display_order - b.display_order);

  for (const criterion of sortedCriteria) {
    const raw = customer[criterion.source_field];
    let points = 0;

    if (criterion.formula_type === "lookup") {
      const values = config.lookupValues[criterion.id] ?? [];
      const match = values.find((v) => norm(v.match_value) === norm(rawToString(raw)));
      points = criterion.active ? match?.points ?? 0 : 0;
      if (criterion.active && match?.special_rule) forced = match.special_rule;
    } else if (criterion.formula_type === "linear") {
      const value = rawToNumber(raw);
      const min = criterion.linear_min ?? 0;
      const max = criterion.linear_max ?? 1;
      const range = max - min || 1;
      const normalized = clamp((value - min) / range, 0, 1);
      const directional = criterion.direction === "higher_better" ? normalized : 1 - normalized;
      points = criterion.active ? criterion.weight * directional : 0;
    } else if (criterion.formula_type === "band") {
      const value = rawToNumber(raw);
      // Ceiling match (smallest upper bound that still covers the value,
      // ascending; open-ended last) rather than a strict min<=v<=max window —
      // real-world inputs are continuous (e.g. 7.01 overdue days) while band
      // boundaries are typically typed as whole numbers ("0–7", "8–30"), so a
      // strict window would silently score anything between two displayed
      // boundaries as 0. Ceiling matching instead rolls a value like 7.01
      // into the next band ("8–30"), matching how aging buckets actually
      // work: once you've crossed a threshold you're in the next bucket.
      const sorted = [...(config.bands[criterion.id] ?? [])].sort((a, b) => {
        if (a.max_value === null) return 1;
        if (b.max_value === null) return -1;
        return a.max_value - b.max_value;
      });
      const band = sorted.find((b) => b.max_value === null || value <= b.max_value);
      points = criterion.active ? band?.points ?? 0 : 0;
    }

    breakdown.push({
      key: criterion.id,
      label: criterion.label,
      sourceField: criterion.source_field,
      max: criterion.weight,
      inputDisplay: formatInput(criterion.source_field, raw),
      points,
      active: criterion.active,
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

// Sum of active criteria weights — surfaced in the parameters UI as a
// non-blocking "Eksik/Fazla Ağırlık" warning badge when it isn't exactly 100.
export function totalActiveWeight(criteria: Pick<Criterion, "weight" | "active">[]): number {
  return criteria.filter((c) => c.active).reduce((s, c) => s + c.weight, 0);
}

// Overlap checker for a single criterion's bands, sorted by min_value — used
// by the parameters UI so genuinely ambiguous configuration (two bands both
// claiming the same numeric span) is caught before it confuses whoever's
// reading the table. This only flags true overlaps: computeScore's band
// matching is a ceiling search (smallest max_value >= value, ascending), so
// a display gap like "0–7" / "8–30" never actually produces a 0-point hole —
// a value like 7.01 just rolls into "8–30" — which is why gaps aren't
// reported as an issue here, only as an informational note in the UI.
export type BandIssue = { type: "overlap"; message: string };

export function checkBandIssues(bands: Pick<Band, "min_value" | "max_value">[]): BandIssue[] {
  const sorted = [...bands].sort((a, b) => a.min_value - b.min_value);
  const issues: BandIssue[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (cur.max_value === null) continue; // open-ended band swallows everything after it; nothing to compare
    if (next.min_value <= cur.max_value) {
      issues.push({ type: "overlap", message: `${cur.min_value}–${cur.max_value} ile ${next.min_value}–${next.max_value ?? "∞"} aralıkları çakışıyor.` });
    }
  }
  return issues;
}

export function bandRangeLabel(band: Pick<Band, "min_value" | "max_value">): string {
  return band.max_value === null ? `${band.min_value}+` : `${band.min_value} – ${band.max_value}`;
}

// ----------------------------------------------------------------------------
// Default parameter template — a *suggested* starting point (same 6 criteria
// conceptually as the site owner's original Excel model), not a fixed/locked
// structure. Every field here is exactly as user-editable/deletable as any
// criterion a user adds themselves; nothing in the engine above knows or
// cares that "Risk Class" happens to be one of these. Used both to power the
// "Varsayılan Parametreleri Yükle" action and to seed the demo account.
// ----------------------------------------------------------------------------

export type DefaultCriterionTemplate = {
  criterion: Omit<Criterion, "id">;
  lookupValues?: Omit<LookupValue, "id" | "criterion_id">[];
  bands?: Omit<Band, "id" | "criterion_id">[];
};

// Risk Class was deliberately removed from the suggested template (2026-08-10,
// explicit product decision) — it's not disabled or hidden, it simply isn't
// part of what new users/the "load defaults" action start from anymore. A
// user can still add a lookup-type criterion reading risk_class themselves
// if they want one; the engine has never special-cased it.
export const DEFAULT_CRITERIA_TEMPLATE: DefaultCriterionTemplate[] = [
  {
    criterion: {
      label: "Overdue Rate",
      source_field: "overdue_rate",
      formula_type: "linear",
      direction: "lower_better",
      linear_min: 0,
      linear_max: 1,
      weight: 25,
      active: true,
      display_order: 0,
      description: "Vadesi geçmiş oran. Lineer: Puan = Ağırlık × (1 − oran).",
    },
  },
  {
    criterion: {
      label: "Overdue Days",
      source_field: "overdue_days",
      formula_type: "band",
      direction: null,
      linear_min: null,
      linear_max: null,
      weight: 30,
      active: true,
      display_order: 1,
      description: "Vadesi geçmiş gün sayısı (DSO − Sales Term). Aralık tablosundan okunur.",
    },
    bands: [
      { min_value: 0, max_value: 7, points: 30, display_order: 0 },
      { min_value: 8, max_value: 30, points: 15, display_order: 1 },
      { min_value: 31, max_value: 60, points: 7, display_order: 2 },
      { min_value: 61, max_value: 90, points: 0, display_order: 3 },
      { min_value: 91, max_value: null, points: 0, display_order: 4 },
    ],
  },
  {
    criterion: {
      label: "Çalışma Yılı",
      source_field: "years_active",
      formula_type: "band",
      direction: null,
      linear_min: null,
      linear_max: null,
      weight: 5,
      active: true,
      display_order: 2,
      description: "Müşteri ile çalışılan yıl sayısına göre kademeli puan.",
    },
    bands: [
      { min_value: 1, max_value: 4, points: 1, display_order: 0 },
      { min_value: 5, max_value: 9, points: 3, display_order: 1 },
      { min_value: 10, max_value: null, points: 5, display_order: 2 },
    ],
  },
  {
    criterion: {
      label: "Payment Habit",
      source_field: "payment_habit",
      formula_type: "lookup",
      direction: null,
      linear_min: null,
      linear_max: null,
      weight: 10,
      active: true,
      display_order: 3,
      description: "Ödeme alışkanlığı etiketi.",
    },
    lookupValues: [
      { match_value: "Good Payer", points: 10, special_rule: null, description: null, display_order: 0 },
      { match_value: "Neutral", points: 5, special_rule: null, description: null, display_order: 1 },
      { match_value: "Bad Payer", points: 0, special_rule: null, description: null, display_order: 2 },
    ],
  },
  {
    criterion: {
      label: "Stratejik Müşteri",
      source_field: "strategic_customer",
      formula_type: "lookup",
      direction: null,
      linear_min: null,
      linear_max: null,
      weight: 5,
      active: true,
      display_order: 4,
      description: "Stratejik müşteri. Yes=ağırlık, No=0.",
    },
    lookupValues: [
      { match_value: "true", points: 5, special_rule: null, description: "Yes", display_order: 0 },
      { match_value: "false", points: 0, special_rule: null, description: "No", display_order: 1 },
    ],
  },
];

export const DEFAULT_GRADE_THRESHOLDS: (GradeThreshold & { display_order: number })[] = [
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
