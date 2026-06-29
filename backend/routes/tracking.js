"use strict";

/**
 * tracking.js — Öffentliche, cookieless Landing-Page-Analytics (KEINE JWT-Auth).
 *
 * In server.js VOR der authChain einhängen (wie webhooks):
 *   const trackingRoutes = require("./routes/tracking")(supabase);
 *   app.use("/api/v1/track", trackingRoutes);
 *
 * Der Client (Landingpage) sendet die Ereignisse per navigator.sendBeacon mit
 * Content-Type "text/plain", damit KEIN CORS-Preflight nötig ist und der Endpoint
 * cross-origin (eigene Marketing-Domain) erreichbar bleibt. Body ist JSON-Text.
 *
 * Datenschutz: keine IP-Speicherung, kein Cookie, kein persistenter Identifier.
 * Siehe services/landingAnalytics.js und docs/marketing/Analytics_Setup.md.
 */

const express = require("express");
const svc = require("../services/landingAnalytics");

// ── Einfaches In-Memory-Rate-Limit (pro IP, gleitendes Fenster) ──────────────
// Hinweis: pro Instanz. Auf Railway mit mehreren Instanzen nur Grundschutz;
// für härtere Limits express-rate-limit + Shared Store verwenden.
const WINDOW_MS = 60 * 1000;
const MAX_REQ_PER_WINDOW = 60;
const hits = new Map(); // ip -> { count, resetAt }

function rateLimited(ip) {
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(ip, rec);
  }
  rec.count++;
  return rec.count > MAX_REQ_PER_WINDOW;
}

// Gelegentliches Aufräumen, damit die Map nicht wächst.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now > rec.resetAt) hits.delete(ip);
}, 5 * 60 * 1000).unref?.();

module.exports = (supabase) => {
  const router = express.Router();

  // text/plain-Beacons selbst parsen (globales express.json() greift hier nicht).
  router.use(express.text({ type: ["text/plain", "application/json"], limit: "32kb" }));

  router.post("/", async (req, res) => {
    // Schnelle, leere Antwort — Beacons werten den Body nicht aus.
    const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();
    if (rateLimited(ip)) return res.status(429).end();

    let payload;
    try {
      payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(204).end(); // defekter Body -> still verwerfen
    }

    // Sofort 204 zurück; Persistenz asynchron (kein Warten für den Browser).
    res.status(204).end();

    try {
      await svc.recordEvents(supabase, payload, { country: null });
    } catch (e) {
      console.warn("[tracking] recordEvents:", e?.message || e);
    }
  });

  return router;
};
