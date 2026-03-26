"use strict";

const express = require("express");
const ctrl = require("../controllers/documentTemplates");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/",                   (req, res) => ctrl.listDocumentTemplates(req, res, supabase));
  router.post("/",                  (req, res) => ctrl.createDocumentTemplate(req, res, supabase));
  router.patch("/:id",              (req, res) => ctrl.patchDocumentTemplate(req, res, supabase));
  router.post("/:id/duplicate",     (req, res) => ctrl.duplicateDocumentTemplate(req, res, supabase));
  router.post("/:id/publish",       (req, res) => ctrl.publishDocumentTemplate(req, res, supabase));
  router.post("/:id/archive",       (req, res) => ctrl.archiveDocumentTemplate(req, res, supabase));
  router.post("/:id/set-default",   (req, res) => ctrl.setDefaultDocumentTemplate(req, res, supabase));

  return router;
};
