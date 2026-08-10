"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCs } from "@/lib/csContext";
import { supabase } from "@/lib/supabase";
import { hasAnyParameters, loadDefaultParameters } from "@/lib/csData";
import {
  totalActiveWeight,
  checkBandIssues,
  bandRangeLabel,
  SOURCE_FIELD_OPTIONS,
  type Criterion,
  type LookupValue,
  type Band,
  type CriterionFormulaType,
  type CriterionDirection,
  type CustomerFieldName,
} from "@/lib/customerScoring";

// ---------------------------------------------------------------------------
// Generic editable sub-table — used for both a criterion's lookup values and
// its bands, and for the (still generic, untouched) grade-thresholds table.
// insertExtra supplies the FK the table needs beyond its own columns
// (criterion_id for lookup values/bands, user_id for grade thresholds).
// ---------------------------------------------------------------------------

type ColumnType = "text" | "number" | "nullableNumber" | "select";

type ColumnDef<T> = {
  key: keyof T;
  label: string;
  type: ColumnType;
  options?: { value: string; label: string }[];
};

function ParamTable<T extends { id: string }>({
  tableName,
  columns,
  rows,
  setRows,
  newRowTemplate,
  insertExtra,
  compact,
}: {
  tableName: string;
  columns: ColumnDef<T>[];
  rows: T[];
  setRows: (rows: T[]) => void;
  newRowTemplate: () => Omit<T, "id">;
  insertExtra: Record<string, unknown>;
  compact?: boolean;
}) {
  const [newRow, setNewRow] = useState<Omit<T, "id">>(newRowTemplate());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateCell(id: string, key: keyof T, value: unknown) {
    setRows(rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  }

  function parseValue(type: ColumnType, raw: string): unknown {
    if (type === "number") return raw === "" ? 0 : Number(raw);
    if (type === "nullableNumber") return raw === "" ? null : Number(raw);
    return raw;
  }

  async function handleSaveRow(row: T) {
    setSavingId(row.id);
    setError(null);
    const patch: Record<string, unknown> = {};
    for (const col of columns) patch[col.key as string] = row[col.key];
    const { error: updateError } = await supabase.from(tableName).update(patch).eq("id", row.id);
    setSavingId(null);
    if (updateError) setError(updateError.message);
  }

  async function handleDeleteRow(id: string) {
    setError(null);
    const { error: deleteError } = await supabase.from(tableName).delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setRows(rows.filter((r) => r.id !== id));
  }

  async function handleAddRow() {
    setAdding(true);
    setError(null);
    const { data, error: insertError } = await supabase
      .from(tableName)
      .insert({ ...newRow, ...insertExtra })
      .select()
      .single();
    setAdding(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setRows([...rows, data as T]);
    setNewRow(newRowTemplate());
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={String(col.key)}>{col.label}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((col) => (
                  <td key={String(col.key)}>
                    {col.type === "select" ? (
                      <select
                        value={(row[col.key] as string) ?? ""}
                        onChange={(e) => updateCell(row.id, col.key, e.target.value || null)}
                      >
                        {col.options?.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={col.type === "text" ? "text" : "number"}
                        step="any"
                        value={row[col.key] === null || row[col.key] === undefined ? "" : (row[col.key] as string | number)}
                        onChange={(e) => updateCell(row.id, col.key, parseValue(col.type, e.target.value))}
                        style={{ width: "100%", minWidth: compact ? 70 : 90 }}
                      />
                    )}
                  </td>
                ))}
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-secondary" disabled={savingId === row.id} onClick={() => handleSaveRow(row)}>
                    {savingId === row.id ? "…" : "Kaydet"}
                  </button>{" "}
                  <button className="btn-danger" onClick={() => handleDeleteRow(row.id)}>Sil</button>
                </td>
              </tr>
            ))}
            <tr>
              {columns.map((col) => {
                const newRowAsT = newRow as unknown as T;
                return (
                  <td key={String(col.key)}>
                    {col.type === "select" ? (
                      <select
                        value={(newRowAsT[col.key] as string) ?? ""}
                        onChange={(e) => setNewRow({ ...newRow, [col.key]: e.target.value || null } as Omit<T, "id">)}
                      >
                        <option value="">—</option>
                        {col.options?.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={col.type === "text" ? "text" : "number"}
                        step="any"
                        placeholder={col.label}
                        value={newRowAsT[col.key] === null || newRowAsT[col.key] === undefined ? "" : (newRowAsT[col.key] as string | number)}
                        onChange={(e) => setNewRow({ ...newRow, [col.key]: parseValue(col.type, e.target.value) } as Omit<T, "id">)}
                        style={{ width: "100%", minWidth: compact ? 70 : 90 }}
                      />
                    )}
                  </td>
                );
              })}
              <td>
                <button className="btn-primary" disabled={adding} onClick={handleAddRow}>
                  {adding ? "…" : "+ Ekle"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SPECIAL_RULE_OPTIONS = [
  { value: "force_100", label: "force_100 (toplam=100)" },
  { value: "force_0", label: "force_0 (toplam=0)" },
];

const FORMULA_TYPE_OPTIONS: { value: CriterionFormulaType; label: string }[] = [
  { value: "lookup", label: "Lookup (değer eşleştirme)" },
  { value: "linear", label: "Linear (oransal)" },
  { value: "band", label: "Band (aralık)" },
];

const DIRECTION_OPTIONS: { value: CriterionDirection; label: string }[] = [
  { value: "lower_better", label: "Düşük değer iyi (ör. gecikme oranı)" },
  { value: "higher_better", label: "Yüksek değer iyi" },
];

type GradeRow = { id: string; min_score: number; max_score: number; grade_label: string; action_signal: string; recommended_action: string | null };

export default function CsParametersPage() {
  const { user } = useCs();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingDefaults, setLoadingDefaults] = useState(false);

  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [lookupByCriterion, setLookupByCriterion] = useState<Record<string, LookupValue[]>>({});
  const [bandsByCriterion, setBandsByCriterion] = useState<Record<string, Band[]>>({});
  const [gradeRows, setGradeRows] = useState<GradeRow[]>([]);

  const [newLabel, setNewLabel] = useState("");
  const [newSourceField, setNewSourceField] = useState<CustomerFieldName>("risk_class");
  const [newFormulaType, setNewFormulaType] = useState<CriterionFormulaType>("lookup");
  const [newWeight, setNewWeight] = useState(10);
  const [addingCriterion, setAddingCriterion] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const criteriaRes = await supabase
        .from("CS_criteria")
        .select("id, label, source_field, formula_type, direction, linear_min, linear_max, weight, active, display_order, description")
        .eq("user_id", user.id)
        .order("display_order");
      if (criteriaRes.error) throw criteriaRes.error;
      const criteriaData = (criteriaRes.data ?? []) as Criterion[];
      const ids = criteriaData.map((c) => c.id);

      const [lookupRes, bandRes, gradeRes] = await Promise.all([
        ids.length > 0
          ? supabase.from("CS_criterion_lookup_values").select("id, criterion_id, match_value, points, special_rule, description, display_order").in("criterion_id", ids).order("display_order")
          : Promise.resolve({ data: [], error: null }),
        ids.length > 0
          ? supabase.from("CS_criterion_bands").select("id, criterion_id, min_value, max_value, points, display_order").in("criterion_id", ids).order("display_order")
          : Promise.resolve({ data: [], error: null }),
        supabase.from("CS_grade_thresholds").select("id, min_score, max_score, grade_label, action_signal, recommended_action").eq("user_id", user.id).order("display_order"),
      ]);
      if (lookupRes.error) throw lookupRes.error;
      if (bandRes.error) throw bandRes.error;
      if (gradeRes.error) throw gradeRes.error;

      const lookupMap: Record<string, LookupValue[]> = {};
      for (const row of (lookupRes.data ?? []) as LookupValue[]) (lookupMap[row.criterion_id] ??= []).push(row);
      const bandMap: Record<string, Band[]> = {};
      for (const row of (bandRes.data ?? []) as Band[]) (bandMap[row.criterion_id] ??= []).push(row);

      setCriteria(criteriaData);
      setLookupByCriterion(lookupMap);
      setBandsByCriterion(bandMap);
      setGradeRows((gradeRes.data ?? []) as GradeRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parametreler yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleLoadDefaults() {
    if (!user) return;
    setLoadingDefaults(true);
    setError(null);
    try {
      const already = await hasAnyParameters(user.id);
      if (already) {
        const confirmed = window.confirm(
          "Zaten kayıtlı kriterleriniz var. Varsayılan şablonu yüklemek, mevcutların YANINA yeni kriterler ekleyecek (üzerine yazmaz). Devam edilsin mi?"
        );
        if (!confirmed) {
          setLoadingDefaults(false);
          return;
        }
      }
      await loadDefaultParameters(user.id);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Varsayılan parametreler yüklenirken hata oluştu.");
    } finally {
      setLoadingDefaults(false);
    }
  }

  async function handleSaveCriterion(row: Criterion) {
    const { error: updateError } = await supabase
      .from("CS_criteria")
      .update({
        label: row.label,
        source_field: row.source_field,
        formula_type: row.formula_type,
        direction: row.direction,
        linear_min: row.linear_min,
        linear_max: row.linear_max,
        weight: row.weight,
        active: row.active,
      })
      .eq("id", row.id);
    if (updateError) setError(updateError.message);
  }

  async function handleDeleteCriterion(id: string) {
    if (!window.confirm("Bu kriter (ve varsa alt tabloları) tamamen silinsin mi?")) return;
    const { error: deleteError } = await supabase.from("CS_criteria").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setCriteria(criteria.filter((c) => c.id !== id));
  }

  async function handleAddCriterion() {
    if (!user || !newLabel.trim()) return;
    setAddingCriterion(true);
    setError(null);
    const { data, error: insertError } = await supabase
      .from("CS_criteria")
      .insert({
        user_id: user.id,
        label: newLabel.trim(),
        source_field: newSourceField,
        formula_type: newFormulaType,
        direction: newFormulaType === "linear" ? "lower_better" : null,
        linear_min: newFormulaType === "linear" ? 0 : null,
        linear_max: newFormulaType === "linear" ? 1 : null,
        weight: newWeight,
        active: true,
        display_order: criteria.length,
      })
      .select()
      .single();
    setAddingCriterion(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setCriteria([...criteria, data as Criterion]);
    setNewLabel("");
    setNewWeight(10);
  }

  const activeWeightTotal = useMemo(() => totalActiveWeight(criteria), [criteria]);
  const weightDiff = 100 - activeWeightTotal;

  if (loading || !user) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Parametre Yönetimi</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Kriterleri tamamen siz belirlersiniz: istediğiniz kriteri silin, ağırlığını değiştirin, yenisini ekleyin.
          Aşağıdaki liste sadece önerilen bir başlangıç şablonudur — hiçbiri koda gömülü/sabit değildir.
        </p>
        {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn-secondary" onClick={handleLoadDefaults} disabled={loadingDefaults}>
          {loadingDefaults ? "Yükleniyor…" : "Varsayılan Parametreleri Yükle"}
        </button>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Kriterler</div>
          <span className={`pill ${weightDiff === 0 ? "pill-green" : "pill-amber"}`}>
            Toplam Ağırlık: {activeWeightTotal} / 100
            {weightDiff > 0 && ` — Eksik Ağırlık: ${weightDiff} puan eksik`}
            {weightDiff < 0 && ` — Fazla Ağırlık: ${-weightDiff} puan fazla`}
          </span>
        </div>
        <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Aktif kriterlerin ağırlıkları toplamda 100 olmalıdır — bu sadece bir uyarıdır, düzenlemeye devam
          edebilirsiniz. Her kriterin altında, tipine göre (Lookup/Linear/Band) ilgili alt tablo bulunur.
        </p>

        <div className="form-grid" style={{ marginBottom: 18 }}>
          <label className="auth-field">
            <span>Yeni Kriter Adı</span>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="örn. Şehir Risk Puanı" />
          </label>
          <label className="auth-field">
            <span>Veri Alanı</span>
            <select value={newSourceField} onChange={(e) => setNewSourceField(e.target.value as CustomerFieldName)}>
              {SOURCE_FIELD_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Formül Tipi</span>
            <select value={newFormulaType} onChange={(e) => setNewFormulaType(e.target.value as CriterionFormulaType)}>
              {FORMULA_TYPE_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Ağırlık (Max Puan)</span>
            <input type="number" step="any" value={newWeight} onChange={(e) => setNewWeight(Number(e.target.value))} />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn-primary" onClick={handleAddCriterion} disabled={addingCriterion || !newLabel.trim()}>
              {addingCriterion ? "Ekleniyor…" : "+ Yeni Kriter Ekle"}
            </button>
          </div>
        </div>

        {criteria.length === 0 ? (
          <div className="empty-state">Henüz kriter yok. Yukarıdan ekleyin ya da varsayılan şablonu yükleyin.</div>
        ) : (
          criteria.map((c) => (
            <CriterionCard
              key={c.id}
              criterion={c}
              setCriterion={(updated) => setCriteria(criteria.map((x) => (x.id === c.id ? updated : x)))}
              onSave={() => handleSaveCriterion(c)}
              onDelete={() => handleDeleteCriterion(c.id)}
              lookupRows={lookupByCriterion[c.id] ?? []}
              setLookupRows={(rows) => setLookupByCriterion({ ...lookupByCriterion, [c.id]: rows })}
              bandRows={bandsByCriterion[c.id] ?? []}
              setBandRows={(rows) => setBandsByCriterion({ ...bandsByCriterion, [c.id]: rows })}
            />
          ))
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Skor Notu &amp; Aksiyon Sinyali Eşikleri</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Toplam skorun hangi aralıkta hangi nota (A+/A/B/C) ve aksiyon sinyaline (Green/Yellow/Red) karşılık geldiği.
        </p>
        <ParamTable<GradeRow>
          tableName="CS_grade_thresholds"
          insertExtra={{ user_id: user.id, display_order: gradeRows.length }}
          rows={gradeRows}
          setRows={setGradeRows}
          columns={[
            { key: "min_score", label: "Alt Limit", type: "number" },
            { key: "max_score", label: "Üst Limit", type: "number" },
            { key: "grade_label", label: "Not", type: "text" },
            { key: "action_signal", label: "Aksiyon Sinyali", type: "text" },
            { key: "recommended_action", label: "Tavsiye Edilen Aksiyon", type: "text" },
          ]}
          newRowTemplate={() => ({ min_score: 0, max_score: 0, grade_label: "", action_signal: "", recommended_action: "" })}
        />
      </div>
    </div>
  );
}

function CriterionCard({
  criterion,
  setCriterion,
  onSave,
  onDelete,
  lookupRows,
  setLookupRows,
  bandRows,
  setBandRows,
}: {
  criterion: Criterion;
  setCriterion: (c: Criterion) => void;
  onSave: () => void;
  onDelete: () => void;
  lookupRows: LookupValue[];
  setLookupRows: (rows: LookupValue[]) => void;
  bandRows: Band[];
  setBandRows: (rows: Band[]) => void;
}) {
  const bandIssues = useMemo(() => checkBandIssues(bandRows), [bandRows]);
  const sortedBands = useMemo(() => [...bandRows].sort((a, b) => a.min_value - b.min_value), [bandRows]);

  return (
    <div style={{ border: "0.5px solid var(--border-strong)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <div className="form-grid" style={{ marginBottom: 10 }}>
        <label className="auth-field">
          <span>Etiket</span>
          <input value={criterion.label} onChange={(e) => setCriterion({ ...criterion, label: e.target.value })} />
        </label>
        <label className="auth-field">
          <span>Veri Alanı</span>
          <select value={criterion.source_field} onChange={(e) => setCriterion({ ...criterion, source_field: e.target.value as CustomerFieldName })}>
            {SOURCE_FIELD_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="auth-field">
          <span>Formül Tipi</span>
          <select value={criterion.formula_type} onChange={(e) => setCriterion({ ...criterion, formula_type: e.target.value as CriterionFormulaType })}>
            {FORMULA_TYPE_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="auth-field">
          <span>Ağırlık (Max Puan)</span>
          <input type="number" step="any" value={criterion.weight} onChange={(e) => setCriterion({ ...criterion, weight: Number(e.target.value) })} />
        </label>
        <label className="auth-field">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={criterion.active} onChange={(e) => setCriterion({ ...criterion, active: e.target.checked })} />
            Aktif
          </span>
        </label>
        {criterion.formula_type === "linear" && (
          <>
            <label className="auth-field">
              <span>Yön</span>
              <select value={criterion.direction ?? "lower_better"} onChange={(e) => setCriterion({ ...criterion, direction: e.target.value as CriterionDirection })}>
                {DIRECTION_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span>Min Değer (0 puan)</span>
              <input type="number" step="any" value={criterion.linear_min ?? 0} onChange={(e) => setCriterion({ ...criterion, linear_min: Number(e.target.value) })} />
            </label>
            <label className="auth-field">
              <span>Max Değer (tam puan)</span>
              <input type="number" step="any" value={criterion.linear_max ?? 1} onChange={(e) => setCriterion({ ...criterion, linear_max: Number(e.target.value) })} />
            </label>
          </>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <button className="btn-secondary" onClick={onSave}>Kaydet</button>
          <button className="btn-danger" onClick={onDelete}>Kriteri Sil</button>
        </div>
      </div>

      {criterion.formula_type === "lookup" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>
            Değer Eşleştirme Tablosu — müşterinin bu alandaki değeri burada eşleşen satırla puanlanır (büyük/küçük harf duyarsız).
          </div>
          <ParamTable<LookupValue>
            tableName="CS_criterion_lookup_values"
            insertExtra={{ criterion_id: criterion.id, display_order: lookupRows.length }}
            rows={lookupRows}
            setRows={setLookupRows}
            compact
            columns={[
              { key: "match_value", label: "Değer", type: "text" },
              { key: "points", label: "Puan", type: "number" },
              { key: "special_rule", label: "Özel Kural", type: "select", options: SPECIAL_RULE_OPTIONS },
              { key: "description", label: "Açıklama", type: "text" },
            ]}
            newRowTemplate={() => ({ criterion_id: criterion.id, match_value: "", points: 0, special_rule: null, description: "", display_order: lookupRows.length })}
          />
        </div>
      )}

      {criterion.formula_type === "band" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>
            Aralık Tablosu — bir değer, üst sınırı kendisinden büyük veya eşit olan İLK dilime girer (örn. 1 – 4
            ve 5 – 9 dilimleri varsa, 4,5 gibi aradaki bir değer otomatik olarak 5 – 9 dilimine dahil olur; hiçbir
            değer 0 puanla "boşlukta" kalmaz). Üst sınır boş bırakılırsa aralık sınırsız (açık uçlu) olur.
          </div>
          {bandIssues.length > 0 && (
            <div className="auth-error" style={{ marginBottom: 8 }}>
              {bandIssues.map((issue, i) => (
                <div key={i}>⚠ Çakışma: {issue.message}</div>
              ))}
            </div>
          )}
          <div className="table-scroll" style={{ marginBottom: 8 }}>
            <table className="data-table">
              <thead><tr><th>Aralık</th><th>Puan</th></tr></thead>
              <tbody>
                {sortedBands.map((b) => (
                  <tr key={b.id}><td>{bandRangeLabel(b)}</td><td>{b.points}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <ParamTable<Band>
            tableName="CS_criterion_bands"
            insertExtra={{ criterion_id: criterion.id, display_order: bandRows.length }}
            rows={bandRows}
            setRows={setBandRows}
            compact
            columns={[
              { key: "min_value", label: "Alt Sınır", type: "number" },
              { key: "max_value", label: "Üst Sınır (boş=sınırsız)", type: "nullableNumber" },
              { key: "points", label: "Puan", type: "number" },
            ]}
            newRowTemplate={() => ({ criterion_id: criterion.id, min_value: 0, max_value: null, points: 0, display_order: bandRows.length })}
          />
        </div>
      )}

      {criterion.formula_type === "linear" && (
        <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 8 }}>
          Puan = Ağırlık × normalize edilmiş değer (Min–Max arasında 0–1&apos;e ölçeklenir, Yön&apos;e göre ters çevrilir).
        </div>
      )}
    </div>
  );
}
