'use strict';

// CRUD fuer NOTIFICATION_SCHEDULE_CONFIG (Migration 0056).
//
// Generischer Tenant-Store fuer zeitgesteuerte Notification-Typen.
// Lookup ueber (TENANT_ID, TYPE_KEY).
//
// ZEITZONE — warum das hier steht
//   Die Uhrzeit im Zeitplan ist die Uhrzeit des Buero, nicht die des Servers.
//   Auf Railway laeuft der Container in UTC; new Date().getHours() lieferte
//   deshalb im Sommer zwei Stunden zu wenig, und eine auf 09:00 gestellte
//   Erinnerung ging erst um 11:00 Ortszeit raus. Aus demselben Grund darf
//   auch das Tagesdatum (LAST_FIRED_DATE, ref_date) nicht aus
//   toISOString() kommen: abends nach 22:00 Ortszeit ist in UTC schon der
//   naechste Tag, und die Erinnerung haette sich selbst uebersprungen.
//
//   Alle Zeitplan-Entscheidungen laufen deshalb ueber localParts() in der
//   Zone aus APP_TIMEZONE (Vorgabe Europe/Berlin).

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Berlin';

// Datum und Uhrzeit in der App-Zeitzone. 'sv-SE' formatiert als
// "2026-08-19 14:35" — nah genug an ISO, um es ohne Nacharbeit zu zerlegen.
let _fmt = null;
function localParts(when = new Date()) {
  if (!_fmt) {
    try {
      _fmt = new Intl.DateTimeFormat('sv-SE', {
        timeZone: APP_TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
    } catch (e) {
      // Unbekannte Zone (Tippfehler in APP_TIMEZONE): lieber Serverzeit als
      // gar keine Erinnerung — aber laut, damit es auffaellt.
      console.warn(`[NOTIFICATION_SCHEDULE] Zeitzone "${APP_TIMEZONE}" unbekannt, nutze Serverzeit:`, e?.message || e);
      _fmt = false;
    }
  }
  if (!_fmt) {
    const mm = String(when.getMonth() + 1).padStart(2, '0');
    const dd = String(when.getDate()).padStart(2, '0');
    return {
      dateStr:    `${when.getFullYear()}-${mm}-${dd}`,
      dayOfMonth: when.getDate(),
      minutes:    when.getHours() * 60 + when.getMinutes(),
    };
  }
  const s = _fmt.format(when);                    // "2026-08-19 14:35"
  const m = /^(\d{4})-(\d{2})-(\d{2})\D+(\d{2}):(\d{2})/.exec(s);
  if (!m) return { dateStr: s.slice(0, 10), dayOfMonth: Number(s.slice(8, 10)), minutes: 0 };
  return {
    dateStr:    `${m[1]}-${m[2]}-${m[3]}`,
    dayOfMonth: Number(m[3]),
    minutes:    Number(m[4]) * 60 + Number(m[5]),
  };
}

// Tagesdatum in der App-Zeitzone (YYYY-MM-DD) — fuer LAST_FIRED_DATE und
// die ref_date-Idempotenz der Checker.
function localDateStr(when = new Date()) {
  return localParts(when).dateStr;
}

// "HH:MM[:SS]" -> Minuten seit Mitternacht; null bei ungueltiger Eingabe.
function timeToMinutes(timeStr) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || ''));
  if (!m) return null;
  const h = Number(m[1]); const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// Ist die konfigurierte Uhrzeit in der App-Zeitzone erreicht?
// Ohne hinterlegte Uhrzeit: ja (der Typ ist dann nur tagesgenau geplant).
function hasReachedTimeOfDay(timeStr, when = new Date()) {
  const target = timeToMinutes(timeStr);
  if (target == null) return true;
  return localParts(when).minutes >= target;
}

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
    PM_NOTIFY_MODE:        b.pmNotifyMode === 'summary' ? 'summary' : 'per_project',
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

  // Migration 0129 noch nicht eingespielt: die Spalte gibt es dann nicht, und
  // PostgREST lehnt den ganzen Datensatz ab. Ohne diesen Rueckfall liesse sich
  // der Reminder zwischen Deploy und Migration gar nicht mehr speichern —
  // eine kaputte Einstellungsseite waere ein hoher Preis fuer ein Feld.
  if (error && /PM_NOTIFY_MODE/i.test(error.message || '')) {
    const { PM_NOTIFY_MODE, ...ohneModus } = row;
    void PM_NOTIFY_MODE;
    console.warn('[NOTIFICATION_SCHEDULE] PM_NOTIFY_MODE fehlt — Migration 0129 einspielen. Speichere ohne dieses Feld.');
    const retry = await supabase
      .from('NOTIFICATION_SCHEDULE_CONFIG')
      .upsert([ohneModus], { onConflict: 'TENANT_ID,TYPE_KEY' })
      .select('*').single();
    if (retry.error) throw { status: 500, message: retry.error.message };
    return retry.data;
  }

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

// Ist heute ein Tag, an dem dieses Schedule feuert? (nur Datum, ohne Uhrzeit)
function isFireDay(schedule, today = new Date()) {
  const { dateStr, dayOfMonth } = localParts(today);
  const days = Array.isArray(schedule.SCHEDULE_DAYS) ? schedule.SCHEDULE_DAYS : [];
  if (days.includes(dayOfMonth)) return true;
  if (schedule.SCHEDULE_LAST_DAY) {
    // Letzter Tag des Monats: der Folgetag liegt schon im naechsten Monat.
    const [y, m] = dateStr.split('-').map(Number);
    const letzter = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (dayOfMonth === letzter) return true;
  }
  return false;
}

// Schedule-Treffer-Pruefung: feuert dieses Schedule JETZT?
// Tag UND — falls hinterlegt — Uhrzeit muessen erreicht sein. Vor dieser
// Aenderung war SCHEDULE_TIME_OF_DAY beim Leistungsstand-Reminder gespeichert,
// aber wirkungslos: die Erinnerung ging zu der Uhrzeit raus, zu der der
// 6-Stunden-Takt des Checkers gerade den Tag traf.
function shouldFireToday(schedule, today = new Date()) {
  if (!schedule || !schedule.ENABLED) return false;
  if (!isFireDay(schedule, today)) return false;
  return hasReachedTimeOfDay(schedule.SCHEDULE_TIME_OF_DAY, today);
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
  isFireDay,
  hasReachedTimeOfDay,
  localDateStr,
  localParts,
  markFired,
  APP_TIMEZONE,
};
