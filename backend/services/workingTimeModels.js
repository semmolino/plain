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

async function listModels(supabase, tenantId) {
  const { data, error } = await supabase
    .from('WORKING_TIME_MODEL')
    .select('ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN')
    .eq('TENANT_ID', tenantId)
    .order('NAME', { ascending: true });
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

async function createModel(supabase, tenantId, body) {
  const { name, country_code, state_code, mon, tue, wed, thu, fri, sat, sun } = body;
  if (!name || !country_code) throw { status: 400, message: 'Name und Land sind Pflichtfelder' };

  const { data, error } = await supabase
    .from('WORKING_TIME_MODEL')
    .insert([{
      TENANT_ID:    tenantId,
      NAME:         name.trim(),
      COUNTRY_CODE: country_code,
      STATE_CODE:   state_code || null,
      MON:          Number(mon) || 0,
      TUE:          Number(tue) || 0,
      WED:          Number(wed) || 0,
      THU:          Number(thu) || 0,
      FRI:          Number(fri) || 0,
      SAT:          Number(sat) || 0,
      SUN:          Number(sun) || 0,
    }])
    .select('ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN')
    .single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

async function updateModel(supabase, tenantId, id, body) {
  const { name, country_code, state_code, mon, tue, wed, thu, fri, sat, sun } = body;
  if (!name || !country_code) throw { status: 400, message: 'Name und Land sind Pflichtfelder' };

  const { data, error } = await supabase
    .from('WORKING_TIME_MODEL')
    .update({
      NAME:         name.trim(),
      COUNTRY_CODE: country_code,
      STATE_CODE:   state_code || null,
      MON:          Number(mon) || 0,
      TUE:          Number(tue) || 0,
      WED:          Number(wed) || 0,
      THU:          Number(thu) || 0,
      FRI:          Number(fri) || 0,
      SAT:          Number(sat) || 0,
      SUN:          Number(sun) || 0,
    })
    .eq('ID', id)
    .eq('TENANT_ID', tenantId)
    .select('ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN')
    .single();
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
