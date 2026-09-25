"use strict";

const express = require("express");
const ctrl = require("../controllers/buchungen");
const bookingTypesCtrl = require("../controllers/bookingTypes");
const textSnippetsCtrl = require("../controllers/textSnippets");
const { requirePermission, requireAnyPermission } = require("../middleware/permissions");

// „Eigene Zeit buchen" (projects.bookings.own, Migration 0169) oeffnet die
// Buchungswege fuer die eigene Person; was genau erlaubt ist, entscheidet der
// Controller (ownOnly): nur fuer sich selbst, Saetze vom Server, nur eigene
// unabgerechnete Buchungen in offenen Monaten.
const OWN = "projects.bookings.own";

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/booking-types",        requirePermission("projects.bookings.view"),          (req, res) => bookingTypesCtrl.listSelectable(req, res, supabase));
  router.post("/booking-types",       requirePermission("projects.hourly_rates.edit"),      (req, res) => bookingTypesCtrl.createProjectType(req, res, supabase));
  router.delete("/booking-types/:id", requirePermission("projects.hourly_rates.edit"),      (req, res) => bookingTypesCtrl.deleteProjectType(req, res, supabase));
  router.get("/booking-prices",       requirePermission("projects.hourly_rates.view"),      (req, res) => bookingTypesCtrl.listProjectPrices(req, res, supabase));
  router.put("/booking-prices",       requirePermission("projects.hourly_rates.edit"),      (req, res) => bookingTypesCtrl.upsertProjectPrice(req, res, supabase));
  router.post("/special",             requirePermission("projects.bookings.special.create"), (req, res) => ctrl.createSpecialBuchung(req, res, supabase));
  router.patch("/special/:id",        requirePermission("projects.bookings.edit"),           (req, res) => ctrl.updateSpecialBuchung(req, res, supabase));
  // Schlanke Auswahlliste fuer „Eigene Zeit buchen" — ohne Betraege, statt projects.view.
  // Eigene Buchungen — ohne eigenes Recht, der Mitarbeiter kommt aus der Sitzung.
  router.get("/mine",                         (req, res) => ctrl.listMine(req, res, supabase));
  router.get("/eigen/projekte",               requireAnyPermission("projects.bookings.create", OWN), (req, res) => ctrl.listOwnProjects(req, res, supabase));
  router.get("/eigen/projekte/:id/leistungen", requireAnyPermission("projects.bookings.create", OWN), (req, res) => ctrl.listOwnLeaves(req, res, supabase));
  router.post("/",                    requireAnyPermission("projects.bookings.create", OWN), (req, res) => ctrl.createBuchung(req, res, supabase));
  router.patch("/:id",                requireAnyPermission("projects.bookings.edit", OWN),   (req, res) => ctrl.patchBuchung(req, res, supabase));
  router.delete("/:id",               requireAnyPermission("projects.bookings.delete", OWN), (req, res) => ctrl.deleteBuchung(req, res, supabase));
  // Umbuchen steht unter einem EIGENEN Recht, nicht unter bookings.edit: es
  // verschiebt Kosten und Erloes zwischen zwei Projekten, ohne dass sich eine
  // Zahl aendert und jemandem auffaellt (Migration 0139). Die Vorschau tragt
  // dasselbe Gate — sie beantwortet, welche Buchungen gesperrt sind und
  // welcher Stundensatz sich aendert, und das ist keine oeffentliche Auskunft.
  router.post("/umbuchen/vorschau", requirePermission("projects.bookings.rebook"), (req, res) => ctrl.previewRebook(req, res, supabase));
  router.post("/umbuchen",          requirePermission("projects.bookings.rebook"), (req, res) => ctrl.rebook(req, res, supabase));
  router.get("/project/:id",          requirePermission("projects.bookings.view"),   (req, res) => ctrl.listBuchungenByProject(req, res, supabase));
  // Die Timer-Endpunkte trugen bisher KEIN Gate, obwohl ihre Zwillinge direkt
  // darueber (POST /, PATCH /:id, DELETE /:id) eines haben. Ein Nutzer mit der
  // Default-Rolle "Mitarbeiter" — die laut Migration 0062 nur dashboard.view
  // und addresses.view besitzt — konnte darueber Zeitbuchungen anlegen,
  // bestaetigen, aendern und loeschen (Pentest 2026-08-06).
  //
  // Dieselben Permissions wie bei den regulaeren Buchungen: ein Entwurf wird
  // durch /timer/confirm zu einer abrechnungsrelevanten Buchung.
  // Die Stempeluhr ist immer „eigene Zeit": Entwuerfe tragen die Sitzung als
  // Mitarbeiter, Lesen/Bestaetigen fremder nur mit employees.bookings.view_all.
  router.post("/timer/draft",        requireAnyPermission("projects.bookings.create", OWN), (req, res) => ctrl.createTimerDraft(req, res, supabase));
  router.get("/timer/drafts",        requireAnyPermission("projects.bookings.view", OWN),   (req, res) => ctrl.listDraftsByEmployee(req, res, supabase));
  router.post("/timer/confirm",      requireAnyPermission("projects.bookings.create", OWN), (req, res) => ctrl.confirmDrafts(req, res, supabase));
  router.delete("/timer/draft/:id",  requireAnyPermission("projects.bookings.delete", OWN), (req, res) => ctrl.deleteDraft(req, res, supabase));
  router.patch("/timer/draft/:id",   requireAnyPermission("projects.bookings.edit", OWN),   (req, res) => ctrl.patchDraftDescription(req, res, supabase));
  router.get("/workstart-status",    (req, res) => ctrl.getWorkstartStatus(req, res, supabase));

  // Persönliche Buchungstexte (Textbausteine) — jeweils nur die eigenen.
  router.get("/text-snippets",        (req, res) => textSnippetsCtrl.list(req, res, supabase));
  router.post("/text-snippets",       (req, res) => textSnippetsCtrl.create(req, res, supabase));
  router.patch("/text-snippets/:id",  (req, res) => textSnippetsCtrl.update(req, res, supabase));
  router.delete("/text-snippets/:id", (req, res) => textSnippetsCtrl.remove(req, res, supabase));

  return router;
};
