"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

type Currency = "USD" | "EUR";

const CURRENCIES: Currency[] = ["USD", "EUR"];

type FxRate = {
  id: string;
  rate_date: string;
  currency: Currency;
  buying: number;
  selling: number;
  source: string;
  created_at: string;
};

type FxForecast = {
  id: string;
  site_id: string;
  currency: Currency;
  forecast_month: string; // YYYY-MM-01
  rate: number;
  created_at: string;
};

const rateFormatter = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

function formatRate(n: number): string {
  return rateFormatter.format(n);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

function nextMonthIso(dateIso: string): string {
  const [y, m] = dateIso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function daysBetweenInclusive(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00Z`).getTime();
  const end = new Date(`${endIso}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

export default function RatesPage() {
  const { selectedSiteId, canWrite, user } = useAidat();

  // "Bugünün Kurları"
  const [latestRates, setLatestRates] = useState<FxRate[]>([]);
  const [latestLoading, setLatestLoading] = useState(true);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // "Dönem Ortalama Kur"
  const [avgCurrency, setAvgCurrency] = useState<Currency>("USD");
  const [avgStart, setAvgStart] = useState(firstOfMonthIso(todayIso()));
  const [avgEnd, setAvgEnd] = useState(todayIso());
  const [avgRows, setAvgRows] = useState<FxRate[]>([]);
  const [avgLoading, setAvgLoading] = useState(false);
  const [avgError, setAvgError] = useState<string | null>(null);
  const [avgComputed, setAvgComputed] = useState(false);

  // "Kur Tahmini (İleri Dönem)"
  const [forecasts, setForecasts] = useState<FxForecast[]>([]);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [fCurrency, setFCurrency] = useState<Currency>("USD");
  const [fMonth, setFMonth] = useState(nextMonthIso(todayIso()).slice(0, 7));
  const [fRate, setFRate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [forecastSaving, setForecastSaving] = useState(false);

  const loadLatestRates = useCallback(async () => {
    setLatestLoading(true);
    setLatestError(null);
    const { data, error } = await supabase
      .from("fx_rates")
      .select("id, rate_date, currency, buying, selling, source, created_at")
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

  const loadForecasts = useCallback(async () => {
    if (!selectedSiteId) {
      setForecasts([]);
      setForecastLoading(false);
      return;
    }
    setForecastLoading(true);
    setForecastError(null);
    const { data, error } = await supabase
      .from("fx_forecasts")
      .select("id, site_id, currency, forecast_month, rate, created_at")
      .eq("site_id", selectedSiteId)
      .order("forecast_month", { ascending: true })
      .order("currency", { ascending: true });
    if (error) {
      setForecastError(error.message);
    } else {
      setForecasts((data ?? []) as FxForecast[]);
    }
    setForecastLoading(false);
  }, [selectedSiteId]);

  useEffect(() => {
    loadLatestRates();
  }, [loadLatestRates]);

  useEffect(() => {
    loadForecasts();
  }, [loadForecasts]);

  async function handleSyncNow() {
    if (!canWrite) return;
    setSyncing(true);
    setSyncMessage(null);
    setLatestError(null);
    try {
      const res = await fetch("/api/fx-rates/tcmb-sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? "TCMB güncellemesi başarısız oldu.");
      }
      setSyncMessage(`Güncellendi: ${body.resolvedDate}`);
      await loadLatestRates();
    } catch (err) {
      setLatestError(err instanceof Error ? err.message : "TCMB güncellemesi başarısız oldu.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleComputeAverage() {
    setAvgLoading(true);
    setAvgError(null);
    setAvgComputed(false);
    const { data, error } = await supabase
      .from("fx_rates")
      .select("id, rate_date, currency, buying, selling, source, created_at")
      .eq("currency", avgCurrency)
      .gte("rate_date", avgStart)
      .lte("rate_date", avgEnd)
      .order("rate_date", { ascending: true });
    if (error) {
      setAvgError(error.message);
      setAvgLoading(false);
      return;
    }
    setAvgRows((data ?? []) as FxRate[]);
    setAvgComputed(true);
    setAvgLoading(false);
  }

  const avgBuying = useMemo(
    () => (avgRows.length ? avgRows.reduce((s, r) => s + r.buying, 0) / avgRows.length : null),
    [avgRows]
  );
  const avgSelling = useMemo(
    () => (avgRows.length ? avgRows.reduce((s, r) => s + r.selling, 0) / avgRows.length : null),
    [avgRows]
  );
  const totalDaysInRange = useMemo(() => daysBetweenInclusive(avgStart, avgEnd), [avgStart, avgEnd]);

  function resetForecastForm() {
    setEditingId(null);
    setFCurrency("USD");
    setFMonth(nextMonthIso(todayIso()).slice(0, 7));
    setFRate("");
  }

  function startEditForecast(f: FxForecast) {
    setEditingId(f.id);
    setFCurrency(f.currency);
    setFMonth(f.forecast_month.slice(0, 7));
    setFRate(String(f.rate));
  }

  async function handleSaveForecast(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !canWrite || !fRate) return;
    setForecastSaving(true);
    setForecastError(null);
    const forecastMonthDate = `${fMonth}-01`;

    if (editingId) {
      const { error } = await supabase
        .from("fx_forecasts")
        .update({ currency: fCurrency, forecast_month: forecastMonthDate, rate: Number(fRate) })
        .eq("id", editingId)
        .eq("site_id", selectedSiteId);
      setForecastSaving(false);
      if (error) {
        setForecastError(error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("fx_forecasts").insert({
        site_id: selectedSiteId,
        currency: fCurrency,
        forecast_month: forecastMonthDate,
        rate: Number(fRate),
        created_by: user?.id ?? null,
      });
      setForecastSaving(false);
      if (error) {
        setForecastError(
          error.message.includes("duplicate")
            ? "Bu ay ve döviz için zaten bir tahmin var. Listeden düzenleyebilirsiniz."
            : error.message
        );
        return;
      }
    }
    resetForecastForm();
    await loadForecasts();
  }

  async function handleDeleteForecast(f: FxForecast) {
    if (!canWrite || !selectedSiteId) return;
    if (!window.confirm("Bu kur tahminini silmek istediğinize emin misiniz?")) return;
    setForecastError(null);
    const { error } = await supabase
      .from("fx_forecasts")
      .delete()
      .eq("id", f.id)
      .eq("site_id", selectedSiteId);
    if (error) {
      setForecastError(error.message);
      return;
    }
    if (editingId === f.id) resetForecastForm();
    await loadForecasts();
  }

  return (
    <div>
      <div className="kpi-grid">
        {CURRENCIES.map((c) => {
          const rate = latestRates.find((r) => r.currency === c);
          return (
            <div className="kpi-card" key={c}>
              <div className="kpi-label">{c} / TRY (Satış)</div>
              <div className="kpi-value">{rate ? formatRate(rate.selling) : "—"}</div>
              <div className="kpi-sub">{rate ? rate.rate_date : "Veri yok"}</div>
            </div>
          );
        })}
        <div className="kpi-card">
          <div className="kpi-label">TRY / TRY</div>
          <div className="kpi-value">1.0000</div>
          <div className="kpi-sub">Baz para birimi</div>
        </div>
      </div>

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
          <div className="empty-state">Henüz kur verisi bulunmuyor. {canWrite ? "\"Şimdi Güncelle\" ile TCMB'den çekebilirsiniz." : ""}</div>
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
                    <td>
                      <span className="pill pill-blue">{r.source}</span>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>TRY</td>
                  <td>—</td>
                  <td className="num">1.0000</td>
                  <td className="num">1.0000</td>
                  <td>
                    <span className="pill pill-neutral">baz</span>
                  </td>
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

        <div className="form-grid">
          <label className="auth-field">
            <span>Para Birimi</span>
            <select value={avgCurrency} onChange={(e) => setAvgCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Başlangıç Tarihi</span>
            <input type="date" value={avgStart} onChange={(e) => setAvgStart(e.target.value)} max={avgEnd} />
          </label>
          <label className="auth-field">
            <span>Bitiş Tarihi</span>
            <input type="date" value={avgEnd} onChange={(e) => setAvgEnd(e.target.value)} min={avgStart} />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn-primary" onClick={handleComputeAverage} disabled={avgLoading}>
              {avgLoading ? "Hesaplanıyor…" : "Hesapla"}
            </button>
          </div>
        </div>

        {avgError && <div className="auth-error">{avgError}</div>}

        {avgComputed && (
          avgRows.length === 0 ? (
            <div className="empty-state">
              Seçilen aralıkta ({avgStart} – {avgEnd}) TCMB kur verisi bulunamadı.
            </div>
          ) : (
            <>
              <div className="kpi-grid">
                <div className="kpi-card">
                  <div className="kpi-label">{avgCurrency} Ortalama Alış</div>
                  <div className="kpi-value">{formatRate(avgBuying ?? 0)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">{avgCurrency} Ortalama Satış</div>
                  <div className="kpi-value">{formatRate(avgSelling ?? 0)}</div>
                </div>
              </div>
              <div className="kpi-sub">
                {totalDaysInRange} günün {avgRows.length}&apos;i için veri mevcut (hafta sonu / resmi tatil günlerinde
                TCMB bülteni yayınlanmadığından bu günler ortalamaya dahil edilmemiştir).
              </div>
            </>
          )
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Kur Tahmini (İleri Dönem)</div>
        </div>

        {canWrite && (
          <form onSubmit={handleSaveForecast} className="form-grid">
            <label className="auth-field">
              <span>Para Birimi</span>
              <select value={fCurrency} onChange={(e) => setFCurrency(e.target.value as Currency)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span>Ay</span>
              <input type="month" value={fMonth} onChange={(e) => setFMonth(e.target.value)} required />
            </label>
            <label className="auth-field">
              <span>Tahmini Kur (TRY)</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={fRate}
                onChange={(e) => setFRate(e.target.value)}
                required
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <button className="btn-primary" type="submit" disabled={forecastSaving || !fRate}>
                {forecastSaving ? "Kaydediliyor…" : editingId ? "Güncelle" : "Tahmin Ekle"}
              </button>
              {editingId && (
                <button type="button" className="btn-secondary" onClick={resetForecastForm}>
                  Vazgeç
                </button>
              )}
            </div>
          </form>
        )}

        {forecastError && <div className="auth-error">{forecastError}</div>}

        {forecastLoading ? (
          <div className="empty-state">Yükleniyor…</div>
        ) : forecasts.length === 0 ? (
          <div className="empty-state">Bu site için henüz kur tahmini girilmemiş.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ay</th>
                  <th>Para Birimi</th>
                  <th className="num">Tahmini Kur</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {forecasts.map((f) => (
                  <tr key={f.id}>
                    <td>{f.forecast_month.slice(0, 7)}</td>
                    <td>{f.currency}</td>
                    <td className="num">{formatRate(f.rate)}</td>
                    {canWrite && (
                      <td style={{ display: "flex", gap: 8 }}>
                        <button className="btn-secondary" onClick={() => startEditForecast(f)}>
                          Düzenle
                        </button>
                        <button className="btn-danger" onClick={() => handleDeleteForecast(f)}>
                          Sil
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
