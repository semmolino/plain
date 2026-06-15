"use strict";

const express = require("express");

/**
 * Liefert das effektive Entitlement des eingeloggten Tenants ans Frontend
 * (analog /permissions/me). req.license wird von der licenseMiddleware gesetzt.
 */
module.exports = () => {
  const router = express.Router();

  router.get("/me", (req, res) => {
    const lic = req.license || {};
    res.json({
      unrestricted: !!req._licenseUnrestricted,
      plan_id: lic.planId ?? null,
      state: lic.state ?? null,
      capabilities: [...(lic.capabilities || [])],
      limits: Object.fromEntries(lic.limits || []),
    });
  });

  return router;
};
