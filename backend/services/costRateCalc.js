'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

function weekendsInYear(year) {
  let count = 0;
  const d = new Date(year, 0, 1);
  while (d.getFullYear() === year) {
    const wd = d.getDay();
    if (wd === 0 || wd === 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function countPublicHolidays(supabase, countryCode, stateCode, year) {
  const from = `${year}-01-01`;
  const to   = `${year}-12-31`;
  const { count, error } = await supabase
    .from('PUBLIC_HOLIDAY')
    .select('*', { count: 'exact', head: true })
    .eq('COUNTRY_CODE', countryCode)
    .or(stateCode ? `STATE_CODE.is.null,STATE_CODE.eq.${stateCode}` : 'STATE_CODE.is.null')
    .gte('HOLIDAY_DATE', from)
    .lte('HOLIDAY_DATE', to);
  if (error) console.warn('PUBLIC_HOLIDAY query failed, defaulting to 0:', error.message);
  return count || 0;
}

// Get the employee's country+state from their latest work model assignment
async function getEmployeeCountryState(supabase, tenantId, employeeId) {
  const { data: assignments } = await supabase
    .from('EMPLOYEE_WORK_MODEL')
    .select('MODEL_ID, VALID_FROM')
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .order('VALID_FROM', { ascending: false })
    .limit(1);
  if (!assignments || !assignments.length) return { countryCode: 'DE', stateCode: null };

  const { data: model } = await supabase
    .from('WORKING_TIME_MODEL')
    .select('COUNTRY_CODE, STATE_CODE')
    .eq('ID', assignments[0].MODEL_ID)
    .single();
  return { countryCode: model?.COUNTRY_CODE || 'DE', stateCode: model?.STATE_CODE || null };
}

// ── Overhead config ───────────────────────────────────────────────────────────

async function getOverheadItems(supabase, tenantId, year) {
  const { data, error } = await supabase
    .from('COST_RATE_CONFIG')
    .select('ID, CATEGORY, ITEM_NAME, AMOUNT')
    .eq('TENANT_ID', tenantId)
    .eq('YEAR', year)
    .order('CATEGORY')
    .order('ITEM_NAME');
  if (error) throw { status: 500, message: error.message };
  return (data || []).map(r => ({
    id:        r.ID,
    category:  r.CATEGORY,
    item_name: r.ITEM_NAME,
    amount:    Number(r.AMOUNT),
  }));
}

async function saveOverheadItems(supabase, tenantId, year, items) {
  // Replace strategy: delete existing, re-insert
  const { error: delErr } = await supabase
    .from('COST_RATE_CONFIG')
    .delete()
    .eq('TENANT_ID', tenantId)
    .eq('YEAR', year);
  if (delErr) throw { status: 500, message: delErr.message };

  if (!items || !items.length) return [];

  const rows = items.map(i => ({
    TENANT_ID: tenantId,
    YEAR:      year,
    CATEGORY:  i.category  || 'Sonstiges',
    ITEM_NAME: i.item_name || '',
    AMOUNT:    Number(i.amount) || 0,
  }));
  const { data, error } = await supabase.from('COST_RATE_CONFIG').insert(rows).select();
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

async function copyOverheadFromYear(supabase, tenantId, fromYear, toYear) {
  const items = await getOverheadItems(supabase, tenantId, fromYear);
  if (!items.length) return [];
  return saveOverheadItems(supabase, tenantId, toYear, items);
}

// ── Employee params ───────────────────────────────────────────────────────────

const PARAM_DEFAULTS = {
  annual_salary:      0,
  weekly_hours:       40,
  vacation_days:      30,
  sick_days_est:      7,
  training_days:      5,
  social_contrib_pct: 21,
  productivity_pct:   85,
};

async function getEmployeeParams(supabase, tenantId, employeeId, year) {
  const { data } = await supabase
    .from('COST_RATE_EMP_PARAMS')
    .select('*')
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .eq('YEAR', year)
    .maybeSingle();
  if (!data) return { ...PARAM_DEFAULTS };
  return {
    annual_salary:      Number(data.ANNUAL_SALARY),
    weekly_hours:       Number(data.WEEKLY_HOURS),
    vacation_days:      Number(data.VACATION_DAYS),
    sick_days_est:      Number(data.SICK_DAYS_EST),
    training_days:      Number(data.TRAINING_DAYS),
    social_contrib_pct: Number(data.SOCIAL_CONTRIB_PCT),
    productivity_pct:   Number(data.PRODUCTIVITY_PCT),
  };
}

async function upsertEmployeeParams(supabase, tenantId, employeeId, year, params) {
  const row = {
    TENANT_ID:          tenantId,
    EMPLOYEE_ID:        employeeId,
    YEAR:               year,
    ANNUAL_SALARY:      Number(params.annual_salary)      || 0,
    WEEKLY_HOURS:       Number(params.weekly_hours)       || 40,
    VACATION_DAYS:      Number(params.vacation_days)      || 30,
    SICK_DAYS_EST:      Number(params.sick_days_est)      || 7,
    TRAINING_DAYS:      Number(params.training_days)      || 5,
    SOCIAL_CONTRIB_PCT: Number(params.social_contrib_pct) || 21,
    PRODUCTIVITY_PCT:   Number(params.productivity_pct)   || 85,
  };
  const { data, error } = await supabase
    .from('COST_RATE_EMP_PARAMS')
    .upsert(row, { onConflict: 'TENANT_ID,EMPLOYEE_ID,YEAR' })
    .select()
    .single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function bulkUpsertEmployeeParams(supabase, tenantId, year, paramsList) {
  const rows = paramsList.map(p => ({
    TENANT_ID:          tenantId,
    EMPLOYEE_ID:        p.employee_id,
    YEAR:               year,
    ANNUAL_SALARY:      Number(p.annual_salary)      || 0,
    WEEKLY_HOURS:       Number(p.weekly_hours)       || 40,
    VACATION_DAYS:      Number(p.vacation_days)      || 30,
    SICK_DAYS_EST:      Number(p.sick_days_est)      || 7,
    TRAINING_DAYS:      Number(p.training_days)      || 5,
    SOCIAL_CONTRIB_PCT: Number(p.social_contrib_pct) || 21,
    PRODUCTIVITY_PCT:   Number(p.productivity_pct)   || 85,
  }));
  const { error } = await supabase
    .from('COST_RATE_EMP_PARAMS')
    .upsert(rows, { onConflict: 'TENANT_ID,EMPLOYEE_ID,YEAR' });
  if (error) throw { status: 500, message: error.message };
}

// ── Core calculation ──────────────────────────────────────────────────────────

function calcProductiveHours(params, publicHolidayCount) {
  const calDays     = 365; // leap year difference is minor; keep consistent
  const totalDays   = calDays - 104 - publicHolidayCount // 104 = 52 weekends × 2
                      - params.vacation_days
                      - params.sick_days_est
                      - params.training_days;
  const dailyHours  = params.weekly_hours / 5;
  const grossHours  = Math.max(0, totalDays) * dailyHours;
  const netHours    = grossHours * (params.productivity_pct / 100);
  return {
    working_days:     Math.max(0, totalDays),
    public_holidays:  publicHolidayCount,
    productive_hours: Math.round(netHours * 100) / 100,
  };
}

/**
 * Calculate Vollkostensatz for all (or selected) active employees for a given year.
 * profitMarkupPct: optional additional markup on top of pure cost (default 0)
 * Returns array of CalcResult objects.
 */
async function calculateCostRates(supabase, tenantId, year, employeeIds, profitMarkupPct = 0) {
  // Fetch employees — use or() to include rows where ACTIVE IS NULL (neq alone excludes NULLs in PostgREST)
  let empQ = supabase
    .from('EMPLOYEE')
    .select('ID, ABBR, FIRST_NAME, LAST_NAME')
    .eq('TENANT_ID', tenantId)
    .or('ACTIVE.is.null,ACTIVE.neq.2')
    .order('ABBR');
  if (employeeIds && employeeIds.length) empQ = empQ.in('ID', employeeIds);
  const { data: employees, error: empErr } = await empQ;
  if (empErr) throw { status: 500, message: empErr.message };
  if (!employees || !employees.length) return [];

  // Fetch current COST_RATE for each employee from EMPLOYEE_COST_RATE (latest entry ≤ today)
  const today = new Date().toISOString().slice(0, 10);
  const empIds = employees.map(e => e.ID);
  const { data: rateRows } = await supabase
    .from('EMPLOYEE_COST_RATE')
    .select('EMPLOYEE_ID, COST_RATE, VALID_FROM')
    .eq('TENANT_ID', tenantId)
    .in('EMPLOYEE_ID', empIds)
    .lte('VALID_FROM', today)
    .order('VALID_FROM', { ascending: false });
  // Pick latest rate per employee
  const currentRateMap = new Map();
  for (const row of (rateRows || [])) {
    if (!currentRateMap.has(row.EMPLOYEE_ID)) {
      currentRateMap.set(row.EMPLOYEE_ID, Number(row.COST_RATE));
    }
  }

  // Fetch overhead total for year
  const overheadItems = await getOverheadItems(supabase, tenantId, year);
  const totalOverhead = overheadItems.reduce((s, i) => s + Number(i.AMOUNT || i.amount || 0), 0);

  // Fetch params + country/state for all employees in parallel
  const empData = await Promise.all(employees.map(async emp => {
    const params = await getEmployeeParams(supabase, tenantId, emp.ID, year);
    const { countryCode, stateCode } = await getEmployeeCountryState(supabase, tenantId, emp.ID);
    const holidayCount = await countPublicHolidays(supabase, countryCode, stateCode, year);
    const hours = calcProductiveHours(params, holidayCount);
    return { emp, params, countryCode, stateCode, hours };
  }));

  // Total productive hours across all employees (for overhead allocation)
  const totalProductiveHours = empData.reduce((s, d) => s + d.hours.productive_hours, 0);

  // Build results
  return empData.map(({ emp, params, countryCode, stateCode, hours }) => {
    const directCostTotal  = params.annual_salary * (1 + params.social_contrib_pct / 100);
    const directCostPerH   = hours.productive_hours > 0
      ? directCostTotal / hours.productive_hours : 0;

    const empShare         = totalProductiveHours > 0
      ? hours.productive_hours / totalProductiveHours : 0;
    const overheadAlloc    = totalOverhead * empShare;
    const overheadPerH     = hours.productive_hours > 0
      ? overheadAlloc / hours.productive_hours : 0;

    const vollkostensatz   = directCostPerH + overheadPerH;
    const importRate       = vollkostensatz * (1 + profitMarkupPct / 100);

    const fmt2 = n => Math.round(n * 100) / 100;

    return {
      employee_id:      emp.ID,
      abbr:       emp.ABBR,
      first_name:       emp.FIRST_NAME,
      last_name:        emp.LAST_NAME,
      current_cp_rate:  currentRateMap.has(emp.ID) ? currentRateMap.get(emp.ID) : null,
      country_code:     countryCode,
      state_code:       stateCode,
      params,
      breakdown: {
        working_days:       hours.working_days,
        public_holidays:    hours.public_holidays,
        productive_hours:   fmt2(hours.productive_hours),
        annual_salary:      fmt2(params.annual_salary),
        social_contrib_eur: fmt2(params.annual_salary * params.social_contrib_pct / 100),
        direct_cost_total:  fmt2(directCostTotal),
        direct_cost_per_h:  fmt2(directCostPerH),
        overhead_total:     fmt2(totalOverhead),
        overhead_share_pct: fmt2(empShare * 100),
        overhead_allocated: fmt2(overheadAlloc),
        overhead_per_h:     fmt2(overheadPerH),
        vollkostensatz:     fmt2(vollkostensatz),
        import_rate:        fmt2(importRate),
      },
    };
  });
}

// ── Import to EMPLOYEE_COST_RATE ────────────────────────────────────────────────
//
// Runde 11 des UI-Pilots. Vorher schrieb „Buchungen neu rechnen" den neuen
// Satz auf JEDE Buchung ab dem Stichtag:
//   * auch über einen späteren Satz hinweg — ein am 1.1. gültiger Satz
//     überschrieb Buchungen, für die längst der Satz vom 1.7. galt;
//   * auf Pauschalen und Stückleistungen (dort ist COST_TOTAL ein fester
//     Betrag, keine Menge × Satz) und auf Pausen, die keine Arbeitszeit sind;
//   * in abgeschlossenen Monaten, die der Monatsabschluss einfrieren soll.
// Die Kosten der Projektelemente wurden danach nicht nachgerechnet, und ein
// zweiter Import am selben Tag legte einen zweiten Satz daneben.

const SPECIAL_KINDS = new Set(['UNIT', 'LUMP_COST', 'LUMP_REVENUE']);
const round2 = (n) => Math.round(n * 100) / 100;
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

async function importCostRates(supabase, tenantId, rates, validFrom, recalcBookings = false) {
  if (!isIsoDate(validFrom)) throw { status: 400, message: 'Bitte ein gültiges Datum für „Gültig ab" angeben.' };
  if (!Array.isArray(rates) || !rates.length) throw { status: 400, message: 'Keine Kostensätze übergeben.' };
  const byEmp = new Map();
  for (const r of rates) {
    const empId = Number(r?.employee_id);
    const rate = Number(String(r?.rate ?? '').replace(',', '.'));
    if (!(empId > 0) || r?.rate === '' || r?.rate == null || !Number.isFinite(rate) || rate < 0) {
      throw { status: 400, message: 'Jeder Kostensatz braucht einen Mitarbeiter und einen Betrag ab 0 €/h.' };
    }
    byEmp.set(empId, round2(rate));
  }
  const empIds = [...byEmp.keys()];

  const { data: emps, error: empErr } = await supabase.from('EMPLOYEE').select('ID')
    .eq('TENANT_ID', tenantId).in('ID', empIds);
  if (empErr) throw { status: 500, message: empErr.message };
  if ((emps || []).length !== empIds.length) throw { status: 404, message: 'Mitarbeiter nicht gefunden' };

  // Je Mitarbeiter und Tag ein Satz: vorhandenen ändern statt einen zweiten anlegen.
  const { data: sameDay, error: sdErr } = await supabase.from('EMPLOYEE_COST_RATE').select('ID, EMPLOYEE_ID')
    .eq('TENANT_ID', tenantId).eq('VALID_FROM', validFrom).in('EMPLOYEE_ID', empIds);
  if (sdErr) throw { status: 500, message: sdErr.message };
  const existing = new Map((sameDay || []).map(x => [x.EMPLOYEE_ID, x.ID]));
  const inserts = empIds.filter(id => !existing.has(id)).map(id => ({
    TENANT_ID: tenantId, EMPLOYEE_ID: id, COST_RATE: byEmp.get(id), VALID_FROM: validFrom,
  }));
  if (inserts.length) {
    const { error } = await supabase.from('EMPLOYEE_COST_RATE').insert(inserts);
    if (error) throw { status: 500, message: error.message };
  }
  for (const [empId, rowId] of existing) {
    const { error } = await supabase.from('EMPLOYEE_COST_RATE').update({ COST_RATE: byEmp.get(empId) })
      .eq('ID', rowId).eq('TENANT_ID', tenantId);
    if (error) throw { status: 500, message: error.message };
  }

  const summary = { rates: empIds.length, replaced: existing.size, recalculated: 0, skipped_closed_month: 0, skipped_not_hours: 0, until: {} };
  if (!recalcBookings) return summary;

  const structures = new Set();
  for (const empId of empIds) {
    const rate = byEmp.get(empId);

    // Nur bis zum nächsten Satz — für die Zeit danach gilt der.
    const { data: later, error: lErr } = await supabase.from('EMPLOYEE_COST_RATE').select('VALID_FROM')
      .eq('TENANT_ID', tenantId).eq('EMPLOYEE_ID', empId).gt('VALID_FROM', validFrom)
      .order('VALID_FROM', { ascending: true }).limit(1);
    if (lErr) throw { status: 500, message: lErr.message };
    const until = later && later.length ? String(later[0].VALID_FROM).slice(0, 10) : null;
    if (until) summary.until[empId] = until;

    const { data: closes, error: cErr } = await supabase.from('EMPLOYEE_MONTH_CLOSE').select('YEAR, MONTH')
      .eq('TENANT_ID', tenantId).eq('EMPLOYEE_ID', empId);
    if (cErr) throw { status: 500, message: cErr.message };
    const closed = new Set((closes || []).map(c => `${c.YEAR}-${String(c.MONTH).padStart(2, '0')}`));

    let q = supabase.from('BOOKING')
      .select('ID, QUANTITY_INT, BOOKING_KIND, ENTRY_KIND, BOOKING_DATE, STRUCTURE_ID')
      .eq('TENANT_ID', tenantId).eq('EMPLOYEE_ID', empId).gte('BOOKING_DATE', validFrom);
    if (until) q = q.lt('BOOKING_DATE', until);
    const { data: rows, error: fetchErr } = await q;
    if (fetchErr) throw { status: 500, message: fetchErr.message };

    // Gleiche Menge = gleicher Betrag: je Menge ein update statt je Zeile.
    // Bewusst kein .upsert(): dessen INSERT-Teil verlangt jede Pflichtspalte
    // der Buchung und scheitert daran, bevor der Konflikt greift.
    const byQty = new Map();
    for (const row of rows || []) {
      if (SPECIAL_KINDS.has(row.BOOKING_KIND) || row.ENTRY_KIND === 'BREAK') { summary.skipped_not_hours++; continue; }
      if (closed.has(String(row.BOOKING_DATE).slice(0, 7))) { summary.skipped_closed_month++; continue; }
      const qty = Number(row.QUANTITY_INT) || 0;
      if (!byQty.has(qty)) byQty.set(qty, []);
      byQty.get(qty).push(row.ID);
      if (row.STRUCTURE_ID) structures.add(row.STRUCTURE_ID);
    }
    for (const [qty, ids] of byQty) {
      // In Stücken — die IDs stehen in der URL der Anfrage.
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200);
        const { error: updErr } = await supabase.from('BOOKING')
          .update({ COST_RATE: rate, COST_TOTAL: round2(qty * rate) })
          .eq('TENANT_ID', tenantId).eq('EMPLOYEE_ID', empId).in('ID', part);
        if (updErr) throw { status: 500, message: updErr.message };
        summary.recalculated += part.length;
      }
    }
  }

  // Kosten der Projektelemente nachziehen — sonst zeigten Struktur und
  // Controlling weiter die alten Kosten.
  const { recomputeStructure } = require('./buchungen');
  for (const sid of structures) await recomputeStructure(supabase, sid);
  return summary;
}

module.exports = {
  getOverheadItems,
  saveOverheadItems,
  copyOverheadFromYear,
  getEmployeeParams,
  upsertEmployeeParams,
  bulkUpsertEmployeeParams,
  calculateCostRates,
  importCostRates,
  getEmployeeCountryState,
};
