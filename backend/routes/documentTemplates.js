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
  // Katalog (Belegarten, Bausteine, Platzhalter): statische Beschreibung, die
  // auch Textbausteine und Rechnungsassistent brauchen — vor dem Vorlagen-Recht.
  router.get("/catalog", (req, res) => ctrl.getCatalog(req, res, supabase));
  // Namen der Varianten — die Auswahl je Beleg im Rechnungsassistenten braucht sie
  router.get("/variants", (req, res) => ctrl.listVariants(req, res, supabase));

  router.use(requirePermission("settings.document_templates.edit"));

  router.post("/variants",          (req, res) => ctrl.createVariant(req, res, supabase));
  router.get("/variants/:id",       (req, res) => ctrl.getVariant(req, res, supabase));
  router.put("/variants/:id",       (req, res) => ctrl.saveVariant(req, res, supabase));
  router.delete("/variants/:id",    (req, res) => ctrl.archiveVariant(req, res, supabase));
  // Vorschau mit Beispielbeleg als PDF — Seitenansicht und „Als PDF ansehen".
  // Bis 10/2026 gab es daneben POST /preview mit dem HTML; das ist randlos,
  // die Seitenraender setzt erst der PDF-Druck („/pdf" zaehlt im Limiter als teuer).
  router.post("/preview/pdf",       (req, res) => ctrl.previewDocumentTemplatePdf(req, res, supabase));
  router.get("/branding",           (req, res) => ctrl.getBranding(req, res, supabase));
  router.put("/branding",           (req, res) => ctrl.saveBranding(req, res, supabase));
  router.get("/",                   (req, res) => ctrl.listDocumentTemplates(req, res, supabase));
  router.post("/",                  (req, res) => ctrl.createDocumentTemplate(req, res, supabase));
  router.patch("/:id",              (req, res) => ctrl.patchDocumentTemplate(req, res, supabase));
  router.post("/:id/duplicate",     (req, res) => ctrl.duplicateDocumentTemplate(req, res, supabase));
  router.post("/:id/publish",       (req, res) => ctrl.publishDocumentTemplate(req, res, supabase));
  router.post("/:id/archive",       (req, res) => ctrl.archiveDocumentTemplate(req, res, supabase));
  router.post("/:id/set-default",   (req, res) => ctrl.setDefaultDocumentTemplate(req, res, supabase));

  return router;
};
