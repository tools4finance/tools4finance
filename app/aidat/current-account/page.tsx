"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

type Block = {
  id: string;
  name: string;
};

type Unit = {
  id: string;
  site_id: string;
  block_id: string | null;
  unit_number: string;
  active: boolean;
};

type LedgerEntryType = "accrual" | "payment" | "adjustment" | "opening_balance";

type LedgerEntry = {
  id: string;
  site_id: string;
  unit_id: string;
  entry_date: string;
  entry_type: LedgerEntryType;
  amount: number;
  reference_table: string | null;
  reference_id: string | null;
  description: string | null;
};

type UnitBalance = {
  unit_id: string;
  site_id: string;
  balance: number;
};

const ENTRY_TYPE_LABELS: Record<LedgerEntryType, string> = {
  accrual: "Tahakkuk",
  payment: "Tahsilat",
  adjustment: "Düzeltme",
  opening_balance: "Açılış Bakiyesi",
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amount);
}

function formatSignedCurrency(amount: number) {
  const formatted = formatCurrency(Math.abs(amount));
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return formatted;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("tr-TR");
}

function slugify(text: string) {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function CurrentAccountPage() {
  const { selectedSiteId, selectedSite } = useAidat();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [unitSearch, setUnitSearch] = useState("");
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);

  const fetchUnits = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoadingUnits(true);
    setError(null);

    const [blocksRes, unitsRes] = await Promise.all([
      supabase.from("blocks").select("id, name").eq("site_id", selectedSiteId),
      supabase
        .from("units")
        .select("id, site_id, block_id, unit_number, active")
        .eq("site_id", selectedSiteId)
        .order("unit_number", { ascending: true }),
    ]);

    if (blocksRes.error) {
      setError(blocksRes.error.message);
    } else if (unitsRes.error) {
      setError(unitsRes.error.message);
    } else {
      setBlocks((blocksRes.data ?? []) as Block[]);
      setUnits((unitsRes.data ?? []) as Unit[]);
    }
    setLoadingUnits(false);
  }, [selectedSiteId]);

  useEffect(() => {
    fetchUnits();
    setSelectedUnitId("");
    setUnitSearch("");
  }, [fetchUnits]);

  const blockName = useCallback(
    (blockId: string | null) => blocks.find((b) => b.id === blockId)?.name ?? null,
    [blocks]
  );

  const unitLabel = useCallback(
    (unitId: string) => {
      const unit = units.find((u) => u.id === unitId);
      if (!unit) return "—";
      const bName = blockName(unit.block_id);
      return bName ? `${bName} — ${unit.unit_number}` : unit.unit_number;
    },
    [units, blockName]
  );

  const fetchLedger = useCallback(async () => {
    if (!selectedSiteId || !selectedUnitId) {
      setEntries([]);
      setBalance(null);
      return;
    }
    setLoadingLedger(true);
    setError(null);

    const [entriesRes, balanceRes] = await Promise.all([
      supabase
        .from("unit_ledger_entries")
        .select("id, site_id, unit_id, entry_date, entry_type, amount, reference_table, reference_id, description")
        .eq("site_id", selectedSiteId)
        .eq("unit_id", selectedUnitId)
        .order("entry_date", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("v_unit_balances")
        .select("unit_id, site_id, balance")
        .eq("site_id", selectedSiteId)
        .eq("unit_id", selectedUnitId)
        .maybeSingle(),
    ]);

    if (entriesRes.error) {
      setError(entriesRes.error.message);
      setLoadingLedger(false);
      return;
    }
    if (balanceRes.error) {
      setError(balanceRes.error.message);
      setLoadingLedger(false);
      return;
    }

    setEntries((entriesRes.data ?? []) as LedgerEntry[]);
    const balanceData = balanceRes.data as UnitBalance | null;
    setBalance(balanceData ? balanceData.balance : 0);
    setLoadingLedger(false);
  }, [selectedSiteId, selectedUnitId]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  const filteredUnits = useMemo(() => {
    const q = unitSearch.trim().toLocaleLowerCase("tr");
    if (!q) return units;
    return units.filter((u) => unitLabel(u.id).toLocaleLowerCase("tr").includes(q));
  }, [units, unitSearch, unitLabel]);

  function pickUnit(unitId: string) {
    setSelectedUnitId(unitId);
    setUnitSearch(unitLabel(unitId));
    setUnitPickerOpen(false);
  }

  const entriesWithRunningBalance = useMemo(() => {
    let running = 0;
    return entries.map((e) => {
      running += e.amount;
      return { ...e, running };
    });
  }, [entries]);

  const handleExportExcel = useCallback(() => {
    if (entries.length === 0 || !selectedUnitId) return;

    const today = new Date();
    const generatedLabel = today.toLocaleDateString("tr-TR");
    const unit = unitLabel(selectedUnitId);

    const rows: (string | number)[][] = [
      [selectedSite?.site.name ?? "Site"],
      [unit],
      ["Hesap Ekstresi"],
      [`Oluşturma Tarihi: ${generatedLabel}`],
      [],
      ["Tarih", "Tür", "Açıklama", "Tutar", "Bakiye"],
      ...entriesWithRunningBalance.map((e) => [
        formatDate(e.entry_date),
        ENTRY_TYPE_LABELS[e.entry_type],
        e.description ?? "",
        e.amount,
        e.running,
      ]),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 14 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ekstre");

    const datePart = today.toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(workbook, `ekstre-${slugify(unit)}-${datePart}.xlsx`);
  }, [entries.length, selectedUnitId, selectedSite, unitLabel, entriesWithRunningBalance]);

  const handleExportPdf = useCallback(() => {
    if (entries.length === 0 || !selectedUnitId) return;

    const today = new Date();
    const generatedLabel = today.toLocaleDateString("tr-TR");
    const unit = unitLabel(selectedUnitId);
    const siteName = selectedSite?.site.name ?? "";
    const siteAddress = selectedSite?.site.address ?? "";

    const rowsHtml = entriesWithRunningBalance
      .map(
        (e) => `<tr>
          <td>${escapeHtml(formatDate(e.entry_date))}</td>
          <td>${escapeHtml(ENTRY_TYPE_LABELS[e.entry_type])}</td>
          <td>${escapeHtml(e.description ?? "—")}</td>
          <td class="num">${escapeHtml(formatSignedCurrency(e.amount))}</td>
          <td class="num">${escapeHtml(formatCurrency(e.running))}</td>
        </tr>`
      )
      .join("");

    const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Ekstre - ${escapeHtml(unit)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 16px 0 4px; font-weight: 600; color: #222; }
  .meta { font-size: 12px; color: #555; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; text-align: left; }
  th { background: #f0f0f0; }
  td.num, th.num { text-align: right; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(siteName)}</h1>
  ${siteAddress ? `<div class="meta">${escapeHtml(siteAddress)}</div>` : ""}
  <h2>Hesap Ekstresi — ${escapeHtml(unit)}</h2>
  <div class="meta">Oluşturma Tarihi: ${escapeHtml(generatedLabel)}</div>
  <div class="meta">Güncel Bakiye: ${escapeHtml(formatCurrency(balance ?? 0))}</div>
  <table>
    <thead>
      <tr>
        <th>Tarih</th>
        <th>Tür</th>
        <th>Açıklama</th>
        <th class="num">Tutar</th>
        <th class="num">Bakiye</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 300);
  }, [entries.length, selectedUnitId, selectedSite, unitLabel, entriesWithRunningBalance, balance]);

  if (loadingUnits) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  return (
    <div>
      {error && (
        <div className="auth-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Cari Hesap</div>
        </div>

        <div className="form-grid">
          <label className="auth-field" style={{ position: "relative" }}>
            <span>Daire{units.length === 0 ? " (yok)" : ""} — ara veya seç</span>
            <input
              type="text"
              value={unitSearch}
              disabled={units.length === 0}
              placeholder="Blok veya daire no yazın…"
              onFocus={() => setUnitPickerOpen(true)}
              onChange={(e) => {
                setUnitSearch(e.target.value);
                setUnitPickerOpen(true);
                if (selectedUnitId) setSelectedUnitId("");
              }}
              onBlur={() => {
                // allow the click on a list item to register before closing
                setTimeout(() => setUnitPickerOpen(false), 150);
              }}
            />
            {unitPickerOpen && (
              <div className="unit-picker-dropdown">
                {filteredUnits.length === 0 ? (
                  <div className="unit-picker-empty">Eşleşen daire yok.</div>
                ) : (
                  filteredUnits.map((u) => (
                    <button
                      type="button"
                      key={u.id}
                      className="unit-picker-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickUnit(u.id)}
                    >
                      {unitLabel(u.id)}
                    </button>
                  ))
                )}
              </div>
            )}
          </label>
        </div>
      </div>

      {!selectedUnitId ? (
        <div className="panel">
          <div className="empty-state">Ekstre görüntülemek için bir daire seçin.</div>
        </div>
      ) : loadingLedger ? (
        <div className="panel">
          <div className="empty-state">Yükleniyor…</div>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">Güncel Bakiye</div>
              <div className="kpi-value">
                <span className={`pill ${balance !== null && balance > 0 ? "pill-coral" : "pill-green"}`}>
                  {formatCurrency(balance ?? 0)}
                </span>
              </div>
              <div className="kpi-sub">
                {balance !== null && balance > 0 ? "Borçlu" : "Ödenmiş / Alacaklı"}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Daire</div>
              <div className="kpi-value">{unitLabel(selectedUnitId)}</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">Hesap Ekstresi</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={entries.length === 0}
                  onClick={handleExportExcel}
                >
                  Excel İndir
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={entries.length === 0}
                  onClick={handleExportPdf}
                >
                  PDF İndir
                </button>
              </div>
            </div>

            {entries.length > 0 && (
              <div className="kpi-sub" style={{ marginBottom: 12 }}>
                E-posta ile gönderme özelliği yakında eklenecek.
              </div>
            )}

            {entries.length === 0 ? (
              <div className="empty-state">Bu daire için hesap hareketi yok.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>Tür</th>
                      <th>Açıklama</th>
                      <th className="num">Tutar</th>
                      <th className="num">Bakiye</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entriesWithRunningBalance.map((e) => (
                      <tr key={e.id}>
                        <td>{formatDate(e.entry_date)}</td>
                        <td>
                          <span
                            className={`pill ${
                              e.entry_type === "payment"
                                ? "pill-green"
                                : e.entry_type === "accrual"
                                ? "pill-coral"
                                : e.entry_type === "adjustment"
                                ? "pill-amber"
                                : "pill-neutral"
                            }`}
                          >
                            {ENTRY_TYPE_LABELS[e.entry_type]}
                          </span>
                        </td>
                        <td className="wrap">{e.description ?? "—"}</td>
                        <td className="num">{formatSignedCurrency(e.amount)}</td>
                        <td className="num">{formatCurrency(e.running)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
