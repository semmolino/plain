"use strict";

const express = require("express");
const ctrl = require("../controllers/documentTemplates");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // Verwaltung der PDF-Vorlagen (Layout/Branding) -> eigene Konfigurations-Permission.
  // Hinweis: Das tatsaechliche PDF-Rendering liest DOCUMENT_TEMPLATE direkt im
  // Render-Service (services_pdf_render.js) und ist davon NICHT betroffen — normale
  // Nutzer koennen weiterhin PDFs erzeugen, nur die Vorlagen-Pflege ist gegated.
  router.use(requirePermission("settings.document_templates.edit"));

  router.get("/",                   (req, res) => ctrl.listDocumentTemplates(req, res, supabase));
  router.post("/",                  (req, res) => ctrl.createDocumentTemplate(req, res, supabase));
  router.patch("/:id",              (req, res) => ctrl.patchDocumentTemplate(req, res, supabase));
  router.post("/:id/duplicate",     (req, res) => ctrl.duplicateDocumentTemplate(req, res, supabase));
  router.post("/:id/publish",       (req, res) => ctrl.publishDocumentTemplate(req, res, supabase));
  router.post("/:id/archive",       (req, res) => ctrl.archiveDocumentTemplate(req, res, supabase));
  router.post("/:id/set-default",   (req, res) => ctrl.setDefaultDocumentTemplate(req, res, supabase));

  return router;
};
