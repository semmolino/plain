"use strict";

/**
 * Rate-Limiter für Auth-Endpoints (Brute-Force- / Missbrauchsschutz).
 *
 * Voraussetzung: server.js setzt `app.set("trust proxy", 1)`, sonst teilen sich
 * alle Clients hinter dem Railway-Proxy einen Bucket.
 *
 * Login/Passwort-Limiter zählen NUR Fehlversuche (skipSuccessfulRequests) —
 * ein ganzes Büro hinter einer NAT-IP wird so nie ausgesperrt, nur Brute-Force.
 * Schwellen via Env überschreibbar (RL_*). In NODE_ENV=test deaktiviert.
 */

// ipKeyGenerator normalisiert IPv6 auf ein /56-Praefix, damit ein Client sich
// nicht ueber seine eigenen Adressen neue Kontingente holt.
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = rateLimit;

const isTest = process.env.NODE_ENV === "test";
const num = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

function make(opts) {
  if (isTest) return (_req, _res, next) => next(); // Limiter stören Unit-Tests/CI nicht
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Zu viele Versuche. Bitte später erneut versuchen." },
    ...opts,
  });
}

const WINDOW_15M = 15 * 60 * 1000;
const WINDOW_1H = 60 * 60 * 1000;

// Login: nur Fehlversuche zählen -> echte Nutzer bleiben unberührt.
const loginLimiter = make({
  windowMs: WINDOW_15M,
  max: num(process.env.RL_LOGIN_MAX, 15),
  skipSuccessfulRequests: true,
});

// Passwort ändern (current-password-Raten begrenzen).
const passwordLimiter = make({
  windowMs: WINDOW_15M,
  max: num(process.env.RL_PASSWORD_MAX, 15),
  skipSuccessfulRequests: true,
});

// Reset anfordern: gegen E-Mail-Bombing / Enumeration -> alle Requests zählen.
const resetRequestLimiter = make({
  windowMs: WINDOW_15M,
  max: num(process.env.RL_RESET_MAX, 5),
});

// Reset bestätigen: Token-Raten begrenzen.
const resetConfirmLimiter = make({
  windowMs: WINDOW_15M,
  max: num(process.env.RL_RESET_CONFIRM_MAX, 15),
});

// Signup: Massen-Tenant-Anlage verhindern.
const signupLimiter = make({
  windowMs: WINDOW_1H,
  max: num(process.env.RL_SIGNUP_MAX, 10),
});

// ── Teure Endpunkte (Sicherheitsaudit 2026-09-03, M6) ───────────────────────
//
// Die PDF-Erzeugung startet je Aufruf Playwright-Chromium, Reports aggregieren
// ueber den ganzen Mandanten. Beides war ungedrosselt: ein einzelnes Konto
// konnte den Container erschoepfen — und der reisst BEIDE Prozesse mit, weil
// bin/start-web.sh auf "wait -n" steht und PostgREST mitsamt Node beendet.
//
// GEZAEHLT WIRD PRO KONTO, NICHT PRO IP.
//   Ein Buero sitzt hinter einer NAT-Adresse. Ein IP-Limit auf teuren
//   Endpunkten wuerde dort bedeuten, dass sich Kollegen gegenseitig
//   aussperren — beim Rechnungslauf am Monatsende genau dann, wenn es
//   wehtut. Der Schluessel ist deshalb die Mitarbeiter-ID aus dem Token;
//   nur wo keine vorliegt, faellt es auf die IP zurueck.
//
// Die Schwellen liegen bewusst weit ueber dem Alltag: ein Rechnungslauf mit
// 50 Belegen soll durchlaufen, ein Skript mit 5.000 Aufrufen nicht.

// ACHTUNG: ipKeyGenerator nimmt die IP als STRING, nicht das Request-Objekt.
// Mit dem Objekt gibt es das Objekt zurueck, ohne zu werfen — der Schluessel
// waere dann kein String mehr und der Limiter still unbrauchbar. Genau dieser
// Fehler stand hier zuerst; tests/rate_limit_heavy.test.js haelt ihn fest.
const perKonto = (req) =>
  req.employeeId ? `e${req.employeeId}` : (ipKeyGenerator(req.ip) ?? "unbekannt");

/** Erzeugt PDF/XML oder rechnet einen Report — beides teuer. */
const istTeuer = (req) => /\/(pdf|report|reports|einvoice|xml)(\/|$)/i.test(req.path);

const heavyLimiter = make({
  windowMs: WINDOW_15M,
  max: num(process.env.RL_HEAVY_MAX, 120),
  keyGenerator: perKonto,
  skip: (req) => !istTeuer(req),
  message: { error: "Zu viele Dokument- oder Report-Anfragen in kurzer Zeit. Bitte einen Moment warten." },
});

// Grober Deckel gegen Flut auf alles Uebrige. Weit weg von normaler Nutzung —
// er soll nur verhindern, dass ein durchgedrehtes Skript oder ein
// Endlos-Reload die Instanz belegt.
const apiLimiter = make({
  windowMs: WINDOW_15M,
  max: num(process.env.RL_API_MAX, 1500),
  keyGenerator: perKonto,
});

module.exports = {
  loginLimiter,
  passwordLimiter,
  resetRequestLimiter,
  resetConfirmLimiter,
  signupLimiter,
  heavyLimiter,
  apiLimiter,
  _istTeuer: istTeuer,
  _perKonto: perKonto,
};
