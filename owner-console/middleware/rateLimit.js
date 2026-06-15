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

module.exports = { loginLimiter };
