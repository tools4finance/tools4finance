"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import TrDateInput from "@/components/TrDateInput";

type Currency = "USD" | "EUR";
const CURRENCIES: Currency[] = ["USD", "EUR"];

type FxRate = {
  id: string;
  rate_date: string;
  currency: Currency;
  buying: number;
  selling: number;
  source: string;
};

type AverageResult = {
  currency: Currency;
  buying: number;
  selling: number;
  daysWithData: number;
};

const rateFormatter = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
function formatRate(n: number): string {
  return rateFormatter.format(n);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthIso(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}
function daysBetweenInclusive(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00Z`).getTime();
  const end = new Date(`${endIso}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

// Shared "actual FX rate" widget — today's rate + a filterable, multi-currency
// period-average table. Used both on the internal /aidat/rates page (with
// canWrite=true showing sync/backfill buttons) and read-only on the public
// homepage (canWrite omitted) — reading fx_rates works unauthenticated too
// since it's public reference data (see the anon SELECT policy added in
// 20260810000009_fx_rates_public_read.sql). Deliberately excludes the
// "Kur Tahmini" (per-site manual forecast) section — that's private,
// site-scoped budgeting data, not public market data.
export default function FxRatesPanel({ canWrite = false }: { canWrite?: boolean }) {
  const [latestRates, setLatestRates] = useState<FxRate[]>([]);
  const [latestLoading, setLatestLoading] = useState(true);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [selectedCurrencies, setSelectedCurrencies] = useState<Currency[]>(CURRENCIES);
  const [avgStart, setAvgStart] = useState(firstOfMonthIso(todayIso()));
  const [avgEnd, setAvgEnd] = useState(todayIso());
  const [avgResults, setAvgResults] = useState<AverageResult[]>([]);
  const [avgLoading, setAvgLoading] = useState(false);
  const [avgError, setAvgError] = useState<string | null>(null);
  const [avgComputed, setAvgComputed] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const totalDaysInRange = useMemo(() => daysBetweenInclusive(avgStart, avgEnd), [avgStart, avgEnd]);

  const loadLatestRates = useCallback(async () => {
    setLatestLoading(true);
    setLatestError(null);
    const { data, error } = await supabase
      .from("fx_rates")
      .select("id, rate_date, currency, buying, selling, source")
      .order("rate_date", { ascending: false })
      .limit(20);
    if (error) {
      setLatestError(error.message);
      setLatestLoading(false);
      return;
    }
    const rows = (data ?? []) as FxRate[];
    const latestByCurrency = new Map<Currency, FxRate>();
    for (const row of rows) {
      if (!latestByCurrency.has(row.currency)) latestByCurrency.set(row.currency, row);
    }
    setLatestRates(CURRENCIES.map((c) => latestByCurrency.get(c)).filter((r): r is FxRate => !!r));
    setLatestLoading(false);
  }, []);

  useEffect(() => {
    loadLatestRates();
  }, [loadLatestRates]);

  async function handleSyncNow() {
    if (!canWrite) return;
    setSyncing(true);
    setSyncMessage(null);
    setLatestError(null);
    try {
      const res = await fetch("/api/fx-rates/tcmb-sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "TCMB güncellemesi başarısız oldu.");
      setSyncMessage(`Güncellendi: ${body.resolvedDate}`);
      await loadLatestRates();
    } catch (err) {
      setLatestError(err instanceof Error ? err.message : "TCMB güncellemesi başarısız oldu.");
    } finally {
      setSyncing(false);
    }
  }

  function toggleCurrency(c: Currency) {
    setSelectedCurrencies((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  const handleComputeAverage = useCallback(async () => {
    if (selectedCurrencies.length === 0) {
      setAvgError("En az bir para birimi seçin.");
      return;
    }
    if (!avgStart || !avgEnd) {
      setAvgError("Geçerli bir başlangıç ve bitiş tarihi girin (gg.aa.yyyy).");
      return;
    }
    if (avgStart > avgEnd) {
      setAvgError("Başlangıç tarihi bitiş tarihinden sonra olamaz.");
      return;
    }
    setAvgLoading(true);
    setAvgError(null);
    setAvgComputed(false);
    const { data, error } = await supabase
      .from("fx_rates")
      .select("id, rate_date, currency, buying, selling, source")
      .in("currency", selectedCurrencies)
      .gte("rate_date", avgStart)
      .lte("rate_date", avgEnd)
      .order("rate_date", { ascending: true });
    if (error) {
      setAvgError(error.message);
      setAvgLoading(false);
      return;
    }
    const rows = (data ?? []) as FxRate[];
    const results: AverageResult[] = selectedCurrencies.map((currency) => {
      const currencyRows = rows.filter((r) => r.currency === currency);
      const buying = currencyRows.length ? currencyRows.reduce((s, r) => s + r.buying, 0) / currencyRows.length : 0;
      const selling = currencyRows.length ? currencyRows.reduce((s, r) => s + r.selling, 0) / currencyRows.length : 0;
      return { currency, buying, selling, daysWithData: currencyRows.length };
    });
    setAvgResults(results);
    setAvgComputed(true);
    setAvgLoading(false);
  }, [selectedCurrencies, avgStart, avgEnd]);

  async function handleBackfill() {
    if (!canWrite) return;
    setBackfilling(true);
    setBackfillMessage(null);
    try {
      const res = await fetch("/api/fx-rates/tcmb-sync-range", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: avgStart, endDate: avgEnd }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Geçmiş veri çekme başarısız oldu.");
      setBackfillMessage(
        `${body.fetched} gün TCMB'den çekildi, ${body.alreadyPresent} gün zaten mevcuttu${body.failed ? `, ${body.failed} gün alınamadı` : ""}.`
      );
      await handleComputeAverage();
    } catch (err) {
      setBackfillMessage(err instanceof Error ? err.message : "Geçmiş veri çekme başarısız oldu.");
    } finally {
      setBackfilling(false);
    }
  }

  const hasAnyData = avgResults.some((r) => r.daysWithData > 0);

  return (
    <>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Bugünün Kurları (TCMB)</div>
          {canWrite && (
            <button className="btn-primary" onClick={handleSyncNow} disabled={syncing}>
              {syncing ? "Güncelleniyor…" : "Şimdi Güncelle"}
            </button>
          )}
        </div>

        {syncMessage && <div className="kpi-sub" style={{ marginBottom: 8 }}>{syncMessage}</div>}
        {latestError && <div className="auth-error">{latestError}</div>}

        {latestLoading ? (
          <div className="empty-state">Yükleniyor…</div>
        ) : latestRates.length === 0 ? (
          <div className="empty-state">
            Henüz kur verisi bulunmuyor. {canWrite ? "\"Şimdi Güncelle\" ile TCMB'den çekebilirsiniz." : ""}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Para Birimi</th>
                  <th>Tarih</th>
                  <th className="num">Alış</th>
                  <th className="num">Satış</th>
                  <th>Kaynak</th>
                </tr>
              </thead>
              <tbody>
                {latestRates.map((r) => (
                  <tr key={r.id}>
                    <td>{r.currency}</td>
                    <td>{r.rate_date}</td>
                    <td className="num">{formatRate(r.buying)}</td>
                    <td className="num">{formatRate(r.selling)}</td>
                    <td><span className="pill pill-blue">{r.source}</span></td>
                  </tr>
                ))}
                <tr>
                  <td>TRY</td>
                  <td>—</td>
                  <td className="num">1.0000</td>
                  <td className="num">1.0000</td>
                  <td><span className="pill pill-neutral">baz</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Dönem Ortalama Kur</div>
        </div>

        <div className="form-grid" style={{ alignItems: "flex-end" }}>
          <label className="auth-field">
            <span>Para Birimi</span>
            <div style={{ display: "flex", gap: 14, paddingTop: 6 }}>
              {CURRENCIES.map((c) => (
                <label key={c} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text)", cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedCurrencies.includes(c)} onChange={() => toggleCurrency(c)} />
                  {c}
                </label>
              ))}
            </div>
          </label>
          <label className="auth-field">
            <span>Başlangıç Tarihi</span>
            <TrDateInput value={avgStart} onChange={setAvgStart} />
          </label>
          <label className="auth-field">
            <span>Bitiş Tarihi</span>
            <TrDateInput value={avgEnd} onChange={setAvgEnd} />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn-primary" onClick={handleComputeAverage} disabled={avgLoading}>
              {avgLoading ? "Hesaplanıyor…" : "Hesapla"}
            </button>
          </div>
        </div>

        {avgError && <div className="auth-error">{avgError}</div>}

        {avgComputed && (
          <>
            <div className="table-scroll" style={{ marginBottom: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Para Birimi</th>
                    <th className="num">Ortalama Alış</th>
                    <th className="num">Ortalama Satış</th>
                    <th>Veri</th>
                  </tr>
                </thead>
                <tbody>
                  {avgResults.map((r) => (
                    <tr key={r.currency}>
                      <td>{r.currency}</td>
                      <td className="num">{r.daysWithData > 0 ? formatRate(r.buying) : "—"}</td>
                      <td className="num">{r.daysWithData > 0 ? formatRate(r.selling) : "—"}</td>
                      <td>{r.daysWithData}/{totalDaysInRange} gün</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!hasAnyData ? (
              <div className="empty-state">
                Seçilen aralıkta ({avgStart} – {avgEnd}) TCMB kur verisi bulunamadı.
                {canWrite && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn-primary" onClick={handleBackfill} disabled={backfilling}>
                      {backfilling ? "Çekiliyor…" : "TCMB'den Geçmiş Veri Çek"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="kpi-sub">
                Hafta sonu / resmi tatil günlerinde TCMB bülteni yayınlanmadığından bu günler ortalamaya dahil edilmemiştir.
                {canWrite && (
                  <button className="btn-primary" onClick={handleBackfill} disabled={backfilling} style={{ marginLeft: 10 }}>
                    {backfilling ? "Çekiliyor…" : "Eksik Günleri TCMB'den Çek"}
                  </button>
                )}
              </div>
            )}
            {backfillMessage && <div className="kpi-sub" style={{ marginTop: 8 }}>{backfillMessage}</div>}
          </>
        )}
      </div>
    </>
  );
}
