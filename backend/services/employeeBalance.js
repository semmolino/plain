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

// Buchungsarten, die KEINE Arbeitszeit sind (Pauschalen, Stückleistungen) und
// daher nicht in Stundenauswertungen (Saldo, Produktivität, Kosten) zählen.
// Stunden ('WORK') und Pausen ('BREAK') sowie Altzeilen (NULL) zählen normal.
const NON_HOURS_KINDS = new Set(['UNIT', 'LUMP_COST', 'LUMP_REVENUE']);
const isNonHoursKind = (k) => NON_HOURS_KINDS.has(k);

async function buildTecData(supabase, tenantId, employeeId, dateFrom, dateTo) {
  const { data, error } = await supabase
    .from('TEC')
    .select(`
      ID, DATE_VOUCHER, TIME_START, TIME_FINISH, QUANTITY_INT, POSTING_DESCRIPTION,
      PROJECT_ID, STRUCTURE_ID, BOOKING_KIND,
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
    if (isNonHoursKind(row.BOOKING_KIND)) continue;
    const d = row.DATE_VOUCHER;
    const h = Number(row.QUANTITY_INT || 0);
    sumMap.set(d, (sumMap.get(d) || 0) + h);
    if (!bookingsMap.has(d)) bookingsMap.set(d, []);
    bookingsMap.get(d).push({
      id:           row.ID,
      hours:        h,
      description:  row.POSTING_DESCRIPTION || '',
      project:      row.PROJECT?.NAME_SHORT  || '',
      structure:    row.STRUCTURE?.NAME_SHORT || '',
      time_start:   row.TIME_START  || null,
      time_finish:  row.TIME_FINISH || null,
      project_id:   row.PROJECT_ID  ?? null,
      structure_id: row.STRUCTURE_ID ?? null,
    });
  }
  return { sumMap, bookingsMap };
}

/**
 * Liefert je Mitarbeiter eine Map<dateStr, {fraction, name}> der GENEHMIGTEN
 * Abwesenheiten, deren Art als Arbeitszeit zaehlt (COUNTS_AS_WORKED). Solche
 * Tage werden im Saldo als Soll-erfuellt gutgeschrieben (fraction 0.5 = halber
 * Tag). Soft-fail: fehlt Migration 0086 (ABSENCE-Tabellen), liefert leere Map,
 * damit die Saldo-Berechnung ohne Abwesenheits-Feature normal funktioniert.
 */
async function buildAbsenceCreditMap(supabase, tenantId, empIds, dateFrom, dateTo) {
  const byEmp = new Map();
  if (!empIds || !empIds.length) return byEmp;
  try {
    const { data: types, error: tErr } = await supabase
      .from('ABSENCE_TYPE')
      .select('ID, NAME')
      .eq('TENANT_ID', tenantId)
      .eq('COUNTS_AS_WORKED', true);
    if (tErr) return byEmp;
    const typeName = new Map((types || []).map(t => [t.ID, t.NAME]));
    const typeIds = [...typeName.keys()];
    if (!typeIds.length) return byEmp;

    const { data: rows, error: aErr } = await supabase
      .from('ABSENCE')
      .select('EMPLOYEE_ID, ABSENCE_TYPE_ID, DATE_FROM, DATE_TO, HALF_DAY')
      .eq('TENANT_ID', tenantId)
      .in('EMPLOYEE_ID', empIds)
      .eq('STATUS', 'APPROVED')
      .in('ABSENCE_TYPE_ID', typeIds)
      .gte('DATE_TO', dateFrom)
      .lte('DATE_FROM', dateTo);
    if (aErr) return byEmp;

    for (const r of rows || []) {
      const frac = r.HALF_DAY ? 0.5 : 1;
      const name = typeName.get(r.ABSENCE_TYPE_ID) || 'Abwesenheit';
      const from = r.DATE_FROM < dateFrom ? dateFrom : r.DATE_FROM;
      const to   = r.DATE_TO   > dateTo   ? dateTo   : r.DATE_TO;
      if (!byEmp.has(r.EMPLOYEE_ID)) byEmp.set(r.EMPLOYEE_ID, new Map());
      const dmap = byEmp.get(r.EMPLOYEE_ID);
      let cur = new Date(from + 'T00:00:00');
      const end = new Date(to + 'T00:00:00');
      while (cur <= end) {
        const ds = isoDate(cur);
        const prev = dmap.get(ds);
        if (!prev || frac > prev.fraction) dmap.set(ds, { fraction: frac, name });
        cur = addDays(cur, 1);
      }
    }
    return byEmp;
  } catch (_) {
    return byEmp;
  }
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
  const absByEmp = await buildAbsenceCreditMap(supabase, tenantId, [employeeId], dateFrom, dateTo);
  const absMap = absByEmp.get(employeeId) || new Map();

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

    const booked   = getActualHours(tecMap, ds);
    const abs      = absMap.get(ds) || null;
    const credited = abs ? Math.round(required * abs.fraction * 100) / 100 : 0;
    const actual   = Math.round((booked + credited) * 100) / 100;
    const balance  = Math.round((actual - required) * 100) / 100;
    const bookings = bookingsMap.get(ds) || [];

    days.push({
      date: ds, weekday, required, actual, balance, isHoliday, bookings,
      absence: abs ? { name: abs.name, fraction: abs.fraction, hours: credited } : null,
    });
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
    .select('EMPLOYEE_ID, DATE_VOUCHER, QUANTITY_INT, BOOKING_KIND')
    .eq('TENANT_ID', tenantId)
    .in('EMPLOYEE_ID', empIds)
    .eq('STATUS', 'CONFIRMED')
    .gte('DATE_VOUCHER', globalStart)
    .lte('DATE_VOUCHER', upToDate);

  const actualByEmp = new Map();
  for (const row of tecRows || []) {
    if (isNonHoursKind(row.BOOKING_KIND)) continue;
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

  const absByEmp = await buildAbsenceCreditMap(supabase, tenantId, empIds, globalStart, upToDate);

  const result = new Map();
  for (const [empId, empAssigns] of assignByEmp.entries()) {
    const firstDate = empAssigns[0].VALID_FROM;
    const absMap = absByEmp.get(empId) || new Map();
    let required = 0;
    let credited = 0;
    let cur = new Date(firstDate + 'T00:00:00');
    const end = new Date(upToDate + 'T00:00:00');
    while (cur <= end) {
      const ds    = isoDate(cur);
      const model = findActiveModel(empAssigns, ds);
      if (model) {
        const dayH = Number(model[WEEKDAY_COLS[cur.getDay()]]) || 0;
        if (dayH > 0 && !holidayKey.has(`${model.COUNTRY_CODE}|${model.STATE_CODE || ''}|${ds}`)) {
          required += dayH;
          const abs = absMap.get(ds);
          if (abs) credited += dayH * abs.fraction;
        }
      }
      cur = addDays(cur, 1);
    }
    const actual = (actualByEmp.get(empId) || 0) + credited;
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
  // Inaktive (ACTIVE=2) NICHT serverseitig ausschliessen: der Report bietet im
  // Frontend einen Status-Filter (Aktiv/Inaktiv) an. Wuerde der Server inaktive
  // hart filtern, fehlten sie auch ohne gesetzten Filter.
  let empQ = supabase
    .from('EMPLOYEE')
    .select('ID, SHORT_NAME, FIRST_NAME, LAST_NAME, DEPARTMENT_ID')
    .eq('TENANT_ID', tenantId)
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
    .select('EMPLOYEE_ID, DATE_VOUCHER, QUANTITY_INT, QUANTITY_EXT, CP_TOT, STRUCTURE_ID, BOOKING_KIND')
    .eq('TENANT_ID', tenantId)
    .in('EMPLOYEE_ID', empIds)
    .eq('STATUS', 'CONFIRMED')
    .gte('DATE_VOUCHER', allFrom)
    .lte('DATE_VOUCHER', allTo);
  if (tecErr) throw { status: 500, message: tecErr.message };

  // Pauschalen/Stückleistungen sind keine Arbeitszeit → aus der Stunden-/
  // Kosten-/Produktivitätsauswertung der Mitarbeiter ausnehmen.
  const tecRowsHours = (tecRows || []).filter(r => !isNonHoursKind(r.BOOKING_KIND));

  // Build sets of internal structure IDs and internal project IDs for Produktivität
  const internalStructureIds = new Set();
  const internalProjectIds   = new Set();
  const structureToProject   = new Map();
  try {
    const allStructIds = [...new Set((tecRows || []).map(r => r.STRUCTURE_ID).filter(Boolean))];
    if (allStructIds.length > 0) {
      const { data: structs } = await supabase
        .from('PROJECT_STRUCTURE')
        .select('ID, IS_INTERNAL, PROJECT_ID')
        .in('ID', allStructIds)
        .eq('TENANT_ID', tenantId);
      for (const s of structs || []) {
        structureToProject.set(s.ID, s.PROJECT_ID);
        if (s.IS_INTERNAL) internalStructureIds.add(s.ID);
      }
      const projIds = [...new Set((structs || []).map(s => s.PROJECT_ID).filter(Boolean))];
      if (projIds.length > 0) {
        const { data: projs } = await supabase
          .from('PROJECT')
          .select('ID, IS_INTERNAL')
          .in('ID', projIds)
          .eq('TENANT_ID', tenantId);
        for (const p of projs || []) {
          if (p.IS_INTERNAL) internalProjectIds.add(p.ID);
        }
      }
    }
  } catch (_) { /* soft-fail: Produktivität will show as null */ }

  const tecIdx = new Map();
  for (const row of tecRowsHours) {
    const y = parseInt(row.DATE_VOUCHER.slice(0, 4), 10);
    const m = parseInt(row.DATE_VOUCHER.slice(5, 7), 10);
    const k = `${row.EMPLOYEE_ID}-${y}-${m}`;
    const a = tecIdx.get(k) || { hoursInt: 0, hoursExt: 0, cost: 0, hoursExtNonInternal: 0 };
    a.hoursInt += Number(row.QUANTITY_INT) || 0;
    a.hoursExt += Number(row.QUANTITY_EXT) || 0;
    a.cost     += Number(row.CP_TOT)       || 0;
    // Count external hours only if neither the structure position nor its project is internal
    const sid = row.STRUCTURE_ID;
    const pid = sid ? structureToProject.get(sid) : null;
    const isInternalRow = (sid && internalStructureIds.has(sid)) || (pid && internalProjectIds.has(pid));
    if (!isInternalRow) {
      a.hoursExtNonInternal += Number(row.QUANTITY_EXT) || 0;
    }
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

  const absByEmp = await buildAbsenceCreditMap(supabase, tenantId, empIds, allFrom, allTo);

  // Build result rows
  const result = [];
  for (const emp of employees) {
    const empAssigns = assignByEmp.get(emp.ID) || [];
    const absMap = absByEmp.get(emp.ID) || new Map();
    for (const mo of months) {
      const tec = tecIdx.get(`${emp.ID}-${mo.year}-${mo.month}`) || { hoursInt: 0, hoursExt: 0, cost: 0 };

      let required = 0;
      let credited = 0;
      let cur = new Date(mo.from + 'T00:00:00');
      const end = new Date(mo.to + 'T00:00:00');
      while (cur <= end) {
        const ds    = isoDate(cur);
        const model = findActiveModel(empAssigns, ds);
        if (model) {
          const dayH = Number(model[WEEKDAY_COLS[cur.getDay()]]) || 0;
          if (dayH > 0 && !holidayKey.has(`${model.COUNTRY_CODE}|${model.STATE_CODE || ''}|${ds}`)) {
            required += dayH;
            const abs = absMap.get(ds);
            if (abs) credited += dayH * abs.fraction;
          }
        }
        cur = addDays(cur, 1);
      }

      // Ist = gebuchte Stunden + gutgeschriebene Abwesenheit (Urlaub/Krank etc.),
      // damit der Saldo an Abwesenheitstagen neutral bleibt. Produktivitaet
      // bleibt auf gebuchten Stunden (Abwesenheit zaehlt nicht als produktiv).
      const actual = Math.round((tec.hoursInt + credited) * 100) / 100;
      const totalHours = tec.hoursInt || 0;
      const productiveHours = tec.hoursExtNonInternal || 0;
      const productivityPct = totalHours > 0 ? Math.round((productiveHours / totalHours) * 1000) / 10 : null;
      result.push({
        EMPLOYEE_ID:     emp.ID,
        SHORT_NAME:      emp.SHORT_NAME,
        FIRST_NAME:      emp.FIRST_NAME,
        LAST_NAME:       emp.LAST_NAME,
        DEPARTMENT_NAME: deptMap.get(emp.DEPARTMENT_ID) || '',
        YEAR:            mo.year,
        MONTH:           mo.month,
        REQUIRED:        Math.round(required * 100) / 100,
        ACTUAL:          actual,
        BALANCE:         Math.round((actual - required) * 100) / 100,
        HOURS_EXT:       Math.round(tec.hoursExt  * 100) / 100,
        COST:            Math.round(tec.cost       * 100) / 100,
        PRODUCTIVITY_PCT: productivityPct,
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
