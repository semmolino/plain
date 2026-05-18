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
// Uses a 2-step query because Supabase FK joins require explicit FK constraints.
async function getWorkModelAssignments(supabase, tenantId, employeeId) {
  const { data: assignments, error } = await supabase
    .from('EMPLOYEE_WORK_MODEL')
    .select('ID, MODEL_ID, VALID_FROM')
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .order('VALID_FROM', { ascending: true });

  if (error) throw { status: 500, message: error.message };
  if (!assignments || !assignments.length) return [];

  const modelIds = [...new Set(assignments.map(a => a.MODEL_ID))];
  const { data: models, error: mErr } = await supabase
    .from('WORKING_TIME_MODEL')
    .select('ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN')
    .in('ID', modelIds);

  if (mErr) throw { status: 500, message: mErr.message };
  const modelMap = new Map((models || []).map(m => [m.ID, m]));

  return assignments.map(a => ({ ...a, model: modelMap.get(a.MODEL_ID) ?? null }));
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

async function buildTecData(supabase, tenantId, employeeId, dateFrom, dateTo) {
  const { data, error } = await supabase
    .from('TEC')
    .select(`
      ID, DATE_VOUCHER, QUANTITY_INT, POSTING_DESCRIPTION,
      PROJECT:PROJECT_ID(NAME_SHORT),
      STRUCTURE:STRUCTURE_ID(NAME_SHORT)
    `)
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .eq('STATUS', 'CONFIRMED')
    .gte('DATE_VOUCHER', dateFrom)
    .lte('DATE_VOUCHER', dateTo)
    .order('DATE_VOUCHER', { ascending: true });

  if (error) throw { status: 500, message: error.message };

  const sumMap      = new Map();
  const bookingsMap = new Map();

  for (const row of data || []) {
    const d = row.DATE_VOUCHER;
    const h = Number(row.QUANTITY_INT || 0);
    sumMap.set(d, (sumMap.get(d) || 0) + h);
    if (!bookingsMap.has(d)) bookingsMap.set(d, []);
    bookingsMap.get(d).push({
      id:          row.ID,
      hours:       h,
      description: row.POSTING_DESCRIPTION || '',
      project:     row.PROJECT?.NAME_SHORT  || '',
      structure:   row.STRUCTURE?.NAME_SHORT || '',
    });
  }
  return { sumMap, bookingsMap };
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

  const { sumMap: tecMap, bookingsMap } = await buildTecData(supabase, tenantId, employeeId, dateFrom, dateTo);

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

    const actual   = getActualHours(tecMap, ds);
    const balance  = actual - required;
    const bookings = bookingsMap.get(ds) || [];

    days.push({ date: ds, weekday, required, actual, balance, isHoliday, bookings });
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

/**
 * Compute the total cumulative working-time balance for each employee in empIds,
 * from their first EMPLOYEE_WORK_MODEL assignment up to (and including) upToDate.
 * Returns Map<employeeId, balance>.
 */
async function buildRunningBalances(supabase, tenantId, empIds, upToDate) {
  if (!empIds.length) return new Map();

  const { data: assigns, error: asErr } = await supabase
    .from('EMPLOYEE_WORK_MODEL')
    .select('EMPLOYEE_ID, MODEL_ID, VALID_FROM')
    .eq('TENANT_ID', tenantId)
    .in('EMPLOYEE_ID', empIds)
    .lte('VALID_FROM', upToDate)
    .order('VALID_FROM', { ascending: true });
  if (asErr) throw { status: 500, message: asErr.message };
  if (!assigns || !assigns.length) return new Map(empIds.map(id => [id, 0]));

  const modelIds = [...new Set(assigns.map(a => a.MODEL_ID))];
  const { data: models } = await supabase
    .from('WORKING_TIME_MODEL')
    .select('ID, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN')
    .in('ID', modelIds);
  const modelMap = new Map((models || []).map(m => [m.ID, m]));

  const assignByEmp = new Map();
  for (const a of assigns) {
    if (!assignByEmp.has(a.EMPLOYEE_ID)) assignByEmp.set(a.EMPLOYEE_ID, []);
    assignByEmp.get(a.EMPLOYEE_ID).push({ ...a, model: modelMap.get(a.MODEL_ID) ?? null });
  }

  const globalStart = assigns[0].VALID_FROM; // earliest across all employees (sorted asc)

  const { data: tecRows } = await supabase
    .from('TEC')
    .select('EMPLOYEE_ID, DATE_VOUCHER, QUANTITY_INT')
    .eq('TENANT_ID', tenantId)
    .in('EMPLOYEE_ID', empIds)
    .eq('STATUS', 'CONFIRMED')
    .gte('DATE_VOUCHER', globalStart)
    .lte('DATE_VOUCHER', upToDate);

  const actualByEmp = new Map();
  for (const row of tecRows || []) {
    const id = row.EMPLOYEE_ID;
    actualByEmp.set(id, (actualByEmp.get(id) || 0) + Number(row.QUANTITY_INT || 0));
  }

  const csSet = new Set();
  for (const m of modelMap.values()) csSet.add(`${m.COUNTRY_CODE}|${m.STATE_CODE || ''}`);
  const holidayKey = new Set();
  for (const cs of csSet) {
    const [cc, sc] = cs.split('|');
    const { data: hols } = await supabase
      .from('PUBLIC_HOLIDAY')
      .select('HOLIDAY_DATE')
      .eq('COUNTRY_CODE', cc)
      .or(sc ? `STATE_CODE.is.null,STATE_CODE.eq.${sc}` : 'STATE_CODE.is.null')
      .gte('HOLIDAY_DATE', globalStart)
      .lte('HOLIDAY_DATE', upToDate);
    for (const h of hols || []) holidayKey.add(`${cs}|${h.HOLIDAY_DATE}`);
  }

  const result = new Map();
  for (const [empId, empAssigns] of assignByEmp.entries()) {
    const firstDate = empAssigns[0].VALID_FROM;
    let required = 0;
    let cur = new Date(firstDate + 'T00:00:00');
    const end = new Date(upToDate + 'T00:00:00');
    while (cur <= end) {
      const ds    = isoDate(cur);
      const model = findActiveModel(empAssigns, ds);
      if (model) {
        const dayH = Number(model[WEEKDAY_COLS[cur.getDay()]]) || 0;
        if (dayH > 0 && !holidayKey.has(`${model.COUNTRY_CODE}|${model.STATE_CODE || ''}|${ds}`)) {
          required += dayH;
        }
      }
      cur = addDays(cur, 1);
    }
    const actual = actualByEmp.get(empId) || 0;
    result.set(empId, Math.round((actual - required) * 100) / 100);
  }
  for (const id of empIds) {
    if (!result.has(id)) result.set(id, 0);
  }
  return result;
}

/**
 * Build a flat list of (employee × month) rows for the employee list report.
 * mode: 'now' | 'as_of' | 'period'
 * Returns [{ EMPLOYEE_ID, SHORT_NAME, FIRST_NAME, LAST_NAME, DEPARTMENT_NAME,
 *            YEAR, MONTH, REQUIRED, ACTUAL, BALANCE, HOURS_EXT, COST }]
 */
async function buildEmployeeReportList(supabase, tenantId, { mode, asOfDate, dateFrom, dateTo, employeeId }) {
  const today = isoDate(new Date());

  // Determine month slots
  const months = [];
  if (mode === 'now') {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth() + 1;
    months.push({ year: y, month: m, from: `${y}-${String(m).padStart(2,'0')}-01`, to: today });
  } else if (mode === 'as_of') {
    const d = new Date(asOfDate + 'T00:00:00');
    const y = d.getFullYear(), m = d.getMonth() + 1;
    months.push({ year: y, month: m, from: `${y}-${String(m).padStart(2,'0')}-01`, to: asOfDate });
  } else {
    let cur = new Date(dateFrom.slice(0, 7) + '-01T00:00:00');
    const endM = new Date(dateTo.slice(0, 7) + '-01T00:00:00');
    while (cur <= endM) {
      const y = cur.getFullYear(), m = cur.getMonth() + 1;
      const mFrom = `${y}-${String(m).padStart(2,'0')}-01`;
      const mLast = isoDate(new Date(y, m, 0));
      months.push({ year: y, month: m, from: mFrom, to: mLast < dateTo ? mLast : dateTo });
      cur = new Date(y, m, 1);
    }
  }
  if (!months.length) return [];

  const allFrom = months[0].from;
  const allTo   = months[months.length - 1].to;

  // Fetch employees
  let empQ = supabase
    .from('EMPLOYEE')
    .select('ID, SHORT_NAME, FIRST_NAME, LAST_NAME, DEPARTMENT_ID')
    .eq('TENANT_ID', tenantId)
    .neq('ACTIVE', 2)
    .order('SHORT_NAME', { ascending: true });
  if (employeeId) empQ = empQ.eq('ID', employeeId);
  const { data: employees, error: empErr } = await empQ;
  if (empErr) throw { status: 500, message: empErr.message };
  if (!employees || !employees.length) return [];

  const empIds = employees.map(e => e.ID);

  const { data: depts } = await supabase.from('PROJECT_DEPARTMENT')
    .select('ID, NAME_SHORT').eq('TENANT_ID', tenantId);
  const deptMap = new Map((depts || []).map(d => [d.ID, d.NAME_SHORT]));

  // Bulk TEC (CONFIRMED only)
  const { data: tecRows, error: tecErr } = await supabase
    .from('TEC')
    .select('EMPLOYEE_ID, DATE_VOUCHER, QUANTITY_INT, QUANTITY_EXT, CP_TOT')
    .eq('TENANT_ID', tenantId)
    .in('EMPLOYEE_ID', empIds)
    .eq('STATUS', 'CONFIRMED')
    .gte('DATE_VOUCHER', allFrom)
    .lte('DATE_VOUCHER', allTo);
  if (tecErr) throw { status: 500, message: tecErr.message };

  const tecIdx = new Map();
  for (const row of tecRows || []) {
    const y = parseInt(row.DATE_VOUCHER.slice(0, 4), 10);
    const m = parseInt(row.DATE_VOUCHER.slice(5, 7), 10);
    const k = `${row.EMPLOYEE_ID}-${y}-${m}`;
    const a = tecIdx.get(k) || { hoursInt: 0, hoursExt: 0, cost: 0 };
    a.hoursInt += Number(row.QUANTITY_INT) || 0;
    a.hoursExt += Number(row.QUANTITY_EXT) || 0;
    a.cost     += Number(row.CP_TOT)       || 0;
    tecIdx.set(k, a);
  }

  // Bulk work model assignments
  const { data: assigns, error: asErr } = await supabase
    .from('EMPLOYEE_WORK_MODEL')
    .select('EMPLOYEE_ID, MODEL_ID, VALID_FROM')
    .eq('TENANT_ID', tenantId)
    .in('EMPLOYEE_ID', empIds)
    .lte('VALID_FROM', allTo)
    .order('VALID_FROM', { ascending: true });
  if (asErr) throw { status: 500, message: asErr.message };

  const modelIds = [...new Set((assigns || []).map(a => a.MODEL_ID))];
  let modelMap = new Map();
  if (modelIds.length) {
    const { data: models } = await supabase
      .from('WORKING_TIME_MODEL')
      .select('ID, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN')
      .in('ID', modelIds);
    modelMap = new Map((models || []).map(m => [m.ID, m]));
  }

  const assignByEmp = new Map();
  for (const a of assigns || []) {
    if (!assignByEmp.has(a.EMPLOYEE_ID)) assignByEmp.set(a.EMPLOYEE_ID, []);
    assignByEmp.get(a.EMPLOYEE_ID).push({ ...a, model: modelMap.get(a.MODEL_ID) ?? null });
  }

  // Bulk holidays for all country/state combos used
  const csSet = new Set();
  for (const m of modelMap.values()) csSet.add(`${m.COUNTRY_CODE}|${m.STATE_CODE || ''}`);
  const holidayKey = new Set();
  for (const cs of csSet) {
    const [cc, sc] = cs.split('|');
    const { data: hols } = await supabase
      .from('PUBLIC_HOLIDAY')
      .select('HOLIDAY_DATE')
      .eq('COUNTRY_CODE', cc)
      .or(sc ? `STATE_CODE.is.null,STATE_CODE.eq.${sc}` : 'STATE_CODE.is.null')
      .gte('HOLIDAY_DATE', allFrom)
      .lte('HOLIDAY_DATE', allTo);
    for (const h of hols || []) holidayKey.add(`${cs}|${h.HOLIDAY_DATE}`);
  }

  // Build result rows
  const result = [];
  for (const emp of employees) {
    const empAssigns = assignByEmp.get(emp.ID) || [];
    for (const mo of months) {
      const tec = tecIdx.get(`${emp.ID}-${mo.year}-${mo.month}`) || { hoursInt: 0, hoursExt: 0, cost: 0 };

      let required = 0;
      let cur = new Date(mo.from + 'T00:00:00');
      const end = new Date(mo.to + 'T00:00:00');
      while (cur <= end) {
        const ds    = isoDate(cur);
        const model = findActiveModel(empAssigns, ds);
        if (model) {
          const dayH = Number(model[WEEKDAY_COLS[cur.getDay()]]) || 0;
          if (dayH > 0 && !holidayKey.has(`${model.COUNTRY_CODE}|${model.STATE_CODE || ''}|${ds}`)) {
            required += dayH;
          }
        }
        cur = addDays(cur, 1);
      }

      result.push({
        EMPLOYEE_ID:     emp.ID,
        SHORT_NAME:      emp.SHORT_NAME,
        FIRST_NAME:      emp.FIRST_NAME,
        LAST_NAME:       emp.LAST_NAME,
        DEPARTMENT_NAME: deptMap.get(emp.DEPARTMENT_ID) || '',
        YEAR:            mo.year,
        MONTH:           mo.month,
        REQUIRED:        Math.round(required      * 100) / 100,
        ACTUAL:          Math.round(tec.hoursInt  * 100) / 100,
        BALANCE:         Math.round((tec.hoursInt - required) * 100) / 100,
        HOURS_EXT:       Math.round(tec.hoursExt  * 100) / 100,
        COST:            Math.round(tec.cost       * 100) / 100,
      });
    }
  }

  // For flat modes (now / as_of) add per-employee cumulative running balance
  if (mode !== 'period' && empIds.length > 0) {
    const runUp   = mode === 'as_of' ? asOfDate : today;
    const runBals = await buildRunningBalances(supabase, tenantId, empIds, runUp);
    for (const row of result) {
      row.RUNNING_BALANCE = runBals.get(row.EMPLOYEE_ID) ?? 0;
    }
  }

  return result;
}

module.exports = { calculateMonthBalance, calculateRunningBalance, buildEmployeeReportList };
