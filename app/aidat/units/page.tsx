"use client";

import { useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

type Block = {
  id: string;
  site_id: string;
  name: string;
  display_order: number;
  active: boolean;
};

type Unit = {
  id: string;
  site_id: string;
  block_id: string | null;
  unit_number: string;
  unit_type: string | null;
  gross_sqm: number | null;
  net_sqm: number | null;
  ownership_share: number | null;
  active: boolean;
};

type DuesRule = {
  id: string;
  unit_id: string | null;
  amount: number;
  active: boolean;
};

type UnitFormState = {
  block_id: string;
  unit_number: string;
  unit_type: string;
  gross_sqm: string;
  net_sqm: string;
  dues_amount: string;
};

const EMPTY_UNIT_FORM: UnitFormState = {
  block_id: "",
  unit_number: "",
  unit_type: "",
  gross_sqm: "",
  net_sqm: "",
  dues_amount: "",
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amount);
}

export default function UnitsPage() {
  const { selectedSiteId, canWrite } = useAidat();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [duesRulesByUnit, setDuesRulesByUnit] = useState<Record<string, DuesRule>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Blocks form
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockName, setBlockName] = useState("");
  const [savingBlock, setSavingBlock] = useState(false);

  // Units form
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [unitForm, setUnitForm] = useState<UnitFormState>(EMPTY_UNIT_FORM);
  const [savingUnit, setSavingUnit] = useState(false);

  // Inline unit edit
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UnitFormState>(EMPTY_UNIT_FORM);
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);

    const [blocksRes, unitsRes, duesRulesRes] = await Promise.all([
      supabase
        .from("blocks")
        .select("id, site_id, name, display_order, active")
        .eq("site_id", selectedSiteId)
        .order("display_order", { ascending: true }),
      supabase
        .from("units")
        .select("id, site_id, block_id, unit_number, unit_type, gross_sqm, net_sqm, ownership_share, active")
        .eq("site_id", selectedSiteId)
        .order("unit_number", { ascending: true }),
      supabase
        .from("dues_rules")
        .select("id, unit_id, amount, active")
        .eq("site_id", selectedSiteId)
        .eq("active", true)
        .not("unit_id", "is", null),
    ]);

    if (blocksRes.error) {
      setError(blocksRes.error.message);
    } else if (unitsRes.error) {
      setError(unitsRes.error.message);
    } else if (duesRulesRes.error) {
      setError(duesRulesRes.error.message);
    } else {
      setBlocks((blocksRes.data ?? []) as Block[]);
      setUnits((unitsRes.data ?? []) as Unit[]);
      const rulesMap: Record<string, DuesRule> = {};
      for (const rule of (duesRulesRes.data ?? []) as DuesRule[]) {
        if (rule.unit_id) rulesMap[rule.unit_id] = rule;
      }
      setDuesRulesByUnit(rulesMap);
    }
    setLoading(false);
  }, [selectedSiteId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleAddBlock(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !blockName.trim()) return;
    setSavingBlock(true);
    setError(null);
    const { error: insertError } = await supabase.from("blocks").insert({
      site_id: selectedSiteId,
      name: blockName.trim(),
      display_order: blocks.length,
      active: true,
    });
    setSavingBlock(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setBlockName("");
    setShowBlockForm(false);
    await fetchAll();
  }

  async function handleToggleBlockActive(block: Block) {
    setError(null);
    const { error: updateError } = await supabase
      .from("blocks")
      .update({ active: !block.active })
      .eq("id", block.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await fetchAll();
  }

  async function handleDeleteBlock(block: Block) {
    setError(null);
    const { error: deleteError } = await supabase.from("blocks").delete().eq("id", block.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await fetchAll();
  }

  function openUnitForm() {
    setUnitForm({ ...EMPTY_UNIT_FORM, block_id: blocks[0]?.id ?? "" });
    setShowUnitForm(true);
  }

  // One active dues_rules row per unit is the whole model here (MVP —
  // effective-dated rule history is schema-ready via dues_rules but not
  // exposed in this UI yet): if the unit already has one, update its
  // amount; otherwise insert a new row. Clearing the field back to empty
  // deactivates the existing rule rather than leaving a stale amount.
  async function upsertDuesRule(unitId: string, amountStr: string) {
    if (!selectedSiteId) return;
    const existing = duesRulesByUnit[unitId];
    const amount = amountStr.trim() ? Number(amountStr) : null;

    if (amount === null) {
      if (existing) {
        await supabase.from("dues_rules").update({ active: false }).eq("id", existing.id);
      }
      return;
    }

    if (existing) {
      await supabase.from("dues_rules").update({ amount }).eq("id", existing.id);
    } else {
      await supabase.from("dues_rules").insert({
        site_id: selectedSiteId,
        unit_id: unitId,
        name: "Aidat",
        amount,
        active: true,
      });
    }
  }

  async function handleAddUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !unitForm.unit_number.trim()) return;
    setSavingUnit(true);
    setError(null);
    const { data: inserted, error: insertError } = await supabase
      .from("units")
      .insert({
        site_id: selectedSiteId,
        block_id: unitForm.block_id || null,
        unit_number: unitForm.unit_number.trim(),
        unit_type: unitForm.unit_type.trim() || null,
        gross_sqm: unitForm.gross_sqm ? Number(unitForm.gross_sqm) : null,
        net_sqm: unitForm.net_sqm ? Number(unitForm.net_sqm) : null,
        active: true,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      setSavingUnit(false);
      setError(insertError?.message ?? "Daire kaydedilemedi.");
      return;
    }

    if (unitForm.dues_amount.trim()) {
      await upsertDuesRule(inserted.id, unitForm.dues_amount);
    }

    setSavingUnit(false);
    setUnitForm(EMPTY_UNIT_FORM);
    setShowUnitForm(false);
    await fetchAll();
  }

  function startEditUnit(unit: Unit) {
    setEditingUnitId(unit.id);
    const rule = duesRulesByUnit[unit.id];
    setEditForm({
      block_id: unit.block_id ?? "",
      unit_number: unit.unit_number,
      unit_type: unit.unit_type ?? "",
      gross_sqm: unit.gross_sqm != null ? String(unit.gross_sqm) : "",
      net_sqm: unit.net_sqm != null ? String(unit.net_sqm) : "",
      dues_amount: rule ? String(rule.amount) : "",
    });
  }

  function cancelEditUnit() {
    setEditingUnitId(null);
    setEditForm(EMPTY_UNIT_FORM);
  }

  async function handleSaveEditUnit(unitId: string) {
    if (!editForm.unit_number.trim()) return;
    setSavingEdit(true);
    setError(null);
    const { error: updateError } = await supabase
      .from("units")
      .update({
        block_id: editForm.block_id || null,
        unit_number: editForm.unit_number.trim(),
        unit_type: editForm.unit_type.trim() || null,
        gross_sqm: editForm.gross_sqm ? Number(editForm.gross_sqm) : null,
        net_sqm: editForm.net_sqm ? Number(editForm.net_sqm) : null,
      })
      .eq("id", unitId);
    if (updateError) {
      setSavingEdit(false);
      setError(updateError.message);
      return;
    }

    await upsertDuesRule(unitId, editForm.dues_amount);

    setSavingEdit(false);
    cancelEditUnit();
    await fetchAll();
  }

  async function handleToggleUnitActive(unit: Unit) {
    setError(null);
    const { error: updateError } = await supabase
      .from("units")
      .update({ active: !unit.active })
      .eq("id", unit.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await fetchAll();
  }

  const blockName_ = (blockId: string | null) => blocks.find((b) => b.id === blockId)?.name ?? "—";
  const unitCountForBlock = (blockId: string) => units.filter((u) => u.block_id === blockId).length;

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Bloklar</div>
          {canWrite && (
            <button className="btn-secondary" onClick={() => setShowBlockForm((v) => !v)}>
              {showBlockForm ? "Vazgeç" : "+ Blok Ekle"}
            </button>
          )}
        </div>

        {showBlockForm && canWrite && (
          <form onSubmit={handleAddBlock} className="form-grid">
            <label className="auth-field">
              <span>Blok Adı</span>
              <input
                value={blockName}
                onChange={(e) => setBlockName(e.target.value)}
                required
                placeholder="örn. A Blok"
                autoFocus
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn-primary" type="submit" disabled={savingBlock || !blockName.trim()}>
                {savingBlock ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </form>
        )}

        {blocks.length === 0 ? (
          <div className="empty-state">Henüz blok tanımlanmamış.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ad</th>
                  <th className="num">Sıra</th>
                  <th>Durum</th>
                  {canWrite && <th>Aksiyon</th>}
                </tr>
              </thead>
              <tbody>
                {blocks.map((block) => (
                  <tr key={block.id}>
                    <td>{block.name}</td>
                    <td className="num">{block.display_order}</td>
                    <td>
                      <span className={`pill ${block.active ? "pill-green" : "pill-neutral"}`}>
                        {block.active ? "Aktif" : "Pasif"}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="btn-secondary" onClick={() => handleToggleBlockActive(block)}>
                            {block.active ? "Pasifleştir" : "Aktifleştir"}
                          </button>
                          {unitCountForBlock(block.id) === 0 && (
                            <button className="btn-danger" onClick={() => handleDeleteBlock(block)}>
                              Sil
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Daireler</div>
          {canWrite && (
            <button className="btn-secondary" onClick={() => (showUnitForm ? setShowUnitForm(false) : openUnitForm())}>
              {showUnitForm ? "Vazgeç" : "+ Daire Ekle"}
            </button>
          )}
        </div>

        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
          Bir daireye sakin (malik/kiracı) atamak için Sakinler sayfasını kullanın.
        </p>

        {showUnitForm && canWrite && (
          <form onSubmit={handleAddUnit} className="form-grid">
            <label className="auth-field">
              <span>Blok{blocks.length === 0 ? " (yok)" : ""}</span>
              <select
                value={unitForm.block_id}
                onChange={(e) => setUnitForm((f) => ({ ...f, block_id: e.target.value }))}
                disabled={blocks.length === 0}
              >
                <option value="">Bloksuz</option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <label className="auth-field">
              <span>Daire No</span>
              <input
                value={unitForm.unit_number}
                onChange={(e) => setUnitForm((f) => ({ ...f, unit_number: e.target.value }))}
                required
                placeholder="örn. 12"
              />
            </label>
            <label className="auth-field">
              <span>Tip</span>
              <input
                value={unitForm.unit_type}
                onChange={(e) => setUnitForm((f) => ({ ...f, unit_type: e.target.value }))}
                placeholder="örn. 2+1, Dükkan"
              />
            </label>
            <label className="auth-field">
              <span>Brüt m²</span>
              <input
                type="number"
                step="0.01"
                value={unitForm.gross_sqm}
                onChange={(e) => setUnitForm((f) => ({ ...f, gross_sqm: e.target.value }))}
              />
            </label>
            <label className="auth-field">
              <span>Net m²</span>
              <input
                type="number"
                step="0.01"
                value={unitForm.net_sqm}
                onChange={(e) => setUnitForm((f) => ({ ...f, net_sqm: e.target.value }))}
              />
            </label>
            <label className="auth-field">
              <span>Aylık Aidat Tutarı</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={unitForm.dues_amount}
                onChange={(e) => setUnitForm((f) => ({ ...f, dues_amount: e.target.value }))}
                placeholder="örn. 1500"
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn-primary" type="submit" disabled={savingUnit || !unitForm.unit_number.trim()}>
                {savingUnit ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </form>
        )}

        {units.length === 0 ? (
          <div className="empty-state">Henüz daire tanımlanmamış.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Blok</th>
                  <th>Daire No</th>
                  <th>Tip</th>
                  <th className="num">Brüt m²</th>
                  <th className="num">Net m²</th>
                  <th className="num">Aylık Aidat</th>
                  <th>Durum</th>
                  {canWrite && <th>Aksiyon</th>}
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => {
                  const isEditing = editingUnitId === unit.id;
                  if (isEditing) {
                    return (
                      <tr key={unit.id}>
                        <td>
                          <select
                            value={editForm.block_id}
                            onChange={(e) => setEditForm((f) => ({ ...f, block_id: e.target.value }))}
                          >
                            <option value="">Bloksuz</option>
                            {blocks.map((b) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            value={editForm.unit_number}
                            onChange={(e) => setEditForm((f) => ({ ...f, unit_number: e.target.value }))}
                            style={{ width: 80 }}
                          />
                        </td>
                        <td>
                          <input
                            value={editForm.unit_type}
                            onChange={(e) => setEditForm((f) => ({ ...f, unit_type: e.target.value }))}
                            style={{ width: 90 }}
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.gross_sqm}
                            onChange={(e) => setEditForm((f) => ({ ...f, gross_sqm: e.target.value }))}
                            style={{ width: 80 }}
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.net_sqm}
                            onChange={(e) => setEditForm((f) => ({ ...f, net_sqm: e.target.value }))}
                            style={{ width: 80 }}
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editForm.dues_amount}
                            onChange={(e) => setEditForm((f) => ({ ...f, dues_amount: e.target.value }))}
                            style={{ width: 90 }}
                            placeholder="—"
                          />
                        </td>
                        <td>
                          <span className={`pill ${unit.active ? "pill-green" : "pill-neutral"}`}>
                            {unit.active ? "Aktif" : "Pasif"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn-primary"
                              onClick={() => handleSaveEditUnit(unit.id)}
                              disabled={savingEdit || !editForm.unit_number.trim()}
                            >
                              {savingEdit ? "…" : "Kaydet"}
                            </button>
                            <button className="btn-secondary" onClick={cancelEditUnit}>Vazgeç</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={unit.id}>
                      <td>{blockName_(unit.block_id)}</td>
                      <td>{unit.unit_number}</td>
                      <td className="wrap">{unit.unit_type ?? "—"}</td>
                      <td className="num">{unit.gross_sqm ?? "—"}</td>
                      <td className="num">{unit.net_sqm ?? "—"}</td>
                      <td className="num">
                        {duesRulesByUnit[unit.id] ? (
                          formatCurrency(duesRulesByUnit[unit.id].amount)
                        ) : (
                          <span className="pill pill-amber">Tanımsız</span>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${unit.active ? "pill-green" : "pill-neutral"}`}>
                          {unit.active ? "Aktif" : "Pasif"}
                        </span>
                      </td>
                      {canWrite && (
                        <td>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn-secondary" onClick={() => startEditUnit(unit)}>Düzenle</button>
                            <button className="btn-secondary" onClick={() => handleToggleUnitActive(unit)}>
                              {unit.active ? "Pasifleştir" : "Aktifleştir"}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
