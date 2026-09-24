"use strict";

const { createNotification } = require("./notifications");
const schedule = require("./notificationSchedule");
const health   = require("./checkerHealth");

const TYPE_KEY = "leistungsstand_reminder";

// Iteriert ueber alle Tenants mit aktivem Schedule, prueft ob heute der
// Reminder feuern soll, schreibt Notifications je nach Konfig:
//   - NOTIFY_PROJECT_PM=true  -> pro Projekt eine Notif an PROJECT_MANAGER_ID
//   - AUDIENCE_*  gesetzt     -> pro Mitarbeiter eine Sammel-Notif (Link auf
//                                Leistungsstand-Liste, Filter "meine Projekte")
async function checkLeistungsstandReminders(supabase) {
  const now = new Date();
  const todayStr = schedule.localDateStr(now);

  let configs;
  try {
    const { data, error } = await supabase
      .from("NOTIFICATION_SCHEDULE_CONFIG")
      .select("*")
      .eq("TYPE_KEY", TYPE_KEY);
    if (error) throw error;
    configs = data || [];
  } catch (e) {
    // Diese Stelle verschluckte bisher JEDEN Datenbankfehler als "Tabelle
    // fehlt eben". Ein abgelaufenes Token sah damit aus wie ein sauberer Lauf
    // ohne Arbeit — der Grund, warum das Ausbleiben so lange raetselhaft war.
    console.warn("[LEISTUNGSSTAND_REMINDER] Zeitplaene nicht lesbar, skip:", e?.message || e);
    health.melde(TYPE_KEY, { fehler: e?.message || String(e) });
    return;
  }

  health.melde(TYPE_KEY, { gesehen: configs.length });

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

  health.melde(TYPE_KEY, { erstellt: totalCreated });

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
    .select("ID, ABBR, NAME, PROJECT_MANAGER_ID, PROJECT_STATUS_ID")
    .eq("TENANT_ID", tenantId);
  if (Array.isArray(cfg.PROJECT_STATUS_IDS) && cfg.PROJECT_STATUS_IDS.length > 0) {
    projectsQuery = projectsQuery.in("PROJECT_STATUS_ID", cfg.PROJECT_STATUS_IDS);
  }
  const { data: projects, error: projErr } = await projectsQuery;
  if (projErr) throw projErr;

  // PM-Notifications: entweder je Projekt eine oder eine Sammelnachricht je
  // Person. Bei zwanzig laufenden Projekten sind zwanzig Meldungen am selben
  // Morgen keine Erinnerung mehr, sondern Rauschen — deshalb die Wahl.
  if (cfg.NOTIFY_PROJECT_PM) {
    const projekteJePm = new Map();          // pmId(String) -> Projekte
    for (const p of projects || []) {
      if (!p.PROJECT_MANAGER_ID) continue;
      const key = String(p.PROJECT_MANAGER_ID);
      if (!projekteJePm.has(key)) projekteJePm.set(key, []);
      projekteJePm.get(key).push(p);
    }

    const summary = String(cfg.PM_NOTIFY_MODE || "per_project") === "summary";
    for (const [pmId, liste] of projekteJePm) {
      created += summary
        ? await notifyPmSummary(supabase, { tenantId, pmId, projekte: liste })
        : await notifyPmPerProject(supabase, { tenantId, pmId, projekte: liste });
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
        link:     `/projekte?tab=leistungsstaende`,
        metadata: { ref_date: todayLocal(), scope: "audience" },
      });
      created++;
    } catch (e) {
      console.warn(`[LEISTUNGSSTAND_REMINDER] Audience-Notif EMP ${empId} fehlgeschlagen: ${e?.message || e}`);
    }
  }

  return created;
}

// Beschriftung eines Projekts fuer Titel und Fliesstext.
function projektLabel(p) {
  return `${p.ABBR || ""}${p.NAME ? " – " + p.NAME : ""}`.trim() || `#${p.ID}`;
}

// Je Projekt eine eigene Nachricht (Vorgabe, bisheriges Verhalten).
async function notifyPmPerProject(supabase, { tenantId, pmId, projekte }) {
  let created = 0;
  for (const p of projekte) {
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

    try {
      await createNotification(supabase, {
        tenantId,
        userId:   pmId,                       // managed_by_rule -> wird durchgereicht
        type:     TYPE_KEY,
        title:    `Leistungsstand pflegen: ${p.ABBR || `#${p.ID}`}`,
        body:     `Bitte den Leistungsstand für „${projektLabel(p)}" aktualisieren.`,
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
  return created;
}

// Eine Nachricht je Person — unabhaengig davon, wie viele Projekte sie fuehrt.
//
// Eigener scope ("pm_summary") in der Idempotenz-Pruefung: sonst wuerde eine
// bereits vorhandene Einzelnachricht (etwa aus einem Lauf vor dem Umschalten)
// die Sammelnachricht unterdruecken oder umgekehrt.
async function notifyPmSummary(supabase, { tenantId, pmId, projekte }) {
  const { data: existing } = await supabase
    .from("NOTIFICATION")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .eq("TYPE", TYPE_KEY)
    .eq("USER_ID", pmId)
    .eq("METADATA->>scope", "pm_summary")
    .eq("METADATA->>ref_date", todayLocal())
    .limit(1);
  if (existing && existing.length > 0) return 0;

  const anzahl = projekte.length;
  // Vollstaendige Liste waere bei vielen Projekten unlesbar; die ersten fuenf
  // benennen den Umfang, der Rest steht in der Leistungsstand-Liste hinter dem
  // Link.
  const namen = projekte.slice(0, 5).map(projektLabel);
  const rest  = anzahl - namen.length;
  const aufzaehlung = namen.join(", ") + (rest > 0 ? ` und ${rest} weitere` : "");

  try {
    await createNotification(supabase, {
      tenantId,
      userId:   pmId,
      type:     TYPE_KEY,
      title:    anzahl === 1
        ? `Leistungsstand pflegen: ${projekte[0].ABBR || `#${projekte[0].ID}`}`
        : `Leistungsstände pflegen (${anzahl} Projekte)`,
      body:     anzahl === 1
        ? `Bitte den Leistungsstand für „${projektLabel(projekte[0])}" aktualisieren.`
        : `Bitte die Leistungsstände aktualisieren: ${aufzaehlung}.`,
      link:     `/projekte?tab=leistungsstaende`,
      metadata: {
        ref_date:    todayLocal(),
        scope:       "pm_summary",
        project_ids: projekte.map(p => String(p.ID)),
      },
    });
    return 1;
  } catch (e) {
    console.warn(`[LEISTUNGSSTAND_REMINDER] PM-Sammelnotif fuer EMP ${pmId} fehlgeschlagen: ${e?.message || e}`);
    return 0;
  }
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

// Tagesdatum in der App-Zeitzone (Europe/Berlin, s. notificationSchedule.js).
// toISOString() waere hier falsch: nach 22:00 Ortszeit steht dort schon der
// naechste Tag, und die ref_date-Idempotenz griffe ins Leere.
function todayLocal() {
  return schedule.localDateStr();
}

// Boot: 5 Min nach Startup ersten Lauf, danach MINUETLICH.
//
// WARUM NICHT STUENDLICH (bis 09/2026)
//   Der Zeitplan laesst eine Uhrzeit auf die Minute genau einstellen. Ein
//   stuendlicher Takt kann dieses Versprechen nicht halten: er trifft die
//   eingestellte Zeit nur zufaellig. Schlimmer noch, das Raster haengt am
//   PROZESSSTART — nach jedem Deploy liegt es woanders.
//
//   Gemessen am 2026-09-17: Prozessstart 17:32 UTC, erster Lauf also 17:37,
//   danach 18:37, 19:37 … Der Zeitplan stand auf 19:38 Ortszeit (17:38 UTC).
//   Der Lauf um 17:37 kam eine Minute zu frueh, der naechste eine Stunde zu
//   spaet. Aus Nutzersicht: "die Erinnerung kommt nicht" — dabei kam sie 59
//   Minuten spaeter, und am Vortag zu einer anderen Zeit.
//
//   Der Takt muss feiner sein als die Genauigkeit, die die Oberflaeche
//   verspricht. Eine Minute ist billig: ein Lauf laedt die Zeitplaene mit
//   EINER Abfrage und bricht ab, wenn keiner faellig ist. Was Arbeit kostet,
//   passiert nur an dem einen Lauf des Tages, der wirklich feuert.
//
// Mehrfachlaeufe sind unschaedlich: LAST_FIRED_DATE und die ref_date-Pruefung
// machen den Lauf idempotent.
function startLeistungsstandReminderChecker(supabase) {
  const RUN_AFTER_MS = 5 * 60 * 1000;
  const INTERVAL_MS  = 60 * 1000;

  setTimeout(async () => {
    console.log("[LEISTUNGSSTAND_REMINDER] Initial-Lauf …");
    await health.laufe(TYPE_KEY, () => checkLeistungsstandReminders(supabase)).catch(e =>
      console.error("[LEISTUNGSSTAND_REMINDER] Error:", e?.message || e),
    );
    setInterval(() => {
      health.laufe(TYPE_KEY, () => checkLeistungsstandReminders(supabase)).catch(e =>
        console.error("[LEISTUNGSSTAND_REMINDER] Error:", e?.message || e),
      );
    }, INTERVAL_MS);
  }, RUN_AFTER_MS);
}

// Manueller Trigger: feuert fuer EINEN Tenant ohne Schedule-/Datums-Check
// (fuer "Jetzt ausfuehren"-Button im Admin).
//
// Setzt LAST_FIRED_DATE bewusst NICHT — sonst gilt der regulaere Lauf
// desselben Tages als erledigt, und genau die Erinnerung, die der Test
// pruefen sollte, bleibt aus. Gegen Dopplungen wirkt die ref_date-Pruefung
// je Projekt bzw. je Empfaenger in fireForTenant().
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

  // Null erzeugte Benachrichtigungen haben zwei sehr verschiedene Gruende:
  // entweder gibt es gerade nichts zu erinnern, oder fuer heute wurde bereits
  // erinnert und die ref_date-Sperre greift. In der Oberflaeche sahen beide
  // gleich aus — "Erinnerungen ausgeloest: 0", gruen. Wer kurz zuvor getestet
  // hatte, stand damit vor einem Knopf, der nichts tat und nichts sagte.
  let bereitsHeute = 0;
  if (created === 0) {
    const { data: heute } = await supabase
      .from("NOTIFICATION")
      .select("ID")
      .eq("TENANT_ID", tenantId)
      .eq("TYPE", TYPE_KEY)
      .eq("METADATA->>ref_date", todayLocal());
    bereitsHeute = Array.isArray(heute) ? heute.length : 0;
  }
  return { created, bereitsHeute };
}

module.exports = {
  startLeistungsstandReminderChecker,
  checkLeistungsstandReminders, // exported fuer Manual-Trigger / Tests
  runNowForTenant,
};
