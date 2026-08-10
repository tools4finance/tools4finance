-- ============================================================================
-- Allow anonymous SELECT on fx_rates — genuinely public TCMB reference data
-- (already published daily on tcmb.gov.tr), needed so the homepage's public
-- "TCMB Kurlar" widget can read rates without a login. See design note #4 in
-- 20260810000000_fx_rates.sql, which already called this "shared reference
-- data, no tenant" — this just extends read access to unauthenticated
-- visitors too. Write policies (insert/update, authenticated-only) are
-- untouched; anon still cannot write.
-- ============================================================================

drop policy fx_rates_select on public.fx_rates;

create policy fx_rates_select on public.fx_rates for select to authenticated, anon
  using (true);
