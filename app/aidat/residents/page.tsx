"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";
import { exportRowsToExcel, exportRowsToPdf, type ExportColumn } from "@/lib/exportTable";
import TrDateInput from "@/components/TrDateInput";

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

// ---------------------------------------------------------------------------
// Excel bulk-import (Excel ile Toplu Yükle)
// ---------------------------------------------------------------------------

const BULK_TEMPLATE_HEADERS = ["Ad*", "Soyad*", "Telefon", "E-posta", "Blok", "Daire No", "İlişki"] as const;

type ImportRowStatus = "ready" | "warning" | "skip";

type ParsedResidentRow = {
  rowNumber: number; // matches the row in the source spreadsheet (header = row 1)
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  blockName: string;
  unitNumber: string;
  relationship: RelationshipType;
  status: ImportRowStatus;
  message: string;
  resolvedUnitId: string | null;
};

type BulkImportSummary = {
  created: number;
  skippedInvalid: number;
  unassigned: number;
  errors: string[];
};

function handleDownloadTemplate() {
  const exampleRow: Record<(typeof BULK_TEMPLATE_HEADERS)[number], string> = {
    "Ad*": "Ahmet",
    "Soyad*": "Yılmaz",
    Telefon: "0532 000 00 00",
    "E-posta": "ahmet@ornek.com",
    Blok: "A Blok",
    "Daire No": "5",
    İlişki: "Ev Sahibi",
  };
  const sheet = XLSX.utils.json_to_sheet([exampleRow], { header: [...BULK_TEMPLATE_HEADERS] });
  const notesSheet = XLSX.utils.aoa_to_sheet([
    ["Açıklama"],
    ["* işaretli alanlar zorunludur: Ad ve Soyad."],
    ["Telefon, E-posta, Blok, Daire No ve İlişki alanları opsiyoneldir."],
    [
      "İlişki alanı için geçerli değerler: Ev Sahibi, Kiracı, Oturan, Yetkili Kişi. Boş bırakılırsa veya tanınmazsa 'Ev Sahibi' kabul edilir.",
    ],
    [
      "Blok ve Daire No girilirse, sistemde bu isimlerle kayıtlı bir blok/daire olması gerekir; aksi halde sakin yine oluşturulur ama daireye atanmaz.",
    ],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sakinler");
  XLSX.utils.book_append_sheet(workbook, notesSheet, "Açıklama");
  XLSX.writeFile(workbook, "sakinler_sablonu.xlsx");
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

function parseRelationshipLabel(label: string): RelationshipType {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return "owner";
  const entries = Object.entries(RELATIONSHIP_LABELS) as [RelationshipType, string][];
  const match = entries.find(([, lbl]) => lbl.toLowerCase() === normalized);
  return match ? match[0] : "owner";
}

function buildParsedRow(
  raw: Record<string, unknown>,
  index: number,
  blocks: Block[],
  units: Unit[]
): ParsedResidentRow {
  const firstName = cellToString(raw["Ad*"] ?? raw["Ad"]);
  const lastName = cellToString(raw["Soyad*"] ?? raw["Soyad"]);
  const phone = cellToString(raw["Telefon"]);
  const email = cellToString(raw["E-posta"]);
  const blockName = cellToString(raw["Blok"]);
  const unitNumber = cellToString(raw["Daire No"]);
  const relationship = parseRelationshipLabel(cellToString(raw["İlişki"]));
  const rowNumber = index + 2; // header occupies row 1

  const base = {
    rowNumber,
    firstName,
    lastName,
    phone,
    email,
    blockName,
    unitNumber,
    relationship,
    resolvedUnitId: null as string | null,
  };

  if (!firstName || !lastName) {
    return {
      ...base,
      status: "skip",
      message: "Ad ve Soyad zorunludur, bu satır atlanacak.",
    };
  }

  if (blockName) {
    const block = blocks.find((b) => b.name.toLowerCase() === blockName.toLowerCase());
    if (!block) {
      return {
        ...base,
        status: "warning",
        message: `"${blockName}" adlı blok bulunamadı. Sakin oluşturulacak ama daireye atanmayacak.`,
      };
    }
    if (unitNumber) {
      const unit = units.find(
        (u) => u.block_id === block.id && u.unit_number.toLowerCase() === unitNumber.toLowerCase()
      );
      if (!unit) {
        return {
          ...base,
          status: "warning",
          message: `"${blockName} — ${unitNumber}" dairesi bulunamadı. Sakin oluşturulacak ama daireye atanmayacak.`,
        };
      }
      return {
        ...base,
        status: "ready",
        message: "Hazır, daireye atanacak.",
        resolvedUnitId: unit.id,
      };
    }
    return {
      ...base,
      status: "ready",
      message: "Blok girildi ama Daire No boş, sadece sakin oluşturulacak.",
    };
  }

  return { ...base, status: "ready", message: "Hazır." };
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

  // Excel bulk-import state
  const [parsedRows, setParsedRows] = useState<ParsedResidentRow[]>([]);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkImportSummary | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

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

  async function handleBulkFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setBulkError(null);
    setBulkResult(null);
    setParsedRows([]);
    setBulkParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
      if (!sheet) {
        throw new Error("Excel dosyasında okunabilir bir sayfa bulunamadı.");
      }
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const rows = rawRows.map((raw, idx) => buildParsedRow(raw, idx, blocks, units));
      if (rows.length === 0) {
        setBulkError("Dosyada satır bulunamadı. Lütfen şablonu kullanarak en az bir sakin satırı ekleyin.");
      }
      setParsedRows(rows);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Dosya okunamadı. Lütfen .xlsx/.xls formatında yükleyin.");
    } finally {
      setBulkParsing(false);
    }
  }

  function handleCancelBulkPreview() {
    setParsedRows([]);
    setBulkError(null);
  }

  async function handleImportRows() {
    if (!selectedSiteId || !canWrite) return;
    const readyRows = parsedRows.filter((r) => r.status !== "skip");
    const skippedInvalid = parsedRows.length - readyRows.length;
    if (readyRows.length === 0) return;

    setBulkImporting(true);
    setBulkError(null);
    setBulkResult(null);
    setImportProgress({ done: 0, total: readyRows.length });

    let created = 0;
    let unassigned = 0;
    const errors: string[] = [];

    for (let i = 0; i < readyRows.length; i++) {
      const row = readyRows[i];
      const { data: insertedResident, error: insertError } = await supabase
        .from("residents")
        .insert({
          site_id: selectedSiteId,
          first_name: row.firstName,
          last_name: row.lastName,
          phone: row.phone || null,
          email: row.email || null,
          active: true,
        })
        .select("id")
        .single();

      const residentId = (insertedResident as { id: string } | null)?.id;
      if (insertError || !residentId) {
        errors.push(`${row.firstName} ${row.lastName} (satır ${row.rowNumber}): ${insertError?.message ?? "kaydedilemedi"}`);
        setImportProgress({ done: i + 1, total: readyRows.length });
        continue;
      }
      created++;

      if (row.resolvedUnitId) {
        const { error: linkError } = await supabase.from("unit_residents").insert({
          unit_id: row.resolvedUnitId,
          resident_id: residentId,
          relationship_type: row.relationship,
          is_primary: false,
          start_date: todayStr(),
        });
        if (linkError) unassigned++;
      } else if (row.status === "warning") {
        unassigned++;
      }

      setImportProgress({ done: i + 1, total: readyRows.length });
    }

    setBulkImporting(false);
    setImportProgress(null);
    setBulkResult({ created, skippedInvalid, unassigned, errors });
    setParsedRows([]);
    await loadResidents();
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

  const readyCount = parsedRows.filter((r) => r.status === "ready").length;
  const warningCount = parsedRows.filter((r) => r.status === "warning").length;
  const skipCount = parsedRows.filter((r) => r.status === "skip").length;

  function buildResidentsExportColumns(): ExportColumn[] {
    return [
      {
        header: "Ad Soyad",
        value: (row) => {
          const r = row as unknown as Resident;
          return `${r.first_name} ${r.last_name}`;
        },
      },
      { header: "Telefon", value: (row) => (row as unknown as Resident).phone ?? "—" },
      { header: "E-posta", value: (row) => (row as unknown as Resident).email ?? "—" },
      { header: "Durum", value: (row) => ((row as unknown as Resident).active ? "Aktif" : "Pasif") },
    ];
  }

  function handleExportResidentsExcel() {
    exportRowsToExcel(residents as unknown as Record<string, unknown>[], buildResidentsExportColumns(), {
      title: "Sakinler",
    });
  }

  function handleExportResidentsPdf() {
    exportRowsToPdf(residents as unknown as Record<string, unknown>[], buildResidentsExportColumns(), {
      title: "Sakinler",
    });
  }

  return (
    <div>
      {canWrite && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Excel ile Toplu Yükle</div>
          </div>

          <div className="auth-info" style={{ marginBottom: 14 }}>
            Sakinlerinizi tek tek girmek yerine, elinizdeki listeyi Excel şablonuna aktarıp buradan toplu
            olarak yükleyebilirsiniz. Önce şablonu indirin, doldurun, sonra dosyayı seçip önizlemeden
            onaylayın.
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
            <button type="button" className="btn-secondary" onClick={handleDownloadTemplate}>
              Excel Şablonu İndir
            </button>
            <label className="auth-field" style={{ flex: "1 1 240px", minWidth: 240 }}>
              <span>Excel Dosyası Seç (.xlsx / .xls)</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleBulkFileSelected}
                disabled={bulkParsing || bulkImporting}
              />
            </label>
          </div>

          {bulkParsing && <div className="empty-state">Dosya okunuyor…</div>}
          {bulkError && <div className="auth-error">{bulkError}</div>}

          {parsedRows.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
                <span className="pill pill-green">{readyCount} hazır</span>
                <span className="pill pill-amber">{warningCount} uyarı</span>
                <span className="pill pill-coral">{skipCount} atlanacak</span>
              </div>
              <div className="table-scroll" style={{ marginBottom: 14 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Satır</th>
                      <th>Durum</th>
                      <th>Ad Soyad</th>
                      <th>Telefon</th>
                      <th className="wrap">E-posta</th>
                      <th>Blok</th>
                      <th>Daire No</th>
                      <th>İlişki</th>
                      <th className="wrap">Not</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>
                          {row.status === "ready" && <span className="pill pill-green">Hazır</span>}
                          {row.status === "warning" && <span className="pill pill-amber">Uyarı</span>}
                          {row.status === "skip" && <span className="pill pill-coral">Atlanacak</span>}
                        </td>
                        <td className="wrap">
                          {row.firstName} {row.lastName}
                        </td>
                        <td>{row.phone || "—"}</td>
                        <td className="wrap">{row.email || "—"}</td>
                        <td>{row.blockName || "—"}</td>
                        <td>{row.unitNumber || "—"}</td>
                        <td>{RELATIONSHIP_LABELS[row.relationship]}</td>
                        <td className="wrap">{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {importProgress && (
                <div className="empty-state">
                  İçe aktarılıyor… ({importProgress.done}/{importProgress.total})
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleImportRows}
                  disabled={bulkImporting || readyCount + warningCount === 0}
                >
                  {bulkImporting ? "Kaydediliyor…" : `İçe Aktar (${readyCount + warningCount})`}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCancelBulkPreview}
                  disabled={bulkImporting}
                >
                  Vazgeç
                </button>
              </div>
            </>
          )}

          {bulkResult && (
            <div className="auth-info" style={{ marginTop: 14 }}>
              {bulkResult.created} sakin oluşturuldu, {bulkResult.skippedInvalid} satır atlandı (Ad/Soyad
              eksik), {bulkResult.unassigned} sakin daireye atanamadı (blok/daire bulunamadı, sonradan
              manuel atayabilirsiniz).
              {bulkResult.errors.length > 0 && (
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {bulkResult.errors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Sakinler</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={residents.length === 0}
              onClick={handleExportResidentsExcel}
            >
              Excel İndir
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={residents.length === 0}
              onClick={handleExportResidentsPdf}
            >
              PDF İndir
            </button>
          </div>
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
            <TrDateInput value={assignStartDate} onChange={setAssignStartDate} required />
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
                            <TrDateInput value={moveOutDate} onChange={setMoveOutDate} />
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
