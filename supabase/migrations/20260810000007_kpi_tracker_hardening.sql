-- ============================================================================
-- KPI Tracker hardening pass (HR Performance Management Systems Expert review)
-- ============================================================================
-- Reviewed against the full HR performance-management checklist (audit trail,
-- RBAC/least-privilege, score integrity, historical-record protection).
-- Three fixes, all additive:
--
-- 1. KPI_individual_goals SELECT policy was has_kpi_org_access(org_id) — any
--    member of an org (not just HR or the goal's own employee) could read
--    every colleague's self/manager ratings and comments straight from the
--    REST API, even though the UI never surfaces it. Per "never rely solely
--    on hidden frontend buttons": tightened to member-self-or-HR, matching
--    every other per-member table in this schema (KPI_notifications, etc).
--
-- 2. Audit trail: self_rating/self_comment/manager_rating/manager_comment/
--    weight_pct/title were plain columns silently overwritten in place on
--    UPDATE with no trace of the previous value — the persona's "never
--    overwrite original ratings" rule. Added KPI_individual_goal_history
--    (append-only, one row per changed tracked field per UPDATE), populated
--    by an AFTER UPDATE trigger. No insert/update/delete policy for clients
--    — same "only a SECURITY DEFINER trigger can write this" shape as
--    KPI_notifications — so the log itself can't be edited or deleted by a
--    regular session.
--
-- 3. Goal lock after manager review: once HR has rated a goal
--    (manager_rating is not null), an employee could still freely retitle
--    or reweight it, or delete it outright — silently invalidating HR's
--    review and corrupting the weighted score. Extended the existing field
--    guard trigger to freeze weight_pct/title/description once reviewed
--    (self_rating/self_comment stay editable — per lib/kpiScoring.ts's
--    `manager_rating ?? self_rating ?? 0`, they no longer affect the score
--    once a manager_rating exists, so there's no integrity reason to lock
--    them), and tightened the DELETE policy so an employee can only remove
--    their own goal before it has been reviewed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tighten KPI_individual_goals SELECT
-- ----------------------------------------------------------------------------

drop policy kpi_individual_goals_select on public."KPI_individual_goals";
create policy kpi_individual_goals_select on public."KPI_individual_goals" for select to authenticated
  using (public.is_kpi_member_self(member_id) or public.is_kpi_hr_admin(org_id));

-- ----------------------------------------------------------------------------
-- 2. Individual goal history (audit trail)
-- ----------------------------------------------------------------------------

create table public."KPI_individual_goal_history" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public."KPI_organizations"(id) on delete cascade,
  goal_id uuid not null references public."KPI_individual_goals"(id) on delete cascade,
  member_id uuid not null references public."KPI_members"(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  field text not null,
  old_value text,
  new_value text,
  changed_at timestamptz not null default now()
);

create index idx_kpi_goal_history_goal on public."KPI_individual_goal_history"(goal_id);
create index idx_kpi_goal_history_member on public."KPI_individual_goal_history"(member_id);

create or replace function public.kpi_log_individual_goal_history()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.self_rating is distinct from old.self_rating then
    insert into public."KPI_individual_goal_history" (org_id, goal_id, member_id, changed_by, field, old_value, new_value)
    values (new.org_id, new.id, new.member_id, auth.uid(), 'self_rating', old.self_rating::text, new.self_rating::text);
  end if;
  if new.self_comment is distinct from old.self_comment then
    insert into public."KPI_individual_goal_history" (org_id, goal_id, member_id, changed_by, field, old_value, new_value)
    values (new.org_id, new.id, new.member_id, auth.uid(), 'self_comment', old.self_comment, new.self_comment);
  end if;
  if new.manager_rating is distinct from old.manager_rating then
    insert into public."KPI_individual_goal_history" (org_id, goal_id, member_id, changed_by, field, old_value, new_value)
    values (new.org_id, new.id, new.member_id, auth.uid(), 'manager_rating', old.manager_rating::text, new.manager_rating::text);
  end if;
  if new.manager_comment is distinct from old.manager_comment then
    insert into public."KPI_individual_goal_history" (org_id, goal_id, member_id, changed_by, field, old_value, new_value)
    values (new.org_id, new.id, new.member_id, auth.uid(), 'manager_comment', old.manager_comment, new.manager_comment);
  end if;
  if new.weight_pct is distinct from old.weight_pct then
    insert into public."KPI_individual_goal_history" (org_id, goal_id, member_id, changed_by, field, old_value, new_value)
    values (new.org_id, new.id, new.member_id, auth.uid(), 'weight_pct', old.weight_pct::text, new.weight_pct::text);
  end if;
  if new.title is distinct from old.title then
    insert into public."KPI_individual_goal_history" (org_id, goal_id, member_id, changed_by, field, old_value, new_value)
    values (new.org_id, new.id, new.member_id, auth.uid(), 'title', old.title, new.title);
  end if;
  return new;
end;
$$;

-- Runs after trg_kpi_individual_goals_guard (also BEFORE) has already reset
-- any disallowed field, so it only ever logs what actually got persisted —
-- but this trigger itself is AFTER UPDATE, seeing the final committed NEW row.
create trigger trg_kpi_individual_goals_history
  after update on public."KPI_individual_goals"
  for each row execute function public.kpi_log_individual_goal_history();

alter table public."KPI_individual_goal_history" enable row level security;

create policy kpi_goal_history_select on public."KPI_individual_goal_history" for select to authenticated
  using (public.is_kpi_member_self(member_id) or public.is_kpi_hr_admin(org_id));

-- ----------------------------------------------------------------------------
-- 3. Lock structural fields + delete once a goal has been manager-reviewed
-- ----------------------------------------------------------------------------

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
      -- Once HR has rated this goal, also freeze the employee-owned
      -- structural fields — otherwise an employee could reweight/retitle a
      -- reviewed goal (or delete it, see the DELETE policy below) and
      -- silently invalidate HR's review.
      if old.manager_rating is not null then
        new.weight_pct := old.weight_pct;
        new.title := old.title;
        new.description := old.description;
      end if;
    else
      new.manager_rating := null;
      new.manager_comment := null;
    end if;
  end if;
  return new;
end;
$$;

drop policy kpi_individual_goals_del on public."KPI_individual_goals";
create policy kpi_individual_goals_del on public."KPI_individual_goals" for delete to authenticated
  using (
    (public.is_kpi_member_self(member_id) and manager_rating is null)
    or public.is_kpi_hr_admin(org_id)
  );
