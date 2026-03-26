"use strict";

const express = require("express");
const ctrl = require("../controllers/buchungen");

module.exports = (supabase) => {
  const router = express.Router();

  router.post("/",              (req, res) => ctrl.createBuchung(req, res, supabase));
  router.patch("/:id",          (req, res) => ctrl.patchBuchung(req, res, supabase));
  router.delete("/:id",         (req, res) => ctrl.deleteBuchung(req, res, supabase));
  router.get("/project/:id",    (req, res) => ctrl.listBuchungenByProject(req, res, supabase));

  return router;
};
