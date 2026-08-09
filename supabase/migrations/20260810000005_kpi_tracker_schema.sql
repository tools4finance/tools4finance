-- ============================================================================
-- KPI Tracker module (KPI_ prefix)
-- ============================================================================
-- A simple standard performance-management system: HR admin creates an org,
-- departments and people (invited by email, auto-claimed on first login),
-- opens a yearly period with a Company/Individual weight split (default
-- 40/60), defines company-wide goals, announces the period (fan-out
-- notification), employees enter their own weighted individual goals,
-- everyone rates/comments their own goals, HR rates/comments as manager and
-- fills the shared company-goal achievement, and a final weighted score is
-- computed (see lib/kpiScoring.ts for the pure formula).
--
-- Design notes:
-- 1. Multi-member tenancy modeled like the aidat module (site_members ->
--    KPI_members), NOT like the single-owner CS_ module — an org has many
--    members with different roles. org_id is denormalized onto every child
--    table (not just period_id) so every RLS policy is a single indexed
--    lookup, matching the aidat convention of carrying site_id everywhere.
-- 2. No real invite/workflow engine (explicitly out of scope per product
--    owner) — "invites" are just KPI_members rows with user_id=null; any
--    authenticated user auto-claims a matching row by email via the
--    kpi_claim_membership() RPC (same SECURITY DEFINER rationale as
--    find_profile_by_email in 20260810000002).
-- 3. Field-level ownership (employees own self_rating/self_comment, HR owns
--    manager_rating/manager_comment on individual goals; HR owns all of
--    company goals) is enforced with a BEFORE INSERT/UPDATE trigger on
--    KPI_individual_goals, not just the UI — Postgres RLS can't do
--    column-level checks, so a trigger resets any field a non-HR caller
--    tries to change outside their lane. Company goals need no such trigger
--    because employees simply have no write policy on that table at all.
-- 4. Notifications are DB-generated only (period announce/close RPCs, and an
--    AFTER UPDATE trigger when HR changes a manager rating/comment) — there
--    is no direct client insert policy on KPI_notifications, so only the
--    SECURITY DEFINER paths above can create one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Organizations, departments, members
-- ----------------------------------------------------------------------------

create table public."KPI_organizations" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_kpi_organizations_updated_at
  before update on public."KPI_organizations"
  for each row execute function public.set_updated_at();

create table public."KPI_departments" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public."KPI_organizations"(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create index idx_kpi_departments_org on public."KPI_departments"(org_id);

create table public."KPI_members" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public."KPI_organizations"(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  department_id uuid references public."KPI_departments"(id) on delete set null,
  role text not null default 'employee' check (role in ('hr_admin', 'employee')),
  invite_status text not null default 'pending' check (invite_status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email)
);

create trigger trg_kpi_members_updated_at
  before update on public."KPI_members"
  for each row execute function public.set_updated_at();

create index idx_kpi_members_org on public."KPI_members"(org_id);
create index idx_kpi_members_user on public."KPI_members"(user_id);

-- ----------------------------------------------------------------------------
-- 2. RLS helpers (SECURITY DEFINER — bypass RLS internally so the check
--    itself doesn't recurse into the policies that call it; same shape as
--    has_site_access/has_site_write_access in the aidat init migration).
-- ----------------------------------------------------------------------------

create or replace function public.has_kpi_org_access(p_org_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public."KPI_members"
    where org_id = p_org_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_kpi_hr_admin(p_org_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public."KPI_members"
    where org_id = p_org_id and user_id = auth.uid() and role = 'hr_admin'
  );
$$;

create or replace function public.is_kpi_member_self(p_member_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public."KPI_members"
    where id = p_member_id and user_id = auth.uid()
  );
$$;

-- Atomic "create an org and become its HR admin" — direct inserts into
-- KPI_organizations are locked down (see RLS below) so every org always has
-- an hr_admin member row from creation, mirroring create_site().
create or replace function public.create_kpi_organization(p_name text)
returns public."KPI_organizations"
language plpgsql security definer set search_path = public
as $$
declare
  v_org public."KPI_organizations";
  v_email text;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select email, coalesce(full_name, email) into v_email, v_name
  from public.profiles where id = auth.uid();

  insert into public."KPI_organizations" (name, owner_id)
  values (p_name, auth.uid())
  returning * into v_org;

  insert into public."KPI_members" (org_id, user_id, full_name, email, role, invite_status)
  values (v_org.id, auth.uid(), coalesce(v_name, 'HR Yöneticisi'), coalesce(v_email, ''), 'hr_admin', 'accepted');

  return v_org;
end;
$$;

-- Called on every /kpi-tracker load (see lib/kpiContext.tsx) — attaches the
-- current user to any pending KPI_members row matching their email. A plain
-- client-side UPDATE can't do this: the row's user_id is still null, so
-- neither has_kpi_org_access nor is_kpi_member_self would allow it yet.
create or replace function public.kpi_claim_membership()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    return;
  end if;
  select email into v_email from public.profiles where id = auth.uid();
  if v_email is null then
    return;
  end if;
  update public."KPI_members"
    set user_id = auth.uid(), invite_status = 'accepted'
    where user_id is null and lower(email) = lower(v_email);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Periods (+ optional per-member weight override)
-- ----------------------------------------------------------------------------

create table public."KPI_periods" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public."KPI_organizations"(id) on delete cascade,
  name text not null,
  year int not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  company_weight_pct numeric(5, 2) not null default 40,
  individual_weight_pct numeric(5, 2) not null default 60,
  announced_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (company_weight_pct + individual_weight_pct = 100)
);

create trigger trg_kpi_periods_updated_at
  before update on public."KPI_periods"
  for each row execute function public.set_updated_at();

create index idx_kpi_periods_org on public."KPI_periods"(org_id);

-- Not surfaced in the MVP UI (per-member split override) but modeled now so
-- it can be added later without another migration.
create table public."KPI_period_member_weights" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public."KPI_organizations"(id) on delete cascade,
  period_id uuid not null references public."KPI_periods"(id) on delete cascade,
  member_id uuid not null references public."KPI_members"(id) on delete cascade,
  company_weight_pct numeric(5, 2) not null,
  individual_weight_pct numeric(5, 2) not null,
  unique (period_id, member_id),
  check (company_weight_pct + individual_weight_pct = 100)
);

create index idx_kpi_pmw_period on public."KPI_period_member_weights"(period_id);

-- HR-only, SECURITY DEFINER because the RPC also performs the notification
-- fan-out atomically with the status transition.
create or replace function public.kpi_announce_period(p_period_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_name text;
begin
  select org_id, name into v_org_id, v_name from public."KPI_periods" where id = p_period_id;
  if v_org_id is null then
    raise exception 'period not found';
  end if;
  if not public.is_kpi_hr_admin(v_org_id) then
    raise exception 'not authorized';
  end if;

  update public."KPI_periods" set status = 'active', announced_at = now() where id = p_period_id;

  insert into public."KPI_notifications" (org_id, member_id, message, link)
  select v_org_id, m.id, v_name || ' dönemi açıldı — hedeflerinizi girin.', '/kpi-tracker/my-goals'
  from public."KPI_members" m
  where m.org_id = v_org_id;
end;
$$;

create or replace function public.kpi_close_period(p_period_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_name text;
begin
  select org_id, name into v_org_id, v_name from public."KPI_periods" where id = p_period_id;
  if v_org_id is null then
    raise exception 'period not found';
  end if;
  if not public.is_kpi_hr_admin(v_org_id) then
    raise exception 'not authorized';
  end if;

  update public."KPI_periods" set status = 'closed', closed_at = now() where id = p_period_id;

  insert into public."KPI_notifications" (org_id, member_id, message, link)
  select v_org_id, m.id, v_name || ' dönemi kapandı — sonuçlarınız açıklandı.', '/kpi-tracker/my-goals'
  from public."KPI_members" m
  where m.org_id = v_org_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Company goals (the shared "40%" bucket — HR-owned end to end)
-- ----------------------------------------------------------------------------

create table public."KPI_company_goals" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public."KPI_organizations"(id) on delete cascade,
  period_id uuid not null references public."KPI_periods"(id) on delete cascade,
  title text not null,
  description text,
  weight_pct numeric(5, 2) not null default 0,
  achievement_pct numeric(5, 2),
  hr_comment text,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_kpi_company_goals_updated_at
  before update on public."KPI_company_goals"
  for each row execute function public.set_updated_at();

create index idx_kpi_company_goals_period on public."KPI_company_goals"(period_id);

-- ----------------------------------------------------------------------------
-- 5. Individual goals (the employee's own "60%" bucket)
-- ----------------------------------------------------------------------------

create table public."KPI_individual_goals" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public."KPI_organizations"(id) on delete cascade,
  period_id uuid not null references public."KPI_periods"(id) on delete cascade,
  member_id uuid not null references public."KPI_members"(id) on delete cascade,
  title text not null,
  description text,
  weight_pct numeric(5, 2) not null default 0,
  self_rating numeric(5, 2),
  self_comment text,
  manager_rating numeric(5, 2),
  manager_comment text,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_kpi_individual_goals_updated_at
  before update on public."KPI_individual_goals"
  for each row execute function public.set_updated_at();

create index idx_kpi_individual_goals_period on public."KPI_individual_goals"(period_id);
create index idx_kpi_individual_goals_member on public."KPI_individual_goals"(member_id);

-- Field-level guard: manager_rating/manager_comment (and the row's
-- org/period/member linkage) can only be changed by an HR admin of the
-- goal's org — a non-HR caller's attempt is silently reset to the previous
-- value (UPDATE) or forced null (INSERT) rather than rejected outright, so
-- an employee's own self_rating/self_comment/title/description/weight_pct
-- edit in the same request still goes through.
create or replace function public.kpi_guard_individual_goal_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_is_hr boolean;
begin
  v_is_hr := public.is_kpi_hr_admin(new.org_id);
  if not v_is_hr then
    if TG_OP = 'UPDATE' then
      new.manager_rating := old.manager_rating;
      new.manager_comment := old.manager_comment;
      new.member_id := old.member_id;
      new.org_id := old.org_id;
      new.period_id := old.period_id;
    else
      new.manager_rating := null;
      new.manager_comment := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_kpi_individual_goals_guard
  before insert or update on public."KPI_individual_goals"
  for each row execute function public.kpi_guard_individual_goal_fields();

-- Runs after the guard above, so an employee's own edit (manager fields
-- untouched, is-distinct-from is false) never fires a notification — only a
-- genuine HR review change does.
create or replace function public.kpi_notify_on_manager_review()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.manager_rating is distinct from old.manager_rating)
     or (new.manager_comment is distinct from old.manager_comment) then
    insert into public."KPI_notifications" (org_id, member_id, message, link)
    values (
      new.org_id,
      new.member_id,
      '"' || new.title || '" hedefiniz için yönetici değerlendirmesi girildi.',
      '/kpi-tracker/my-goals'
    );
  end if;
  return new;
end;
$$;

create trigger trg_kpi_individual_goals_notify
  after update on public."KPI_individual_goals"
  for each row execute function public.kpi_notify_on_manager_review();

-- ----------------------------------------------------------------------------
-- 6. Notifications (in-app only, no email/push — DB-generated exclusively)
-- ----------------------------------------------------------------------------

create table public."KPI_notifications" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public."KPI_organizations"(id) on delete cascade,
  member_id uuid not null references public."KPI_members"(id) on delete cascade,
  message text not null,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index idx_kpi_notifications_member on public."KPI_notifications"(member_id);

-- ----------------------------------------------------------------------------
-- 7. RLS
-- ----------------------------------------------------------------------------

alter table public."KPI_organizations" enable row level security;
alter table public."KPI_departments" enable row level security;
alter table public."KPI_members" enable row level security;
alter table public."KPI_periods" enable row level security;
alter table public."KPI_period_member_weights" enable row level security;
alter table public."KPI_company_goals" enable row level security;
alter table public."KPI_individual_goals" enable row level security;
alter table public."KPI_notifications" enable row level security;

-- organizations: visible to members; direct insert blocked (use
-- create_kpi_organization()) so every org always has an hr_admin row.
create policy kpi_organizations_select on public."KPI_organizations" for select to authenticated
  using (public.has_kpi_org_access(id));
create policy kpi_organizations_update on public."KPI_organizations" for update to authenticated
  using (public.is_kpi_hr_admin(id));

create policy kpi_departments_select on public."KPI_departments" for select to authenticated
  using (public.has_kpi_org_access(org_id));
create policy kpi_departments_ins on public."KPI_departments" for insert to authenticated
  with check (public.is_kpi_hr_admin(org_id));
create policy kpi_departments_upd on public."KPI_departments" for update to authenticated
  using (public.is_kpi_hr_admin(org_id));
create policy kpi_departments_del on public."KPI_departments" for delete to authenticated
  using (public.is_kpi_hr_admin(org_id));

-- members: HR manages the roster directly (add/edit/remove); claiming an
-- invite (attaching user_id) goes through kpi_claim_membership() instead,
-- since the claimant isn't "self" yet by has_kpi_org_access's own definition.
create policy kpi_members_select on public."KPI_members" for select to authenticated
  using (public.has_kpi_org_access(org_id));
create policy kpi_members_ins on public."KPI_members" for insert to authenticated
  with check (public.is_kpi_hr_admin(org_id));
create policy kpi_members_upd on public."KPI_members" for update to authenticated
  using (public.is_kpi_hr_admin(org_id));
create policy kpi_members_del on public."KPI_members" for delete to authenticated
  using (public.is_kpi_hr_admin(org_id));

create policy kpi_periods_select on public."KPI_periods" for select to authenticated
  using (public.has_kpi_org_access(org_id));
create policy kpi_periods_ins on public."KPI_periods" for insert to authenticated
  with check (public.is_kpi_hr_admin(org_id));
create policy kpi_periods_upd on public."KPI_periods" for update to authenticated
  using (public.is_kpi_hr_admin(org_id));
create policy kpi_periods_del on public."KPI_periods" for delete to authenticated
  using (public.is_kpi_hr_admin(org_id));

create policy kpi_pmw_select on public."KPI_period_member_weights" for select to authenticated
  using (public.has_kpi_org_access(org_id));
create policy kpi_pmw_ins on public."KPI_period_member_weights" for insert to authenticated
  with check (public.is_kpi_hr_admin(org_id));
create policy kpi_pmw_upd on public."KPI_period_member_weights" for update to authenticated
  using (public.is_kpi_hr_admin(org_id));
create policy kpi_pmw_del on public."KPI_period_member_weights" for delete to authenticated
  using (public.is_kpi_hr_admin(org_id));

-- company_goals: HR-only writes at every step (create, announce-time lock is
-- a UI convention — see app/kpi-tracker/periods/[id]/page.tsx — HR can still
-- fix a typo later; employees never get a write policy on this table at all).
create policy kpi_company_goals_select on public."KPI_company_goals" for select to authenticated
  using (public.has_kpi_org_access(org_id));
create policy kpi_company_goals_ins on public."KPI_company_goals" for insert to authenticated
  with check (public.is_kpi_hr_admin(org_id));
create policy kpi_company_goals_upd on public."KPI_company_goals" for update to authenticated
  using (public.is_kpi_hr_admin(org_id));
create policy kpi_company_goals_del on public."KPI_company_goals" for delete to authenticated
  using (public.is_kpi_hr_admin(org_id));

-- individual_goals: the owning employee OR an HR admin of the org may write;
-- the trg_kpi_individual_goals_guard trigger above enforces which columns a
-- non-HR write is actually allowed to change.
create policy kpi_individual_goals_select on public."KPI_individual_goals" for select to authenticated
  using (public.has_kpi_org_access(org_id));
create policy kpi_individual_goals_ins on public."KPI_individual_goals" for insert to authenticated
  with check (public.is_kpi_member_self(member_id) or public.is_kpi_hr_admin(org_id));
create policy kpi_individual_goals_upd on public."KPI_individual_goals" for update to authenticated
  using (public.is_kpi_member_self(member_id) or public.is_kpi_hr_admin(org_id));
create policy kpi_individual_goals_del on public."KPI_individual_goals" for delete to authenticated
  using (public.is_kpi_member_self(member_id) or public.is_kpi_hr_admin(org_id));

-- notifications: no insert policy at all — only the SECURITY DEFINER RPCs
-- and trigger above can create one. Recipients (or HR) can read; only the
-- recipient can mark their own as read.
create policy kpi_notifications_select on public."KPI_notifications" for select to authenticated
  using (public.is_kpi_member_self(member_id) or public.is_kpi_hr_admin(org_id));
create policy kpi_notifications_upd on public."KPI_notifications" for update to authenticated
  using (public.is_kpi_member_self(member_id));

revoke all on function public.create_kpi_organization(text) from public;
revoke all on function public.kpi_claim_membership() from public;
revoke all on function public.kpi_announce_period(uuid) from public;
revoke all on function public.kpi_close_period(uuid) from public;
grant execute on function public.create_kpi_organization(text) to authenticated;
grant execute on function public.kpi_claim_membership() to authenticated;
grant execute on function public.kpi_announce_period(uuid) to authenticated;
grant execute on function public.kpi_close_period(uuid) to authenticated;
