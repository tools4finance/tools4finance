// ============================================================================
// Shared TCMB bulletin fetch/parse/upsert logic — used by both
// app/api/fx-rates/tcmb-sync/route.ts (single date/today) and
// app/api/fx-rates/tcmb-sync-range/route.ts (bulk backfill over a date
// range). Extracted so the range route doesn't reimplement bulletin
// resolution/parsing — see tcmb-sync/route.ts's original header comment for
// the verified-live TCMB endpoint shapes this parsing logic is based on.
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const CURRENCIES = ["USD", "EUR"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export type ParsedRate = {
  currency: CurrencyCode;
  buying: number;
  selling: number;
};

export type SyncResult = {
  requestedDate: string;
  resolvedDate: string;
  attemptedUrls: string[];
  rates: ParsedRate[];
};

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** YYYY-MM-DD -> { ddmmyyyy: "DDMMYYYY", yyyymm: "YYYYMM" } for the TCMB URL scheme. */
function toTcmbPathParts(isoDate: string): { ddmmyyyy: string; yyyymm: string } {
  const [y, m, d] = isoDate.split("-");
  return { ddmmyyyy: `${d}${m}${y}`, yyyymm: `${y}${m}` };
}

export function addDaysIso(isoDate: string, deltaDays: number): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

/** Sunday=0 / Saturday=6 in UTC terms — used by the range route to skip weekends. */
export function isWeekendIso(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Parses the Tarih="DD.MM.YYYY" root attribute into an ISO date string. */
function parseBulletinDate(xml: string): string | null {
  const match = xml.match(/Tarih="(\d{2})\.(\d{2})\.(\d{4})"/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function parseDecimal(raw: string | undefined): number | null {
  if (raw == null) return null;
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseCurrencyBlock(xml: string, code: CurrencyCode): ParsedRate | null {
  const blockMatch = xml.match(new RegExp(`<Currency\\b[^>]*Kod="${code}"[^>]*>([\\s\\S]*?)</Currency>`, "i"));
  if (!blockMatch) return null;
  const block = blockMatch[1];
  const buyingMatch = block.match(/<ForexBuying>([^<]*)<\/ForexBuying>/i);
  const sellingMatch = block.match(/<ForexSelling>([^<]*)<\/ForexSelling>/i);
  const buying = parseDecimal(buyingMatch?.[1]);
  const selling = parseDecimal(sellingMatch?.[1]);
  if (buying == null || selling == null || buying <= 0 || selling <= 0) return null;
  return { currency: code, buying, selling };
}

export function parseTcmbXml(xml: string): { bulletinDate: string; rates: ParsedRate[] } | null {
  const bulletinDate = parseBulletinDate(xml);
  if (!bulletinDate) return null;
  const rates: ParsedRate[] = [];
  for (const code of CURRENCIES) {
    const parsed = parseCurrencyBlock(xml, code);
    if (parsed) rates.push(parsed);
  }
  if (rates.length === 0) return null;
  return { bulletinDate, rates };
}

async function fetchXml(url: string): Promise<{ ok: true; xml: string } | { ok: false; status: number }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { ok: false, status: res.status };
  const xml = await res.text();
  return { ok: true, xml };
}

/**
 * Resolves and fetches a TCMB bulletin.
 * - No explicit date requested: try today.xml directly — TCMB already
 *   resolves this to the latest published business day on its own.
 * - Explicit date requested: try that date's dated URL, then walk backward
 *   up to 4 more calendar days (5 attempts total) since weekends/holidays
 *   have no bulletin. This also means requesting any weekend/holiday date
 *   naturally resolves to (and upserts under) the correct prior business
 *   day's real date — safe to call once per calendar day in a bulk loop
 *   without a Turkish holiday calendar.
 */
export async function resolveBulletin(requestedDate: string | null): Promise<SyncResult> {
  const attemptedUrls: string[] = [];
  const effectiveRequested = requestedDate ?? todayIso();

  if (!requestedDate) {
    const url = "https://www.tcmb.gov.tr/kurlar/today.xml";
    attemptedUrls.push(url);
    const result = await fetchXml(url);
    if (result.ok) {
      const parsed = parseTcmbXml(result.xml);
      if (parsed) {
        return {
          requestedDate: effectiveRequested,
          resolvedDate: parsed.bulletinDate,
          attemptedUrls,
          rates: parsed.rates,
        };
      }
    }
    // Fall through to the dated walk-back below if today.xml was somehow
    // unparseable/unavailable.
  }

  const MAX_ATTEMPTS = 5;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidateDate = addDaysIso(effectiveRequested, -i);
    const { ddmmyyyy, yyyymm } = toTcmbPathParts(candidateDate);
    const url = `https://www.tcmb.gov.tr/kurlar/${yyyymm}/${ddmmyyyy}.xml`;
    attemptedUrls.push(url);
    const result = await fetchXml(url);
    if (result.ok) {
      const parsed = parseTcmbXml(result.xml);
      if (parsed) {
        return {
          requestedDate: effectiveRequested,
          resolvedDate: parsed.bulletinDate,
          attemptedUrls,
          rates: parsed.rates,
        };
      }
    }
  }

  throw new Error(
    `TCMB bulletin not found for ${effectiveRequested} or the ${MAX_ATTEMPTS - 1} preceding day(s). Tried: ${attemptedUrls.join(", ")}`
  );
}

export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Server misconfiguration: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function upsertRates(admin: SupabaseClient, resolvedDate: string, rates: ParsedRate[]) {
  const rows = rates.map((r) => ({
    rate_date: resolvedDate,
    currency: r.currency,
    buying: r.buying,
    selling: r.selling,
    source: "tcmb",
  }));
  return admin.from("fx_rates").upsert(rows, { onConflict: "rate_date,currency" });
}
