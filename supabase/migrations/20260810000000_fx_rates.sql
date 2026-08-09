-- ============================================================================
-- Kurlar (FX Rates) module — TCMB-sourced exchange rates + manual forecasts
-- ============================================================================
-- Scope: adds two tables to support the "Kurlar" page under Site Bütçe
-- Yönetimi (app/aidat/rates):
--   1. `fx_rates`     — daily USD/EUR buying & selling rates against TRY,
--                       sourced from TCMB (Türkiye Cumhuriyet Merkez Bankası)
--                       published daily XML bulletins. GLOBAL (no site_id) —
--                       an exchange rate is not a property of any one site,
--                       it's shared market data every site reads.
--   2. `fx_forecasts` — manual, forward-looking rate estimates a site's
--                       accountant/admin enters for future months (there is
--                       no market data for the future). SITE-SCOPED, follows
--                       the standard has_site_access/has_site_write_access
--                       RLS pattern established in
--                       20260809190000_init_aidat_schema.sql.
--
-- Key design decisions:
--
-- 1. TRY has no row in `fx_rates` — it is the base/quote currency every rate
--    is expressed in (TRY per 1 unit of USD/EUR), so a "TRY rate" is
--    trivially 1 and is handled in the UI, not stored.
--
-- 2. `currency` is constrained to ('USD','EUR') for now — TCMB publishes many
--    more, but the site only asked for USD/EUR/TRY. Widening the check
--    constraint later is a one-line migration if more currencies are needed.
--
-- 3. Weekends/holidays have no TCMB bulletin. Rather than materialising
--    carried-forward rows for non-business days (which would misrepresent
--    "we have real data for this date"), `fx_rates` only ever contains rows
--    for days TCMB actually published. Period-average calculations (done in
--    the UI) average over whatever rows exist in the requested range and
--    surface how many of the requested days had data — see the page's
--    "Dönem Ortalama Kur" panel. This keeps the table an honest source of
--    truth instead of silently fabricating weekend data.
--
-- 4. RLS write access for `fx_rates`: unlike site-scoped tables, this is
--    global reference data, and unlike `expense_categories`/
--    `income_categories` (which are seed-only, no client insert policy), FX
--    rates need routine incremental writes (a new day's rate every day).
--    Decision: allow INSERT/UPDATE (upsert) by any authenticated user, same
--    trust level as the rest of this internal tool — the "Şimdi Güncelle"
--    button in the UI calls POST /api/fx-rates/tcmb-sync, which itself
--    writes via the service-role key (bypassing RLS entirely) so the
--    authenticated-write policy below is really just a safety net / manual
--    fallback path, not the primary write path. No DELETE policy is granted
--    from the client — corrections happen via re-sync (upsert), not deletion.
--    If this table is ever used for something more sensitive than reference
--    market data, tighten this to service-role-only and drop the client
--    insert/update policies.
--
-- 5. `fx_forecasts` mirrors the audit/RLS shape of every other site-scoped
--    table in the reference migration (created_by, created_at,
--    has_site_access/has_site_write_access policies). `forecast_month` is
--    stored as the first-of-month `date` (matching the `fiscal_periods`
--    year/month convention used elsewhere, but as a single date column
--    rather than a year/month pair, since forecasts don't need a foreign key
--    to `fiscal_periods` and a plain date is simpler to range-query/sort).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. fx_rates — global daily TCMB rates
-- ----------------------------------------------------------------------------

create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  rate_date date not null,
  currency text not null check (currency in ('USD', 'EUR')),
  buying numeric(14, 4) not null check (buying > 0),
  selling numeric(14, 4) not null check (selling > 0),
  source text not null default 'tcmb',
  created_at timestamptz not null default now(),
  unique (rate_date, currency)
);

create index idx_fx_rates_date on public.fx_rates(rate_date);
create index idx_fx_rates_currency on public.fx_rates(currency);

alter table public.fx_rates enable row level security;

-- readable by any authenticated user — shared reference data, no tenant.
create policy fx_rates_select on public.fx_rates for select to authenticated
  using (true);

-- writable (insert/upsert) by any authenticated user — see design note #4.
-- Primary write path is the service-role sync route; this is the client
-- fallback for the "Şimdi Güncelle" button and manual corrections.
create policy fx_rates_write_ins on public.fx_rates for insert to authenticated
  with check (true);
create policy fx_rates_write_upd on public.fx_rates for update to authenticated
  using (true);
-- (no delete policy: corrections happen via upsert, not deletion)

-- ----------------------------------------------------------------------------
-- 2. fx_forecasts — site-scoped manual forward-looking rate estimates
-- ----------------------------------------------------------------------------

create table public.fx_forecasts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  currency text not null check (currency in ('USD', 'EUR')),
  forecast_month date not null,
  rate numeric(14, 4) not null check (rate > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (site_id, currency, forecast_month),
  check (extract(day from forecast_month) = 1)
);

create index idx_fx_forecasts_site on public.fx_forecasts(site_id);
create index idx_fx_forecasts_month on public.fx_forecasts(forecast_month);

alter table public.fx_forecasts enable row level security;

create policy fx_forecasts_select on public.fx_forecasts for select to authenticated
  using (public.has_site_access(site_id));
create policy fx_forecasts_write_ins on public.fx_forecasts for insert to authenticated
  with check (public.has_site_write_access(site_id));
create policy fx_forecasts_write_upd on public.fx_forecasts for update to authenticated
  using (public.has_site_write_access(site_id));
create policy fx_forecasts_write_del on public.fx_forecasts for delete to authenticated
  using (public.has_site_write_access(site_id));
