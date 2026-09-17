"use strict";

// ---------------------------------------------------------------------------
// Selbstauskunft der Benachrichtigungs-Zustellung.
//
// Wenn eine geplante Erinnerung ausbleibt, war von aussen nicht zu erkennen,
// woran es liegt — Zeitplan, Hintergrunddienst, Datenbank oder Push sahen im
// Fehlerfall alle gleich aus: nichts passiert. Diese Auskunft macht die vier
// Schichten einzeln pruefbar, damit die naechste Fehlersuche nicht wieder eine
// Reihe von Vermutungen wird.
// ---------------------------------------------------------------------------

const schedule = require("./notificationSchedule");
const health   = require("./checkerHealth");
const push     = require("./push");
const dbLayer  = require("../db");

// Wann feuert dieser Zeitplan das naechste Mal? Rein aus der Konfiguration
// gerechnet, ohne Datenbank — beantwortet "habe ich mich beim Tag vertan?".
function naechsterLauf(cfg, ab = new Date()) {
  if (!cfg || !cfg.ENABLED) return null;

  // Die Buchungs-Erinnerung braucht zusaetzlich eine Uhrzeit — ohne sie
  // ueberspringt ihr Checker den Zeitplan ganz.
  const uhrzeit = (cfg.SCHEDULE_TIME_OF_DAY || "").slice(0, 5) || null;
  if (schedule.istTaeglich(cfg.TYPE_KEY) && !uhrzeit) return null;

  // Tageweise bis zu 62 Tage vorausschauen: deckt auch "nur am 31." ab, den es
  // nicht in jedem Monat gibt. Taegliche Zeitplaene treffen schon bei i = 0
  // oder 1 — die Schleife gilt fuer beide Arten.
  for (let i = 0; i < 62; i++) {
    const tag = new Date(ab.getTime() + i * 24 * 60 * 60 * 1000);
    if (!schedule.isFireDay(cfg, tag)) continue;

    const { dateStr } = schedule.localParts(tag);

    if (i === 0) {
      // Heute schon abgehakt -> erst der naechste Termin zaehlt.
      const schonGelaufen =
        cfg.LAST_FIRED_DATE && String(cfg.LAST_FIRED_DATE).slice(0, 10) === dateStr;
      if (schonGelaufen) continue;
      if (schedule.hasReachedTimeOfDay(cfg.SCHEDULE_TIME_OF_DAY, tag)) {
        // Uhrzeit ist durch, aber noch nicht gefeuert -> steht unmittelbar an.
        return { datum: dateStr, uhrzeit, faellig: true };
      }
    }
    return { datum: dateStr, uhrzeit, faellig: false };
  }
  return null;
}

async function diagnose(supabase, { tenantId, userId }) {
  const jetzt = new Date();
  const { dateStr, minutes } = schedule.localParts(jetzt);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  const utcMinute = jetzt.toISOString().slice(0, 16);   // "YYYY-MM-DDTHH:MM"

  // ── Zeitpläne dieses Mandanten ──
  let schedules = [];
  let scheduleFehler = null;
  try {
    schedules = await schedule.listAllSchedules(supabase, tenantId);
  } catch (e) {
    scheduleFehler = e?.message || String(e);
  }

  // ── Eigene Push-Geräte ──
  let geraete = 0;
  let jeZugestellt = 0;
  let geraeteFehler = null;
  try {
    const { data, error } = await supabase
      .from("PUSH_SUBSCRIPTION")
      .select("ID, USER_AGENT, CREATED_AT, LAST_USED_AT")
      .eq("TENANT_ID", tenantId)
      .eq("USER_ID", String(userId));
    if (error) throw new Error(error.message);
    geraete = (data || []).length;
    // Ein Geraet, das seit der Registrierung nie einen Push angenommen hat,
    // unterscheidet den Fall "kommt nicht an" von "kam frueher an, jetzt nicht
    // mehr". Ohne diese Zahl sehen beide gleich aus.
    jeZugestellt = (data || []).filter(r => r.LAST_USED_AT).length;
  } catch (e) {
    geraeteFehler = e?.message || String(e);
  }

  return {
    zeit: {
      zeitzone:   schedule.APP_TIMEZONE,
      jetztLokal: `${dateStr} ${hh}:${mm}`,
      jetztUtc:   utcMinute.replace("T", " "),
      // Abstand zwischen Buerozeit und UTC. Steht hier 0, laeuft der Server
      // ohnehin in dieser Zone — dann war die Zeitzone nie die Ursache.
      versatzStunden: Math.round(
        (Date.parse(`${dateStr}T${hh}:${mm}:00Z`) - Date.parse(`${utcMinute}:00Z`)) / 3_600_000,
      ),
    },
    datenbank: {
      weg: dbLayer.mode ? dbLayer.mode() : "unbekannt",
    },
    hintergrundJobs: {
      // Auf Nebeninstanzen bewusst abgeschaltet — dann laeuft hier nichts,
      // und das ist kein Fehler, sondern Absicht.
      abgeschaltet: process.env.DISABLE_BACKGROUND_JOBS === "true",
      ...health.status(),
    },
    push: {
      serverKonfiguriert: push.isConfigured(),
      eigeneGeraete:      geraete,
      // Wie viele davon schon einmal einen Push angenommen haben. 0 bei
      // vorhandenen Geraeten heisst: es kam noch NIE etwas durch — dann liegt
      // es am Kanal, nicht am Zeitplan.
      jeZugestellt,
      // Der sub-Claim im VAPID-Token. Steht hier der Standardwert, zeigt die
      // Absenderkennung auf eine Domain, die uns nicht gehoeren muss — Apple
      // lehnt solche Tokens ab.
      absenderkennung:    push.getSubject(),
      fehler:             geraeteFehler,
    },
    zeitplaene: schedules.map(cfg => ({
      typeKey:        cfg.TYPE_KEY,
      aktiv:          !!cfg.ENABLED,
      taeglich:       schedule.istTaeglich(cfg.TYPE_KEY),
      tage:           cfg.SCHEDULE_DAYS || [],
      letzterTag:     !!cfg.SCHEDULE_LAST_DAY,
      uhrzeit:        (cfg.SCHEDULE_TIME_OF_DAY || "").slice(0, 5) || null,
      zuletztGefeuert: cfg.LAST_FIRED_DATE ? String(cfg.LAST_FIRED_DATE).slice(0, 10) : null,
      naechsterLauf:  naechsterLauf(cfg, jetzt),
    })),
    zeitplaeneFehler: scheduleFehler,
  };
}

module.exports = { diagnose, naechsterLauf };
