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
  if (error) throw { status: 500, message: error.message };
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
  return data || [];
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
  // Fetch employees
  let empQ = supabase
    .from('EMPLOYEE')
    .select('ID, SHORT_NAME, FIRST_NAME, LAST_NAME, CP_RATE')
    .eq('TENANT_ID', tenantId)
    .neq('ACTIVE', 2)
    .order('SHORT_NAME');
  if (employeeIds && employeeIds.length) empQ = empQ.in('ID', employeeIds);
  const { data: employees, error: empErr } = await empQ;
  if (empErr) throw { status: 500, message: empErr.message };
  if (!employees || !employees.length) return [];

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
      short_name:       emp.SHORT_NAME,
      first_name:       emp.FIRST_NAME,
      last_name:        emp.LAST_NAME,
      current_cp_rate:  emp.CP_RATE != null ? Number(emp.CP_RATE) : null,
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

// ── Import to EMPLOYEE_CP_RATE ────────────────────────────────────────────────

async function importCostRates(supabase, tenantId, rates, validFrom) {
  if (!rates || !rates.length) return;
  const rows = rates.map(r => ({
    TENANT_ID:   tenantId,
    EMPLOYEE_ID: r.employee_id,
    CP_RATE:     r.rate,
    VALID_FROM:  validFrom,
  }));
  const { error } = await supabase.from('EMPLOYEE_CP_RATE').insert(rows);
  if (error) throw { status: 500, message: error.message };
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
};
