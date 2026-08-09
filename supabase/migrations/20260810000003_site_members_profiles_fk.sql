-- ============================================================================
-- site_members -> profiles FK (for PostgREST embedding)
-- ============================================================================
-- app/aidat/settings/page.tsx embeds profiles via
-- `.select("id, user_id, role, profiles(email, full_name)")`. PostgREST only
-- auto-detects this nested-select relationship when a direct foreign key
-- exists between the two tables in the embed. site_members.user_id already
-- references auth.users(id), and profiles.id also references auth.users(id),
-- but that shared ancestor isn't enough for PostgREST — it needs an FK
-- directly from site_members to profiles.
--
-- This is safe to add: every row that can appear in site_members.user_id is
-- necessarily a real auth.users row, and handle_new_user() (init migration)
-- creates the matching public.profiles row synchronously at signup, before
-- that user could ever be referenced by a site_members insert. So every
-- existing and future site_members.user_id value already satisfies this
-- constraint — a column can carry more than one FK to different tables as
-- long as both are satisfied, which holds here by construction.
-- ============================================================================

alter table public.site_members
  add constraint site_members_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- Force PostgREST to pick up the new relationship immediately instead of
-- waiting for its periodic schema-cache auto-reload.
select pg_notify('pgrst', 'reload schema');
