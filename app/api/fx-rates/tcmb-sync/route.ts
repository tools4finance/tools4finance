// ============================================================================
// POST/GET /api/fx-rates/tcmb-sync
// ----------------------------------------------------------------------------
// Fetches USD/EUR buying & selling rates from TCMB's free, no-auth, no-API-key
// public XML bulletins and upserts them into `fx_rates` using the Supabase
// service-role key (server-only — never sent to the client).
//
// Verified live against the real TCMB endpoints while building this route:
//   - https://www.tcmb.gov.tr/kurlar/today.xml
//       returned (2026-08-09, a Sunday): root attrs
//       `Tarih="07.08.2026" Date="08/07/2026" Bulten_No="2026/146"` — i.e.
//       "today.xml" already resolves to the latest published business day,
//       no walk-back needed when no explicit date is requested.
//   - https://www.tcmb.gov.tr/kurlar/202601/15012026.xml (an explicit past
//       business day) returned a normal bulletin.
//   - https://www.tcmb.gov.tr/kurlar/202601/17012026.xml (a Saturday)
//       returned HTTP 404 — confirms weekends/holidays have no bulletin and
//       the walk-back-on-404 fallback is required for explicit-date lookups.
//
// Confirmed real shape of a <Currency> block (USD shown; EUR identical
// shape), values are plain decimal strings using "." as the separator:
//   <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
//     <Unit>1</Unit>
//     <Isim>ABD DOLARI</Isim>
//     <CurrencyName>US DOLLAR</CurrencyName>
//     <ForexBuying>47.5229</ForexBuying>
//     <ForexSelling>47.6085</ForexSelling>
//     <BanknoteBuying>47.4896</BanknoteBuying>
//     <BanknoteSelling>47.6799</BanknoteSelling>
//     <CrossRateUSD/>
//     <CrossRateOther/>
//   </Currency>
// The root element carries `Tarih="DD.MM.YYYY"` — the authoritative bulletin
// date, which can differ from the requested date (e.g. a Friday bulletin
// returned when Saturday/Sunday was requested/resolved).
//
// Even though "." was the only separator observed, parsing below also
// tolerates "," defensively, since that has not been exhaustively verified
// across TCMB's full history.
//
// No new npm dependency is introduced — Node has no built-in DOMParser, so
// this uses small, well-scoped regexes against the known-fixed XML shape
// rather than pulling in an XML parsing library.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const CURRENCIES = ["USD", "EUR"] as const;
type CurrencyCode = (typeof CURRENCIES)[number];

type ParsedRate = {
  currency: CurrencyCode;
  buying: number;
  selling: number;
};

type SyncResult = {
  requestedDate: string;
  resolvedDate: string;
  attemptedUrls: string[];
  rates: ParsedRate[];
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** YYYY-MM-DD -> { ddmmyyyy: "DDMMYYYY", yyyymm: "YYYYMM" } for the TCMB URL scheme. */
function toTcmbPathParts(isoDate: string): { ddmmyyyy: string; yyyymm: string } {
  const [y, m, d] = isoDate.split("-");
  return { ddmmyyyy: `${d}${m}${y}`, yyyymm: `${y}${m}` };
}

function addDaysIso(isoDate: string, deltaDays: number): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
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

function parseTcmbXml(xml: string): { bulletinDate: string; rates: ParsedRate[] } | null {
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
 *   have no bulletin.
 */
async function resolveBulletin(requestedDate: string | null): Promise<SyncResult> {
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

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Server misconfiguration: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function handleSync(requestedDate: string | null): Promise<NextResponse> {
  try {
    const bulletin = await resolveBulletin(requestedDate);

    const supabaseAdmin = getServiceClient();
    const rows = bulletin.rates.map((r) => ({
      rate_date: bulletin.resolvedDate,
      currency: r.currency,
      buying: r.buying,
      selling: r.selling,
      source: "tcmb",
    }));

    const { error: upsertError } = await supabaseAdmin
      .from("fx_rates")
      .upsert(rows, { onConflict: "rate_date,currency" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({
      requestedDate: bulletin.requestedDate,
      resolvedDate: bulletin.resolvedDate,
      rates: bulletin.rates,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error while syncing TCMB rates.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let requestedDate: string | null = null;
  try {
    const body = await request.json();
    if (body && typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      requestedDate = body.date;
    }
  } catch {
    // No/invalid JSON body is fine — defaults to today.
  }
  return handleSync(requestedDate);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const dateParam = request.nextUrl.searchParams.get("date");
  const requestedDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  return handleSync(requestedDate);
}
