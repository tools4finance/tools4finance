-- ============================================================================
-- Profiles: add phone number
-- ============================================================================
-- Adds a `phone` column to the existing public.profiles table (defined in
-- 20260809190000_init_aidat_schema.sql) so the "Profilim" (my profile) page
-- can collect a contact phone number for the logged-in user. Purely additive
-- — existing RLS policies profiles_select_own / profiles_update_own already
-- restrict access to `id = auth.uid()`, so no new policy is needed for this
-- column: users can already read/update their own profiles row.
-- ============================================================================

alter table public.profiles
  add column if not exists phone text;
