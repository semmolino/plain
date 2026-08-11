"use strict";

const express = require("express");
const svc     = require("../services/emailTemplates");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // Lesen darf jeder angemeldete Nutzer: die Versanddialoge (Rechnungen,
  // Mahnungen) fuellen ihre Felder aus der Vorlage vor. Aendern bleibt an
  // settings.text_templates.edit gebunden — dieselbe Permission wie bei den
  // Kopf-/Fusstexten der PDFs.
  router.get("/", async (req, res) => {
    try {
      const data = await svc.getTemplates(supabase, { tenantId: req.tenantId });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.put("/:key", requirePermission("settings.text_templates.edit"), async (req, res) => {
    try {
      const result = await svc.saveTemplate(supabase, {
        tenantId: req.tenantId,
        key:      req.params.key,
        subject:  req.body.subject,
        body:     req.body.body,
      });
      res.json(result);
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // Zuruecksetzen auf den Standardtext (Zeile loeschen).
  router.delete("/:key", requirePermission("settings.text_templates.edit"), async (req, res) => {
    try {
      const result = await svc.resetTemplate(supabase, { tenantId: req.tenantId, key: req.params.key });
      res.json(result);
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  return router;
};
