"use strict";

/**
 * landingAnalytics.js — First-Party, cookieless Landing-Page-Analytics.
 *
 * Nimmt anonyme Besucher-Ereignisse der öffentlichen Marketing-Seite entgegen
 * und schreibt sie sanitisiert in "LANDING_EVENT". KEINE PII:
 *   - keine IP-Speicherung
 *   - kein persistenter Identifier (SESSION_KEY ist pro Seitenaufruf zufällig)
 *   - Referrer nur als Host (keine volle URL/Query)
 *
 * Siehe Migration 0084 und docs/marketing/Analytics_Setup.md.
 */

const ALLOWED_TYPES = new Set([
  "page_view",
  "click",
  "scroll_depth",
  "section_view",
  "engagement",
]);

const ALLOWED_DEVICES = new Set(["mobile", "tablet", "desktop"]);

const MAX_BATCH = 50; // Schutz gegen Missbrauch: max. Ereignisse pro Request

function str(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function intOrNull(v, { min = -2147483648, max = 2147483647 } = {}) {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  if (r < min || r > max) return null;
  return r;
}

/** Nur der Host der Referrer-URL — keine vollständige URL, kein Query/Pfad. */
function referrerHost(v) {
  const s = str(v, 500);
  if (!s) return null;
  try {
    return new URL(s).host.slice(0, 255) || null;
  } catch {
    return null;
  }
}

/** Sprache auf den primären Subtag normalisieren (z. B. 'de-DE' -> 'de'). */
function normLang(v) {
  const s = str(v, 35);
  if (!s) return null;
  return s.split(",")[0].split("-")[0].toLowerCase().slice(0, 8);
}

/** Ein einzelnes Roh-Ereignis in eine sichere DB-Zeile überführen (oder null verwerfen). */
function sanitizeEvent(raw, shared) {
  if (!raw || typeof raw !== "object") return null;

  const type = str(raw.type, 30);
  if (!type || !ALLOWED_TYPES.has(type)) return null;

  let device = str(raw.device, 10);
  if (device && !ALLOWED_DEVICES.has(device)) device = null;

  let scroll = null;
  if (type === "scroll_depth") {
    scroll = intOrNull(raw.scroll, { min: 0, max: 100 });
  }

  let engaged = null;
  if (type === "engagement") {
    // Plausibilitätsgrenze: 0 .. 6h, gegen Ausreißer
    engaged = intOrNull(raw.engagedMs, { min: 0, max: 6 * 60 * 60 * 1000 });
  }

  return {
    SESSION_KEY:   str(shared.sessionKey, 64),
    EVENT_TYPE:    type,
    EVENT_LABEL:   str(raw.label, 120),
    PATH:          str(raw.path || shared.path, 300),
    REFERRER_HOST: referrerHost(raw.referrer || shared.referrer),
    SCROLL_DEPTH:  scroll,
    ENGAGED_MS:    engaged,
    DEVICE_TYPE:   device || str(shared.device, 10) || null,
    VIEWPORT_W:    intOrNull(raw.viewportW ?? shared.viewportW, { min: 0, max: 20000 }),
    LANGUAGE:      normLang(raw.language || shared.language),
    UTM_SOURCE:    str(raw.utmSource || shared.utmSource, 120),
    UTM_MEDIUM:    str(raw.utmMedium || shared.utmMedium, 120),
    UTM_CAMPAIGN:  str(raw.utmCampaign || shared.utmCampaign, 120),
    COUNTRY:       str(shared.country, 2),   // serverseitig optional gesetzt; OHNE IP
  };
}

/**
 * recordEvents(supabase, payload, ctx)
 *   payload: { sessionKey, path, referrer, device, viewportW, language,
 *              utmSource, utmMedium, utmCampaign, events: [...] }
 *   ctx:     { country } — optional, serverseitig grob (kein IP-Persist)
 */
async function recordEvents(supabase, payload, ctx = {}) {
  if (!payload || typeof payload !== "object") {
    throw { status: 400, message: "Ungültiger Payload" };
  }
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) return { inserted: 0 };

  const shared = {
    sessionKey:  payload.sessionKey,
    path:        payload.path,
    referrer:    payload.referrer,
    device:      payload.device,
    viewportW:   payload.viewportW,
    language:    payload.language,
    utmSource:   payload.utmSource,
    utmMedium:   payload.utmMedium,
    utmCampaign: payload.utmCampaign,
    country:     ctx.country,
  };

  const rows = events
    .slice(0, MAX_BATCH)
    .map((e) => sanitizeEvent(e, shared))
    .filter(Boolean);

  if (rows.length === 0) return { inserted: 0 };

  const { error } = await supabase.from("LANDING_EVENT").insert(rows);
  if (error) throw { status: 500, message: error.message };

  return { inserted: rows.length };
}

/**
 * getSummary(supabase, { from, to }) — Aggregat fürs Reporting-Modul.
 * Liefert Kennzahlen über den Zeitraum. Alle Auswertungen sind aggregiert/anonym.
 */
async function getSummary(supabase, { from, to } = {}) {
  let q = supabase
    .from("LANDING_EVENT")
    .select("EVENT_TYPE,EVENT_LABEL,SESSION_KEY,SCROLL_DEPTH,ENGAGED_MS,DEVICE_TYPE,REFERRER_HOST,CREATED_AT");
  if (from) q = q.gte("CREATED_AT", from);
  if (to)   q = q.lte("CREATED_AT", to);
  // Obergrenze gegen versehentliche Vollscans; für große Zeiträume besser SQL-View.
  q = q.limit(100000);

  const { data, error } = await q;
  if (error) throw { status: 500, message: error.message };

  const rows = data || [];
  const sessions = new Set();
  let pageViews = 0;
  const clicksByLabel = {};
  const sectionsBySession = {};
  const scrollDepthCount = { 25: 0, 50: 0, 75: 0, 100: 0 };
  const engagedBySession = {};
  const devices = {};
  const referrers = {};

  for (const r of rows) {
    if (r.SESSION_KEY) sessions.add(r.SESSION_KEY);
    if (r.DEVICE_TYPE) devices[r.DEVICE_TYPE] = (devices[r.DEVICE_TYPE] || 0) + 1;
    switch (r.EVENT_TYPE) {
      case "page_view":
        pageViews++;
        if (r.REFERRER_HOST) referrers[r.REFERRER_HOST] = (referrers[r.REFERRER_HOST] || 0) + 1;
        break;
      case "click":
        if (r.EVENT_LABEL) clicksByLabel[r.EVENT_LABEL] = (clicksByLabel[r.EVENT_LABEL] || 0) + 1;
        break;
      case "scroll_depth":
        if (scrollDepthCount[r.SCROLL_DEPTH] != null) scrollDepthCount[r.SCROLL_DEPTH]++;
        break;
      case "section_view":
        if (r.SESSION_KEY && r.EVENT_LABEL) {
          (sectionsBySession[r.EVENT_LABEL] = sectionsBySession[r.EVENT_LABEL] || new Set()).add(r.SESSION_KEY);
        }
        break;
      case "engagement":
        if (r.SESSION_KEY && r.ENGAGED_MS != null) {
          engagedBySession[r.SESSION_KEY] = Math.max(engagedBySession[r.SESSION_KEY] || 0, r.ENGAGED_MS);
        }
        break;
    }
  }

  const engagedVals = Object.values(engagedBySession);
  const avgEngagedMs = engagedVals.length
    ? Math.round(engagedVals.reduce((a, b) => a + b, 0) / engagedVals.length)
    : 0;

  const sectionReach = Object.fromEntries(
    Object.entries(sectionsBySession).map(([k, set]) => [k, set.size])
  );

  return {
    range: { from: from || null, to: to || null },
    visits: sessions.size,
    pageViews,
    avgEngagedMs,
    scrollDepth: scrollDepthCount,
    clicksByLabel,
    sectionReach,
    devices,
    topReferrers: referrers,
  };
}

module.exports = { recordEvents, getSummary };
