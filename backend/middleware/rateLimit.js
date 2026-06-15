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

const rateLimit = require("express-rate-limit");

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

module.exports = {
  loginLimiter,
  passwordLimiter,
  resetRequestLimiter,
  resetConfirmLimiter,
  signupLimiter,
};
