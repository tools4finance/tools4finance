"use client";

import { useCallback, useEffect, useState } from "react";
import { useCs } from "@/lib/csContext";
import { supabase } from "@/lib/supabase";
import { hasAnyParameters, loadDefaultParameters } from "@/lib/csData";
import type { CriteriaWeight } from "@/lib/customerScoring";

// ---------------------------------------------------------------------------
// Generic editable parameter table — every CS_ parameter table (except the
// two fixed-cardinality ones handled below) follows the same add/edit/delete
// shape, so one component drives all of them instead of five near-identical
// copies.
// ---------------------------------------------------------------------------

type ColumnType = "text" | "number" | "nullableNumber" | "select";

type ColumnDef<T> = {
  key: keyof T;
  label: string;
  type: ColumnType;
  options?: { value: string; label: string }[];
};

function ParamTable<T extends { id: string }>({
  title,
  description,
  tableName,
  columns,
  rows,
  setRows,
  newRowTemplate,
  userId,
}: {
  title: string;
  description: string;
  tableName: string;
  columns: ColumnDef<T>[];
  rows: T[];
  setRows: (rows: T[]) => void;
  newRowTemplate: () => Omit<T, "id">;
  userId: string;
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
      .insert({ ...newRow, user_id: userId })
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
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">{title}</div>
      </div>
      <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>{description}</p>
      {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
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
                        style={{ width: "100%", minWidth: 90 }}
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
                        style={{ width: "100%", minWidth: 90 }}
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

// ---------------------------------------------------------------------------
// Row types (mirror the CS_ table columns actually edited on this page)
// ---------------------------------------------------------------------------

type WeightRow = CriteriaWeight & { id: string };
type RiskClassRow = { id: string; risk_class: string; points: number; special_rule: string | null; description: string | null };
type OverdueDaysRow = { id: string; upper_bound_days: number | null; points: number };
type TenureRow = { id: string; label: string; min_years: number; points: number };
type HabitRow = { id: string; habit_label: string; points: number };
type StrategicRow = { id: string; is_strategic: boolean; points: number };
type GradeRow = { id: string; min_score: number; max_score: number; grade_label: string; action_signal: string; recommended_action: string | null };

const SPECIAL_RULE_OPTIONS = [
  { value: "force_100", label: "force_100 (toplam=100)" },
  { value: "force_0", label: "force_0 (toplam=0)" },
];

export default function CsParametersPage() {
  const { user } = useCs();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingDefaults, setLoadingDefaults] = useState(false);

  const [weights, setWeights] = useState<WeightRow[]>([]);
  const [riskRows, setRiskRows] = useState<RiskClassRow[]>([]);
  const [odRows, setOdRows] = useState<OverdueDaysRow[]>([]);
  const [tenureRows, setTenureRows] = useState<TenureRow[]>([]);
  const [habitRows, setHabitRows] = useState<HabitRow[]>([]);
  const [stratRows, setStratRows] = useState<StrategicRow[]>([]);
  const [gradeRows, setGradeRows] = useState<GradeRow[]>([]);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [w, r, od, t, h, s, g] = await Promise.all([
        supabase.from("CS_criteria_weights").select("id, criterion_key, label, weight, active, formula_type").eq("user_id", user.id).order("display_order"),
        supabase.from("CS_risk_class_scores").select("id, risk_class, points, special_rule, description").eq("user_id", user.id).order("display_order"),
        supabase.from("CS_overdue_days_bands").select("id, upper_bound_days, points").eq("user_id", user.id).order("display_order"),
        supabase.from("CS_tenure_bands").select("id, label, min_years, points").eq("user_id", user.id).order("display_order"),
        supabase.from("CS_payment_habit_scores").select("id, habit_label, points").eq("user_id", user.id).order("display_order"),
        supabase.from("CS_strategic_scores").select("id, is_strategic, points").eq("user_id", user.id),
        supabase.from("CS_grade_thresholds").select("id, min_score, max_score, grade_label, action_signal, recommended_action").eq("user_id", user.id).order("display_order"),
      ]);
      for (const res of [w, r, od, t, h, s, g]) if (res.error) throw res.error;
      setWeights((w.data ?? []) as WeightRow[]);
      setRiskRows((r.data ?? []) as RiskClassRow[]);
      setOdRows((od.data ?? []) as OverdueDaysRow[]);
      setTenureRows((t.data ?? []) as TenureRow[]);
      setHabitRows((h.data ?? []) as HabitRow[]);
      setStratRows((s.data ?? []) as StrategicRow[]);
      setGradeRows((g.data ?? []) as GradeRow[]);
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
          "Zaten kayıtlı parametreleriniz var. Varsayılan şablonu yüklemek, mevcutların YANINA yeni satırlar ekleyecek (üzerine yazmaz). Devam edilsin mi?"
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

  async function handleSaveWeight(row: WeightRow) {
    const { error: updateError } = await supabase
      .from("CS_criteria_weights")
      .update({ label: row.label, weight: row.weight, active: row.active })
      .eq("id", row.id);
    if (updateError) setError(updateError.message);
  }

  async function handleSaveStrategic(row: StrategicRow) {
    const { error: updateError } = await supabase.from("CS_strategic_scores").update({ points: row.points }).eq("id", row.id);
    if (updateError) setError(updateError.message);
  }

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
          Aşağıdaki tüm tablolar müşteri risk skoru formülünü besler. Değiştirdiğiniz her değer, hem müşteri
          listesindeki hem de tekil skor kartındaki hesaplamalara anında yansır — formül sabittir, sadece bu
          girdiler kullanıcıya özeldir.
        </p>
        {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn-secondary" onClick={handleLoadDefaults} disabled={loadingDefaults}>
          {loadingDefaults ? "Yükleniyor…" : "Varsayılan Parametreleri Yükle"}
        </button>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Kriter Ağırlıkları &amp; Aktif/Pasif (Tablo 6)</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Her kriterin toplam skora katkısının maksimum puanı ve aktif olup olmadığı. Kriter listesi sabittir
          (formül bu 7 anahtara göre çalışır); sadece ağırlık, etiket ve aktiflik düzenlenebilir.
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kriter Anahtarı</th>
                <th>Etiket</th>
                <th>Ağırlık (Max Puan)</th>
                <th>Aktif</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {weights.map((w) => (
                <tr key={w.id}>
                  <td><code>{w.criterion_key}</code></td>
                  <td>
                    <input
                      value={w.label}
                      onChange={(e) => setWeights(weights.map((x) => (x.id === w.id ? { ...x, label: e.target.value } : x)))}
                      style={{ width: "100%", minWidth: 160 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      value={w.weight}
                      onChange={(e) => setWeights(weights.map((x) => (x.id === w.id ? { ...x, weight: Number(e.target.value) } : x)))}
                      style={{ width: 90 }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={w.active}
                      onChange={(e) => setWeights(weights.map((x) => (x.id === w.id ? { ...x, active: e.target.checked } : x)))}
                    />
                  </td>
                  <td>
                    <button className="btn-secondary" onClick={() => handleSaveWeight(w)}>Kaydet</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ParamTable<RiskClassRow>
        title="Risk Class Puanları (Tablo 1)"
        description="Credit Reform / risk sınıfı koduna karşılık gelen puan. force_100 seçilirse o sınıftaki müşterinin toplam skoru direkt 100, force_0 seçilirse direkt 0 olur (diğer kriterler yok sayılır)."
        tableName="CS_risk_class_scores"
        userId={user.id}
        rows={riskRows}
        setRows={setRiskRows}
        columns={[
          { key: "risk_class", label: "Risk Class", type: "text" },
          { key: "points", label: "Puan", type: "number" },
          { key: "special_rule", label: "Özel Kural", type: "select", options: SPECIAL_RULE_OPTIONS },
          { key: "description", label: "Açıklama", type: "text" },
        ]}
        newRowTemplate={() => ({ risk_class: "", points: 0, special_rule: null, description: "", display_order: riskRows.length } as unknown as Omit<RiskClassRow, "id">)}
      />

      <ParamTable<OverdueDaysRow>
        title="Overdue Days Puanları (Tablo 3)"
        description="Vadesi geçmiş gün sayısına göre kademeli puan. Üst Sınır (Gün) boş bırakılırsa o satır açık uçlu (en üst) bant olur."
        tableName="CS_overdue_days_bands"
        userId={user.id}
        rows={odRows}
        setRows={setOdRows}
        columns={[
          { key: "upper_bound_days", label: "Üst Sınır (Gün)", type: "nullableNumber" },
          { key: "points", label: "Puan", type: "number" },
        ]}
        newRowTemplate={() => ({ upper_bound_days: null, points: 0, display_order: odRows.length } as unknown as Omit<OverdueDaysRow, "id">)}
      />

      <ParamTable<TenureRow>
        title="Çalışma Yılı Puanları (Tablo 4)"
        description="Müşteri ile çalışılan yıl sayısına göre kademeli puan. En yüksek 'Min Yıl' değeri, müşterinin gerçek yılından küçük veya eşit olan bant kazanır."
        tableName="CS_tenure_bands"
        userId={user.id}
        rows={tenureRows}
        setRows={setTenureRows}
        columns={[
          { key: "label", label: "Etiket", type: "text" },
          { key: "min_years", label: "Min Yıl", type: "number" },
          { key: "points", label: "Puan", type: "number" },
        ]}
        newRowTemplate={() => ({ label: "", min_years: 0, points: 0, display_order: tenureRows.length } as unknown as Omit<TenureRow, "id">)}
      />

      <ParamTable<HabitRow>
        title="Payment Habit Puanları (Tablo 4)"
        description="Ödeme alışkanlığı etiketine karşılık gelen puan. Müşteri kaydındaki Payment Habit değeri burada eşleşen satırla puanlanır (büyük/küçük harf duyarsız)."
        tableName="CS_payment_habit_scores"
        userId={user.id}
        rows={habitRows}
        setRows={setHabitRows}
        columns={[
          { key: "habit_label", label: "Habit Etiketi", type: "text" },
          { key: "points", label: "Puan", type: "number" },
        ]}
        newRowTemplate={() => ({ habit_label: "", points: 0, display_order: habitRows.length } as unknown as Omit<HabitRow, "id">)}
      />

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Stratejik Müşteri Puanları (Tablo 4)</div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14, lineHeight: 1.6 }}>
          Stratejik müşteri işaretli olan/olmayan kayıtlar için sabit puan.
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Stratejik mi?</th><th>Puan</th><th></th></tr>
            </thead>
            <tbody>
              {stratRows.map((s) => (
                <tr key={s.id}>
                  <td>{s.is_strategic ? "Yes" : "No"}</td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      value={s.points}
                      onChange={(e) => setStratRows(stratRows.map((x) => (x.id === s.id ? { ...x, points: Number(e.target.value) } : x)))}
                      style={{ width: 90 }}
                    />
                  </td>
                  <td>
                    <button className="btn-secondary" onClick={() => handleSaveStrategic(s)}>Kaydet</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ParamTable<GradeRow>
        title="Skor Notu &amp; Aksiyon Sinyali Eşikleri (Tablo 5)"
        description="Toplam skorun hangi aralıkta hangi nota (A+/A/B/C) ve aksiyon sinyaline (Green/Yellow/Red) karşılık geldiği."
        tableName="CS_grade_thresholds"
        userId={user.id}
        rows={gradeRows}
        setRows={setGradeRows}
        columns={[
          { key: "min_score", label: "Alt Limit", type: "number" },
          { key: "max_score", label: "Üst Limit", type: "number" },
          { key: "grade_label", label: "Not", type: "text" },
          { key: "action_signal", label: "Aksiyon Sinyali", type: "text" },
          { key: "recommended_action", label: "Tavsiye Edilen Aksiyon", type: "text" },
        ]}
        newRowTemplate={() => ({ min_score: 0, max_score: 0, grade_label: "", action_signal: "", recommended_action: "", display_order: gradeRows.length } as unknown as Omit<GradeRow, "id">)}
      />
    </div>
  );
}
