-- ============================================================================
-- Customer Segmentation — generic, fully user-defined criteria engine
-- ============================================================================
-- Replaces the first version of this module's parameter tables, which
-- hardcoded a fixed set of 7 criteria (CS_criteria_weights.criterion_key had
-- a CHECK constraint locking it to risk_class/overdue_rate/overdue_days/
-- tenure/payment_habit/strategic/annual_revenue, and lib/customerScoring.ts
-- had a per-key branch for each). Product feedback: users must be able to
-- define their OWN criteria and weights, not just adjust values within a
-- fixed structure — e.g. "Risk Class" must be fully deletable, not merely
-- deactivatable.
--
-- New shape (standard points-based scorecard pattern — WoE/FICO-style
-- binning for numeric fields, rules-based point tables for categorical
-- fields, both user-configurable per criterion):
--   CS_criteria                 one row per user-defined criterion, pointing
--                                at a specific CS_customers column
--                                (source_field) with a formula_type that says
--                                how to turn that field's value into points.
--   CS_criterion_lookup_values   for formula_type='lookup' criteria — a
--                                generic replacement for the old
--                                CS_risk_class_scores / CS_payment_habit_scores
--                                / CS_strategic_scores tables (all three were
--                                the same shape: text value -> points).
--   CS_criterion_bands           for formula_type='band' criteria — a generic
--                                replacement for CS_overdue_days_bands /
--                                CS_tenure_bands. Bands are min_value/
--                                max_value (both inclusive; max_value=null =
--                                open-ended) so the displayed range IS the
--                                matching rule — no more free-text label
--                                that could disagree with the actual
--                                boundaries (the original "1-4 yıl, but
--                                where does 3 actually land?" complaint).
--
-- CS_customers and CS_grade_thresholds are untouched — both were already
-- generic (CS_grade_thresholds only maps a score range to a grade, never
-- referenced a specific criterion).
-- ============================================================================

drop table if exists public."CS_criteria_weights" cascade;
drop table if exists public."CS_risk_class_scores" cascade;
drop table if exists public."CS_overdue_days_bands" cascade;
drop table if exists public."CS_tenure_bands" cascade;
drop table if exists public."CS_payment_habit_scores" cascade;
drop table if exists public."CS_strategic_scores" cascade;

create table public."CS_criteria" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  source_field text not null check (source_field in (
    'risk_class', 'overdue_rate', 'overdue_days', 'dso', 'sales_term', 'years_active',
    'payment_habit', 'credit_limit', 'annual_revenue_target', 'strategic_customer',
    'city', 'sum_overdue', 'sum_amount_local'
  )),
  formula_type text not null check (formula_type in ('lookup', 'linear', 'band')),
  direction text check (direction in ('higher_better', 'lower_better')), -- 'linear' only
  linear_min numeric(16, 4), -- 'linear' only
  linear_max numeric(16, 4), -- 'linear' only
  weight numeric(6, 2) not null default 0,
  active boolean not null default true,
  display_order int not null default 0,
  description text,
  created_at timestamptz not null default now()
);

create index idx_cs_criteria_user on public."CS_criteria"(user_id);

create table public."CS_criterion_lookup_values" (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid not null references public."CS_criteria"(id) on delete cascade,
  match_value text not null, -- compared case-insensitively against the customer's source_field value; booleans compare as 'true'/'false'
  points numeric(6, 2) not null default 0,
  special_rule text check (special_rule in ('force_100', 'force_0')),
  description text,
  display_order int not null default 0
);

create index idx_cs_lookup_criterion on public."CS_criterion_lookup_values"(criterion_id);

create table public."CS_criterion_bands" (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid not null references public."CS_criteria"(id) on delete cascade,
  min_value numeric(16, 4) not null,
  max_value numeric(16, 4), -- null = open-ended; both bounds inclusive when present
  points numeric(6, 2) not null default 0,
  display_order int not null default 0,
  check (max_value is null or max_value >= min_value)
);

create index idx_cs_bands_criterion on public."CS_criterion_bands"(criterion_id);

alter table public."CS_criteria" enable row level security;
alter table public."CS_criterion_lookup_values" enable row level security;
alter table public."CS_criterion_bands" enable row level security;

create policy cs_criteria_all on public."CS_criteria" for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- lookup_values/bands have no user_id of their own — ownership is via their
-- parent criterion, same pattern as unit_ledger_entries under aidat.
create policy cs_lookup_values_all on public."CS_criterion_lookup_values" for all to authenticated
  using (exists (select 1 from public."CS_criteria" c where c.id = criterion_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public."CS_criteria" c where c.id = criterion_id and c.user_id = auth.uid()));

create policy cs_bands_all on public."CS_criterion_bands" for all to authenticated
  using (exists (select 1 from public."CS_criteria" c where c.id = criterion_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public."CS_criteria" c where c.id = criterion_id and c.user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- Re-seed the demo account's parameters into the new generic shape (the old
-- fixed-7 rows were just dropped above along with the old tables). Same 6
-- criteria as before, values unchanged except the tenure bands, which are
-- now unambiguous min/max ranges instead of a disconnected free-text label.
-- ----------------------------------------------------------------------------

do $$
declare
  v_demo_user uuid := '9df07bd1-e7cb-49e0-84c2-486785d18b0c';
  v_c_risk uuid;
  v_c_overdue_rate uuid;
  v_c_overdue_days uuid;
  v_c_tenure uuid;
  v_c_habit uuid;
  v_c_strategic uuid;
begin
  insert into public."CS_criteria" (user_id, label, source_field, formula_type, direction, linear_min, linear_max, weight, active, display_order, description)
  values (v_demo_user, 'Risk Class (Credit Reform)', 'risk_class', 'lookup', null, null, null, 25, true, 0, 'Risk Class (AAA/BBB/CCC/DDD…) puanı. Örnek bir kriterdir — tamamen silinebilir.')
  returning id into v_c_risk;

  insert into public."CS_criterion_lookup_values" (criterion_id, match_value, points, special_rule, description, display_order) values
    (v_c_risk, 'MMM', 25, 'force_100', 'Major müşteri — direkt 100 puan', 0),
    (v_c_risk, 'GGG', 25, 'force_100', 'Kamu müşterisi — direkt 100 puan', 1),
    (v_c_risk, 'AAA', 25, null, 'En iyi CR notu (100-175)', 2),
    (v_c_risk, 'BBB', 20, null, 'İyi CR notu (176-275)', 3),
    (v_c_risk, 'CCC', 10, null, 'Orta CR notu (276-325)', 4),
    (v_c_risk, 'DDD', 5, null, 'Riskli CR notu (326-600)', 5),
    (v_c_risk, 'SSS', 0, 'force_0', 'Limit gelmedi — sıfır puan', 6),
    (v_c_risk, 'NNB', 0, 'force_0', 'Yeni müşteri — sıfır puan', 7),
    (v_c_risk, 'LLL', 0, 'force_0', 'Yasal takip — sıfır puan', 8),
    (v_c_risk, 'NNN', 0, 'force_0', 'Uzun aradan dönen — sıfır puan', 9);

  insert into public."CS_criteria" (user_id, label, source_field, formula_type, direction, linear_min, linear_max, weight, active, display_order, description)
  values (v_demo_user, 'Overdue Rate', 'overdue_rate', 'linear', 'lower_better', 0, 1, 25, true, 1, 'Vadesi geçmiş oran. Lineer: Puan = Ağırlık × (1 − oran).')
  returning id into v_c_overdue_rate;

  insert into public."CS_criteria" (user_id, label, source_field, formula_type, direction, linear_min, linear_max, weight, active, display_order, description)
  values (v_demo_user, 'Overdue Days', 'overdue_days', 'band', null, null, null, 30, true, 2, 'Vadesi geçmiş gün sayısı (DSO − Sales Term). Aralık tablosundan okunur.')
  returning id into v_c_overdue_days;

  insert into public."CS_criterion_bands" (criterion_id, min_value, max_value, points, display_order) values
    (v_c_overdue_days, 0, 7, 30, 0),
    (v_c_overdue_days, 8, 30, 15, 1),
    (v_c_overdue_days, 31, 60, 7, 2),
    (v_c_overdue_days, 61, 90, 0, 3),
    (v_c_overdue_days, 91, null, 0, 4);

  insert into public."CS_criteria" (user_id, label, source_field, formula_type, direction, linear_min, linear_max, weight, active, display_order, description)
  values (v_demo_user, 'Çalışma Yılı', 'years_active', 'band', null, null, null, 5, true, 3, 'Müşteri ile çalışılan yıl sayısına göre kademeli puan.')
  returning id into v_c_tenure;

  insert into public."CS_criterion_bands" (criterion_id, min_value, max_value, points, display_order) values
    (v_c_tenure, 1, 4, 1, 0),
    (v_c_tenure, 5, 9, 3, 1),
    (v_c_tenure, 10, null, 5, 2);

  insert into public."CS_criteria" (user_id, label, source_field, formula_type, direction, linear_min, linear_max, weight, active, display_order, description)
  values (v_demo_user, 'Payment Habit', 'payment_habit', 'lookup', null, null, null, 10, true, 4, 'Ödeme alışkanlığı etiketi.')
  returning id into v_c_habit;

  insert into public."CS_criterion_lookup_values" (criterion_id, match_value, points, description, display_order) values
    (v_c_habit, 'Good Payer', 10, null, 0),
    (v_c_habit, 'Neutral', 5, null, 1),
    (v_c_habit, 'Bad Payer', 0, null, 2);

  insert into public."CS_criteria" (user_id, label, source_field, formula_type, direction, linear_min, linear_max, weight, active, display_order, description)
  values (v_demo_user, 'Stratejik Müşteri', 'strategic_customer', 'lookup', null, null, null, 5, true, 5, 'Stratejik müşteri. Yes=ağırlık, No=0.')
  returning id into v_c_strategic;

  insert into public."CS_criterion_lookup_values" (criterion_id, match_value, points, description, display_order) values
    (v_c_strategic, 'true', 5, 'Yes', 0),
    (v_c_strategic, 'false', 0, 'No', 1);
end $$;
