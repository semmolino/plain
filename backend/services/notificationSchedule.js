'use strict';

// CRUD fuer NOTIFICATION_SCHEDULE_CONFIG (Migration 0056).
//
// Generischer Tenant-Store fuer zeitgesteuerte Notification-Typen.
// Lookup ueber (TENANT_ID, TYPE_KEY).

async function getSchedule(supabase, { tenantId, typeKey }) {
  const { data } = await supabase
    .from('NOTIFICATION_SCHEDULE_CONFIG')
    .select('*')
    .eq('TENANT_ID', tenantId)
    .eq('TYPE_KEY', typeKey)
    .maybeSingle();
  return data || null;
}

async function listAllSchedules(supabase, tenantId) {
  const { data, error } = await supabase
    .from('NOTIFICATION_SCHEDULE_CONFIG')
    .select('*')
    .eq('TENANT_ID', tenantId);
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

async function upsertSchedule(supabase, { tenantId, typeKey, body, employeeId }) {
  if (!tenantId || !typeKey) throw { status: 400, message: 'tenantId und typeKey erforderlich' };
  const b = body || {};
  const row = {
    TENANT_ID:             tenantId,
    TYPE_KEY:              typeKey,
    ENABLED:               b.enabled !== false,
    SCHEDULE_DAYS:         Array.isArray(b.scheduleDays)
                            ? b.scheduleDays
                                .map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 31)
                            : null,
    SCHEDULE_LAST_DAY:     !!b.scheduleLastDay,
    SCHEDULE_TIME_OF_DAY:  parseTimeHhmm(b.scheduleTimeOfDay),
    NOTIFY_PROJECT_PM:     b.notifyProjectPm !== false,
    PROJECT_STATUS_IDS:    Array.isArray(b.projectStatusIds)
                            ? b.projectStatusIds.map(Number).filter(Number.isFinite)
                            : null,
    AUDIENCE_ROLES:        Array.isArray(b.audienceRoles)       ? b.audienceRoles.filter(Boolean) : null,
    AUDIENCE_DEPARTMENTS:  Array.isArray(b.audienceDepartments) ? b.audienceDepartments.map(Number).filter(Number.isFinite) : null,
    AUDIENCE_EMPLOYEES:    Array.isArray(b.audienceEmployees)   ? b.audienceEmployees.map(Number).filter(Number.isFinite)   : null,
    UPDATED_AT:            new Date().toISOString(),
    UPDATED_BY:            employeeId ?? null,
  };
  const { data, error } = await supabase
    .from('NOTIFICATION_SCHEDULE_CONFIG')
    .upsert([row], { onConflict: 'TENANT_ID,TYPE_KEY' })
    .select('*').single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

// "HH:MM" oder "HH:MM:SS" -> "HH:MM:00"; null/leer -> null.
// Defensiv: invalide Eingaben werden zu null statt zu crashen.
function parseTimeHhmm(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]); const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`;
}

// Schedule-Treffer-Pruefung: feuert dieses Schedule heute?
function shouldFireToday(schedule, today = new Date()) {
  if (!schedule || !schedule.ENABLED) return false;
  const dayOfMonth = today.getDate();
  const days = Array.isArray(schedule.SCHEDULE_DAYS) ? schedule.SCHEDULE_DAYS : [];
  if (days.includes(dayOfMonth)) return true;
  if (schedule.SCHEDULE_LAST_DAY) {
    const tomorrow = new Date(today);
    tomorrow.setDate(dayOfMonth + 1);
    if (tomorrow.getMonth() !== today.getMonth()) return true;
  }
  return false;
}

async function markFired(supabase, scheduleId, dateStr) {
  await supabase
    .from('NOTIFICATION_SCHEDULE_CONFIG')
    .update({ LAST_FIRED_DATE: dateStr })
    .eq('ID', scheduleId);
}

module.exports = {
  getSchedule,
  listAllSchedules,
  upsertSchedule,
  shouldFireToday,
  markFired,
};
