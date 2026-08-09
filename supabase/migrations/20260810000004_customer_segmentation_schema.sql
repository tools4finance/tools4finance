-- ============================================================================
-- Customer Segmentation (CS_) module
-- ============================================================================
-- A separate, independent module from the "Site Bütçe Yönetimi" (aidat_
-- prefix candidate) tables — no site/tenant concept here. Every table is
-- scoped directly by `user_id = auth.uid()` (one person's own customer
-- book and scoring configuration), which is why RLS here is much simpler
-- than the aidat module's site_members-based model: no helper functions
-- needed, just a straight owner check per row.
--
-- Origin: this schema is a faithful port of a working Excel-based
-- "Parametrik Risk Skoru Modeli" (parametric customer risk score) the site
-- owner already uses — see the 6 parameter tables below, which map 1:1 to
-- that spreadsheet's "Parametreler" sheet (Tablo 1-6). The scoring FORMULA
-- itself lives in application code (lib/customerScoring.ts), not in SQL —
-- these tables only hold the user-editable inputs to that formula, exactly
-- as the spreadsheet's yellow input cells did.
--
-- Every parameter table is genuinely user-editable (rows can be added,
-- edited, removed) — nothing here is a fixed enum. A new user's tables
-- start empty; the app offers a "load the default template" action that
-- inserts the same defaults documented in lib/customerScoring.ts, which the
-- user can then freely edit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Customers (raw input data — one row per company/customer)
-- ----------------------------------------------------------------------------

create table public."CS_customers" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_code text,
  name text not null,
  city text,
  sum_undue numeric(16, 2),
  sum_0_7 numeric(16, 2),
  sum_8_30 numeric(16, 2),
  sum_31_60 numeric(16, 2),
  sum_61_90 numeric(16, 2),
  sum_91_plus numeric(16, 2),
  sum_overdue numeric(16, 2),
  sum_amount_local numeric(16, 2),
  risk_class text,
  credit_limit numeric(16, 2),
  overdue_rate numeric(6, 4), -- fraction 0..1, e.g. 0.25 = 25% (matches the spreadsheet's own convention)
  overdue_days numeric(10, 1),
  dso numeric(10, 1),
  sales_term numeric(10, 1),
  years_active numeric(6, 2), -- "Çalışma Yılı"
  payment_habit text,
  annual_revenue_target numeric(16, 2), -- "Yıllık Ciro Hedefi" — excluded from scoring by default
  strategic_customer boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_cs_customers_user on public."CS_customers"(user_id);
create index idx_cs_customers_code on public."CS_customers"(user_id, customer_code);

create trigger trg_cs_customers_updated_at
  before update on public."CS_customers"
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Criteria weights & active/inactive registry (Tablo 6)
-- ----------------------------------------------------------------------------

create table public."CS_criteria_weights" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  criterion_key text not null check (criterion_key in (
    'risk_class', 'overdue_rate', 'overdue_days', 'tenure', 'payment_habit', 'strategic', 'annual_revenue'
  )),
  label text not null,
  weight numeric(6, 2) not null default 0, -- max points this criterion can contribute
  active boolean not null default true,
  formula_type text not null check (formula_type in ('lookup', 'linear', 'band', 'excluded')),
  description text,
  display_order int not null default 0,
  unique (user_id, criterion_key)
);

-- ----------------------------------------------------------------------------
-- 3. Risk Class score table (Tablo 1)
-- ----------------------------------------------------------------------------

create table public."CS_risk_class_scores" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  risk_class text not null,
  points numeric(6, 2) not null default 0,
  special_rule text check (special_rule in ('force_100', 'force_0')), -- MMM/GGG force total=100; SSS/NNB/LLL/NNN force total=0
  description text,
  display_order int not null default 0,
  active boolean not null default true,
  unique (user_id, risk_class)
);

-- ----------------------------------------------------------------------------
-- 4. Overdue Days bands (Tablo 3) — Puan = band matching overdue_days
-- ----------------------------------------------------------------------------

create table public."CS_overdue_days_bands" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  upper_bound_days numeric(10, 1), -- null = open-ended (last band, ">91" style)
  points numeric(6, 2) not null default 0,
  display_order int not null default 0
);

-- ----------------------------------------------------------------------------
-- 5. Tenure ("Çalışma Yılı") bands (Tablo 4)
-- ----------------------------------------------------------------------------

create table public."CS_tenure_bands" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  min_years numeric(6, 2) not null default 0,
  points numeric(6, 2) not null default 0,
  display_order int not null default 0
);

-- ----------------------------------------------------------------------------
-- 6. Payment Habit score table (Tablo 4)
-- ----------------------------------------------------------------------------

create table public."CS_payment_habit_scores" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_label text not null,
  points numeric(6, 2) not null default 0,
  display_order int not null default 0,
  unique (user_id, habit_label)
);

-- ----------------------------------------------------------------------------
-- 7. Strategic customer score table (Tablo 4)
-- ----------------------------------------------------------------------------

create table public."CS_strategic_scores" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  is_strategic boolean not null,
  points numeric(6, 2) not null default 0,
  unique (user_id, is_strategic)
);

-- ----------------------------------------------------------------------------
-- 8. Grade / action-signal thresholds (Tablo 5)
-- ----------------------------------------------------------------------------

create table public."CS_grade_thresholds" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  min_score numeric(6, 2) not null,
  max_score numeric(6, 2) not null,
  grade_label text not null,
  action_signal text not null,
  recommended_action text,
  display_order int not null default 0,
  check (max_score >= min_score)
);

-- ----------------------------------------------------------------------------
-- 9. RLS — every table scoped by user_id = auth.uid(), no helper functions
--    needed (unlike the aidat module's multi-member sites).
-- ----------------------------------------------------------------------------

alter table public."CS_customers" enable row level security;
alter table public."CS_criteria_weights" enable row level security;
alter table public."CS_risk_class_scores" enable row level security;
alter table public."CS_overdue_days_bands" enable row level security;
alter table public."CS_tenure_bands" enable row level security;
alter table public."CS_payment_habit_scores" enable row level security;
alter table public."CS_strategic_scores" enable row level security;
alter table public."CS_grade_thresholds" enable row level security;

create policy cs_customers_all on public."CS_customers" for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cs_criteria_weights_all on public."CS_criteria_weights" for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cs_risk_class_scores_all on public."CS_risk_class_scores" for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cs_overdue_days_bands_all on public."CS_overdue_days_bands" for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cs_tenure_bands_all on public."CS_tenure_bands" for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cs_payment_habit_scores_all on public."CS_payment_habit_scores" for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cs_strategic_scores_all on public."CS_strategic_scores" for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cs_grade_thresholds_all on public."CS_grade_thresholds" for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
