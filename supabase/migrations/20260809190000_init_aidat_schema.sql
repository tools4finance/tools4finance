-- ============================================================================
-- Site Bütçe Yönetimi / Aidat Modülü — initial schema
-- ============================================================================
-- Scope: multi-tenant (site_id) apartment/site dues, receivables, expense,
-- income, budget and reporting schema for the tools4finance "aidat" module.
--
-- Key design decisions (documented so they don't need to be re-derived):
--
-- 1. Accrual vs collection are separate events (core accounting requirement).
--    `accruals` creates a unit receivable + recognises dues income for the
--    period it belongs to. `payments` records cash received and reduces the
--    unit's balance. Neither table derives its amount from the other.
--
-- 2. `payment_allocations` is a pure REPORTING/matching bridge ("this payment
--    settles that accrual"). It does NOT itself post to the ledger — that
--    would double-count. The ledger (`unit_ledger_entries`) is posted
--    directly and only by the `accruals` and `payments` triggers below.
--    This avoids the trap of trying to keep two independently-triggered
--    ledger postings (accrual + allocation) reconciled with a payment that
--    may be split, partial, or an overpayment.
--
-- 3. Nothing here is hard-deleted once posted. `accruals` and `payments`
--    support a `status` of 'void', and voiding inserts a reversing ledger
--    entry rather than mutating/deleting the original — full audit trail.
--
-- 4. "Aidat Gelirleri" (dues income, incl. additional/special assessments and
--    late-payment penalties) is always unit-specific and therefore always an
--    `accruals` row — never an `incomes` row. `incomes` is reserved for
--    income with no specific debtor unit (common-area rental, parking,
--    social facility, interest, other). This distinction determines which
--    table a euro/TRY lands in and must not be blurred later.
--
-- 5. RLS tenant isolation is centralised in two SECURITY DEFINER helper
--    functions (`has_site_access` / `has_site_write_access`) rather than
--    repeating an EXISTS(...) subquery on every policy — one place to audit,
--    one place to change the authorization model later (e.g. per-table role
--    overrides) without touching 20 policies.
--
-- Rollback: this is the first migration for this project (empty database
-- confirmed via `supabase db query` before writing this file) — rollback is
-- `drop schema public cascade; create schema public;` only if this migration
-- has not yet been pushed. After push, do not hand-roll a rollback; write a
-- new corrective migration instead.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helpers
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. Profiles (mirrors auth.users so the app can show names without needing
--    elevated access to the auth schema)
-- ----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. Sites & membership (tenant root)
-- ----------------------------------------------------------------------------

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_sites_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

create table public.site_members (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin', 'accountant', 'viewer')),
  created_at timestamptz not null default now(),
  unique (site_id, user_id)
);

create index idx_site_members_user on public.site_members(user_id);
create index idx_site_members_site on public.site_members(site_id);

-- SECURITY DEFINER: bypasses RLS internally so the check itself doesn't
-- recurse into the policies that call it.
create or replace function public.has_site_access(p_site_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.site_members
    where site_id = p_site_id and user_id = auth.uid()
  );
$$;

create or replace function public.has_site_write_access(p_site_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.site_members
    where site_id = p_site_id
      and user_id = auth.uid()
      and role in ('owner', 'admin', 'accountant')
  );
$$;

-- Atomic "create a site and become its owner" — direct inserts into `sites`
-- are locked down (see RLS below) specifically so every site is guaranteed
-- to have an owner from the first row onward.
create or replace function public.create_site(p_name text, p_address text default null)
returns public.sites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.sites (name, address, created_by)
  values (p_name, p_address, auth.uid())
  returning * into v_site;

  insert into public.site_members (site_id, user_id, role)
  values (v_site.id, auth.uid(), 'owner');

  return v_site;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Blocks & units
-- ----------------------------------------------------------------------------

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  display_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_blocks_updated_at
  before update on public.blocks
  for each row execute function public.set_updated_at();

create index idx_blocks_site on public.blocks(site_id);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  block_id uuid references public.blocks(id) on delete set null,
  unit_number text not null,
  unit_type text,
  gross_sqm numeric(10, 2),
  net_sqm numeric(10, 2),
  ownership_share numeric(10, 4),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, block_id, unit_number)
);

create trigger trg_units_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

create index idx_units_site on public.units(site_id);
create index idx_units_block on public.units(block_id);

-- ----------------------------------------------------------------------------
-- 4. Residents & occupancy history
--    (occupancy is a historical relationship, not a column on `units`, so
--    resident turnover never erases who was responsible for a past charge)
-- ----------------------------------------------------------------------------

create table public.residents (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_residents_updated_at
  before update on public.residents
  for each row execute function public.set_updated_at();

create index idx_residents_site on public.residents(site_id);

create table public.unit_residents (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  resident_id uuid not null references public.residents(id) on delete cascade,
  relationship_type text not null default 'owner' check (relationship_type in ('owner', 'tenant', 'occupant', 'authorized_contact')),
  is_primary boolean not null default true,
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create index idx_unit_residents_unit on public.unit_residents(unit_id);
create index idx_unit_residents_resident on public.unit_residents(resident_id);
-- Only one active (end_date is null) occupancy per relationship_type slot is
-- NOT enforced here (a unit can have an active owner AND an active tenant
-- simultaneously) — enforcing "no two active owners" is left to the app
-- layer for now; revisit if data quality issues show up.

-- ----------------------------------------------------------------------------
-- 5. Fiscal periods (every financial row is attributable to one of these)
-- ----------------------------------------------------------------------------

create table public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (site_id, year, month)
);

create index idx_fiscal_periods_site on public.fiscal_periods(site_id);

create or replace function public.get_or_create_fiscal_period(p_site_id uuid, p_year int, p_month int)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.fiscal_periods
    where site_id = p_site_id and year = p_year and month = p_month;

  if v_id is null then
    insert into public.fiscal_periods (site_id, year, month)
    values (p_site_id, p_year, p_month)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Dues rules (reference data for future auto-generation of monthly
--    accruals — MVP creates accrual rows directly; this table just avoids a
--    schema redesign when auto-generation is built)
-- ----------------------------------------------------------------------------

create table public.dues_rules (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  unit_id uuid references public.units(id) on delete cascade, -- null = site default
  name text not null default 'Aidat',
  amount numeric(14, 2) not null check (amount >= 0),
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index idx_dues_rules_site on public.dues_rules(site_id);
create index idx_dues_rules_unit on public.dues_rules(unit_id);

-- ----------------------------------------------------------------------------
-- 7. Accruals (dues income + unit receivable — always unit-specific)
-- ----------------------------------------------------------------------------

create table public.accruals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete restrict,
  fiscal_period_id uuid not null references public.fiscal_periods(id) on delete restrict,
  accrual_type text not null default 'monthly_dues' check (
    accrual_type in ('monthly_dues', 'additional_dues', 'special_assessment', 'penalty', 'other')
  ),
  description text,
  amount numeric(14, 2) not null check (amount >= 0),
  accrual_date date not null default current_date,
  due_date date,
  status text not null default 'active' check (status in ('active', 'void')),
  voided_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_accruals_site on public.accruals(site_id);
create index idx_accruals_unit on public.accruals(unit_id);
create index idx_accruals_period on public.accruals(fiscal_period_id);
create index idx_accruals_due_date on public.accruals(due_date);

-- Prevent duplicate monthly dues accrual for the same unit/period.
create unique index uq_accruals_monthly_dues
  on public.accruals(unit_id, fiscal_period_id)
  where accrual_type = 'monthly_dues' and status = 'active';

-- ----------------------------------------------------------------------------
-- 8. Payments & allocations
--    payment_allocations is a matching/reporting bridge only — see file
--    header note #2. It never posts to the ledger itself.
-- ----------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete restrict,
  resident_id uuid references public.residents(id) on delete set null,
  payment_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null default 'bank' check (method in ('bank', 'cash', 'credit_card', 'other')),
  description text,
  status text not null default 'active' check (status in ('active', 'void')),
  voided_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_payments_site on public.payments(site_id);
create index idx_payments_unit on public.payments(unit_id);
create index idx_payments_date on public.payments(payment_date);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  accrual_id uuid not null references public.accruals(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index idx_payment_allocations_payment on public.payment_allocations(payment_id);
create index idx_payment_allocations_accrual on public.payment_allocations(accrual_id);

create or replace function public.check_payment_allocation_totals()
returns trigger
language plpgsql
as $$
declare
  v_payment_amount numeric(14, 2);
  v_allocated_total numeric(14, 2);
  v_accrual_amount numeric(14, 2);
  v_accrual_allocated numeric(14, 2);
begin
  select amount into v_payment_amount from public.payments where id = new.payment_id;
  select coalesce(sum(amount), 0) into v_allocated_total
    from public.payment_allocations where payment_id = new.payment_id;
  if v_allocated_total > v_payment_amount then
    raise exception 'payment_allocations: allocated total (%) exceeds payment amount (%) for payment %',
      v_allocated_total, v_payment_amount, new.payment_id;
  end if;

  select amount into v_accrual_amount from public.accruals where id = new.accrual_id;
  select coalesce(sum(amount), 0) into v_accrual_allocated
    from public.payment_allocations where accrual_id = new.accrual_id;
  if v_accrual_allocated > v_accrual_amount then
    raise exception 'payment_allocations: allocated total (%) exceeds accrual amount (%) for accrual %',
      v_accrual_allocated, v_accrual_amount, new.accrual_id;
  end if;

  return new;
end;
$$;

create trigger trg_check_payment_allocation_totals
  after insert or update on public.payment_allocations
  for each row execute function public.check_payment_allocation_totals();

-- ----------------------------------------------------------------------------
-- 9. Unit ledger (the current-account / cari hesap source of truth)
--    Populated only by the accrual/payment triggers below — never written
--    to directly except for 'adjustment' / 'opening_balance' rows, which the
--    app inserts explicitly through the normal RLS-checked insert path.
--    Sign convention: positive = charge (increases what the unit owes),
--    negative = credit (payment, reduces what the unit owes).
-- ----------------------------------------------------------------------------

create table public.unit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete restrict,
  entry_date date not null default current_date,
  entry_type text not null check (entry_type in ('accrual', 'payment', 'adjustment', 'opening_balance')),
  amount numeric(14, 2) not null,
  reference_table text,
  reference_id uuid,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_unit_ledger_site on public.unit_ledger_entries(site_id);
create index idx_unit_ledger_unit on public.unit_ledger_entries(unit_id);
create index idx_unit_ledger_date on public.unit_ledger_entries(entry_date);

create or replace function public.post_accrual_ledger_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    insert into public.unit_ledger_entries
      (site_id, unit_id, entry_date, entry_type, amount, reference_table, reference_id, description, created_by)
    values
      (new.site_id, new.unit_id, new.accrual_date, 'accrual', new.amount, 'accruals', new.id,
       coalesce(new.description, new.accrual_type), new.created_by);

  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status = 'void' then
    insert into public.unit_ledger_entries
      (site_id, unit_id, entry_date, entry_type, amount, reference_table, reference_id, description, created_by)
    values
      (new.site_id, new.unit_id, current_date, 'accrual', -new.amount, 'accruals', new.id,
       'Void: ' || coalesce(new.voided_reason, new.description, new.accrual_type), new.created_by);
  end if;

  return new;
end;
$$;

create trigger trg_post_accrual_ledger_entry
  after insert or update on public.accruals
  for each row execute function public.post_accrual_ledger_entry();

create or replace function public.post_payment_ledger_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    insert into public.unit_ledger_entries
      (site_id, unit_id, entry_date, entry_type, amount, reference_table, reference_id, description, created_by)
    values
      (new.site_id, new.unit_id, new.payment_date, 'payment', -new.amount, 'payments', new.id,
       coalesce(new.description, initcap(new.method) || ' payment'), new.created_by);

  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status = 'void' then
    insert into public.unit_ledger_entries
      (site_id, unit_id, entry_date, entry_type, amount, reference_table, reference_id, description, created_by)
    values
      (new.site_id, new.unit_id, current_date, 'payment', new.amount, 'payments', new.id,
       'Void: ' || coalesce(new.voided_reason, new.description, 'payment'), new.created_by);
  end if;

  return new;
end;
$$;

create trigger trg_post_payment_ledger_entry
  after insert or update on public.payments
  for each row execute function public.post_payment_ledger_entry();

create view public.v_unit_balances as
select
  unit_id,
  site_id,
  sum(amount) as balance
from public.unit_ledger_entries
group by unit_id, site_id;

-- ----------------------------------------------------------------------------
-- 10. Vendors, expense master data + expenses
-- ----------------------------------------------------------------------------

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  tax_no text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_vendors_site on public.vendors(site_id);

-- Global reference catalog (shared chart of expense accounts), not
-- per-site — sites choose from it rather than each maintaining their own
-- copy. Revisit if a site ever needs a genuinely custom account.
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  main_segment text not null,
  sub_segment text not null,
  name text not null,
  opex_capex text not null default 'OPEX' check (opex_capex in ('OPEX', 'CAPEX')),
  display_order int not null default 0,
  active boolean not null default true,
  unique (main_segment, sub_segment, name)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  expense_category_id uuid not null references public.expense_categories(id) on delete restrict,
  fiscal_period_id uuid not null references public.fiscal_periods(id) on delete restrict,
  vendor_id uuid references public.vendors(id) on delete set null,
  expense_date date not null default current_date,
  amount numeric(14, 2) not null check (amount >= 0),
  description text,
  payment_method text check (payment_method in ('bank', 'cash', 'credit_card', 'other')),
  invoice_no text,
  status text not null default 'active' check (status in ('active', 'void')),
  voided_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_expenses_site on public.expenses(site_id);
create index idx_expenses_period on public.expenses(fiscal_period_id);
create index idx_expenses_category on public.expenses(expense_category_id);
create index idx_expenses_date on public.expenses(expense_date);

-- ----------------------------------------------------------------------------
-- 11. Income master data + incomes (non-unit-specific income only — see
--     file header note #4 for why dues-type income never lands here)
-- ----------------------------------------------------------------------------

create table public.income_categories (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  name text not null,
  display_order int not null default 0,
  active boolean not null default true,
  unique (group_name, name)
);

create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  income_category_id uuid not null references public.income_categories(id) on delete restrict,
  fiscal_period_id uuid not null references public.fiscal_periods(id) on delete restrict,
  income_date date not null default current_date,
  amount numeric(14, 2) not null check (amount >= 0),
  description text,
  status text not null default 'active' check (status in ('active', 'void')),
  voided_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_incomes_site on public.incomes(site_id);
create index idx_incomes_period on public.incomes(fiscal_period_id);
create index idx_incomes_category on public.incomes(income_category_id);

-- ----------------------------------------------------------------------------
-- 12. Budget lines (budget is never a transaction — kept fully separate
--     from actuals; "actual" is always derived by querying accruals /
--     expenses / incomes for the same period)
-- ----------------------------------------------------------------------------

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  fiscal_period_id uuid not null references public.fiscal_periods(id) on delete cascade,
  category_type text not null check (category_type in ('expense', 'income')),
  expense_category_id uuid references public.expense_categories(id) on delete cascade,
  income_category_id uuid references public.income_categories(id) on delete cascade,
  budget_amount numeric(14, 2) not null check (budget_amount >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (
    (category_type = 'expense' and expense_category_id is not null and income_category_id is null) or
    (category_type = 'income' and income_category_id is not null and expense_category_id is null)
  )
);

create unique index uq_budget_lines_expense
  on public.budget_lines(site_id, fiscal_period_id, expense_category_id)
  where category_type = 'expense';
create unique index uq_budget_lines_income
  on public.budget_lines(site_id, fiscal_period_id, income_category_id)
  where category_type = 'income';

-- ----------------------------------------------------------------------------
-- 13. Attachments (empty for MVP — invoice/PDF upload is a later phase, but
--     the table exists now so expenses/statements can reference it without
--     another schema migration)
-- ----------------------------------------------------------------------------

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  entity_table text not null,
  entity_id uuid not null,
  file_path text not null,
  file_name text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_attachments_entity on public.attachments(entity_table, entity_id);

-- ----------------------------------------------------------------------------
-- 14. Audit log (generic — who/when for the financially sensitive tables)
-- ----------------------------------------------------------------------------

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);

create index idx_audit_logs_table_record on public.audit_logs(table_name, record_id);
create index idx_audit_logs_site on public.audit_logs(site_id);

create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id uuid;
begin
  begin
    v_site_id := coalesce(
      case when tg_op = 'DELETE' then old.site_id else new.site_id end,
      null
    );
  exception when undefined_column then
    v_site_id := null;
  end;

  insert into public.audit_logs (site_id, table_name, record_id, action, changed_by, old_data, new_data)
  values (
    v_site_id,
    tg_table_name,
    coalesce(case when tg_op = 'DELETE' then old.id else new.id end, gen_random_uuid()),
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

create trigger trg_audit_accruals after insert or update or delete on public.accruals
  for each row execute function public.audit_trigger_fn();
create trigger trg_audit_payments after insert or update or delete on public.payments
  for each row execute function public.audit_trigger_fn();
create trigger trg_audit_expenses after insert or update or delete on public.expenses
  for each row execute function public.audit_trigger_fn();
create trigger trg_audit_incomes after insert or update or delete on public.incomes
  for each row execute function public.audit_trigger_fn();
create trigger trg_audit_budget_lines after insert or update or delete on public.budget_lines
  for each row execute function public.audit_trigger_fn();

-- ----------------------------------------------------------------------------
-- 15. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.site_members enable row level security;
alter table public.blocks enable row level security;
alter table public.units enable row level security;
alter table public.residents enable row level security;
alter table public.unit_residents enable row level security;
alter table public.fiscal_periods enable row level security;
alter table public.dues_rules enable row level security;
alter table public.accruals enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.unit_ledger_entries enable row level security;
alter table public.vendors enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.income_categories enable row level security;
alter table public.incomes enable row level security;
alter table public.budget_lines enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: users can see/update only their own row.
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid());

-- sites: visible to members; direct insert is blocked (use create_site RPC)
-- so every site always has an owner row from creation.
create policy sites_select on public.sites for select to authenticated
  using (public.has_site_access(id));
create policy sites_update on public.sites for update to authenticated
  using (public.has_site_write_access(id));
-- (no insert/delete policy on sites: default-deny; use create_site())

-- site_members: members can see the roster of their own sites; only
-- owner/admin can manage membership.
create policy site_members_select on public.site_members for select to authenticated
  using (public.has_site_access(site_id));
create policy site_members_insert on public.site_members for insert to authenticated
  with check (public.has_site_write_access(site_id));
create policy site_members_update on public.site_members for update to authenticated
  using (public.has_site_write_access(site_id));
create policy site_members_delete on public.site_members for delete to authenticated
  using (public.has_site_write_access(site_id));

-- Generic tenant-isolation policy shape, applied per table below:
--   SELECT: any site member
--   INSERT/UPDATE/DELETE: owner/admin/accountant (not viewer)

create policy blocks_select on public.blocks for select to authenticated using (public.has_site_access(site_id));
create policy blocks_write_ins on public.blocks for insert to authenticated with check (public.has_site_write_access(site_id));
create policy blocks_write_upd on public.blocks for update to authenticated using (public.has_site_write_access(site_id));
create policy blocks_write_del on public.blocks for delete to authenticated using (public.has_site_write_access(site_id));

create policy units_select on public.units for select to authenticated using (public.has_site_access(site_id));
create policy units_write_ins on public.units for insert to authenticated with check (public.has_site_write_access(site_id));
create policy units_write_upd on public.units for update to authenticated using (public.has_site_write_access(site_id));
create policy units_write_del on public.units for delete to authenticated using (public.has_site_write_access(site_id));

create policy residents_select on public.residents for select to authenticated using (public.has_site_access(site_id));
create policy residents_write_ins on public.residents for insert to authenticated with check (public.has_site_write_access(site_id));
create policy residents_write_upd on public.residents for update to authenticated using (public.has_site_write_access(site_id));
create policy residents_write_del on public.residents for delete to authenticated using (public.has_site_write_access(site_id));

create policy unit_residents_select on public.unit_residents for select to authenticated
  using (exists (select 1 from public.units u where u.id = unit_residents.unit_id and public.has_site_access(u.site_id)));
create policy unit_residents_write_ins on public.unit_residents for insert to authenticated
  with check (exists (select 1 from public.units u where u.id = unit_residents.unit_id and public.has_site_write_access(u.site_id)));
create policy unit_residents_write_upd on public.unit_residents for update to authenticated
  using (exists (select 1 from public.units u where u.id = unit_residents.unit_id and public.has_site_write_access(u.site_id)));
create policy unit_residents_write_del on public.unit_residents for delete to authenticated
  using (exists (select 1 from public.units u where u.id = unit_residents.unit_id and public.has_site_write_access(u.site_id)));

create policy fiscal_periods_select on public.fiscal_periods for select to authenticated using (public.has_site_access(site_id));
create policy fiscal_periods_write_ins on public.fiscal_periods for insert to authenticated with check (public.has_site_write_access(site_id));
create policy fiscal_periods_write_upd on public.fiscal_periods for update to authenticated using (public.has_site_write_access(site_id));

create policy dues_rules_select on public.dues_rules for select to authenticated using (public.has_site_access(site_id));
create policy dues_rules_write_ins on public.dues_rules for insert to authenticated with check (public.has_site_write_access(site_id));
create policy dues_rules_write_upd on public.dues_rules for update to authenticated using (public.has_site_write_access(site_id));
create policy dues_rules_write_del on public.dues_rules for delete to authenticated using (public.has_site_write_access(site_id));

create policy accruals_select on public.accruals for select to authenticated using (public.has_site_access(site_id));
create policy accruals_write_ins on public.accruals for insert to authenticated with check (public.has_site_write_access(site_id));
create policy accruals_write_upd on public.accruals for update to authenticated using (public.has_site_write_access(site_id));

create policy payments_select on public.payments for select to authenticated using (public.has_site_access(site_id));
create policy payments_write_ins on public.payments for insert to authenticated with check (public.has_site_write_access(site_id));
create policy payments_write_upd on public.payments for update to authenticated using (public.has_site_write_access(site_id));

create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_allocations.payment_id and public.has_site_access(p.site_id)));
create policy payment_allocations_write_ins on public.payment_allocations for insert to authenticated
  with check (exists (select 1 from public.payments p where p.id = payment_allocations.payment_id and public.has_site_write_access(p.site_id)));
create policy payment_allocations_write_del on public.payment_allocations for delete to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_allocations.payment_id and public.has_site_write_access(p.site_id)));

create policy unit_ledger_entries_select on public.unit_ledger_entries for select to authenticated using (public.has_site_access(site_id));
-- inserts normally happen only via the accrual/payment triggers (security
-- definer, bypass RLS); this policy only covers the app inserting manual
-- 'adjustment' / 'opening_balance' rows directly.
create policy unit_ledger_entries_write_ins on public.unit_ledger_entries for insert to authenticated
  with check (public.has_site_write_access(site_id) and entry_type in ('adjustment', 'opening_balance'));

create policy vendors_select on public.vendors for select to authenticated using (public.has_site_access(site_id));
create policy vendors_write_ins on public.vendors for insert to authenticated with check (public.has_site_write_access(site_id));
create policy vendors_write_upd on public.vendors for update to authenticated using (public.has_site_write_access(site_id));
create policy vendors_write_del on public.vendors for delete to authenticated using (public.has_site_write_access(site_id));

-- expense/income categories are a shared global catalog: readable by any
-- authenticated user, writable by no one through the API (maintained via
-- migration/seed only).
create policy expense_categories_select on public.expense_categories for select to authenticated using (true);
create policy income_categories_select on public.income_categories for select to authenticated using (true);

create policy expenses_select on public.expenses for select to authenticated using (public.has_site_access(site_id));
create policy expenses_write_ins on public.expenses for insert to authenticated with check (public.has_site_write_access(site_id));
create policy expenses_write_upd on public.expenses for update to authenticated using (public.has_site_write_access(site_id));

create policy incomes_select on public.incomes for select to authenticated using (public.has_site_access(site_id));
create policy incomes_write_ins on public.incomes for insert to authenticated with check (public.has_site_write_access(site_id));
create policy incomes_write_upd on public.incomes for update to authenticated using (public.has_site_write_access(site_id));

create policy budget_lines_select on public.budget_lines for select to authenticated using (public.has_site_access(site_id));
create policy budget_lines_write_ins on public.budget_lines for insert to authenticated with check (public.has_site_write_access(site_id));
create policy budget_lines_write_upd on public.budget_lines for update to authenticated using (public.has_site_write_access(site_id));
create policy budget_lines_write_del on public.budget_lines for delete to authenticated using (public.has_site_write_access(site_id));

create policy attachments_select on public.attachments for select to authenticated using (public.has_site_access(site_id));
create policy attachments_write_ins on public.attachments for insert to authenticated with check (public.has_site_write_access(site_id));
create policy attachments_write_del on public.attachments for delete to authenticated using (public.has_site_write_access(site_id));

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (site_id is not null and public.has_site_access(site_id));

-- ----------------------------------------------------------------------------
-- 16. Seed: expense chart of accounts (idempotent — safe to re-run)
-- ----------------------------------------------------------------------------

insert into public.expense_categories (main_segment, sub_segment, name, opex_capex, display_order) values
('1. Bina Bakım Giderleri','Asansör','Asansör periyodik bakım','OPEX',10),
('1. Bina Bakım Giderleri','Asansör','Asansör arıza / parça değişimi','OPEX',11),
('1. Bina Bakım Giderleri','Asansör','Asansör yıllık kontrol gideri','OPEX',12),
('1. Bina Bakım Giderleri','Elektrik Sistemleri','Ortak alan elektrik tesisatı bakımı','OPEX',13),
('1. Bina Bakım Giderleri','Elektrik Sistemleri','Pano / sigorta / kontaktör giderleri','OPEX',14),
('1. Bina Bakım Giderleri','Elektrik Sistemleri','Aydınlatma armatürü ve ampul giderleri','OPEX',15),
('1. Bina Bakım Giderleri','Sıhhi Tesisat','Su tesisatı bakım ve onarım','OPEX',16),
('1. Bina Bakım Giderleri','Sıhhi Tesisat','Hidrofor bakım gideri','OPEX',17),
('1. Bina Bakım Giderleri','Sıhhi Tesisat','Su deposu bakım / temizliği','OPEX',18),
('1. Bina Bakım Giderleri','Sıhhi Tesisat','Pompa bakım ve değişimleri','OPEX',19),
('1. Bina Bakım Giderleri','Isıtma / Soğutma','Merkezi kazan bakım gideri','OPEX',20),
('1. Bina Bakım Giderleri','Isıtma / Soğutma','Kombi / kazan yakıcı bakım','OPEX',21),
('1. Bina Bakım Giderleri','Isıtma / Soğutma','Klima / havalandırma bakım gideri','OPEX',22),
('1. Bina Bakım Giderleri','Yangın Sistemleri','Yangın tüpü dolum / bakım','OPEX',23),
('1. Bina Bakım Giderleri','Yangın Sistemleri','Yangın alarm sistemi bakımı','OPEX',24),
('1. Bina Bakım Giderleri','Yangın Sistemleri','Yangın pompası / sprinkler bakımı','OPEX',25),
('1. Bina Bakım Giderleri','Fiziki Bina','Çatı bakım ve onarımı','OPEX',26),
('1. Bina Bakım Giderleri','Fiziki Bina','Dış cephe bakım ve onarımı','OPEX',27),
('1. Bina Bakım Giderleri','Fiziki Bina','Boya / badana','OPEX',28),
('1. Bina Bakım Giderleri','Fiziki Bina','Kapı / pencere / doğrama tamiri','OPEX',29),
('1. Bina Bakım Giderleri','Fiziki Bina','Otopark kapısı bakım gideri','OPEX',30),

('2. Site Bakım Giderleri','Bahçe','Bahçe sulama giderleri','OPEX',40),
('2. Site Bakım Giderleri','Bahçe','Bahçıvanlık hizmeti','OPEX',41),
('2. Site Bakım Giderleri','Bahçe','Gübre giderleri','OPEX',42),
('2. Site Bakım Giderleri','Bahçe','İlaçlama giderleri','OPEX',43),
('2. Site Bakım Giderleri','Bahçe','Bitki / çiçek / ağaç alımları','OPEX',44),
('2. Site Bakım Giderleri','Bahçe','Çim bakım / biçme giderleri','OPEX',45),
('2. Site Bakım Giderleri','Peyzaj','Peyzaj bakım giderleri','OPEX',46),
('2. Site Bakım Giderleri','Peyzaj','Peyzaj yenileme giderleri','OPEX',47),
('2. Site Bakım Giderleri','Ortak Alanlar','Yürüyüş yolu bakım giderleri','OPEX',48),
('2. Site Bakım Giderleri','Ortak Alanlar','Site içi yol bakım giderleri','OPEX',49),
('2. Site Bakım Giderleri','Ortak Alanlar','Kaldırım / bordür bakım giderleri','OPEX',50),
('2. Site Bakım Giderleri','Ortak Alanlar','Site içi tabela / yönlendirme giderleri','OPEX',51),
('2. Site Bakım Giderleri','Çocuk / Spor Alanları','Çocuk parkı bakım giderleri','OPEX',52),
('2. Site Bakım Giderleri','Çocuk / Spor Alanları','Spor sahası bakım giderleri','OPEX',53),
('2. Site Bakım Giderleri','Çocuk / Spor Alanları','Fitness ekipmanı bakım giderleri','OPEX',54),
('2. Site Bakım Giderleri','Havuz','Havuz bakım giderleri','OPEX',55),
('2. Site Bakım Giderleri','Havuz','Havuz kimyasalları','OPEX',56),
('2. Site Bakım Giderleri','Havuz','Havuz pompa / filtre giderleri','OPEX',57),
('2. Site Bakım Giderleri','Havuz','Havuz sezon açılış / kapanış giderleri','OPEX',58),

('3. Temizlik Giderleri','Temizlik Hizmeti','Temizlik personeli / taşeron hizmeti','OPEX',70),
('3. Temizlik Giderleri','Malzeme','Deterjan ve temizlik malzemeleri','OPEX',71),
('3. Temizlik Giderleri','Malzeme','Çöp torbası / sarf malzemeleri','OPEX',72),
('3. Temizlik Giderleri','Ortak Alan','Merdiven temizliği','OPEX',73),
('3. Temizlik Giderleri','Ortak Alan','Otopark temizliği','OPEX',74),
('3. Temizlik Giderleri','Ortak Alan','Cam temizliği','OPEX',75),
('3. Temizlik Giderleri','Ortak Alan','Dış alan temizliği','OPEX',76),
('3. Temizlik Giderleri','Atık','Çöp toplama / atık giderleri','OPEX',77),
('3. Temizlik Giderleri','Atık','Konteyner bakım / temizlik','OPEX',78),

('4. Güvenlik Giderleri','Personel','Güvenlik personeli giderleri','OPEX',90),
('4. Güvenlik Giderleri','Hizmet','Özel güvenlik şirketi hizmet bedeli','OPEX',91),
('4. Güvenlik Giderleri','Kamera','CCTV bakım giderleri','OPEX',92),
('4. Güvenlik Giderleri','Kamera','Kamera / kayıt cihazı değişimleri','OPEX',93),
('4. Güvenlik Giderleri','Geçiş Sistemleri','Bariyer bakım giderleri','OPEX',94),
('4. Güvenlik Giderleri','Geçiş Sistemleri','Kartlı geçiş sistemi','OPEX',95),
('4. Güvenlik Giderleri','Geçiş Sistemleri','Plaka tanıma sistemi','OPEX',96),
('4. Güvenlik Giderleri','Haberleşme','Güvenlik telsizi / telefon giderleri','OPEX',97),

('5. Personel Giderleri','Maaşlar','Yönetici / müdür maaşı','OPEX',110),
('5. Personel Giderleri','Maaşlar','Kapıcı / görevli maaşı','OPEX',111),
('5. Personel Giderleri','Maaşlar','Teknik personel maaşı','OPEX',112),
('5. Personel Giderleri','Maaşlar','Bahçıvan maaşı','OPEX',113),
('5. Personel Giderleri','Maaşlar','Temizlik personeli maaşı','OPEX',114),
('5. Personel Giderleri','Maaşlar','Güvenlik personeli maaşı','OPEX',115),
('5. Personel Giderleri','Yan Haklar','Yemek giderleri','OPEX',116),
('5. Personel Giderleri','Yan Haklar','Yol giderleri','OPEX',117),
('5. Personel Giderleri','Yan Haklar','Özel sağlık / yan haklar','OPEX',118),
('5. Personel Giderleri','SGK / Vergi','SGK işveren giderleri','OPEX',119),
('5. Personel Giderleri','SGK / Vergi','Vergi / bordro giderleri','OPEX',120),
('5. Personel Giderleri','Diğer','Kıdem / ihbar giderleri','OPEX',121),
('5. Personel Giderleri','Diğer','Fazla mesai','OPEX',122),

('6. Enerji ve Utility Giderleri','Elektrik','Ortak alan elektrik giderleri','OPEX',130),
('6. Enerji ve Utility Giderleri','Elektrik','Otopark elektrik giderleri','OPEX',131),
('6. Enerji ve Utility Giderleri','Elektrik','Bahçe / çevre aydınlatma elektriği','OPEX',132),
('6. Enerji ve Utility Giderleri','Elektrik','Asansör elektrik giderleri','OPEX',133),
('6. Enerji ve Utility Giderleri','Su','Ortak alan su giderleri','OPEX',134),
('6. Enerji ve Utility Giderleri','Su','Bahçe sulama suyu','OPEX',135),
('6. Enerji ve Utility Giderleri','Su','Havuz su giderleri','OPEX',136),
('6. Enerji ve Utility Giderleri','Doğalgaz','Merkezi ısıtma doğalgaz giderleri','OPEX',137),
('6. Enerji ve Utility Giderleri','Yakıt','Jeneratör yakıt giderleri','OPEX',138),

('7. Teknik Sistem Giderleri','Jeneratör','Jeneratör bakım giderleri','OPEX',150),
('7. Teknik Sistem Giderleri','Jeneratör','Akü / parça giderleri','OPEX',151),
('7. Teknik Sistem Giderleri','Hidrofor','Hidrofor bakım giderleri','OPEX',152),
('7. Teknik Sistem Giderleri','Uydu / TV','Merkezi uydu sistemi giderleri','OPEX',153),
('7. Teknik Sistem Giderleri','İnternet','Ortak alan internet giderleri','OPEX',154),
('7. Teknik Sistem Giderleri','Interkom','Diafon / interkom bakım giderleri','OPEX',155),

('8. Yönetim Giderleri','Yönetim Hizmeti','Profesyonel site yönetim şirketi ücreti','OPEX',170),
('8. Yönetim Giderleri','Muhasebe','Muhasebe hizmet giderleri','OPEX',171),
('8. Yönetim Giderleri','Denetim','Bağımsız denetim / mali müşavir','OPEX',172),
('8. Yönetim Giderleri','Hukuk','Avukat / hukuki danışmanlık','OPEX',173),
('8. Yönetim Giderleri','Banka','Banka masrafları','OPEX',174),
('8. Yönetim Giderleri','Banka','POS / tahsilat komisyonları','OPEX',175),
('8. Yönetim Giderleri','Ofis','Kırtasiye giderleri','OPEX',176),
('8. Yönetim Giderleri','Ofis','Yazıcı / toner','OPEX',177),
('8. Yönetim Giderleri','Ofis','Posta / kargo','OPEX',178),
('8. Yönetim Giderleri','Yazılım','Site yönetim yazılımı','OPEX',179),
('8. Yönetim Giderleri','Yazılım','Muhasebe yazılımı','OPEX',180),

('9. Sigorta ve Yasal Giderler','Sigorta','Bina sigortası','OPEX',190),
('9. Sigorta ve Yasal Giderler','Sigorta','Ortak alan sigortaları','OPEX',191),
('9. Sigorta ve Yasal Giderler','Sigorta','İşveren sorumluluk sigortası','OPEX',192),
('9. Sigorta ve Yasal Giderler','Ruhsat / Kontrol','Asansör kontrol / ruhsat gideri','OPEX',193),
('9. Sigorta ve Yasal Giderler','Ruhsat / Kontrol','Belediye izin / ruhsat giderleri','OPEX',194),
('9. Sigorta ve Yasal Giderler','Vergi / Harç','Damga vergisi','OPEX',195),
('9. Sigorta ve Yasal Giderler','Vergi / Harç','Belediye harçları','OPEX',196),

('10. İlaçlama ve Çevre Giderleri','Haşere','Böcek / haşere ilaçlama','OPEX',210),
('10. İlaçlama ve Çevre Giderleri','Kemirgen','Fare ilaçlama','OPEX',211),
('10. İlaçlama ve Çevre Giderleri','Dezenfeksiyon','Ortak alan dezenfeksiyon','OPEX',212),

('11. Sosyal Alan Giderleri','Sosyal Tesis','Sosyal tesis bakım gideri','OPEX',220),
('11. Sosyal Alan Giderleri','Spor','Spor salonu ekipman bakım','OPEX',221),
('11. Sosyal Alan Giderleri','Sauna / Hamam','Sauna / hamam bakım giderleri','OPEX',222),
('11. Sosyal Alan Giderleri','Organizasyon','Site etkinlik giderleri','OPEX',223),

('12. Otopark Giderleri','Bakım','Otopark zemin bakım','OPEX',230),
('12. Otopark Giderleri','Bakım','Otopark çizgi / boya gideri','OPEX',231),
('12. Otopark Giderleri','Sistemler','Bariyer ve plaka tanıma','OPEX',232),
('12. Otopark Giderleri','Havalandırma','Otopark fan / havalandırma bakım','OPEX',233),

('13. Küçük Demirbaş ve Sarf','Demirbaş','El aletleri','OPEX',240),
('13. Küçük Demirbaş ve Sarf','Demirbaş','Temizlik ekipmanları','OPEX',241),
('13. Küçük Demirbaş ve Sarf','Demirbaş','Bahçe ekipmanları','OPEX',242),
('13. Küçük Demirbaş ve Sarf','Sarf','Ampul / pil / vida vb.','OPEX',243),

('14. Beklenmeyen / Diğer Giderler','Acil Müdahale','Su baskını müdahalesi','OPEX',250),
('14. Beklenmeyen / Diğer Giderler','Acil Müdahale','Fırtına / doğal afet onarımları','OPEX',251),
('14. Beklenmeyen / Diğer Giderler','Diğer','Tanımlanmamış diğer giderler','OPEX',252),

('15. Yatırım / Büyük Onarım (CAPEX)','Bina','Çatı yenileme','CAPEX',260),
('15. Yatırım / Büyük Onarım (CAPEX)','Bina','Dış cephe yenileme','CAPEX',261),
('15. Yatırım / Büyük Onarım (CAPEX)','Teknik','Asansör komple yenileme','CAPEX',262),
('15. Yatırım / Büyük Onarım (CAPEX)','Teknik','Jeneratör alımı','CAPEX',263),
('15. Yatırım / Büyük Onarım (CAPEX)','Teknik','Hidrofor değişimi','CAPEX',264),
('15. Yatırım / Büyük Onarım (CAPEX)','Güvenlik','Yeni kamera sistemi','CAPEX',265),
('15. Yatırım / Büyük Onarım (CAPEX)','Sosyal Alan','Havuz renovasyonu','CAPEX',266),
('15. Yatırım / Büyük Onarım (CAPEX)','Sosyal Alan','Çocuk parkı yenileme','CAPEX',267),
('15. Yatırım / Büyük Onarım (CAPEX)','Enerji','Güneş paneli yatırımı','CAPEX',268),
('15. Yatırım / Büyük Onarım (CAPEX)','Enerji','LED dönüşüm projesi','CAPEX',269)
on conflict (main_segment, sub_segment, name) do nothing;

-- ----------------------------------------------------------------------------
-- 17. Seed: income chart of accounts (idempotent).
--     "Aidat Gelirleri" / "Ek Aidat" / "Gecikme Gelirleri" are deliberately
--     NOT seeded here — see file header note #4. They are accrual types.
-- ----------------------------------------------------------------------------

insert into public.income_categories (group_name, name, display_order) values
('Ortak Alan Gelirleri','Ortak alan kira geliri',10),
('Ortak Alan Gelirleri','Reklam alanı geliri',11),
('Ortak Alan Gelirleri','Baz istasyonu / anten kira geliri',12),
('Otopark Gelirleri','Otopark kullanım gelirleri',20),
('Sosyal Tesis Gelirleri','Havuz / spor tesisi vb. gelirler',30),
('Finansal Gelirler','Mevduat faiz geliri',40),
('Diğer Gelirler','Anahtar / kart / kumanda gelirleri',50),
('Diğer Gelirler','Hurda satış gelirleri',51),
('Diğer Gelirler','Diğer gelirler',52)
on conflict (group_name, name) do nothing;
