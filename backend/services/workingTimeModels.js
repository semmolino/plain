'use strict';

// Hard-coded country/state reference data (no DB needed)
const COUNTRY_STATES = {
  DE: [
    { code: 'BW', label: 'Baden-Württemberg' },
    { code: 'BY', label: 'Bayern' },
    { code: 'BE', label: 'Berlin' },
    { code: 'BB', label: 'Brandenburg' },
    { code: 'HB', label: 'Bremen' },
    { code: 'HH', label: 'Hamburg' },
    { code: 'HE', label: 'Hessen' },
    { code: 'MV', label: 'Mecklenburg-Vorpommern' },
    { code: 'NI', label: 'Niedersachsen' },
    { code: 'NW', label: 'Nordrhein-Westfalen' },
    { code: 'RP', label: 'Rheinland-Pfalz' },
    { code: 'SL', label: 'Saarland' },
    { code: 'SN', label: 'Sachsen' },
    { code: 'ST', label: 'Sachsen-Anhalt' },
    { code: 'SH', label: 'Schleswig-Holstein' },
    { code: 'TH', label: 'Thüringen' },
  ],
  AT: [{ code: null, label: 'Österreich (gesamt)' }],
  CH: [{ code: null, label: 'Schweiz (gesamt)' }],
};

function getCountryStates() {
  return COUNTRY_STATES;
}

const FULL_COLS = 'ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN, ' +
                  'MODEL_TYPE, BREAK_RULE_ID, MAX_DAILY_HOURS, MIN_REST_HOURS, IS_MINOR_PROFILE';
const BASIC_COLS = 'ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN';

async function listModels(supabase, tenantId) {
  let { data, error } = await supabase
    .from('WORKING_TIME_MODEL')
    .select(FULL_COLS)
    .eq('TENANT_ID', tenantId)
    .order('NAME', { ascending: true });
  if (error && /MODEL_TYPE|BREAK_RULE_ID|MAX_DAILY_HOURS|MIN_REST_HOURS|IS_MINOR_PROFILE/i.test(error.message)) {
    const r = await supabase
      .from('WORKING_TIME_MODEL')
      .select(BASIC_COLS)
      .eq('TENANT_ID', tenantId)
      .order('NAME', { ascending: true });
    if (r.error) throw { status: 500, message: r.error.message };
    return (r.data || []).map(d => ({ ...d, MODEL_TYPE: 'FIXED', BREAK_RULE_ID: null,
      MAX_DAILY_HOURS: 10, MIN_REST_HOURS: 11, IS_MINOR_PROFILE: false }));
  }
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

/** Zahl aus einer Eingabe — nimmt „7,5" wie „7.5"; leer → `fallback`. */
function hours(v, label, { min, max, fallback }) {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) {
    throw { status: 400, message: `${label}: bitte eine Zahl von ${min} bis ${max}.` };
  }
  return Math.round(n * 100) / 100;
}

const DAYS = [['mon', 'MON', 'Montag'], ['tue', 'TUE', 'Dienstag'], ['wed', 'WED', 'Mittwoch'], ['thu', 'THU', 'Donnerstag'],
              ['fri', 'FRI', 'Freitag'], ['sat', 'SAT', 'Samstag'], ['sun', 'SUN', 'Sonntag']];

/**
 * Prüft die Angaben eines Modells (UI-Pilot Runde 12). Vorher ging alles
 * durch, was `Number()` schluckte: ein Soll von −8 oder 30 Stunden, ein
 * erfundenes Land, ein Bundesland aus einem anderen Land — das Zeitkonto und
 * die Urlaubstage rechneten damit weiter.
 */
function buildPayload(body) {
  const { name, country_code, state_code,
          model_type, break_rule_id, max_daily_hours, min_rest_hours, is_minor_profile } = body || {};
  const nm = typeof name === 'string' ? name.trim() : '';
  if (!nm || !country_code) throw { status: 400, message: 'Name und Land sind Pflichtfelder' };
  if (nm.length > 100) throw { status: 400, message: 'Name: höchstens 100 Zeichen.' };
  const states = COUNTRY_STATES[country_code];
  if (!states) throw { status: 400, message: 'Land: bitte Deutschland, Österreich oder die Schweiz wählen.' };
  const sc = state_code || null;
  if (sc && !states.some(s => s.code === sc)) throw { status: 400, message: 'Bundesland passt nicht zum Land.' };
  const base = { NAME: nm, COUNTRY_CODE: country_code, STATE_CODE: sc };
  for (const [k, col, label] of DAYS) base[col] = hours(body[k], label, { min: 0, max: 24, fallback: 0 });

  const arbzg = {};
  if (model_type        !== undefined) arbzg.MODEL_TYPE       = model_type === 'TRUST' ? 'TRUST' : 'FIXED';
  if (break_rule_id     !== undefined) arbzg.BREAK_RULE_ID    = break_rule_id == null || break_rule_id === ''
                                                                  ? null : Number(break_rule_id);
  if (max_daily_hours   !== undefined) arbzg.MAX_DAILY_HOURS  = hours(max_daily_hours, 'Max. Tagesarbeit', { min: 1, max: 24, fallback: 10 });
  if (min_rest_hours    !== undefined) arbzg.MIN_REST_HOURS   = hours(min_rest_hours, 'Mindest-Ruhezeit', { min: 1, max: 24, fallback: 11 });
  if (is_minor_profile  !== undefined) arbzg.IS_MINOR_PROFILE = !!is_minor_profile;
  if (arbzg.BREAK_RULE_ID != null && !Number.isInteger(arbzg.BREAK_RULE_ID)) throw { status: 400, message: 'Pausenregel: ungültige Auswahl.' };
  return { base, arbzg };
}

/** Eine Pausenregel nur aus dem eigenen Büro. */
async function assertOwnBreakRule(supabase, tenantId, id) {
  if (id == null) return;
  const { data, error } = await supabase.from('BREAK_RULE').select('ID').eq('ID', id).eq('TENANT_ID', tenantId).maybeSingle();
  if (error) throw { status: 500, message: error.message };
  if (!data) throw { status: 400, message: 'Pausenregel nicht gefunden.' };
}

async function createModel(supabase, tenantId, body) {
  const { base, arbzg } = buildPayload(body);
  await assertOwnBreakRule(supabase, tenantId, arbzg.BREAK_RULE_ID);
  const row = { TENANT_ID: tenantId, ...base, ...arbzg };
  let { data, error } = await supabase
    .from('WORKING_TIME_MODEL')
    .insert([row])
    .select(FULL_COLS)
    .single();
  if (error && /MODEL_TYPE|BREAK_RULE_ID|MAX_DAILY_HOURS|MIN_REST_HOURS|IS_MINOR_PROFILE/i.test(error.message)) {
    const r = await supabase.from('WORKING_TIME_MODEL')
      .insert([{ TENANT_ID: tenantId, ...base }]).select(BASIC_COLS).single();
    if (r.error) throw { status: 500, message: r.error.message };
    return { ...r.data, MODEL_TYPE: 'FIXED', BREAK_RULE_ID: null,
             MAX_DAILY_HOURS: 10, MIN_REST_HOURS: 11, IS_MINOR_PROFILE: false };
  }
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function updateModel(supabase, tenantId, id, body) {
  const { base, arbzg } = buildPayload(body);
  await assertOwnBreakRule(supabase, tenantId, arbzg.BREAK_RULE_ID);
  let { data, error } = await supabase
    .from('WORKING_TIME_MODEL')
    .update({ ...base, ...arbzg })
    .eq('ID', id).eq('TENANT_ID', tenantId)
    .select(FULL_COLS).maybeSingle();
  if (error && /MODEL_TYPE|BREAK_RULE_ID|MAX_DAILY_HOURS|MIN_REST_HOURS|IS_MINOR_PROFILE/i.test(error.message)) {
    const r = await supabase.from('WORKING_TIME_MODEL').update(base)
      .eq('ID', id).eq('TENANT_ID', tenantId).select(BASIC_COLS).maybeSingle();
    if (r.error) throw { status: 500, message: r.error.message };
    if (!r.data) throw { status: 404, message: 'Arbeitszeitmodell nicht gefunden.' };
    return { ...r.data, MODEL_TYPE: 'FIXED', BREAK_RULE_ID: null,
             MAX_DAILY_HOURS: 10, MIN_REST_HOURS: 11, IS_MINOR_PROFILE: false };
  }
  if (error) throw { status: 500, message: error.message };
  if (!data) throw { status: 404, message: 'Arbeitszeitmodell nicht gefunden.' };
  return data;
}

async function deleteModel(supabase, tenantId, id) {
  // Check for existing assignments before deleting
  const { data: usages } = await supabase
    .from('EMPLOYEE_WORK_MODEL')
    .select('ID')
    .eq('MODEL_ID', id)
    .eq('TENANT_ID', tenantId)
    .limit(1);
  if (usages && usages.length > 0) {
    throw { status: 409, message: 'Modell wird noch von Mitarbeitern verwendet und kann nicht gelöscht werden' };
  }

  const { error } = await supabase
    .from('WORKING_TIME_MODEL')
    .delete()
    .eq('ID', id)
    .eq('TENANT_ID', tenantId);
  if (error) throw { status: 500, message: error.message };
}

module.exports = { getCountryStates, listModels, createModel, updateModel, deleteModel, buildPayload };
