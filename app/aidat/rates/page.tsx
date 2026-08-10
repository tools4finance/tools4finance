"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";
import FxRatesPanel from "@/components/FxRatesPanel";

type Currency = "USD" | "EUR";
const CURRENCIES: Currency[] = ["USD", "EUR"];

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

function nextMonthIso(dateIso: string): string {
  const [y, m] = dateIso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export default function RatesPage() {
  const { selectedSiteId, canWrite, user } = useAidat();

  // "Kur Tahmini (İleri Dönem)" — site-scoped manual forecasts, unrelated to
  // the shared FxRatesPanel (today's rate / period average), stays bespoke.
  const [forecasts, setForecasts] = useState<FxForecast[]>([]);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [fCurrency, setFCurrency] = useState<Currency>("USD");
  const [fMonth, setFMonth] = useState(nextMonthIso(todayIso()).slice(0, 7));
  const [fRate, setFRate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [forecastSaving, setForecastSaving] = useState(false);

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
    loadForecasts();
  }, [loadForecasts]);

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
      <FxRatesPanel canWrite={canWrite} />

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
