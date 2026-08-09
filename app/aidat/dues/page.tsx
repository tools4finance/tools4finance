"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

type AccrualType = "monthly_dues" | "additional_dues" | "special_assessment" | "penalty" | "other";
type AccrualStatus = "active" | "void";

const ACCRUAL_TYPE_LABELS: Record<AccrualType, string> = {
  monthly_dues: "Aylık Aidat",
  additional_dues: "Ek Aidat",
  special_assessment: "Özel Tahakkuk",
  penalty: "Gecikme Cezası",
  other: "Diğer",
};

const ACCRUAL_TYPE_PILL: Record<AccrualType, string> = {
  monthly_dues: "pill-blue",
  additional_dues: "pill-green",
  special_assessment: "pill-amber",
  penalty: "pill-coral",
  other: "pill-neutral",
};

// Ad-hoc accruals don't include monthly_dues — that's created only via the
// bulk-generation flow so the unique (unit, period) guard has one entry point.
const ADHOC_ACCRUAL_TYPES: AccrualType[] = ["additional_dues", "special_assessment", "penalty", "other"];

type UnitOption = {
  id: string;
  unit_number: string;
  block_name: string | null;
};

function unitOptionLabel(u: UnitOption) {
  return u.block_name ? `${u.block_name} — ${u.unit_number}` : u.unit_number;
}

type AccrualRow = {
  id: string;
  unit_id: string;
  accrual_type: AccrualType;
  description: string | null;
  amount: number;
  due_date: string | null;
  status: AccrualStatus;
  unit_number: string;
  block_name: string | null;
};

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type RawUnitRow = { id: string; unit_number: string; block: { name: string } | { name: string }[] | null };

function normalizeUnitOption(row: RawUnitRow): UnitOption {
  const block = Array.isArray(row.block) ? row.block[0] : row.block;
  return { id: row.id, unit_number: row.unit_number, block_name: block?.name ?? null };
}

type RawAccrualRow = {
  id: string;
  unit_id: string;
  accrual_type: AccrualType;
  description: string | null;
  amount: number;
  due_date: string | null;
  status: AccrualStatus;
  unit: RawUnitRow | RawUnitRow[] | null;
};

function normalizeAccrualRow(row: RawAccrualRow): AccrualRow {
  const unit = Array.isArray(row.unit) ? row.unit[0] : row.unit;
  const block = unit ? (Array.isArray(unit.block) ? unit.block[0] : unit.block) : null;
  return {
    id: row.id,
    unit_id: row.unit_id,
    accrual_type: row.accrual_type,
    description: row.description,
    amount: row.amount,
    due_date: row.due_date,
    status: row.status,
    unit_number: unit?.unit_number ?? "—",
    block_name: block?.name ?? null,
  };
}

export default function DuesPage() {
  const { selectedSiteId, canWrite, year, month, user } = useAidat();

  const [units, setUnits] = useState<UnitOption[]>([]);
  const [accruals, setAccruals] = useState<AccrualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bulk generation — amount comes from each unit's own dues_rules row
  // (site-wide default as fallback), set on the Daireler page; no more
  // typing a single flat amount here.
  const [unitRateById, setUnitRateById] = useState<Record<string, number>>({});
  const [siteDefaultRate, setSiteDefaultRate] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{ created: number; alreadyExists: number; noRate: number } | null>(
    null
  );

  // Ad-hoc accrual form
  const [showAdhocForm, setShowAdhocForm] = useState(false);
  const [adhoc, setAdhoc] = useState({
    unit_id: "",
    accrual_type: "additional_dues" as AccrualType,
    description: "",
    amount: "",
    accrual_date: todayIso(),
    due_date: "",
  });
  const [savingAdhoc, setSavingAdhoc] = useState(false);

  const [voidingId, setVoidingId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);

    const unitsRes = await supabase
      .from("units")
      .select("id, unit_number, block:blocks(name)")
      .eq("site_id", selectedSiteId)
      .eq("active", true)
      .order("unit_number", { ascending: true });

    if (unitsRes.error) {
      setError(unitsRes.error.message);
      setLoading(false);
      return;
    }
    const unitOptions = ((unitsRes.data ?? []) as unknown as RawUnitRow[]).map(normalizeUnitOption);
    setUnits(unitOptions);

    // Per-unit dues amounts (set on the Daireler page) + a site-wide default
    // rule (unit_id null) used as a fallback for any unit without its own.
    const rulesRes = await supabase
      .from("dues_rules")
      .select("unit_id, amount")
      .eq("site_id", selectedSiteId)
      .eq("active", true);
    if (!rulesRes.error && rulesRes.data) {
      const perUnit: Record<string, number> = {};
      let defaultRate: number | null = null;
      for (const rule of rulesRes.data as { unit_id: string | null; amount: number }[]) {
        if (rule.unit_id) perUnit[rule.unit_id] = rule.amount;
        else defaultRate = rule.amount;
      }
      setUnitRateById(perUnit);
      setSiteDefaultRate(defaultRate);
    }

    // Only look at accruals for the currently selected period. If no
    // fiscal_periods row exists yet for this site/year/month, nothing has
    // been accrued and the list is simply empty — we don't create the row
    // just to read it (only the generate/ad-hoc actions do that).
    const periodRes = await supabase
      .from("fiscal_periods")
      .select("id")
      .eq("site_id", selectedSiteId)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    if (periodRes.error) {
      setError(periodRes.error.message);
      setAccruals([]);
      setLoading(false);
      return;
    }

    if (!periodRes.data) {
      setAccruals([]);
      setLoading(false);
      return;
    }

    const accrualsRes = await supabase
      .from("accruals")
      .select("id, unit_id, accrual_type, description, amount, due_date, status, unit:units(unit_number, block:blocks(name))")
      .eq("site_id", selectedSiteId)
      .eq("fiscal_period_id", periodRes.data.id)
      .order("created_at", { ascending: false });

    if (accrualsRes.error) {
      setError(accrualsRes.error.message);
      setAccruals([]);
      setLoading(false);
      return;
    }

    setAccruals(((accrualsRes.data ?? []) as unknown as RawAccrualRow[]).map(normalizeAccrualRow));
    setLoading(false);
  }, [selectedSiteId, year, month]);

  useEffect(() => {
    setGenResult(null);
    fetchAll();
  }, [fetchAll]);

  const unitsMissingRate = units.filter((u) => unitRateById[u.id] == null && siteDefaultRate == null);

  async function handleGenerate() {
    if (!selectedSiteId || !user) return;

    setGenerating(true);
    setError(null);
    setGenResult(null);

    try {
      if (units.length === 0) {
        throw new Error("Sitede aktif daire bulunamadı.");
      }

      const { data: fiscalPeriodId, error: fpError } = await supabase.rpc("get_or_create_fiscal_period", {
        p_site_id: selectedSiteId,
        p_year: year,
        p_month: month,
      });
      if (fpError) throw fpError;

      const existingRes = await supabase
        .from("accruals")
        .select("unit_id")
        .eq("site_id", selectedSiteId)
        .eq("fiscal_period_id", fiscalPeriodId as string)
        .eq("accrual_type", "monthly_dues")
        .eq("status", "active");
      if (existingRes.error) throw existingRes.error;

      const existingUnitIds = new Set((existingRes.data ?? []).map((r) => r.unit_id as string));
      const candidates = units.filter((u) => !existingUnitIds.has(u.id));
      const alreadyExists = units.length - candidates.length;

      // Every candidate needs a rate — its own dues_rules row, or the
      // site-wide default. Units with neither are skipped and reported by
      // name so the user knows exactly which Daireler need a rate set.
      const toInsert = candidates.filter((u) => unitRateById[u.id] != null || siteDefaultRate != null);
      const noRate = candidates.length - toInsert.length;

      if (toInsert.length === 0) {
        setGenResult({ created: 0, alreadyExists, noRate });
        return;
      }

      const rows = toInsert.map((u) => ({
        site_id: selectedSiteId,
        unit_id: u.id,
        fiscal_period_id: fiscalPeriodId as string,
        accrual_type: "monthly_dues" as const,
        description: "Aylık Aidat",
        amount: unitRateById[u.id] ?? (siteDefaultRate as number),
        accrual_date: todayIso(),
        created_by: user.id,
      }));

      let created = 0;
      let extraSkipped = 0;
      let lastRowError: string | null = null;

      const bulkRes = await supabase.from("accruals").insert(rows).select("id");
      if (!bulkRes.error) {
        created = bulkRes.data?.length ?? 0;
      } else {
        // Bulk insert failed (most likely a race on the unique monthly_dues
        // constraint) — fall back to inserting row by row so one collision
        // doesn't sink the whole batch. Duplicate-key errors are treated as
        // "already exists, skipped"; anything else is a real failure.
        for (const row of rows) {
          const rowRes = await supabase.from("accruals").insert(row);
          if (rowRes.error) {
            extraSkipped++;
            if (rowRes.error.code !== "23505") lastRowError = rowRes.error.message;
          } else {
            created++;
          }
        }
      }

      if (created === 0 && extraSkipped > 0 && lastRowError) {
        throw new Error(lastRowError);
      }

      setGenResult({ created, alreadyExists: alreadyExists + extraSkipped, noRate });
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tahakkuk oluşturulurken hata oluştu.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreateAdhoc(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !user) return;
    const amount = Number(adhoc.amount);
    if (!adhoc.unit_id || !amount || amount <= 0) {
      setError("Daire ve geçerli bir tutar seçin.");
      return;
    }

    setSavingAdhoc(true);
    setError(null);

    const { data: fiscalPeriodId, error: fpError } = await supabase.rpc("get_or_create_fiscal_period", {
      p_site_id: selectedSiteId,
      p_year: year,
      p_month: month,
    });
    if (fpError) {
      setError(fpError.message);
      setSavingAdhoc(false);
      return;
    }

    const { error: insertError } = await supabase.from("accruals").insert({
      site_id: selectedSiteId,
      unit_id: adhoc.unit_id,
      fiscal_period_id: fiscalPeriodId as string,
      accrual_type: adhoc.accrual_type,
      description: adhoc.description.trim() || null,
      amount,
      accrual_date: adhoc.accrual_date || todayIso(),
      due_date: adhoc.due_date || null,
      created_by: user.id,
    });

    setSavingAdhoc(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    setAdhoc({
      unit_id: "",
      accrual_type: "additional_dues",
      description: "",
      amount: "",
      accrual_date: todayIso(),
      due_date: "",
    });
    setShowAdhocForm(false);
    await fetchAll();
  }

  async function handleVoid(accrual: AccrualRow) {
    const reason = window.prompt("İptal gerekçesi (kısa açıklama):");
    if (reason === null) return;
    if (!reason.trim()) {
      setError("İptal için bir gerekçe girmelisiniz.");
      return;
    }

    setVoidingId(accrual.id);
    setError(null);
    const { error: updateError } = await supabase
      .from("accruals")
      .update({ status: "void", voided_reason: reason.trim() })
      .eq("id", accrual.id);
    setVoidingId(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    await fetchAll();
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      {canWrite && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Aylık Aidat Tahakkuku</div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
            Seçili dönem ({month}/{year}) için sitedeki tüm aktif dairelere, her dairenin{" "}
            <strong>Daireler</strong> sayfasında tanımlı kendi aylık aidat tutarıyla tahakkuk oluşturur. Daha önce
            tahakkuk oluşturulmuş daireler otomatik olarak atlanır.
          </p>
          {unitsMissingRate.length > 0 && (
            <div className="auth-error" style={{ marginBottom: 16 }}>
              {unitsMissingRate.length} dairenin aidat tutarı tanımlı değil ({unitsMissingRate.map(unitOptionLabel).join(", ")}).
              Tahakkuk oluşturmadan önce <strong>Daireler</strong> sayfasından tutarlarını girin, ya da bu daireler
              atlanarak devam edin.
            </div>
          )}
          <button className="btn-primary" onClick={handleGenerate} disabled={generating || units.length === 0}>
            {generating ? "Oluşturuluyor…" : "Bu Ay İçin Aidat Tahakkuku Oluştur"}
          </button>
          {genResult && (
            <div className="auth-info" style={{ marginTop: 12 }}>
              {genResult.created} daire için tahakkuk oluşturuldu, {genResult.alreadyExists} daire zaten
              tahakkuklandığı için atlandı
              {genResult.noRate > 0 && `, ${genResult.noRate} dairenin aidat tutarı tanımlı olmadığı için atlandı`}.
            </div>
          )}
        </div>
      )}

      {canWrite && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Ek / Özel Tahakkuk</div>
            <button className="btn-secondary" onClick={() => setShowAdhocForm((v) => !v)}>
              {showAdhocForm ? "Vazgeç" : "+ Tahakkuk Ekle"}
            </button>
          </div>

          {showAdhocForm && (
            <form onSubmit={handleCreateAdhoc} className="form-grid">
              <label className="auth-field">
                <span>Daire</span>
                <select
                  value={adhoc.unit_id}
                  onChange={(e) => setAdhoc((f) => ({ ...f, unit_id: e.target.value }))}
                  required
                >
                  <option value="">Seçiniz</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.block_name ? `${u.block_name} / ${u.unit_number}` : u.unit_number}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-field">
                <span>Tahakkuk Türü</span>
                <select
                  value={adhoc.accrual_type}
                  onChange={(e) => setAdhoc((f) => ({ ...f, accrual_type: e.target.value as AccrualType }))}
                >
                  {ADHOC_ACCRUAL_TYPES.map((t) => (
                    <option key={t} value={t}>{ACCRUAL_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
              <label className="auth-field">
                <span>Açıklama</span>
                <input
                  value={adhoc.description}
                  onChange={(e) => setAdhoc((f) => ({ ...f, description: e.target.value }))}
                  placeholder="opsiyonel"
                />
              </label>
              <label className="auth-field">
                <span>Tutar</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={adhoc.amount}
                  onChange={(e) => setAdhoc((f) => ({ ...f, amount: e.target.value }))}
                  required
                />
              </label>
              <label className="auth-field">
                <span>Tahakkuk Tarihi</span>
                <input
                  type="date"
                  value={adhoc.accrual_date}
                  onChange={(e) => setAdhoc((f) => ({ ...f, accrual_date: e.target.value }))}
                  required
                />
              </label>
              <label className="auth-field">
                <span>Vade Tarihi</span>
                <input
                  type="date"
                  value={adhoc.due_date}
                  onChange={(e) => setAdhoc((f) => ({ ...f, due_date: e.target.value }))}
                />
              </label>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  className="btn-primary"
                  type="submit"
                  disabled={savingAdhoc || !adhoc.unit_id || !adhoc.amount}
                >
                  {savingAdhoc ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Tahakkuklar ({month}/{year})</div>
        </div>

        {accruals.length === 0 ? (
          <div className="empty-state">Seçili dönem için tahakkuk bulunmuyor.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Daire</th>
                  <th>Tür</th>
                  <th>Açıklama</th>
                  <th className="num">Tutar</th>
                  <th>Vade Tarihi</th>
                  <th>Durum</th>
                  {canWrite && <th>Aksiyon</th>}
                </tr>
              </thead>
              <tbody>
                {accruals.map((a) => (
                  <tr key={a.id}>
                    <td>{a.block_name ? `${a.block_name} / ${a.unit_number}` : a.unit_number}</td>
                    <td>
                      <span className={`pill ${ACCRUAL_TYPE_PILL[a.accrual_type]}`}>
                        {ACCRUAL_TYPE_LABELS[a.accrual_type]}
                      </span>
                    </td>
                    <td className="wrap">{a.description ?? "—"}</td>
                    <td className="num">{currency.format(a.amount)}</td>
                    <td>{a.due_date ?? "—"}</td>
                    <td>
                      <span className={`pill ${a.status === "active" ? "pill-green" : "pill-neutral"}`}>
                        {a.status === "active" ? "Aktif" : "İptal"}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        {a.status === "active" && (
                          <button
                            className="btn-danger"
                            onClick={() => handleVoid(a)}
                            disabled={voidingId === a.id}
                          >
                            {voidingId === a.id ? "…" : "İptal Et"}
                          </button>
                        )}
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
