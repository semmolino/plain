// Teil-/Schlussrechnung routes
// Base path: /api/final-invoices
"use strict";

const express = require("express");
const ctrl = require("../controllers/finalInvoices");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/:id/phases",      (req, res) => ctrl.getPhases(req, res, supabase));
  router.post("/:id/phases",     (req, res) => ctrl.savePhases(req, res, supabase));
  router.get("/:id/deductions",  (req, res) => ctrl.getDeductions(req, res, supabase));
  router.post("/:id/deductions", (req, res) => ctrl.saveDeductions(req, res, supabase));
  router.get("/:id",             (req, res) => ctrl.getFinalInvoice(req, res, supabase));
  router.post("/:id/book",       (req, res) => ctrl.bookFinalInvoice(req, res, supabase));

  return router;
};
