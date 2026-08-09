"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

export default function CurrentAccountPage() {
  const { selectedSiteId } = useAidat();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);

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

  const entriesWithRunningBalance = useMemo(() => {
    let running = 0;
    return entries.map((e) => {
      running += e.amount;
      return { ...e, running };
    });
  }, [entries]);

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
          <label className="auth-field">
            <span>Daire{units.length === 0 ? " (yok)" : ""}</span>
            <select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              disabled={units.length === 0}
            >
              <option value="">Seçiniz</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitLabel(u.id)}
                </option>
              ))}
            </select>
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
            </div>

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
