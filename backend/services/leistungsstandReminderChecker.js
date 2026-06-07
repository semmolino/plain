"use strict";

const { createNotification } = require("./notifications");
const schedule = require("./notificationSchedule");

const TYPE_KEY = "leistungsstand_reminder";

// Iteriert ueber alle Tenants mit aktivem Schedule, prueft ob heute der
// Reminder feuern soll, schreibt Notifications je nach Konfig:
//   - NOTIFY_PROJECT_PM=true  -> pro Projekt eine Notif an PROJECT_MANAGER_ID
//   - AUDIENCE_*  gesetzt     -> pro Mitarbeiter eine Sammel-Notif (Link auf
//                                Leistungsstand-Liste, Filter "meine Projekte")
async function checkLeistungsstandReminders(supabase) {
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
    console.warn("[LEISTUNGSSTAND_REMINDER] kein Schedule-Tisch, skip:", e?.message || e);
    return;
  }

  let totalCreated = 0;

  for (const cfg of configs) {
    if (!cfg.ENABLED) continue;
    if (cfg.LAST_FIRED_DATE && String(cfg.LAST_FIRED_DATE).slice(0, 10) === todayStr) continue;
    if (!schedule.shouldFireToday(cfg, now)) continue;

    try {
      const created = await fireForTenant(supabase, cfg);
      totalCreated += created;
      await schedule.markFired(supabase, cfg.ID, todayStr);
      console.log(`[LEISTUNGSSTAND_REMINDER] Tenant ${cfg.TENANT_ID}: ${created} Notification(s) erstellt`);
    } catch (e) {
      console.error(`[LEISTUNGSSTAND_REMINDER] Tenant ${cfg.TENANT_ID} Fehler:`, e?.message || e);
    }
  }

  if (totalCreated > 0) {
    console.log(`[LEISTUNGSSTAND_REMINDER] Insgesamt ${totalCreated} Notification(s) erstellt`);
  }
}

async function fireForTenant(supabase, cfg) {
  const tenantId = cfg.TENANT_ID;
  let created = 0;

  // Projekte fuer diesen Tenant (gefiltert nach PROJECT_STATUS_IDS, falls gesetzt)
  let projectsQuery = supabase
    .from("PROJECT")
    .select("ID, NAME_SHORT, NAME_LONG, PROJECT_MANAGER_ID, PROJECT_STATUS_ID")
    .eq("TENANT_ID", tenantId);
  if (Array.isArray(cfg.PROJECT_STATUS_IDS) && cfg.PROJECT_STATUS_IDS.length > 0) {
    projectsQuery = projectsQuery.in("PROJECT_STATUS_ID", cfg.PROJECT_STATUS_IDS);
  }
  const { data: projects, error: projErr } = await projectsQuery;
  if (projErr) throw projErr;

  // Pro-Projekt-PM-Notifications
  if (cfg.NOTIFY_PROJECT_PM) {
    for (const p of projects || []) {
      if (!p.PROJECT_MANAGER_ID) continue;
      // Schon heute fuer dieses Projekt geschrieben? -> skip (idempotent)
      const { data: existing } = await supabase
        .from("NOTIFICATION")
        .select("ID")
        .eq("TENANT_ID", tenantId)
        .eq("TYPE", TYPE_KEY)
        .eq("METADATA->>project_id", String(p.ID))
        .eq("METADATA->>ref_date", todayLocal())
        .limit(1);
      if (existing && existing.length > 0) continue;

      const label = `${p.NAME_SHORT || ""}${p.NAME_LONG ? " – " + p.NAME_LONG : ""}`.trim() || `#${p.ID}`;
      try {
        await createNotification(supabase, {
          tenantId,
          userId:   String(p.PROJECT_MANAGER_ID),  // managed_by_rule -> wird durchgereicht
          type:     TYPE_KEY,
          title:    `Leistungsstand pflegen: ${p.NAME_SHORT || `#${p.ID}`}`,
          body:     `Bitte den Leistungsstand für „${label}" aktualisieren.`,
          link:     `/projekte?tab=leistungsstand&projectId=${p.ID}`,
          metadata: {
            project_id: String(p.ID),
            ref_date:   todayLocal(),
            scope:      "pm",
          },
        });
        created++;
      } catch (e) {
        console.warn(`[LEISTUNGSSTAND_REMINDER] PM-Notif fuer Projekt ${p.ID} fehlgeschlagen: ${e?.message || e}`);
      }
    }
  }

  // Audience-Notifications (Rollen / Abteilungen / explizite Mitarbeiter)
  const audienceIds = await resolveScheduleAudience(supabase, tenantId, cfg);
  for (const empId of audienceIds) {
    // Schon heute fuer diesen Empfaenger geschrieben? -> skip
    const { data: existing } = await supabase
      .from("NOTIFICATION")
      .select("ID")
      .eq("TENANT_ID", tenantId)
      .eq("TYPE", TYPE_KEY)
      .eq("USER_ID", String(empId))
      .eq("METADATA->>scope", "audience")
      .eq("METADATA->>ref_date", todayLocal())
      .limit(1);
    if (existing && existing.length > 0) continue;

    try {
      await createNotification(supabase, {
        tenantId,
        userId:   String(empId),
        type:     TYPE_KEY,
        title:    `Leistungsstände erfassen`,
        body:     `Bitte die Leistungsstände der Projekte aktualisieren.`,
        link:     `/projekte?tab=leistungsstand&filter=mine`,
        metadata: { ref_date: todayLocal(), scope: "audience" },
      });
      created++;
    } catch (e) {
      console.warn(`[LEISTUNGSSTAND_REMINDER] Audience-Notif EMP ${empId} fehlgeschlagen: ${e?.message || e}`);
    }
  }

  return created;
}

async function resolveScheduleAudience(supabase, tenantId, cfg) {
  const roles  = Array.isArray(cfg.AUDIENCE_ROLES)       ? cfg.AUDIENCE_ROLES.filter(Boolean) : [];
  const depts  = Array.isArray(cfg.AUDIENCE_DEPARTMENTS) ? cfg.AUDIENCE_DEPARTMENTS.filter(x => x != null) : [];
  const empls  = Array.isArray(cfg.AUDIENCE_EMPLOYEES)   ? cfg.AUDIENCE_EMPLOYEES.filter(x => x != null) : [];

  const ids = new Set();
  if (roles.length || depts.length) {
    const orParts = [];
    if (roles.length) orParts.push(`DASHBOARD_ROLE.in.(${roles.map(r => `"${r}"`).join(',')})`);
    if (depts.length) orParts.push(`DEPARTMENT_ID.in.(${depts.join(',')})`);
    const { data } = await supabase
      .from("EMPLOYEE")
      .select("ID")
      .eq("TENANT_ID", tenantId)
      .or(orParts.join(','));
    for (const r of (data || [])) ids.add(Number(r.ID));
  }
  for (const eid of empls) ids.add(Number(eid));
  return ids;
}

function todayLocal() {
  return new Date().toISOString().slice(0, 10);
}

// Boot: 5 Min nach Startup ersten Lauf, danach alle 6 Stunden
// (haeufig genug, damit ein Tag nicht "verpasst" wird, aber idempotent via
// LAST_FIRED_DATE).
function startLeistungsstandReminderChecker(supabase) {
  const RUN_AFTER_MS = 5 * 60 * 1000;
  const INTERVAL_MS  = 6 * 60 * 60 * 1000;

  setTimeout(async () => {
    console.log("[LEISTUNGSSTAND_REMINDER] Initial-Lauf …");
    await checkLeistungsstandReminders(supabase).catch(e =>
      console.error("[LEISTUNGSSTAND_REMINDER] Error:", e?.message || e),
    );
    setInterval(() => {
      checkLeistungsstandReminders(supabase).catch(e =>
        console.error("[LEISTUNGSSTAND_REMINDER] Error:", e?.message || e),
      );
    }, INTERVAL_MS);
  }, RUN_AFTER_MS);
}

// Manueller Trigger: feuert fuer EINEN Tenant ohne Schedule-/Datums-Check
// (fuer "Jetzt ausfuehren"-Button im Admin).
async function runNowForTenant(supabase, tenantId) {
  const { data, error } = await supabase
    .from("NOTIFICATION_SCHEDULE_CONFIG")
    .select("*")
    .eq("TYPE_KEY", TYPE_KEY)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw { status: 404, message: "Keine Konfiguration vorhanden" };
  if (!data.ENABLED) throw { status: 400, message: "Schedule ist deaktiviert" };
  const created = await fireForTenant(supabase, data);
  await schedule.markFired(supabase, data.ID, todayLocal());
  return created;
}

module.exports = {
  startLeistungsstandReminderChecker,
  checkLeistungsstandReminders, // exported fuer Manual-Trigger / Tests
  runNowForTenant,
};
