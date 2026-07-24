"use strict";

const rateLimit = require("express-rate-limit");

const isTest = process.env.NODE_ENV === "test";

function make(opts) {
  if (isTest) return (_req, _res, next) => next();
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Zu viele Versuche. Bitte später erneut versuchen." },
    ...opts,
  });
}

// Konsolen-Login: aggressiv begrenzt (kleiner Nutzerkreis, hohes Schutzbedürfnis).
const loginLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
});

// Mutierende Endpunkte: großzügig, aber gedeckelt gegen Automatisierung/Missbrauch.
// Lesende Requests (GET) zählen nicht mit — die Konsole lädt Listen häufig neu.
const writeLimiter = make({
  windowMs: 5 * 60 * 1000,
  max: 300,
  skip: (req) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS",
});

module.exports = { loginLimiter, writeLimiter };
