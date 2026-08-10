// ============================================================================
// POST/GET /api/fx-rates/tcmb-sync
// ----------------------------------------------------------------------------
// Fetches USD/EUR buying & selling rates from TCMB's free, no-auth, no-API-key
// public XML bulletins and upserts them into `fx_rates` using the Supabase
// service-role key (server-only — never sent to the client). One date at a
// time — see /api/fx-rates/tcmb-sync-range for bulk backfill over a range.
//
// Bulletin fetch/parse/upsert logic lives in lib/tcmbSync.ts (shared with
// the range route) — see that file for the verified-live TCMB endpoint
// shapes this is based on.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { resolveBulletin, getServiceClient, upsertRates } from "@/lib/tcmbSync";

export const runtime = "nodejs";

async function handleSync(requestedDate: string | null): Promise<NextResponse> {
  try {
    const bulletin = await resolveBulletin(requestedDate);

    const supabaseAdmin = getServiceClient();
    const { error: upsertError } = await upsertRates(supabaseAdmin, bulletin.resolvedDate, bulletin.rates);

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
