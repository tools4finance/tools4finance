// Demo-data seeder for the "Site Bütçe Yönetimi" (aidat) module.
//
// Populates the CURRENTLY SELECTED site with realistic randomized Turkish
// data (blocks, units, residents, 6 months of accruals/payments, expenses,
// incomes, budget lines) so the owner can browse a populated dashboard
// instead of entering everything by hand. Runs entirely through the normal
// browser `supabase` client — RLS is respected as the logged-in user, no
// service-role key is used or needed.
//
// Idempotency note: blocks are skipped by name if they already exist,
// units are skipped by (block, unit_number), and monthly_dues accruals are
// skipped by (unit, fiscal_period) because a unique index enforces that
// combination anyway (see uq_accruals_monthly_dues in the schema — a
// duplicate insert would otherwise fail the whole batch). Residents,
// expenses, incomes and budget lines are lighter-touch: budget lines are
// deduped by (period, category) since that also has a unique index, but
// expenses/incomes are simply appended again on a second click — an
// acceptable failure mode for a demo button, not a transactional system.

import { supabase } from "@/lib/supabase";

export type SeedSummary = {
  blocksCreated: number;
  unitsCreated: number;
  residentsCreated: number;
  accrualsCreated: number;
  paymentsCreated: number;
  expensesCreated: number;
  incomesCreated: number;
  budgetLinesCreated: number;
  warnings: string[];
};

const FIRST_NAMES = [
  "Ahmet", "Mehmet", "Ayşe", "Fatma", "Mustafa", "Emine", "Ali", "Hatice",
  "Hüseyin", "Zeynep", "İbrahim", "Elif", "Hasan", "Meryem", "Osman",
];

const LAST_NAMES = [
  "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk",
  "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin",
];

const BLOCK_NAMES = ["A Blok", "B Blok", "C Blok"];
const UNITS_PER_BLOCK = 8;

// Category pools pulled from the real, globally-seeded expense_categories
// catalog (see supabase/migrations/20260809190000_init_aidat_schema.sql,
// section 16) — chosen so the new "Gider Dağılımı" pie chart has several
// visually distinct OPEX segments to render.
const OPEX_EXPENSE_SEGMENTS = [
  "1. Bina Bakım Giderleri",
  "3. Temizlik Giderleri",
  "4. Güvenlik Giderleri",
  "5. Personel Giderleri",
  "6. Enerji ve Utility Giderleri",
];
const CAPEX_SEGMENT = "15. Yatırım / Büyük Onarım (CAPEX)";
const INCOME_NAMES = ["Ortak alan kira geliri", "Mevduat faiz geliri"];

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 2) {
  const v = Math.random() * (max - min) + min;
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const TURKISH_ASCII_MAP: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
  Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
};

function toAsciiLower(s: string) {
  return s
    .split("")
    .map((ch) => TURKISH_ASCII_MAP[ch] ?? ch)
    .join("")
    .toLowerCase();
}

function randomPhone() {
  const digits = (n: number) => Array.from({ length: n }, () => randInt(0, 9)).join("");
  return `+90 5${digits(2)} ${digits(3)} ${digits(2)} ${digits(2)}`;
}

function randomEmail(first: string, last: string) {
  return `${toAsciiLower(first)}${toAsciiLower(last)}+demo${randInt(100, 999)}@example.com`;
}

function monthKey(year: number, month: number) {
  return `${year}-${month}`;
}

// Ascending (oldest first) list of n {year, month} pairs ending at, and
// including, the given year/month.
function trailingMonths(year: number, month: number, n: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < n; i++) {
    out.unshift({ year: y, month: m });
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function isoDate(year: number, month: number, day: number) {
  const d = Math.min(day, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type BlockRow = { id: string; name: string };
type UnitRow = { id: string; block_id: string; unit_number: string };
type ExpenseCategoryRow = { id: string; main_segment: string; name: string };
type IncomeCategoryRow = { id: string; name: string };

type AccrualPlanItem = {
  unit_id: string;
  fiscal_period_id: string;
  amount: number;
  accrual_date: string;
  due_date: string;
  payStatus: "full" | "partial" | "unpaid";
};

export async function seedDemoData(siteId: string, year: number, month: number): Promise<SeedSummary> {
  const warnings: string[] = [];
  const summary: SeedSummary = {
    blocksCreated: 0,
    unitsCreated: 0,
    residentsCreated: 0,
    accrualsCreated: 0,
    paymentsCreated: 0,
    expensesCreated: 0,
    incomesCreated: 0,
    budgetLinesCreated: 0,
    warnings,
  };

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  // 1. Blocks — skip any that already exist by name (safe to re-run) --------
  const { data: existingBlocksRaw, error: blocksSelErr } = await supabase
    .from("blocks")
    .select("id, name")
    .eq("site_id", siteId)
    .in("name", BLOCK_NAMES);
  if (blocksSelErr) throw new Error(`Bloklar okunamadı: ${blocksSelErr.message}`);

  const existingBlocks = (existingBlocksRaw ?? []) as BlockRow[];
  const missingBlockNames = BLOCK_NAMES.filter((n) => !existingBlocks.some((b) => b.name === n));

  let newBlocks: BlockRow[] = [];
  if (missingBlockNames.length > 0) {
    const { data: insertedBlocks, error: blocksInsErr } = await supabase
      .from("blocks")
      .insert(
        missingBlockNames.map((name) => ({
          site_id: siteId,
          name,
          display_order: BLOCK_NAMES.indexOf(name) * 10,
          active: true,
        }))
      )
      .select("id, name");
    if (blocksInsErr) throw new Error(`Bloklar oluşturulamadı: ${blocksInsErr.message}`);
    newBlocks = (insertedBlocks ?? []) as BlockRow[];
    summary.blocksCreated = newBlocks.length;
  }
  const allBlocks = [...existingBlocks, ...newBlocks];

  // 2. Units — 8 per block (unit_number "1".."8"), skip existing -----------
  const blockIds = allBlocks.map((b) => b.id);
  const { data: existingUnitsRaw, error: unitsSelErr } = await supabase
    .from("units")
    .select("id, block_id, unit_number")
    .eq("site_id", siteId)
    .in("block_id", blockIds);
  if (unitsSelErr) throw new Error(`Daireler okunamadı: ${unitsSelErr.message}`);
  const existingUnits = (existingUnitsRaw ?? []) as UnitRow[];

  const unitsToCreate: { site_id: string; block_id: string; unit_number: string; active: boolean }[] = [];
  for (const block of allBlocks) {
    for (let n = 1; n <= UNITS_PER_BLOCK; n++) {
      const unitNumber = String(n);
      const exists = existingUnits.some((u) => u.block_id === block.id && u.unit_number === unitNumber);
      if (!exists) {
        unitsToCreate.push({ site_id: siteId, block_id: block.id, unit_number: unitNumber, active: true });
      }
    }
  }

  let newUnits: UnitRow[] = [];
  if (unitsToCreate.length > 0) {
    const { data: insertedUnits, error: unitsInsErr } = await supabase
      .from("units")
      .insert(unitsToCreate)
      .select("id, block_id, unit_number");
    if (unitsInsErr) throw new Error(`Daireler oluşturulamadı: ${unitsInsErr.message}`);
    newUnits = (insertedUnits ?? []) as UnitRow[];
    summary.unitsCreated = newUnits.length;
  }
  const allUnits = [...existingUnits, ...newUnits];

  // 3. Residents — plausible synthetic Turkish names, ~20-24 linked units --
  const { data: existingLinksRaw, error: linksSelErr } = await supabase
    .from("unit_residents")
    .select("unit_id")
    .in("unit_id", allUnits.map((u) => u.id));
  if (linksSelErr) {
    warnings.push(`Sakin bağlantıları okunamadı: ${linksSelErr.message}`);
  }
  const unitsWithResident = new Set(((existingLinksRaw ?? []) as { unit_id: string }[]).map((r) => r.unit_id));
  const unitsNeedingResident = shuffle(allUnits.filter((u) => !unitsWithResident.has(u.id)));
  const targetResidentCount = Math.min(unitsNeedingResident.length, randInt(20, 24));
  const chosenUnits = unitsNeedingResident.slice(0, targetResidentCount);

  if (chosenUnits.length > 0) {
    const residentsToCreate = chosenUnits.map(() => {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      return {
        site_id: siteId,
        first_name: first,
        last_name: last,
        phone: randomPhone(),
        email: randomEmail(first, last),
        active: true,
      };
    });
    const { data: insertedResidents, error: residentsInsErr } = await supabase
      .from("residents")
      .insert(residentsToCreate)
      .select("id");
    if (residentsInsErr) throw new Error(`Sakinler oluşturulamadı: ${residentsInsErr.message}`);
    const residentRows = (insertedResidents ?? []) as { id: string }[];
    summary.residentsCreated = residentRows.length;

    // Insert order matches array order for a single multi-row INSERT...
    // RETURNING, so index-pairing chosenUnits[i] <-> residentRows[i] is safe.
    const links = chosenUnits.map((u, i) => {
      const monthsAgo = randInt(3, 30);
      const start = new Date();
      start.setMonth(start.getMonth() - monthsAgo);
      return {
        unit_id: u.id,
        resident_id: residentRows[i].id,
        relationship_type: Math.random() < 0.8 ? "owner" : "tenant",
        is_primary: true,
        start_date: start.toISOString().slice(0, 10),
      };
    });
    const { error: linksInsErr } = await supabase.from("unit_residents").insert(links);
    if (linksInsErr) warnings.push(`Sakin-daire bağlantıları oluşturulamadı: ${linksInsErr.message}`);
  }

  // 4. Fiscal periods — trailing 6 months ending at the selected period ----
  const months = trailingMonths(year, month, 6);
  const periodIds: Record<string, string> = {};
  for (const p of months) {
    const { data, error: periodErr } = await supabase.rpc("get_or_create_fiscal_period", {
      p_site_id: siteId,
      p_year: p.year,
      p_month: p.month,
    });
    if (periodErr || !data) {
      throw new Error(`Dönem oluşturulamadı (${p.month}/${p.year}): ${periodErr?.message ?? "bilinmeyen hata"}`);
    }
    periodIds[monthKey(p.year, p.month)] = data as unknown as string;
  }

  // 5. Accruals — one monthly_dues per unit per month, skip existing -------
  const periodIdList = Object.values(periodIds);
  const { data: existingAccrualsRaw, error: accrualsSelErr } = await supabase
    .from("accruals")
    .select("unit_id, fiscal_period_id")
    .eq("site_id", siteId)
    .eq("accrual_type", "monthly_dues")
    .eq("status", "active")
    .in("fiscal_period_id", periodIdList);
  if (accrualsSelErr) throw new Error(`Mevcut tahakkuklar okunamadı: ${accrualsSelErr.message}`);
  const existingAccrualKeys = new Set(
    ((existingAccrualsRaw ?? []) as { unit_id: string; fiscal_period_id: string }[]).map(
      (r) => `${r.unit_id}|${r.fiscal_period_id}`
    )
  );

  const unitBaseAmount = new Map<string, number>();
  for (const u of allUnits) unitBaseAmount.set(u.id, randInt(800, 1500));

  // ~70% fully paid, ~15% partially paid, ~15% unpaid — so collection-rate
  // KPIs, receivables and the late-payers report all show non-trivial data.
  const accrualPlan: AccrualPlanItem[] = [];
  for (const p of months) {
    const periodId = periodIds[monthKey(p.year, p.month)];
    for (const u of allUnits) {
      const key = `${u.id}|${periodId}`;
      if (existingAccrualKeys.has(key)) continue;
      const base = unitBaseAmount.get(u.id) ?? 1000;
      const amount = Math.round(base * randFloat(0.95, 1.08, 3) * 100) / 100;
      const roll = Math.random();
      const payStatus: AccrualPlanItem["payStatus"] = roll < 0.7 ? "full" : roll < 0.85 ? "partial" : "unpaid";
      accrualPlan.push({
        unit_id: u.id,
        fiscal_period_id: periodId,
        amount,
        accrual_date: isoDate(p.year, p.month, 1),
        due_date: isoDate(p.year, p.month, 10),
        payStatus,
      });
    }
  }

  const accrualIdByKey = new Map<string, { id: string; amount: number; due_date: string }>();
  if (accrualPlan.length > 0) {
    const { data: insertedAccruals, error: accrualsInsErr } = await supabase
      .from("accruals")
      .insert(
        accrualPlan.map((a) => ({
          site_id: siteId,
          unit_id: a.unit_id,
          fiscal_period_id: a.fiscal_period_id,
          accrual_type: "monthly_dues",
          description: "Aylık aidat",
          amount: a.amount,
          accrual_date: a.accrual_date,
          due_date: a.due_date,
          status: "active",
          created_by: userId,
        }))
      )
      .select("id, unit_id, fiscal_period_id, amount, due_date");
    if (accrualsInsErr) throw new Error(`Tahakkuklar oluşturulamadı: ${accrualsInsErr.message}`);
    const rows = (insertedAccruals ?? []) as { id: string; unit_id: string; fiscal_period_id: string; amount: number; due_date: string }[];
    summary.accrualsCreated = rows.length;
    for (const row of rows) {
      accrualIdByKey.set(`${row.unit_id}|${row.fiscal_period_id}`, { id: row.id, amount: row.amount, due_date: row.due_date });
    }
  }

  // 6. Payments + allocations — batched per month (one accrual per unit per
  //    month means unit_id alone is enough to correlate payment -> accrual
  //    within a single month's batch, no per-row round trip needed). A
  //    portion of the "paid" ones are made deliberately late so the
  //    late-payer frequency report has something to show.
  for (const p of months) {
    const periodId = periodIds[monthKey(p.year, p.month)];
    const payableItems = accrualPlan.filter((a) => a.fiscal_period_id === periodId && a.payStatus !== "unpaid");
    if (payableItems.length === 0) continue;

    const paymentRowsToInsert = payableItems.map((item) => {
      const acc = accrualIdByKey.get(`${item.unit_id}|${item.fiscal_period_id}`);
      const dueDate = acc?.due_date ?? item.due_date;
      const fullAmount = acc?.amount ?? item.amount;
      const isLate = Math.random() < 0.25;
      const offsetDays = isLate ? randInt(30, 60) : randInt(2, 21);
      const payAmount =
        item.payStatus === "full" ? fullAmount : Math.round(fullAmount * randFloat(0.3, 0.75, 2) * 100) / 100;
      return {
        site_id: siteId,
        unit_id: item.unit_id,
        payment_date: addDays(dueDate, offsetDays),
        amount: payAmount,
        method: pick(["bank", "cash", "credit_card"]),
        description: "Aidat tahsilatı",
        status: "active",
        created_by: userId,
      };
    });

    const { data: insertedPayments, error: paymentsInsErr } = await supabase
      .from("payments")
      .insert(paymentRowsToInsert)
      .select("id, unit_id");
    if (paymentsInsErr) {
      warnings.push(`${p.month}/${p.year} tahsilatları oluşturulamadı: ${paymentsInsErr.message}`);
      continue;
    }
    const paymentRows = (insertedPayments ?? []) as { id: string; unit_id: string }[];
    summary.paymentsCreated += paymentRows.length;

    const paymentIdByUnit = new Map<string, string>();
    for (const row of paymentRows) paymentIdByUnit.set(row.unit_id, row.id);

    const allocationsToInsert = payableItems
      .map((item, i) => {
        const paymentId = paymentIdByUnit.get(item.unit_id);
        const acc = accrualIdByKey.get(`${item.unit_id}|${item.fiscal_period_id}`);
        if (!paymentId || !acc) return null;
        return { payment_id: paymentId, accrual_id: acc.id, amount: paymentRowsToInsert[i].amount };
      })
      .filter((x): x is { payment_id: string; accrual_id: string; amount: number } => x !== null);

    if (allocationsToInsert.length > 0) {
      const { error: allocInsErr } = await supabase.from("payment_allocations").insert(allocationsToInsert);
      if (allocInsErr) warnings.push(`${p.month}/${p.year} tahsilat dağıtımları oluşturulamadı: ${allocInsErr.message}`);
    }
  }

  // 7. Expenses — 5-10 per month across several OPEX segments + a couple of
  //    CAPEX rows to exercise that code path too. ---------------------------
  const { data: opexCatsRaw, error: opexCatsErr } = await supabase
    .from("expense_categories")
    .select("id, main_segment, name")
    .in("main_segment", OPEX_EXPENSE_SEGMENTS)
    .eq("opex_capex", "OPEX")
    .eq("active", true);
  if (opexCatsErr) warnings.push(`Gider kategorileri okunamadı: ${opexCatsErr.message}`);
  const opexCats = (opexCatsRaw ?? []) as ExpenseCategoryRow[];

  const { data: capexCatsRaw, error: capexCatsErr } = await supabase
    .from("expense_categories")
    .select("id, main_segment, name")
    .eq("main_segment", CAPEX_SEGMENT)
    .eq("opex_capex", "CAPEX")
    .eq("active", true)
    .limit(6);
  if (capexCatsErr) warnings.push(`CAPEX kategorileri okunamadı: ${capexCatsErr.message}`);
  const capexCats = (capexCatsRaw ?? []) as ExpenseCategoryRow[];

  type ExpenseInsertRow = {
    site_id: string;
    expense_category_id: string;
    fiscal_period_id: string;
    expense_date: string;
    amount: number;
    description: string;
    payment_method: string;
    status: string;
    created_by: string | null;
  };

  const expensesToInsert: ExpenseInsertRow[] = [];
  if (opexCats.length > 0) {
    months.forEach((p, idx) => {
      const periodId = periodIds[monthKey(p.year, p.month)];
      const count = randInt(5, 10);
      for (let i = 0; i < count; i++) {
        const cat = pick(opexCats);
        expensesToInsert.push({
          site_id: siteId,
          expense_category_id: cat.id,
          fiscal_period_id: periodId,
          expense_date: isoDate(p.year, p.month, randInt(1, daysInMonth(p.year, p.month))),
          amount: randInt(300, 3000),
          description: cat.name,
          payment_method: pick(["bank", "cash", "credit_card"]),
          status: "active",
          created_by: userId,
        });
      }
      // One or two CAPEX-tagged expenses across the window (an earlier month
      // and the most recent one) so budget/OPEX-vs-CAPEX separation has data.
      if (capexCats.length > 0 && (idx === 1 || idx === months.length - 1)) {
        const cat = pick(capexCats);
        expensesToInsert.push({
          site_id: siteId,
          expense_category_id: cat.id,
          fiscal_period_id: periodId,
          expense_date: isoDate(p.year, p.month, randInt(1, daysInMonth(p.year, p.month))),
          amount: randInt(8000, 45000),
          description: cat.name,
          payment_method: "bank",
          status: "active",
          created_by: userId,
        });
      }
    });
  }

  if (expensesToInsert.length > 0) {
    const { error: expensesInsErr } = await supabase.from("expenses").insert(expensesToInsert);
    if (expensesInsErr) warnings.push(`Giderler oluşturulamadı: ${expensesInsErr.message}`);
    else summary.expensesCreated = expensesToInsert.length;
  }

  // 8. Incomes — a couple of non-unit-specific income rows -------------------
  const { data: incomeCatsRaw, error: incomeCatsErr } = await supabase
    .from("income_categories")
    .select("id, name")
    .in("name", INCOME_NAMES)
    .eq("active", true);
  if (incomeCatsErr) warnings.push(`Gelir kategorileri okunamadı: ${incomeCatsErr.message}`);
  const incomeCats = (incomeCatsRaw ?? []) as IncomeCategoryRow[];

  type IncomeInsertRow = {
    site_id: string;
    income_category_id: string;
    fiscal_period_id: string;
    income_date: string;
    amount: number;
    description: string;
    status: string;
    created_by: string | null;
  };

  const incomesToInsert: IncomeInsertRow[] = [];
  if (incomeCats.length > 0) {
    const incomeMonths = shuffle(months).slice(0, Math.min(2, months.length));
    for (const p of incomeMonths) {
      const periodId = periodIds[monthKey(p.year, p.month)];
      const cat = pick(incomeCats);
      incomesToInsert.push({
        site_id: siteId,
        income_category_id: cat.id,
        fiscal_period_id: periodId,
        income_date: isoDate(p.year, p.month, randInt(1, daysInMonth(p.year, p.month))),
        amount: randInt(500, 4000),
        description: cat.name,
        status: "active",
        created_by: userId,
      });
    }
  }

  if (incomesToInsert.length > 0) {
    const { error: incomesInsErr } = await supabase.from("incomes").insert(incomesToInsert);
    if (incomesInsErr) warnings.push(`Gelirler oluşturulamadı: ${incomesInsErr.message}`);
    else summary.incomesCreated = incomesToInsert.length;
  }

  // 9. Budget lines — 2-3 OPEX categories, most recent 1-2 months ------------
  const budgetCats = opexCats.slice(0, Math.min(3, opexCats.length));
  const budgetMonths = months.slice(-Math.min(2, months.length));
  if (budgetCats.length > 0 && budgetMonths.length > 0) {
    const budgetPeriodIds = budgetMonths.map((p) => periodIds[monthKey(p.year, p.month)]);
    const { data: existingBudgetRaw, error: budgetSelErr } = await supabase
      .from("budget_lines")
      .select("fiscal_period_id, expense_category_id")
      .eq("site_id", siteId)
      .eq("category_type", "expense")
      .in("fiscal_period_id", budgetPeriodIds)
      .in("expense_category_id", budgetCats.map((c) => c.id));
    if (budgetSelErr) warnings.push(`Bütçe satırları okunamadı: ${budgetSelErr.message}`);
    const existingBudgetKeys = new Set(
      ((existingBudgetRaw ?? []) as { fiscal_period_id: string; expense_category_id: string }[]).map(
        (r) => `${r.fiscal_period_id}|${r.expense_category_id}`
      )
    );

    type BudgetInsertRow = {
      site_id: string;
      fiscal_period_id: string;
      category_type: string;
      expense_category_id: string;
      budget_amount: number;
      created_by: string | null;
    };

    const budgetLinesToInsert: BudgetInsertRow[] = [];
    for (const p of budgetMonths) {
      const periodId = periodIds[monthKey(p.year, p.month)];
      for (const cat of budgetCats) {
        const key = `${periodId}|${cat.id}`;
        if (existingBudgetKeys.has(key)) continue;
        budgetLinesToInsert.push({
          site_id: siteId,
          fiscal_period_id: periodId,
          category_type: "expense",
          expense_category_id: cat.id,
          budget_amount: randInt(1500, 6000),
          created_by: userId,
        });
      }
    }

    if (budgetLinesToInsert.length > 0) {
      const { error: budgetInsErr } = await supabase.from("budget_lines").insert(budgetLinesToInsert);
      if (budgetInsErr) warnings.push(`Bütçe satırları oluşturulamadı: ${budgetInsErr.message}`);
      else summary.budgetLinesCreated = budgetLinesToInsert.length;
    }
  }

  return summary;
}
