"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

type Resident = {
  id: string;
  site_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  created_at: string;
};

type Block = {
  id: string;
  site_id: string;
  name: string;
};

type Unit = {
  id: string;
  site_id: string;
  block_id: string | null;
  unit_number: string;
  active: boolean;
};

type RelationshipType = "owner" | "tenant" | "occupant" | "authorized_contact";

type UnitResident = {
  id: string;
  unit_id: string;
  resident_id: string;
  relationship_type: RelationshipType;
  is_primary: boolean;
  start_date: string;
  end_date: string | null;
  created_at: string;
};

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  owner: "Ev Sahibi",
  tenant: "Kiracı",
  occupant: "Oturan",
  authorized_contact: "Yetkili Kişi",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function unitLabel(unit: Unit | undefined, blocksById: Map<string, Block>): string {
  if (!unit) return "—";
  const block = unit.block_id ? blocksById.get(unit.block_id) : undefined;
  return block ? `${block.name} — ${unit.unit_number}` : unit.unit_number;
}

export default function ResidentsPage() {
  const { selectedSiteId, canWrite } = useAidat();

  const [residents, setResidents] = useState<Resident[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [activeOccupancies, setActiveOccupancies] = useState<UnitResident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create resident form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  // expanded resident + its occupancy history
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [occupancies, setOccupancies] = useState<UnitResident[]>([]);
  const [occLoading, setOccLoading] = useState(false);
  const [occError, setOccError] = useState<string | null>(null);

  // assign-to-unit form
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignUnitId, setAssignUnitId] = useState("");
  const [assignRelationship, setAssignRelationship] = useState<RelationshipType>("owner");
  const [assignStartDate, setAssignStartDate] = useState(todayStr());
  const [assignIsPrimary, setAssignIsPrimary] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);

  // move-out (end_date) state, keyed by unit_resident id
  const [moveOutTargetId, setMoveOutTargetId] = useState<string | null>(null);
  const [moveOutDate, setMoveOutDate] = useState(todayStr());
  const [moveOutSaving, setMoveOutSaving] = useState(false);

  const blocksById = new Map(blocks.map((b) => [b.id, b]));

  const loadResidents = useCallback(async () => {
    if (!selectedSiteId) {
      setResidents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [residentsRes, unitsRes, blocksRes] = await Promise.all([
      supabase
        .from("residents")
        .select("id, site_id, first_name, last_name, phone, email, active, created_at")
        .eq("site_id", selectedSiteId)
        .order("first_name", { ascending: true }),
      supabase
        .from("units")
        .select("id, site_id, block_id, unit_number, active")
        .eq("site_id", selectedSiteId)
        .order("unit_number", { ascending: true }),
      supabase
        .from("blocks")
        .select("id, site_id, name")
        .eq("site_id", selectedSiteId)
        .order("name", { ascending: true }),
    ]);

    if (residentsRes.error) {
      setError(residentsRes.error.message);
    } else {
      setResidents((residentsRes.data ?? []) as Resident[]);
    }
    const siteUnits = (unitsRes.data ?? []) as Unit[];
    if (!unitsRes.error) setUnits(siteUnits);
    if (!blocksRes.error) setBlocks((blocksRes.data ?? []) as Block[]);

    if (siteUnits.length > 0) {
      const { data: occData, error: occErr } = await supabase
        .from("unit_residents")
        .select("id, unit_id, resident_id, relationship_type, is_primary, start_date, end_date, created_at")
        .in("unit_id", siteUnits.map((u) => u.id))
        .is("end_date", null);
      if (!occErr) setActiveOccupancies((occData ?? []) as UnitResident[]);
    } else {
      setActiveOccupancies([]);
    }

    setLoading(false);
  }, [selectedSiteId]);

  useEffect(() => {
    loadResidents();
    setExpandedId(null);
  }, [loadResidents]);

  async function loadOccupancies(residentId: string) {
    setOccLoading(true);
    setOccError(null);
    const { data, error: occErr } = await supabase
      .from("unit_residents")
      .select("id, unit_id, resident_id, relationship_type, is_primary, start_date, end_date, created_at")
      .eq("resident_id", residentId)
      .order("start_date", { ascending: false });
    if (occErr) {
      setOccError(occErr.message);
      setOccupancies([]);
    } else {
      setOccupancies((data ?? []) as UnitResident[]);
    }
    setOccLoading(false);
  }

  function toggleExpand(residentId: string) {
    if (expandedId === residentId) {
      setExpandedId(null);
      setShowAssignForm(false);
      return;
    }
    setExpandedId(residentId);
    setShowAssignForm(false);
    setMoveOutTargetId(null);
    loadOccupancies(residentId);
  }

  async function handleCreateResident(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSiteId || !canWrite) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from("residents").insert({
      site_id: selectedSiteId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      active: true,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    await loadResidents();
  }

  async function handleDeactivate(resident: Resident) {
    if (!canWrite) return;
    setError(null);
    const { error: updateError } = await supabase
      .from("residents")
      .update({ active: false })
      .eq("id", resident.id)
      .eq("site_id", selectedSiteId ?? "");
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadResidents();
  }

  async function handleReactivate(resident: Resident) {
    if (!canWrite) return;
    setError(null);
    const { error: updateError } = await supabase
      .from("residents")
      .update({ active: true })
      .eq("id", resident.id)
      .eq("site_id", selectedSiteId ?? "");
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadResidents();
  }

  async function handleAssignUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite || !expandedId || !assignUnitId) return;
    setAssignSaving(true);
    setOccError(null);
    const { error: insertError } = await supabase.from("unit_residents").insert({
      unit_id: assignUnitId,
      resident_id: expandedId,
      relationship_type: assignRelationship,
      is_primary: assignIsPrimary,
      start_date: assignStartDate,
    });
    setAssignSaving(false);
    if (insertError) {
      setOccError(insertError.message);
      return;
    }
    setAssignUnitId("");
    setAssignRelationship("owner");
    setAssignStartDate(todayStr());
    setAssignIsPrimary(false);
    setShowAssignForm(false);
    await Promise.all([loadOccupancies(expandedId), loadResidents()]);
  }

  async function handleMoveOut(occupancy: UnitResident) {
    if (!canWrite || !expandedId) return;
    setMoveOutSaving(true);
    setOccError(null);
    const { error: updateError } = await supabase
      .from("unit_residents")
      .update({ end_date: moveOutDate })
      .eq("id", occupancy.id);
    setMoveOutSaving(false);
    if (updateError) {
      setOccError(updateError.message);
      return;
    }
    setMoveOutTargetId(null);
    setMoveOutDate(todayStr());
    await Promise.all([loadOccupancies(expandedId), loadResidents()]);
  }

  // Group active occupancies by unit for a site-wide "who lives where" view.
  const residentsById = new Map(residents.map((r) => [r.id, r]));
  const activeResidentsByUnit = new Map<string, { name: string; relationship: RelationshipType; isPrimary: boolean }[]>();
  for (const occ of activeOccupancies) {
    const resident = residentsById.get(occ.resident_id);
    const name = resident ? `${resident.first_name} ${resident.last_name}` : "Bilinmeyen sakin";
    const list = activeResidentsByUnit.get(occ.unit_id) ?? [];
    list.push({ name, relationship: occ.relationship_type, isPrimary: occ.is_primary });
    activeResidentsByUnit.set(occ.unit_id, list);
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Sakinler</div>
        </div>

        {canWrite && (
          <form onSubmit={handleCreateResident} className="form-grid">
            <label className="auth-field">
              <span>Ad</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </label>
            <label className="auth-field">
              <span>Soyad</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </label>
            <label className="auth-field">
              <span>Telefon (opsiyonel)</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="opsiyonel" />
            </label>
            <label className="auth-field">
              <span>E-posta (opsiyonel)</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="opsiyonel"
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                className="btn-primary"
                type="submit"
                disabled={saving || !firstName.trim() || !lastName.trim()}
              >
                {saving ? "Kaydediliyor…" : "Sakin Ekle"}
              </button>
            </div>
          </form>
        )}

        {error && <div className="auth-error">{error}</div>}

        {loading ? (
          <div className="empty-state">Yükleniyor…</div>
        ) : residents.length === 0 ? (
          <div className="empty-state">Bu site için henüz sakin eklenmemiş.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ad Soyad</th>
                  <th>Telefon</th>
                  <th>E-posta</th>
                  <th>Durum</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {residents.map((resident) => (
                  <Fragment key={resident.id}>
                    <tr
                      onClick={() => toggleExpand(resident.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="wrap">
                        {resident.first_name} {resident.last_name}
                      </td>
                      <td>{resident.phone || "—"}</td>
                      <td className="wrap">{resident.email || "—"}</td>
                      <td>
                        {resident.active ? (
                          <span className="pill pill-green">Aktif</span>
                        ) : (
                          <span className="pill pill-neutral">Pasif</span>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {canWrite &&
                          (resident.active ? (
                            <button className="btn-secondary" onClick={() => handleDeactivate(resident)}>
                              Pasifleştir
                            </button>
                          ) : (
                            <button className="btn-secondary" onClick={() => handleReactivate(resident)}>
                              Aktifleştir
                            </button>
                          ))}
                      </td>
                    </tr>
                    {expandedId === resident.id && (
                      <tr>
                        <td colSpan={5} style={{ background: "var(--bg2)", cursor: "default" }}>
                          <ResidentOccupancyPanel
                            resident={resident}
                            units={units}
                            blocksById={blocksById}
                            canWrite={canWrite}
                            occupancies={occupancies}
                            occLoading={occLoading}
                            occError={occError}
                            showAssignForm={showAssignForm}
                            setShowAssignForm={setShowAssignForm}
                            assignUnitId={assignUnitId}
                            setAssignUnitId={setAssignUnitId}
                            assignRelationship={assignRelationship}
                            setAssignRelationship={setAssignRelationship}
                            assignStartDate={assignStartDate}
                            setAssignStartDate={setAssignStartDate}
                            assignIsPrimary={assignIsPrimary}
                            setAssignIsPrimary={setAssignIsPrimary}
                            assignSaving={assignSaving}
                            onAssignSubmit={handleAssignUnit}
                            moveOutTargetId={moveOutTargetId}
                            setMoveOutTargetId={setMoveOutTargetId}
                            moveOutDate={moveOutDate}
                            setMoveOutDate={setMoveOutDate}
                            moveOutSaving={moveOutSaving}
                            onMoveOut={handleMoveOut}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {units.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Dairelere Göre Sakinler</div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Blok / Daire</th>
                  <th className="wrap">Güncel Sakinler</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => {
                  const occupants = activeResidentsByUnit.get(unit.id) ?? [];
                  return (
                    <tr key={unit.id}>
                      <td>{unitLabel(unit, blocksById)}</td>
                      <td className="wrap">
                        {occupants.length === 0 ? (
                          "—"
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {occupants.map((o, i) => (
                              <span key={i} className={o.isPrimary ? "pill pill-blue" : "pill pill-neutral"}>
                                {o.name} · {RELATIONSHIP_LABELS[o.relationship]}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ResidentOccupancyPanel({
  resident,
  units,
  blocksById,
  canWrite,
  occupancies,
  occLoading,
  occError,
  showAssignForm,
  setShowAssignForm,
  assignUnitId,
  setAssignUnitId,
  assignRelationship,
  setAssignRelationship,
  assignStartDate,
  setAssignStartDate,
  assignIsPrimary,
  setAssignIsPrimary,
  assignSaving,
  onAssignSubmit,
  moveOutTargetId,
  setMoveOutTargetId,
  moveOutDate,
  setMoveOutDate,
  moveOutSaving,
  onMoveOut,
}: {
  resident: Resident;
  units: Unit[];
  blocksById: Map<string, Block>;
  canWrite: boolean;
  occupancies: UnitResident[];
  occLoading: boolean;
  occError: string | null;
  showAssignForm: boolean;
  setShowAssignForm: (v: boolean) => void;
  assignUnitId: string;
  setAssignUnitId: (v: string) => void;
  assignRelationship: RelationshipType;
  setAssignRelationship: (v: RelationshipType) => void;
  assignStartDate: string;
  setAssignStartDate: (v: string) => void;
  assignIsPrimary: boolean;
  setAssignIsPrimary: (v: boolean) => void;
  assignSaving: boolean;
  onAssignSubmit: (e: React.FormEvent) => void;
  moveOutTargetId: string | null;
  setMoveOutTargetId: (v: string | null) => void;
  moveOutDate: string;
  setMoveOutDate: (v: string) => void;
  moveOutSaving: boolean;
  onMoveOut: (occ: UnitResident) => void;
}) {
  const unitsById = new Map(units.map((u) => [u.id, u]));
  const activeUnits = units.filter((u) => u.active);

  return (
    <div style={{ padding: "14px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>
          {resident.first_name} {resident.last_name} — Daire Geçmişi
        </strong>
        {canWrite && (
          <button className="btn-secondary" onClick={() => setShowAssignForm(!showAssignForm)}>
            {showAssignForm ? "Vazgeç" : "Daire Ata"}
          </button>
        )}
      </div>

      {showAssignForm && (
        <form onSubmit={onAssignSubmit} className="form-grid" style={{ marginBottom: 14 }}>
          <label className="auth-field">
            <span>Daire</span>
            <select value={assignUnitId} onChange={(e) => setAssignUnitId(e.target.value)} required>
              <option value="">Seçiniz…</option>
              {activeUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unitLabel(unit, blocksById)}
                </option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>İlişki Türü</span>
            <select
              value={assignRelationship}
              onChange={(e) => setAssignRelationship(e.target.value as RelationshipType)}
            >
              {(Object.keys(RELATIONSHIP_LABELS) as RelationshipType[]).map((rt) => (
                <option key={rt} value={rt}>
                  {RELATIONSHIP_LABELS[rt]}
                </option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Başlangıç Tarihi</span>
            <input
              type="date"
              value={assignStartDate}
              onChange={(e) => setAssignStartDate(e.target.value)}
              required
            />
          </label>
          <label className="auth-field">
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={assignIsPrimary}
                onChange={(e) => setAssignIsPrimary(e.target.checked)}
              />
              Birincil Sakin
            </span>
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn-primary" type="submit" disabled={assignSaving || !assignUnitId}>
              {assignSaving ? "Kaydediliyor…" : "Ata"}
            </button>
          </div>
        </form>
      )}

      {occError && <div className="auth-error">{occError}</div>}

      {occLoading ? (
        <div className="empty-state">Yükleniyor…</div>
      ) : occupancies.length === 0 ? (
        <div className="empty-state">Bu sakin için daire ataması bulunmuyor.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Daire</th>
                <th>İlişki Türü</th>
                <th>Birincil</th>
                <th>Başlangıç</th>
                <th>Bitiş</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {occupancies.map((occ) => {
                const isActive = !occ.end_date;
                return (
                  <tr key={occ.id}>
                    <td>{unitLabel(unitsById.get(occ.unit_id), blocksById)}</td>
                    <td>{RELATIONSHIP_LABELS[occ.relationship_type]}</td>
                    <td>{occ.is_primary ? "Evet" : "Hayır"}</td>
                    <td>{occ.start_date}</td>
                    <td>
                      {isActive ? (
                        <span className="pill pill-blue">Devam ediyor</span>
                      ) : (
                        occ.end_date
                      )}
                    </td>
                    <td>
                      {canWrite && isActive && (
                        moveOutTargetId === occ.id ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              type="date"
                              value={moveOutDate}
                              onChange={(e) => setMoveOutDate(e.target.value)}
                              style={{
                                padding: "6px 8px",
                                fontSize: 12,
                                border: "0.5px solid var(--border-strong)",
                                borderRadius: 6,
                              }}
                            />
                            <button
                              className="btn-danger"
                              disabled={moveOutSaving}
                              onClick={() => onMoveOut(occ)}
                            >
                              {moveOutSaving ? "Kaydediliyor…" : "Onayla"}
                            </button>
                            <button className="btn-secondary" onClick={() => setMoveOutTargetId(null)}>
                              Vazgeç
                            </button>
                          </div>
                        ) : (
                          <button className="btn-secondary" onClick={() => setMoveOutTargetId(occ.id)}>
                            Taşındı / Çıkış
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
