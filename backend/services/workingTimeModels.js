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

function buildPayload(body) {
  const { name, country_code, state_code, mon, tue, wed, thu, fri, sat, sun,
          model_type, break_rule_id, max_daily_hours, min_rest_hours, is_minor_profile } = body;
  if (!name || !country_code) throw { status: 400, message: 'Name und Land sind Pflichtfelder' };
  const base = {
    NAME:         name.trim(),
    COUNTRY_CODE: country_code,
    STATE_CODE:   state_code || null,
    MON: Number(mon) || 0, TUE: Number(tue) || 0, WED: Number(wed) || 0,
    THU: Number(thu) || 0, FRI: Number(fri) || 0, SAT: Number(sat) || 0,
    SUN: Number(sun) || 0,
  };
  const arbzg = {};
  if (model_type        !== undefined) arbzg.MODEL_TYPE       = model_type === 'TRUST' ? 'TRUST' : 'FIXED';
  if (break_rule_id     !== undefined) arbzg.BREAK_RULE_ID    = break_rule_id == null || break_rule_id === ''
                                                                  ? null : Number(break_rule_id);
  if (max_daily_hours   !== undefined) arbzg.MAX_DAILY_HOURS  = Number(max_daily_hours) || 10;
  if (min_rest_hours    !== undefined) arbzg.MIN_REST_HOURS   = Number(min_rest_hours) || 11;
  if (is_minor_profile  !== undefined) arbzg.IS_MINOR_PROFILE = !!is_minor_profile;
  return { base, arbzg };
}

async function createModel(supabase, tenantId, body) {
  const { base, arbzg } = buildPayload(body);
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
  let { data, error } = await supabase
    .from('WORKING_TIME_MODEL')
    .update({ ...base, ...arbzg })
    .eq('ID', id).eq('TENANT_ID', tenantId)
    .select(FULL_COLS).single();
  if (error && /MODEL_TYPE|BREAK_RULE_ID|MAX_DAILY_HOURS|MIN_REST_HOURS|IS_MINOR_PROFILE/i.test(error.message)) {
    const r = await supabase.from('WORKING_TIME_MODEL').update(base)
      .eq('ID', id).eq('TENANT_ID', tenantId).select(BASIC_COLS).single();
    if (r.error) throw { status: 500, message: r.error.message };
    return { ...r.data, MODEL_TYPE: 'FIXED', BREAK_RULE_ID: null,
             MAX_DAILY_HOURS: 10, MIN_REST_HOURS: 11, IS_MINOR_PROFILE: false };
  }
  if (error) throw { status: 500, message: error.message };
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

module.exports = { getCountryStates, listModels, createModel, updateModel, deleteModel };
