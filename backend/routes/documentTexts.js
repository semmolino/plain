// Textbausteine fuer Belege — Base path: /api/v1/document-texts
// Lesen: jeder Angemeldete (Auswahl im Rechnungsassistenten).
// Pflegen: settings.text_templates.edit (wie die Standard-Kopf-/Fusstexte).
"use strict";

const express = require("express");
const svc = require("../services/documentTexts");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();
  const send = (res, p) => p
    .then((data) => res.json({ data }))
    .catch((e) => res.status(e?.status || 500).json({ error: e?.message || String(e) }));

  router.get("/", (req, res) =>
    send(res, svc.listTexts(supabase, { tenantId: req.tenantId, category: req.query.category ? String(req.query.category) : null })));

  router.post("/", requirePermission("settings.text_templates.edit"), (req, res) =>
    send(res, svc.createText(supabase, { tenantId: req.tenantId, body: req.body })));

  router.patch("/:id", requirePermission("settings.text_templates.edit"), (req, res) =>
    send(res, svc.updateText(supabase, { tenantId: req.tenantId, id: Number(req.params.id), body: req.body })));

  router.delete("/:id", requirePermission("settings.text_templates.edit"), (req, res) =>
    send(res, svc.deleteText(supabase, { tenantId: req.tenantId, id: Number(req.params.id) })));

  return router;
};
