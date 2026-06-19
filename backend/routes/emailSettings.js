"use strict";

const express = require("express");
const ctrl    = require("../controllers/emailSettings");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // Sensible Funktion (SMTP-Zugangsdaten) -> eigene Permission.
  router.use(requirePermission("settings.email.edit"));

  router.get("/",      (req, res) => ctrl.get(req, res, supabase));
  router.put("/",      (req, res) => ctrl.save(req, res, supabase));
  router.post("/test", (req, res) => ctrl.test(req, res, supabase));

  return router;
};
