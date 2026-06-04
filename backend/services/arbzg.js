'use strict';

// ArbZG validator service
// ---------------------------------------------------------------------------
// Settings loader (TENANT_SETTINGS), active-work-model lookup, break-rule
// lookup, validation entry point and audit-write helper.
//
// Wird vom Buchungsservice (buchungen.js) und vom Preflight-Endpoint
// (routes/arbzg.js) verwendet.

// ── Default-Settings ─────────────────────────────────────────────────────────
const DEFAULTS = {
  arbzg_enabled:                    'true',
  arbzg_strict_mode:                'false',
  arbzg_check_break_required:       'true',
  arbzg_check_max_daily:            'true',
  arbzg_check_min_rest:             'true',
  arbzg_check_sunday_holiday:       'true',
  arbzg_check_avg_6m:               'false',
  arbzg_auto_break_deduct:          'true',
  arbzg_auto_break_require_confirm: 'true',
  arbzg_default_break_rule_id:      null,
  arbzg_country:                    'DE',
  arbzg_state_code:                 null,
  arbzg_legal_text_block:
    'Hinweis nach § 16 Abs. 2 ArbZG: Arbeitszeiten, die die werktägliche ' +
    'Arbeitszeit von 8 Stunden überschreiten, sowie Arbeit an Sonn- und ' +
    'Feiertagen werden gesetzeskonform 2 Jahre archiviert.',
};

const SETTING_KEYS = Object.keys(DEFAULTS);

function parseBool(v) { return String(v) === 'true'; }
function parseNum(v)  { const n = Number(v); return Number.isFinite(n) ? n : null; }

// Lädt alle arbzg_*-Settings für einen Tenant; Defaults füllen Lücken.
async function getArbzgSettings(supabase, tenantId) {
  const { data, error } = await supabase
    .from('TENANT_SETTINGS')
    .select('KEY, VALUE')
    .eq('TENANT_ID', tenantId)
    .in('KEY', SETTING_KEYS);
  if (error) throw { status: 500, message: error.message };

  const map = Object.fromEntries((data || []).map(r => [r.KEY, r.VALUE]));
  const merged = { ...DEFAULTS, ...map };

  return {
    enabled:                 parseBool(merged.arbzg_enabled),
    strictMode:              parseBool(merged.arbzg_strict_mode),
    checkBreakRequired:      parseBool(merged.arbzg_check_break_required),
    checkMaxDaily:           parseBool(merged.arbzg_check_max_daily),
    checkMinRest:            parseBool(merged.arbzg_check_min_rest),
    checkSundayHoliday:      parseBool(merged.arbzg_check_sunday_holiday),
    checkAvg6m:              parseBool(merged.arbzg_check_avg_6m),
    autoBreakDeduct:         parseBool(merged.arbzg_auto_break_deduct),
    autoBreakRequireConfirm: parseBool(merged.arbzg_auto_break_require_confirm),
    defaultBreakRuleId:      parseNum(merged.arbzg_default_break_rule_id),
    country:                 merged.arbzg_country || 'DE',
    stateCode:               merged.arbzg_state_code || null,
    legalTextBlock:          merged.arbzg_legal_text_block || '',
  };
}

async function saveArbzgSettings(supabase, tenantId, patch) {
  const now = new Date().toISOString();
  const map = {
    enabled:                 'arbzg_enabled',
    strictMode:              'arbzg_strict_mode',
    checkBreakRequired:      'arbzg_check_break_required',
    checkMaxDaily:           'arbzg_check_max_daily',
    checkMinRest:            'arbzg_check_min_rest',
    checkSundayHoliday:      'arbzg_check_sunday_holiday',
    checkAvg6m:              'arbzg_check_avg_6m',
    autoBreakDeduct:         'arbzg_auto_break_deduct',
    autoBreakRequireConfirm: 'arbzg_auto_break_require_confirm',
    defaultBreakRuleId:      'arbzg_default_break_rule_id',
    country:                 'arbzg_country',
    stateCode:               'arbzg_state_code',
    legalTextBlock:          'arbzg_legal_text_block',
  };
  const upserts = [];
  for (const [k, v] of Object.entries(patch || {})) {
    const key = map[k];
    if (!key) continue;
    let str = '';
    if (typeof v === 'boolean') str = v ? 'true' : 'false';
    else if (v == null)         str = '';
    else                        str = String(v);
    upserts.push({ TENANT_ID: tenantId, KEY: key, VALUE: str, UPDATED_AT: now });
  }
  if (!upserts.length) return;
  const { error } = await supabase
    .from('TENANT_SETTINGS')
    .upsert(upserts, { onConflict: 'TENANT_ID,KEY' });
  if (error) throw { status: 500, message: error.message };
}

// ── Working-time model (active for date) ─────────────────────────────────────
async function getActiveWorkModel(supabase, tenantId, employeeId, dateStr) {
  const { data: assignments, error: aErr } = await supabase
    .from('EMPLOYEE_WORK_MODEL')
    .select('MODEL_ID, VALID_FROM')
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .lte('VALID_FROM', dateStr)
    .order('VALID_FROM', { ascending: false })
    .limit(1);
  if (aErr) throw { status: 500, message: aErr.message };
  if (!assignments || !assignments.length) return null;

  const modelId = assignments[0].MODEL_ID;
  // Versuche zuerst mit ArbZG-Spalten; falls Migration 0049 noch nicht
  // gelaufen ist, fallback auf das Basisschema.
  let { data: full } = await supabase
    .from('WORKING_TIME_MODEL')
    .select('ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN, ' +
            'MODEL_TYPE, BREAK_RULE_ID, MAX_DAILY_HOURS, MIN_REST_HOURS, IS_MINOR_PROFILE')
    .eq('ID', modelId)
    .maybeSingle();
  if (!full) {
    const { data: basic } = await supabase
      .from('WORKING_TIME_MODEL')
      .select('ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN')
      .eq('ID', modelId)
      .maybeSingle();
    if (!basic) return null;
    full = { ...basic, MODEL_TYPE: 'FIXED', BREAK_RULE_ID: null,
             MAX_DAILY_HOURS: 10, MIN_REST_HOURS: 11, IS_MINOR_PROFILE: false };
  }
  return full;
}

// ── Break rule lookup (model.BREAK_RULE_ID > tenant default > inline default) ─
const HARD_DEFAULT_BREAK_RULE = {
  T1_HOURS: 6, T1_BREAK_MIN: 30, T2_HOURS: 9, T2_BREAK_MIN: 45, MIN_BLOCK_MIN: 15,
  NAME: 'ArbZG-Standard (inline default)',
};

async function getBreakRule(supabase, tenantId, ruleId) {
  if (ruleId) {
    const { data } = await supabase
      .from('BREAK_RULE')
      .select('ID, NAME, T1_HOURS, T1_BREAK_MIN, T2_HOURS, T2_BREAK_MIN, MIN_BLOCK_MIN')
      .eq('TENANT_ID', tenantId)
      .eq('ID', ruleId)
      .maybeSingle();
    if (data) return data;
  }
  // tenant-weiter "ArbZG-Standard"-Eintrag aus Seed
  const { data: any } = await supabase
    .from('BREAK_RULE')
    .select('ID, NAME, T1_HOURS, T1_BREAK_MIN, T2_HOURS, T2_BREAK_MIN, MIN_BLOCK_MIN')
    .eq('TENANT_ID', tenantId)
    .eq('NAME', 'ArbZG-Standard')
    .maybeSingle();
  return any || HARD_DEFAULT_BREAK_RULE;
}

// ── Holiday lookup ───────────────────────────────────────────────────────────
async function isPublicHoliday(supabase, dateStr, countryCode, stateCode) {
  if (!dateStr) return false;
  const q = supabase
    .from('PUBLIC_HOLIDAY')
    .select('ID')
    .eq('COUNTRY_CODE', countryCode || 'DE')
    .eq('HOLIDAY_DATE', dateStr);
  if (stateCode) {
    q.or(`STATE_CODE.is.null,STATE_CODE.eq.${stateCode}`);
  } else {
    q.is('STATE_CODE', null);
  }
  const { data } = await q.limit(1);
  return !!(data && data.length);
}

// ── Day aggregates ───────────────────────────────────────────────────────────
async function sumDayWorkHours(supabase, tenantId, employeeId, dateStr, excludeTecId = null) {
  let q = supabase
    .from('TEC')
    .select('ID, QUANTITY_INT, ENTRY_KIND')
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .eq('DATE_VOUCHER', dateStr);
  if (excludeTecId != null) q = q.neq('ID', excludeTecId);
  const { data } = await q;
  // ENTRY_KIND-Filter im Code, weil bestehende Zeilen vor Migration 0051
  // u.U. NULL haben.
  return (data || [])
    .filter(r => (r.ENTRY_KIND ?? 'WORK') === 'WORK')
    .reduce((s, r) => s + Number(r.QUANTITY_INT || 0), 0);
}

async function sumDayBreakMinutes(supabase, tenantId, employeeId, dateStr, excludeTecId = null) {
  let q = supabase
    .from('TEC')
    .select('ID, QUANTITY_INT, ENTRY_KIND, PAUSE_AUTO_DEDUCTED_MIN')
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .eq('DATE_VOUCHER', dateStr);
  if (excludeTecId != null) q = q.neq('ID', excludeTecId);
  const { data } = await q;
  // Pause-Blöcke (ENTRY_KIND='BREAK') werden in Minuten gerechnet.
  // QUANTITY_INT ist Stunden-Dezimal → * 60.
  let breakMin = 0;
  for (const r of data || []) {
    if ((r.ENTRY_KIND ?? 'WORK') === 'BREAK') {
      breakMin += Math.round(Number(r.QUANTITY_INT || 0) * 60);
    }
    breakMin += Number(r.PAUSE_AUTO_DEDUCTED_MIN || 0);
  }
  return breakMin;
}

// ── Last shift end (für 11h-Ruhezeit) ───────────────────────────────────────
async function lastShiftEnd(supabase, tenantId, employeeId, beforeDateStr, beforeTimeStr) {
  // Look at the previous day's last TIME_FINISH (WORK only).
  const prev = new Date(beforeDateStr + 'T00:00:00');
  prev.setDate(prev.getDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);

  const { data } = await supabase
    .from('TEC')
    .select('DATE_VOUCHER, TIME_FINISH, ENTRY_KIND')
    .eq('TENANT_ID', tenantId)
    .eq('EMPLOYEE_ID', employeeId)
    .in('DATE_VOUCHER', [prevStr, beforeDateStr])
    .not('TIME_FINISH', 'is', null)
    .order('DATE_VOUCHER', { ascending: false })
    .order('TIME_FINISH', { ascending: false });

  for (const r of data || []) {
    if ((r.ENTRY_KIND ?? 'WORK') !== 'WORK') continue;
    if (r.DATE_VOUCHER === beforeDateStr && beforeTimeStr && r.TIME_FINISH >= beforeTimeStr) continue;
    return { date: r.DATE_VOUCHER, time: r.TIME_FINISH };
  }
  return null;
}

function hoursBetween(prevEnd, nextStart) {
  // prevEnd = { date, time }, nextStart = { date, time }
  const a = new Date(prevEnd.date + 'T' + (prevEnd.time || '00:00:00'));
  const b = new Date(nextStart.date + 'T' + (nextStart.time || '00:00:00'));
  return (b.getTime() - a.getTime()) / 3_600_000;
}

// ── Severity helpers ─────────────────────────────────────────────────────────
function elevateOnStrict(issues, strictMode) {
  if (!strictMode) return issues;
  for (const i of issues) {
    if (i.severity === 'WARN') i.severity = 'BLOCK';
  }
  return issues;
}

// ── Main validator ───────────────────────────────────────────────────────────
async function validateBookingArbZG(supabase, {
  tenantId, employeeId, dateVoucher, timeStart, timeFinish, quantityInt,
  entryKind = 'WORK', excludeTecId = null,
}) {
  const issues = [];
  const s = await getArbzgSettings(supabase, tenantId);
  if (!s.enabled) return { issues, settings: s, model: null, breakRule: null };
  // Pausen-Blöcke werden nicht ArbZG-geprüft (sie sind das Mittel zur Erfüllung).
  if (entryKind === 'BREAK') return { issues, settings: s, model: null, breakRule: null };

  const model     = await getActiveWorkModel(supabase, tenantId, employeeId, dateVoucher);
  const breakRule = await getBreakRule(
    supabase, tenantId, model?.BREAK_RULE_ID ?? s.defaultBreakRuleId
  );

  const maxDaily = model?.MAX_DAILY_HOURS ? Number(model.MAX_DAILY_HOURS) : 10;
  const minRest  = model?.MIN_REST_HOURS  ? Number(model.MIN_REST_HOURS)  : 11;

  // JArbSchG-Profil verschärft die Tages-/Wochengrenze.
  const isMinor    = !!model?.IS_MINOR_PROFILE;
  const effMaxDay  = isMinor ? Math.min(maxDaily, 8) : maxDaily;
  const effMinRest = isMinor ? Math.max(minRest,  12) : minRest;

  const qty       = Number(quantityInt || 0);
  const dayBefore = await sumDayWorkHours(supabase, tenantId, employeeId, dateVoucher, excludeTecId);
  const dayTotal  = dayBefore + qty;

  // § 3 ArbZG — Tagesmaximum
  if (s.checkMaxDaily) {
    if (dayTotal > effMaxDay) {
      issues.push({
        severity: 'BLOCK',
        code: isMinor ? 'OVER_8H_MINOR' : 'OVER_10H',
        message: isMinor
          ? `Tagesarbeit ${dayTotal.toFixed(2)} h überschreitet das JArbSchG-Maximum von 8 h`
          : `Tagesarbeit ${dayTotal.toFixed(2)} h überschreitet das Maximum von ${effMaxDay} h (§ 3 ArbZG)`,
        details: { dayTotal, max: effMaxDay },
      });
    } else if (dayTotal > 8) {
      issues.push({
        severity: 'INFO',
        code: 'OVER_8H',
        message: `Tagesarbeit > 8 h — wird gem. § 16 Abs. 2 ArbZG dokumentiert`,
        details: { dayTotal },
      });
    }
  }

  // § 4 ArbZG — Pausenpflicht
  if (s.checkBreakRequired) {
    const breaks = await sumDayBreakMinutes(supabase, tenantId, employeeId, dateVoucher, excludeTecId);
    const required = dayTotal > Number(breakRule.T2_HOURS) ? Number(breakRule.T2_BREAK_MIN)
                   : dayTotal > Number(breakRule.T1_HOURS) ? Number(breakRule.T1_BREAK_MIN)
                   : 0;
    if (required > 0 && breaks < required) {
      issues.push({
        severity: 'WARN',
        code: 'BREAK_MISSING',
        message: `${required} min Pflichtpause erforderlich, ${breaks} min erfasst`,
        details: { required, current: breaks, breakRule: breakRule.NAME },
      });
    }
  }

  // § 5 ArbZG — Ruhezeit
  if (s.checkMinRest && timeStart) {
    const last = await lastShiftEnd(supabase, tenantId, employeeId, dateVoucher, timeStart);
    if (last) {
      const restH = hoursBetween(last, { date: dateVoucher, time: timeStart });
      if (restH > 0 && restH < effMinRest) {
        issues.push({
          severity: 'WARN',
          code: 'REST_LT_11H',
          message: `Ruhezeit nur ${restH.toFixed(1)} h (gefordert ≥ ${effMinRest} h)`,
          details: { restHours: restH, required: effMinRest, lastEnd: last },
        });
      }
    }
  }

  // § 9 ArbZG — Sonn-/Feiertagsarbeit
  if (s.checkSundayHoliday) {
    const dow = new Date(dateVoucher + 'T00:00:00').getDay(); // 0=So
    if (dow === 0) {
      issues.push({
        severity: 'BLOCK',
        code: 'SUNDAY_WORK',
        message: 'Sonntagsarbeit ist nach § 9 ArbZG grundsätzlich nicht zulässig',
      });
    }
    const isHol = await isPublicHoliday(supabase, dateVoucher, s.country, s.stateCode);
    if (isHol) {
      issues.push({
        severity: 'BLOCK',
        code: 'HOLIDAY_WORK',
        message: 'Feiertagsarbeit ist nach § 9 ArbZG grundsätzlich nicht zulässig',
      });
    }
  }

  elevateOnStrict(issues, s.strictMode);
  return { issues, settings: s, model, breakRule, dayTotal };
}

// ── Audit writer ─────────────────────────────────────────────────────────────
async function writeAuditEvents(supabase, tenantId, events) {
  if (!Array.isArray(events) || !events.length) return;
  const rows = events.map(e => ({
    TENANT_ID:    tenantId,
    EMPLOYEE_ID:  e.employeeId,
    DATE_VOUCHER: e.dateVoucher,
    EVENT_TYPE:   e.eventType,
    SEVERITY:     e.severity || 'INFO',
    DETAILS:      e.details || {},
    TEC_ID:       e.tecId ?? null,
  }));
  const { error } = await supabase.from('ARBZG_AUDIT').insert(rows);
  if (error) {
    // Soft-fail: wenn ARBZG_AUDIT noch nicht existiert (Migration 0052
    // nicht gelaufen), darf der Buchungsvorgang trotzdem durchgehen.
    if (/relation .*ARBZG_AUDIT/i.test(error.message)) return;
    throw { status: 500, message: 'ArbZG-Audit-Schreibfehler: ' + error.message };
  }
}

// Convenience: wandelt die issues aus validateBookingArbZG in Audit-Events um.
function issuesToAuditEvents({ employeeId, dateVoucher, tecId, issues, dayTotal }) {
  const events = [];
  // Pro Issue ein Audit-Event (außer INFO werden auch geschrieben — sie sind
  // gerade für > 8 h gem. § 16 Abs. 2 wichtig).
  for (const i of issues) {
    events.push({
      employeeId, dateVoucher, tecId,
      eventType: i.code,
      severity:  i.severity,
      details:   i.details || {},
    });
  }
  if (dayTotal > 8) {
    events.push({
      employeeId, dateVoucher, tecId,
      eventType: 'BOOKING_CONFIRMED',
      severity:  'INFO',
      details:   { dayTotal },
    });
  }
  return events;
}

module.exports = {
  // Settings
  getArbzgSettings, saveArbzgSettings, SETTING_KEYS, DEFAULTS,
  // Lookups
  getActiveWorkModel, getBreakRule, isPublicHoliday,
  // Aggregates
  sumDayWorkHours, sumDayBreakMinutes, lastShiftEnd, hoursBetween,
  // Validator + Audit
  validateBookingArbZG, writeAuditEvents, issuesToAuditEvents,
};
