-- ============================================================================
-- find_profile_by_email RPC
-- ============================================================================
-- The "Üye Ekle" (add site member) flow needs to look up ANOTHER user's
-- profile by email, but `profiles_select_own` (init migration) restricts
-- SELECT to `id = auth.uid()` — a direct table query for someone else's row
-- always returns nothing. Rather than loosening the table-level RLS (which
-- would expose every user's email/name to any authenticated client), expose
-- only the three columns actually needed for an invite lookup through a
-- narrow SECURITY DEFINER function.
-- ============================================================================

create or replace function public.find_profile_by_email(p_email text)
returns table (id uuid, email text, full_name text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.email, p.full_name
  from public.profiles p
  where p.email is not null
    and lower(p.email) = lower(p_email)
  limit 1;
$$;

revoke all on function public.find_profile_by_email(text) from public;
grant execute on function public.find_profile_by_email(text) to authenticated;
