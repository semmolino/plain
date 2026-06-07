"use strict";

const { createNotification } = require("./notifications");

const TYPE_KEY = "hours_booking_reminder";

// Sendet pro Tenant einmal pro Tag eine Buchungs-Erinnerung an alle
// aktiven Mitarbeiter, die heute noch keine TEC-Zeile haben — sobald die
// in NOTIFICATION_SCHEDULE_CONFIG.SCHEDULE_TIME_OF_DAY hinterlegte Uhrzeit
// erreicht ist.
async function checkHoursBookingReminders(supabase) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  let configs;
  try {
    const { data, error } = await supabase
      .from("NOTIFICATION_SCHEDULE_CONFIG")
      .select("*")
      .eq("TYPE_KEY", TYPE_KEY);
    if (error) throw error;
    configs = data || [];
  } catch (e) {
    console.warn("[HOURS_BOOKING_REMINDER] kein Schedule-Tisch, skip:", e?.message || e);
    return;
  }

  let totalCreated = 0;
  for (const cfg of configs) {
    if (!cfg.ENABLED) continue;
    if (!cfg.SCHEDULE_TIME_OF_DAY) continue;
    if (cfg.LAST_FIRED_DATE && String(cfg.LAST_FIRED_DATE).slice(0, 10) === todayStr) continue;
    if (!hasReachedTime(cfg.SCHEDULE_TIME_OF_DAY, now)) continue;

    try {
      const created = await fireForTenant(supabase, cfg, todayStr);
      totalCreated += created;
      await supabase
        .from("NOTIFICATION_SCHEDULE_CONFIG")
        .update({ LAST_FIRED_DATE: todayStr })
        .eq("ID", cfg.ID);
      console.log(`[HOURS_BOOKING_REMINDER] Tenant ${cfg.TENANT_ID}: ${created} Notification(s)`);
    } catch (e) {
      console.error(`[HOURS_BOOKING_REMINDER] Tenant ${cfg.TENANT_ID} Fehler:`, e?.message || e);
    }
  }

  if (totalCreated > 0) {
    console.log(`[HOURS_BOOKING_REMINDER] Insgesamt ${totalCreated} Notification(s)`);
  }
}

function hasReachedTime(timeStr, now) {
  // timeStr "HH:MM:SS"
  const m = /^(\d{2}):(\d{2})/.exec(String(timeStr || ""));
  if (!m) return false;
  const targetMin  = Number(m[1]) * 60 + Number(m[2]);
  const nowMin     = now.getHours() * 60 + now.getMinutes();
  return nowMin >= targetMin;
}

async function fireForTenant(supabase, cfg, todayStr) {
  const tenantId = cfg.TENANT_ID;

  // Alle aktiven Mitarbeiter des Tenants
  const { data: employees, error: empErr } = await supabase
    .from("EMPLOYEE")
    .select("ID, FIRST_NAME, LAST_NAME")
    .eq("TENANT_ID", tenantId)
    .eq("ACTIVE", 1);
  if (empErr) throw empErr;
  if (!employees || employees.length === 0) return 0;

  // Welche haben heute schon eine TEC-Zeile (DRAFT oder CONFIRMED)?
  // Wir nehmen alle Zeilen mit DATE_VOUCHER = heute.
  const empIds = employees.map(e => e.ID);
  const { data: tecToday } = await supabase
    .from("TEC")
    .select("EMPLOYEE_ID")
    .eq("TENANT_ID", tenantId)
    .eq("DATE_VOUCHER", todayStr)
    .in("EMPLOYEE_ID", empIds);
  const bookedIds = new Set((tecToday || []).map(r => Number(r.EMPLOYEE_ID)));

  let created = 0;
  for (const emp of employees) {
    if (bookedIds.has(Number(emp.ID))) continue;

    // Idempotenz: heute schon eine Notification fuer diesen Empfaenger?
    const { data: existing } = await supabase
      .from("NOTIFICATION")
      .select("ID")
      .eq("TENANT_ID", tenantId)
      .eq("TYPE", TYPE_KEY)
      .eq("USER_ID", String(emp.ID))
      .eq("METADATA->>ref_date", todayStr)
      .limit(1);
    if (existing && existing.length > 0) continue;

    try {
      await createNotification(supabase, {
        tenantId,
        userId: String(emp.ID),
        type:   TYPE_KEY,
        title:  "Stunden für heute buchen",
        body:   "Du hast für heute noch keine Stunden gebucht. Bitte trage deine Zeiten ein.",
        link:   "/projekte?tab=buchungen",
        metadata: { ref_date: todayStr },
      });
      created++;
    } catch (e) {
      console.warn(`[HOURS_BOOKING_REMINDER] Notif EMP ${emp.ID} fehlgeschlagen: ${e?.message || e}`);
    }
  }
  return created;
}

// Manueller Trigger (ignoriert Uhrzeit-Pruefung)
async function runNowForTenant(supabase, tenantId) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("NOTIFICATION_SCHEDULE_CONFIG")
    .select("*")
    .eq("TYPE_KEY", TYPE_KEY)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw { status: 404, message: "Keine Konfiguration vorhanden" };
  if (!data.ENABLED) throw { status: 400, message: "Schedule ist deaktiviert" };
  const created = await fireForTenant(supabase, data, todayStr);
  await supabase
    .from("NOTIFICATION_SCHEDULE_CONFIG")
    .update({ LAST_FIRED_DATE: todayStr })
    .eq("ID", data.ID);
  return created;
}

// Boot: 5 Min nach Startup, dann stuendlich (damit eine 09:00-Schwelle
// nicht erst um 12:00 anschlaegt).
function startHoursBookingReminderChecker(supabase) {
  const RUN_AFTER_MS = 5 * 60 * 1000;
  const INTERVAL_MS  = 60 * 60 * 1000;
  setTimeout(async () => {
    console.log("[HOURS_BOOKING_REMINDER] Initial-Lauf …");
    await checkHoursBookingReminders(supabase).catch(e =>
      console.error("[HOURS_BOOKING_REMINDER] Error:", e?.message || e),
    );
    setInterval(() => {
      checkHoursBookingReminders(supabase).catch(e =>
        console.error("[HOURS_BOOKING_REMINDER] Error:", e?.message || e),
      );
    }, INTERVAL_MS);
  }, RUN_AFTER_MS);
}

module.exports = {
  startHoursBookingReminderChecker,
  checkHoursBookingReminders,
  runNowForTenant,
};
