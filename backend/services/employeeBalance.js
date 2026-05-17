'use strict';

const WEEKDAY_COLS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Returns a Set of ISO date strings (YYYY-MM-DD) that are public holidays
// for the given country/state within [dateFrom, dateTo].
async function getHolidaySet(supabase, countryCode, stateCode, dateFrom, dateTo) {
  const { data, error } = await supabase
    .from('PUBLIC_HOLIDAY')
    .select('HOLIDAY_DATE')
    .eq('COUNTRY_CODE', countryCode)
    .or(stateCode ? `STATE_CODE.is.null,STATE_CODE.eq.${stateCode}` : 'STATE_CODE.is.null')
    .gte('HOLIDAY_DATE', dateFrom)
    .lte('HOLIDAY_DATE', dateTo);

  if (error) throw { status: 500, message: error.message };
  return new Set((data || []).map(h => h.HOLIDAY_DATE));
}

// Returns model assignments for an employee sorted by VALID_FROM ascending.
async function getWorkModelAssignments(supabase, tenantId, employeeId) {
  const { data, error } = await supabase
    .from('EMPLOYEE_WORK_MODEL')
    .select('ID, MODEL_ID, VALID_FROM, model:WORKING_TIME_MODEL(ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN)')
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .order('VALID_FROM', { ascending: true });

  if (error) throw { status: 500, message: error.message };
  return data || [];
}

// Given a list of assignments sorted by VALID_FROM, find which model was active
// on a given ISO date string.
function findActiveModel(assignments, dateStr) {
  let active = null;
  for (const a of assignments) {
    if (a.VALID_FROM <= dateStr) active = a.model;
    else break;
  }
  return active;
}

// Returns actual hours booked on a specific day from TEC (CONFIRMED only).
// tecByDate: Map<dateStr, number> pre-built for the range.
function getActualHours(tecByDate, dateStr) {
  return tecByDate.get(dateStr) || 0;
}

// Pads date string to YYYY-MM-DD (Supabase returns dates as strings already)
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Adds days to a Date object
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

async function buildTecMap(supabase, tenantId, employeeId, dateFrom, dateTo) {
  const { data, error } = await supabase
    .from('TEC')
    .select('DATE_VOUCHER, QUANTITY_INT')
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .eq('STATUS', 'CONFIRMED')
    .gte('DATE_VOUCHER', dateFrom)
    .lte('DATE_VOUCHER', dateTo);

  if (error) throw { status: 500, message: error.message };

  const map = new Map();
  for (const row of data || []) {
    const d = row.DATE_VOUCHER;
    map.set(d, (map.get(d) || 0) + Number(row.QUANTITY_INT || 0));
  }
  return map;
}

/**
 * Calculate working-time balance for a single calendar month.
 * Returns { year, month, required, actual, balance, days }
 * where days is an array of per-day detail objects.
 */
async function calculateMonthBalance(supabase, tenantId, employeeId, year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay  = new Date(year, month, 0);
  const dateFrom = isoDate(firstDay);
  const dateTo   = isoDate(lastDay);

  const assignments = await getWorkModelAssignments(supabase, tenantId, employeeId);
  if (!assignments.length) {
    return { year, month, required: 0, actual: 0, balance: 0, days: [] };
  }

  const tecMap = await buildTecMap(supabase, tenantId, employeeId, dateFrom, dateTo);

  // Collect unique country/state combos used in this month to fetch holidays efficiently
  const combos = new Set();
  let cursor = new Date(firstDay);
  while (cursor <= lastDay) {
    const ds = isoDate(cursor);
    const model = findActiveModel(assignments, ds);
    if (model) combos.add(`${model.COUNTRY_CODE}|${model.STATE_CODE || ''}`);
    cursor = addDays(cursor, 1);
  }

  // Fetch holiday sets per combo
  const holidaySets = new Map();
  for (const key of combos) {
    const [cc, sc] = key.split('|');
    const set = await getHolidaySet(supabase, cc, sc || null, dateFrom, dateTo);
    holidaySets.set(key, set);
  }

  const days = [];
  let totalRequired = 0;
  let totalActual   = 0;

  cursor = new Date(firstDay);
  while (cursor <= lastDay) {
    const ds      = isoDate(cursor);
    const weekday = cursor.getDay(); // 0=Sun…6=Sat
    const model   = findActiveModel(assignments, ds);

    let required = 0;
    let isHoliday = false;

    if (model) {
      const hoKey  = `${model.COUNTRY_CODE}|${model.STATE_CODE || ''}`;
      const hoSet  = holidaySets.get(hoKey) || new Set();
      isHoliday    = hoSet.has(ds);
      required     = isHoliday ? 0 : Number(model[WEEKDAY_COLS[weekday]] || 0);
    }

    const actual  = getActualHours(tecMap, ds);
    const balance = actual - required;

    days.push({ date: ds, weekday, required, actual, balance, isHoliday });
    totalRequired += required;
    totalActual   += actual;
    cursor = addDays(cursor, 1);
  }

  return {
    year,
    month,
    required: Math.round(totalRequired * 100) / 100,
    actual:   Math.round(totalActual   * 100) / 100,
    balance:  Math.round((totalActual - totalRequired) * 100) / 100,
    days,
  };
}

/**
 * Calculate running balance from the first EMPLOYEE_WORK_MODEL assignment up to today.
 * Returns { months: [...], totalBalance }
 */
async function calculateRunningBalance(supabase, tenantId, employeeId) {
  const assignments = await getWorkModelAssignments(supabase, tenantId, employeeId);
  if (!assignments.length) return { months: [], totalBalance: 0 };

  const firstAssignment = assignments[0].VALID_FROM; // YYYY-MM-DD
  const startYear  = parseInt(firstAssignment.slice(0, 4), 10);
  const startMonth = parseInt(firstAssignment.slice(5, 7), 10);

  const now        = new Date();
  const endYear    = now.getFullYear();
  const endMonth   = now.getMonth() + 1;

  const months = [];
  let cumulative = 0;

  let y = startYear, m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const mb = await calculateMonthBalance(supabase, tenantId, employeeId, y, m);
    cumulative += mb.balance;
    months.push({
      year:       mb.year,
      month:      mb.month,
      required:   mb.required,
      actual:     mb.actual,
      balance:    mb.balance,
      cumulative: Math.round(cumulative * 100) / 100,
    });

    m++;
    if (m > 12) { m = 1; y++; }
  }

  return { months, totalBalance: Math.round(cumulative * 100) / 100 };
}

module.exports = { calculateMonthBalance, calculateRunningBalance };
