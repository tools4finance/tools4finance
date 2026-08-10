-- ============================================================================
-- KPI Tracker: measurable target/actual goals (optional, additive)
-- ============================================================================
-- Product ask: a goal like "Ciro Hedefi" should be numeric with a selectable
-- direction (higher/lower is better), take a real actual value, and have its
-- achievement % CALCULATED rather than typed in directly. Inverse metrics
-- (e.g. LTIFR, where 0 is best) need this too — see lib/kpiScoring.ts's
-- computeAchievementPct for the worked example.
--
-- Design: four nullable columns on both goal tables. When target_value is
-- set, the app computes achievement_pct/self_rating from
-- direction+target_value+actual_value and writes the computed number into
-- the EXISTING column — so lib/kpiScoring.ts's weighting formula needs zero
-- changes, it just keeps reading achievement_pct/self_rating as before. When
-- target_value is left null, today's manual-percentage behavior is
-- unchanged — covers qualitative/milestone goals that don't reduce to a
-- clean number (per the HR persona doc: "never assume all goals are
-- numeric"). Existing demo data has target_value=null everywhere, so it
-- keeps behaving exactly as it does today.
--
-- Ownership: on KPI_individual_goals, direction/target_value/unit join the
-- same employee-owned "structural" lane as title/description/weight_pct
-- (freely editable pre-review, frozen once manager_rating is set — same
-- reasoning as the 20260810000007 hardening pass: unfreezing would let an
-- employee silently redefine what a reviewed goal even measures).
-- actual_value stays in the self_rating/self_comment lane — never frozen,
-- since per the existing `manager_rating ?? self_rating ?? 0` formula it no
-- longer affects the score once manager_rating exists. HR does not get an
-- independent actual_value of their own: like today's self_rating vs.
-- manager_rating, the manager sees the employee's computed achievement (with
-- the full target/actual/direction math visible) and can override with their
-- own manager_rating number if they judge the self-reported actual to be
-- wrong — no separate parallel "manager's actual_value" field, that's a real
-- calibration-workflow feature and out of scope for this MVP.
-- ============================================================================

alter table public."KPI_company_goals"
  add column direction text check (direction in ('higher_better', 'lower_better')),
  add column target_value numeric,
  add column actual_value numeric,
  add column unit text;

alter table public."KPI_individual_goals"
  add column direction text check (direction in ('higher_better', 'lower_better')),
  add column target_value numeric,
  add column actual_value numeric,
  add column unit text;

-- Extend the field guard: direction/target_value/unit follow weight_pct's
-- lane (frozen post-review); actual_value is left alone entirely, same as
-- self_rating/self_comment.
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
      if old.manager_rating is not null then
        new.weight_pct := old.weight_pct;
        new.title := old.title;
        new.description := old.description;
        new.direction := old.direction;
        new.target_value := old.target_value;
        new.unit := old.unit;
      end if;
    else
      new.manager_rating := null;
      new.manager_comment := null;
    end if;
  end if;
  return new;
end;
$$;

-- Track the three new fields in the audit trail the same way as the
-- existing tracked fields.
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
  if new.actual_value is distinct from old.actual_value then
    insert into public."KPI_individual_goal_history" (org_id, goal_id, member_id, changed_by, field, old_value, new_value)
    values (new.org_id, new.id, new.member_id, auth.uid(), 'actual_value', old.actual_value::text, new.actual_value::text);
  end if;
  return new;
end;
$$;
