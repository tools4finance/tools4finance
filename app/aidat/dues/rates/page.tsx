"use client";

// ============================================================================
// Aidat Tutarları — spreadsheet-style effective-dated dues rate matrix.
//
// This supersedes nothing: app/aidat/units/page.tsx keeps its simple
// "one active dues_rules row per unit" quick-edit field untouched. This page
// is the place where the effective-dating columns dues_rules was designed
// for from the start (see supabase/migrations/20260809190000_init_aidat_schema.sql,
// section 6) actually get used: units as rows, months as columns, each cell
// showing/editing the rate that was IN EFFECT for that unit in that month.
//
// No new migration was needed — dues_rules already has
// (unit_id, amount, effective_from, effective_to, active) which is exactly
// the shape an effective-dated rate history requires.
//
// --- "Amount in effect" rule (must match exactly, see below) --------------
// For a given (unit, month), the effective row is the dues_rules row for
// that unit where effective_from <= the month's first day AND
// (effective_to is null OR effective_to >= the month's last day) — i.e. the
// rule must cover the month in full, not just part of it. If more than one
// row matches (shouldn't happen with clean data, but defensively), the one
// with the latest effective_from wins.
//
// One consequence worth flagging: a dues_rules row created through the
// simpler Daireler (app/aidat/units/page.tsx) editor defaults effective_from
// to `current_date` — i.e. whatever day-of-month it was created on, not the
// 1st. Such a row will not satisfy "effective_from <= month's first day" for
// its own creation month, so it first appears as "in effect" in this matrix
// starting the FOLLOWING calendar month. Every row this page itself writes
// always uses the 1st of the target month for effective_from, so this only
// affects legacy rows created via the simple editor.
//
// --- Editing a cell: "close old rule, open new rule" (design choice b) ---
// Editing a cell must never rewrite history — a rate change back-fills
// forward from the edited month only, matching how the site owner described
// it ("zam gelince güncelleme" — a change effective from that point on, not
// a rewrite of the past). Concretely, on a changed cell:
//   1. If there's no currently-effective rule for that unit/month at all
//      (gap, or nothing set yet): insert a new rule starting at the 1st of
//      the edited month, with effective_to capped at the day before the
//      next later rule (if any), so it never overlaps a rule that already
//      exists further in the future.
//   2. If a rule is currently effective and its effective_from IS the 1st
//      of the edited month exactly: update its amount in place. Splitting
//      would try to set effective_to before its own effective_from (illegal
//      per the table's check constraint), and there is no earlier month
//      this particular row ever covered, so there is nothing to protect by
//      splitting — an in-place update is both simpler and correct.
//   3. Otherwise (a rule is effective and started strictly before the
//      edited month): close it out — set its effective_to to the day
//      before the edited month starts — then insert a new rule starting at
//      the edited month with the new amount, inheriting the OLD rule's
//      original effective_to (open-ended if it was open-ended). Earlier
//      months keep showing the old rule's original amount; the edited
//      month and everything after (up to the next explicitly-set rule, if
//      any) shows the new amount.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAidat } from "@/lib/aidatContext";
import { supabase } from "@/lib/supabase";

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });

const MONTH_NAMES = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const MONTH_ABBR = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

// Each month is a table *column* here (like the comparison report), so the
// cap is tight enough to stay readable — 18 side-by-side editable columns is
// already a lot of horizontal scroll.
const MAX_MONTHS = 18;

type Block = { id: string; name: string; display_order: number };
type Unit = { id: string; site_id: string; block_id: string | null; unit_number: string; active: boolean };

type DuesRule = {
  id: string;
  unit_id: string;
  name: string;
  amount: number;
  effective_from: string; // ISO date "YYYY-MM-DD"
  effective_to: string | null;
  active: boolean;
};

type PeriodKey = { year: number; month: number };

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// year*12 + (month-1) — plain integer arithmetic over (year, month) pairs,
// same convention as reports/trend and reports/comparison.
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromMonthIndex(idx: number): PeriodKey {
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

function shiftMonths(year: number, month: number, delta: number): PeriodKey {
  return fromMonthIndex(monthIndex(year, month) + delta);
}

function isoFirstDay(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

function isoLastDay(year: number, month: number): string {
  // Date.UTC(year, month, 0) = day 0 of the (0-indexed) month `month`,
  // which is the last day of the 1-indexed month `month`. UTC avoids any
  // local-timezone day-shift when formatting back to an ISO date string.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function dayBeforeIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function periodLabel(year: number, month: number): string {
  return `${MONTH_ABBR[month - 1]} ${year}`;
}

// The rule "in effect" for a whole month: must start on/before the month's
// first day and (if it ends at all) end on/after the month's last day — see
// file header for why partial-month coverage doesn't count. Ties broken by
// latest effective_from.
function effectiveRuleForMonth(rules: DuesRule[], year: number, month: number): DuesRule | null {
  const firstDay = isoFirstDay(year, month);
  const lastDay = isoLastDay(year, month);
  let best: DuesRule | null = null;
  for (const r of rules) {
    if (!r.active) continue;
    if (r.effective_from <= firstDay && (r.effective_to === null || r.effective_to >= lastDay)) {
      if (!best || r.effective_from > best.effective_from) best = r;
    }
  }
  return best;
}

// The next rule (if any) starting strictly after this month's first day —
// used to cap a newly-inserted open gap-filler rule so it never overlaps a
// rule that already exists further in the future.
function nextRuleAfter(rules: DuesRule[], year: number, month: number): DuesRule | null {
  const firstDay = isoFirstDay(year, month);
  let best: DuesRule | null = null;
  for (const r of rules) {
    if (!r.active) continue;
    if (r.effective_from > firstDay) {
      if (!best || r.effective_from < best.effective_from) best = r;
    }
  }
  return best;
}

// Best-effort numeric parsing for typed OR pasted values — tolerates plain
// "1500", "1500.50", Turkish-locale "1.500,50", or a lone "1500,50", and
// strips stray currency symbols/spaces a paste from Excel might carry.
function parseNumeric(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;
  s = s.replace(/[^\d,.\-]/g, "");
  if (s === "") return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type CellEditResult = { error: string | null; rules?: DuesRule[] };

// Pure-ish: never mutates the `rules` array/objects it's given — returns the
// unit's new rule list on success so callers (single-cell edit, or a paste
// loop touching several months of the same unit in sequence) can thread the
// updated history forward without re-fetching between every cell.
async function applyCellEdit(
  siteId: string,
  unitId: string,
  year: number,
  month: number,
  newAmount: number,
  rules: DuesRule[]
): Promise<CellEditResult> {
  const firstDay = isoFirstDay(year, month);
  const current = effectiveRuleForMonth(rules, year, month);

  if (current && current.amount === newAmount) {
    return { error: null }; // no-op, avoid a needless write
  }

  // Case 2: editing exactly the month this rule already starts in — update
  // in place, no split needed (see file header, case 2).
  if (current && current.effective_from === firstDay) {
    const { error } = await supabase.from("dues_rules").update({ amount: newAmount }).eq("id", current.id);
    if (error) return { error: error.message };
    return { error: null, rules: rules.map((r) => (r.id === current.id ? { ...r, amount: newAmount } : r)) };
  }

  const next = nextRuleAfter(rules, year, month);
  // Capture the ORIGINAL effective_to before we (maybe) close the current
  // rule below — the new rule inherits it, so any already-scheduled future
  // rate change stays untouched.
  const newEffectiveTo = current ? current.effective_to : next ? dayBeforeIso(next.effective_from) : null;

  let workingRules = rules;
  if (current) {
    // Case 3: close the old rule the day before the edited month starts.
    const closeTo = dayBeforeIso(firstDay);
    const { error: closeError } = await supabase.from("dues_rules").update({ effective_to: closeTo }).eq("id", current.id);
    if (closeError) return { error: closeError.message };
    workingRules = workingRules.map((r) => (r.id === current.id ? { ...r, effective_to: closeTo } : r));
  }

  const { data: inserted, error: insertError } = await supabase
    .from("dues_rules")
    .insert({
      site_id: siteId,
      unit_id: unitId,
      name: current?.name ?? "Aidat",
      amount: newAmount,
      effective_from: firstDay,
      effective_to: newEffectiveTo,
      active: true,
    })
    .select("id, unit_id, name, amount, effective_from, effective_to, active")
    .single();

  if (insertError || !inserted) return { error: insertError?.message ?? "Kaydedilemedi." };

  workingRules = [...workingRules, inserted as DuesRule].sort((a, b) =>
    a.effective_from < b.effective_from ? -1 : a.effective_from > b.effective_from ? 1 : 0
  );

  return { error: null, rules: workingRules };
}

export default function DuesRatesMatrixPage() {
  const { selectedSiteId, canWrite, year: shellYear, month: shellMonth } = useAidat();

  // Default window: trailing 6 months through the next 2 months, anchored to
  // the shell's currently-selected period (same anchor convention as
  // reports/trend and reports/comparison) — gives recent history AND
  // near-future planning room without reinventing the picker pattern.
  const defaultEnd = useMemo(() => shiftMonths(shellYear, shellMonth, 2), [shellYear, shellMonth]);
  const defaultStart = useMemo(() => shiftMonths(shellYear, shellMonth, -6), [shellYear, shellMonth]);

  const [startYear, setStartYear] = useState(defaultStart.year);
  const [startMonth, setStartMonth] = useState(defaultStart.month);
  const [endYear, setEndYear] = useState(defaultEnd.year);
  const [endMonth, setEndMonth] = useState(defaultEnd.month);

  function resetToDefault() {
    setStartYear(defaultStart.year);
    setStartMonth(defaultStart.month);
    setEndYear(defaultEnd.year);
    setEndMonth(defaultEnd.month);
  }

  // Self-correct the picker's OWN state if start ends up after end, so the
  // dropdowns themselves never keep showing an inverted selection.
  useEffect(() => {
    const startIdx = monthIndex(startYear, startMonth);
    const endIdx = monthIndex(endYear, endMonth);
    if (startIdx > endIdx) {
      setStartYear(endYear);
      setStartMonth(endMonth);
      setEndYear(startYear);
      setEndMonth(startMonth);
    }
  }, [startYear, startMonth, endYear, endMonth]);

  const { months: rangeMonths, clamped } = useMemo(() => {
    let startIdx = monthIndex(startYear, startMonth);
    const endIdx = monthIndex(endYear, endMonth);
    let wasClamped = false;
    if (endIdx - startIdx + 1 > MAX_MONTHS) {
      startIdx = endIdx - (MAX_MONTHS - 1);
      wasClamped = true;
    }
    const list: PeriodKey[] = [];
    for (let idx = startIdx; idx <= endIdx; idx++) list.push(fromMonthIndex(idx));
    return { months: list, clamped: wasClamped };
  }, [startYear, startMonth, endYear, endMonth]);

  const yearOptions = useMemo(() => {
    const base = shellYear;
    return Array.from({ length: 10 }, (_, i) => base - 7 + i);
  }, [shellYear]);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [rulesByUnit, setRulesByUnit] = useState<Record<string, DuesRule[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingCell, setPendingCell] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);

    // Fetch the unit's ENTIRE rule history (not just the visible range) —
    // a rule effective from years ago with no end date can still be the
    // effective rule for a month at the edge of (or beyond) the picker.
    const [blocksRes, unitsRes, rulesRes] = await Promise.all([
      supabase.from("blocks").select("id, name, display_order").eq("site_id", selectedSiteId),
      supabase
        .from("units")
        .select("id, site_id, block_id, unit_number, active")
        .eq("site_id", selectedSiteId)
        .eq("active", true)
        .order("unit_number", { ascending: true }),
      supabase
        .from("dues_rules")
        .select("id, unit_id, name, amount, effective_from, effective_to, active")
        .eq("site_id", selectedSiteId)
        .eq("active", true)
        .not("unit_id", "is", null)
        .order("effective_from", { ascending: true }),
    ]);

    if (blocksRes.error) {
      setError(blocksRes.error.message);
      setLoading(false);
      return;
    }
    if (unitsRes.error) {
      setError(unitsRes.error.message);
      setLoading(false);
      return;
    }
    if (rulesRes.error) {
      setError(rulesRes.error.message);
      setLoading(false);
      return;
    }

    setBlocks((blocksRes.data ?? []) as Block[]);
    setUnits((unitsRes.data ?? []) as Unit[]);

    const map: Record<string, DuesRule[]> = {};
    for (const rule of (rulesRes.data ?? []) as DuesRule[]) {
      (map[rule.unit_id] ??= []).push(rule);
    }
    setRulesByUnit(map);
    setLoading(false);
  }, [selectedSiteId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const blockNameById = useMemo(() => {
    const m = new Map<string, string>();
    blocks.forEach((b) => m.set(b.id, b.name));
    return m;
  }, [blocks]);

  const sortedUnits = useMemo(() => {
    const orderById = new Map<string, number>();
    blocks.forEach((b) => orderById.set(b.id, b.display_order));
    return [...units].sort((a, b) => {
      const ao = a.block_id ? orderById.get(a.block_id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const bo = b.block_id ? orderById.get(b.block_id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
    });
  }, [units, blocks]);

  function unitLabel(unit: Unit): string {
    const bName = unit.block_id ? blockNameById.get(unit.block_id) : undefined;
    return bName ? `${bName} — ${unit.unit_number}` : unit.unit_number;
  }

  async function commitCell(unit: Unit, year: number, month: number, amount: number) {
    if (!selectedSiteId) return;
    const cellKey = `${unit.id}:${year}-${month}`;
    setSaving(true);
    setPendingCell(cellKey);
    setError(null);

    const result = await applyCellEdit(selectedSiteId, unit.id, year, month, amount, rulesByUnit[unit.id] ?? []);

    setSaving(false);
    setPendingCell(null);

    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.rules) {
      setRulesByUnit((prev) => ({ ...prev, [unit.id]: result.rules! }));
    }
  }

  function handleCellBlur(unit: Unit, year: number, month: number, valueStr: string) {
    if (!canWrite || saving) return;
    const trimmed = valueStr.trim();
    if (trimmed === "") return; // blank on blur is a no-op, not a delete
    const amount = parseNumeric(trimmed);
    if (amount === null || amount < 0) {
      setError("Geçersiz tutar.");
      return;
    }
    void commitCell(unit, year, month, amount);
  }

  // Spreadsheet-style paste: parses Excel/Sheets' tab/newline-delimited
  // clipboard format into a 2D array and applies it starting at the pasted
  // cell, filling right/down, clamped to the grid's actual bounds. Cells are
  // applied sequentially (not in parallel) so that multiple pasted months
  // for the SAME unit see each other's just-written history — required for
  // the close-old/open-new logic above to stay correct across a multi-month
  // paste.
  async function applyPaste(startUnitIdx: number, startMonthIdx: number, grid2d: string[][]) {
    if (!canWrite || !selectedSiteId || saving) return;
    setSaving(true);
    setError(null);

    const nextRulesByUnit: Record<string, DuesRule[]> = { ...rulesByUnit };
    const errors: string[] = [];

    for (let r = 0; r < grid2d.length; r++) {
      const unitIdx = startUnitIdx + r;
      if (unitIdx >= sortedUnits.length) break; // clamp rows to the grid
      const unit = sortedUnits[unitIdx];
      const row = grid2d[r];
      for (let c = 0; c < row.length; c++) {
        const monthIdx = startMonthIdx + c;
        if (monthIdx >= rangeMonths.length) break; // clamp columns to the grid
        const raw = row[c].trim();
        if (raw === "") continue; // blank pasted cell = leave unit/month untouched
        const amount = parseNumeric(raw);
        if (amount === null || amount < 0) continue; // skip unparsable cells, don't abort the whole paste

        const { year, month } = rangeMonths[monthIdx];
        const currentRules = nextRulesByUnit[unit.id] ?? [];
        const result = await applyCellEdit(selectedSiteId, unit.id, year, month, amount, currentRules);
        if (result.error) {
          errors.push(`${unitLabel(unit)} · ${periodLabel(year, month)}: ${result.error}`);
        } else if (result.rules) {
          nextRulesByUnit[unit.id] = result.rules;
        }
      }
    }

    setRulesByUnit(nextRulesByUnit);
    setSaving(false);

    if (errors.length > 0) {
      const shown = errors.slice(0, 3).join("; ");
      setError(`${errors.length} hücre kaydedilemedi: ${shown}${errors.length > 3 ? " …" : ""}`);
    }
  }

  function handleCellPaste(e: React.ClipboardEvent<HTMLInputElement>, unitIdx: number, monthIdx: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return; // single value — let default paste happen
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop(); // trailing blank line from an Excel range copy
    if (lines.length === 0) return;
    const grid2d = lines.map((line) => line.split("\t"));
    void applyPaste(unitIdx, monthIdx, grid2d);
  }

  function handleCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  }

  if (loading) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  const rangeLabel = rangeMonths.length === 1
    ? `${MONTH_NAMES[rangeMonths[0].month - 1]} ${rangeMonths[0].year}`
    : `${MONTH_NAMES[rangeMonths[0].month - 1]} ${rangeMonths[0].year} — ${MONTH_NAMES[rangeMonths[rangeMonths.length - 1].month - 1]} ${rangeMonths[rangeMonths.length - 1].year}`;

  return (
    <div>
      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="auth-info" style={{ marginBottom: 16 }}>
        Bu tablo her dairenin aylık aidat tutarının zaman içindeki geçmişini gösterir. Bir hücreyi değiştirdiğinizde,
        o değişiklik seçili aydan itibaren geçerli olur; geçmiş aylar etkilenmez. Excel&apos;de hazırladığınız bir
        tabloyu kopyalayıp bir hücreye tıkladıktan sonra yapıştırabilirsiniz (Ctrl+V) — birden fazla daire/ay
        otomatik olarak doldurulur.
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Dönem Aralığı</div>
          <button className="btn-secondary" type="button" onClick={resetToDefault}>
            Varsayılan Aralığa Dön
          </button>
        </div>
        <div className="form-grid">
          <label className="auth-field">
            <span>Başlangıç Ayı</span>
            <select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Başlangıç Yılı</span>
            <select value={startYear} onChange={(e) => setStartYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Bitiş Ayı</span>
            <select value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Bitiş Yılı</span>
            <select value={endYear} onChange={(e) => setEndYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
        <p style={{ fontSize: 12, color: "var(--text3)" }}>
          Seçili aralık: {rangeLabel} ({rangeMonths.length} ay)
          {clamped && ` — aralık en fazla ${MAX_MONTHS} ay ile sınırlıdır, başlangıç otomatik olarak öne çekildi.`}
        </p>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Aidat Tutarları — {rangeLabel}</div>
          {saving && <span className="pill pill-blue">Kaydediliyor…</span>}
          {!canWrite && <span className="pill pill-neutral">Salt okunur</span>}
        </div>

        {sortedUnits.length === 0 ? (
          <div className="empty-state">Henüz aktif daire tanımlanmamış.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Daire</th>
                  {rangeMonths.map(({ year, month }) => (
                    <th className="num" key={`${year}-${month}`}>{periodLabel(year, month)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedUnits.map((unit, unitIdx) => (
                  <tr key={unit.id}>
                    <td className="wrap">{unitLabel(unit)}</td>
                    {rangeMonths.map(({ year, month }, monthIdx) => {
                      const rule = effectiveRuleForMonth(rulesByUnit[unit.id] ?? [], year, month);
                      const amount = rule?.amount ?? null;
                      const cellKey = `${unit.id}:${year}-${month}`;
                      const isPending = pendingCell === cellKey;
                      return (
                        <td className="num" key={cellKey}>
                          <input
                            key={`${cellKey}:${amount ?? "x"}:${rule?.id ?? "n"}`}
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={amount ?? ""}
                            placeholder="—"
                            title={amount != null ? currency.format(amount) : "Tanımsız"}
                            disabled={!canWrite || saving}
                            style={{ width: 96, opacity: isPending ? 0.6 : 1 }}
                            onBlur={(e) => handleCellBlur(unit, year, month, e.target.value)}
                            onKeyDown={handleCellKeyDown}
                            onPaste={(e) => handleCellPaste(e, unitIdx, monthIdx)}
                          />
                        </td>
                      );
                    })}
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
