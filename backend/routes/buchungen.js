"use strict";

const express = require("express");
const ctrl = require("../controllers/buchungen");

module.exports = (supabase) => {
  const router = express.Router();

  router.post("/",                    (req, res) => ctrl.createBuchung(req, res, supabase));
  router.patch("/:id",               (req, res) => ctrl.patchBuchung(req, res, supabase));
  router.delete("/:id",              (req, res) => ctrl.deleteBuchung(req, res, supabase));
  router.get("/project/:id",         (req, res) => ctrl.listBuchungenByProject(req, res, supabase));
  router.post("/timer/draft",        (req, res) => ctrl.createTimerDraft(req, res, supabase));
  router.get("/timer/drafts",        (req, res) => ctrl.listDraftsByEmployee(req, res, supabase));
  router.post("/timer/confirm",      (req, res) => ctrl.confirmDrafts(req, res, supabase));
  router.delete("/timer/draft/:id",  (req, res) => ctrl.deleteDraft(req, res, supabase));
  router.patch("/timer/draft/:id",   (req, res) => ctrl.patchDraftDescription(req, res, supabase));

  return router;
};
