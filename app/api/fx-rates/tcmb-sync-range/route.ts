// ============================================================================
// POST /api/fx-rates/tcmb-sync-range
// ----------------------------------------------------------------------------
// Bulk-backfills `fx_rates` over a date range. Fixes a real gap: the
// single-date sync route (/api/fx-rates/tcmb-sync) only ever populates one
// day at a time (today, or an explicit ?date=), so "Dönem Ortalama Kur" on
// app/aidat/rates/page.tsx silently returned "no data" for any range nobody
// had happened to sync day-by-day before — not a data problem, a missing
// capability. This route lets the UI backfill an entire requested range in
// one call.
//
// Design:
// - Range capped at MAX_RANGE_DAYS to bound worst-case duration against
//   Vercel's function timeout.
// - Weekends are skipped outright (TCMB never publishes on Sat/Sun); the
//   shared resolveBulletin() walk-back-on-404 already resolves a holiday
//   weekday to the prior business day's real bulletin date on its own, so no
//   Turkish holiday calendar is needed here.
// - Dates that already have both USD and EUR rows in `fx_rates` are skipped
//   entirely (no TCMB call) — repeated backfills of overlapping ranges stay
//   cheap.
// - Remaining dates are fetched with limited concurrency (not all at once,
//   not fully sequential) to keep total latency reasonable.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { CURRENCIES, resolveBulletin, getServiceClient, upsertRates, addDaysIso, isWeekendIso } from "@/lib/tcmbSync";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_RANGE_DAYS = 186; // ~6 months
const CONCURRENCY = 6;

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function daysBetweenInclusive(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00Z`).getTime();
  const end = new Date(`${endIso}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86400000) + 1;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const { startDate, endDate } = (body ?? {}) as { startDate?: unknown; endDate?: unknown };
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return NextResponse.json({ error: "startDate ve endDate YYYY-MM-DD formatında olmalı." }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json({ error: "endDate, startDate'ten önce olamaz." }, { status: 400 });
  }
  const totalDays = daysBetweenInclusive(startDate, endDate);
  if (totalDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Aralık en fazla ${MAX_RANGE_DAYS} gün olabilir (istenen: ${totalDays} gün). Lütfen tarih aralığını daraltın.` },
      { status: 400 }
    );
  }

  const weekdays: string[] = [];
  for (let d = startDate; d <= endDate; d = addDaysIso(d, 1)) {
    if (!isWeekendIso(d)) weekdays.push(d);
  }

  let admin;
  try {
    admin = getServiceClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sunucu yapılandırma hatası.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Skip weekdays that already have both currencies present.
  const { data: existingRows, error: existingError } = await admin
    .from("fx_rates")
    .select("rate_date, currency")
    .gte("rate_date", startDate)
    .lte("rate_date", endDate);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  const presentCurrenciesByDate = new Map<string, Set<string>>();
  for (const row of (existingRows ?? []) as { rate_date: string; currency: string }[]) {
    const set = presentCurrenciesByDate.get(row.rate_date) ?? new Set<string>();
    set.add(row.currency);
    presentCurrenciesByDate.set(row.rate_date, set);
  }
  const datesToFetch = weekdays.filter((d) => {
    const set = presentCurrenciesByDate.get(d);
    return !set || CURRENCIES.some((c) => !set.has(c));
  });
  const alreadyPresent = weekdays.length - datesToFetch.length;

  let fetched = 0;
  let failed = 0;
  const failedDates: string[] = [];

  for (let i = 0; i < datesToFetch.length; i += CONCURRENCY) {
    const batch = datesToFetch.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (date) => {
        const bulletin = await resolveBulletin(date);
        const { error } = await upsertRates(admin, bulletin.resolvedDate, bulletin.rates);
        if (error) throw new Error(error.message);
      })
    );
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        fetched++;
      } else {
        failed++;
        failedDates.push(batch[j]);
      }
    }
  }

  return NextResponse.json({
    requestedDays: weekdays.length,
    alreadyPresent,
    fetched,
    failed,
    failedDates,
  });
}
