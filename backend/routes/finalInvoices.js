// Teil-/Schlussrechnung routes
// Base path: /api/final-invoices
"use strict";

const express = require("express");
const ctrl = require("../controllers/finalInvoices");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // Phase 2: final-invoices = Teil-/Schlussrechnungen → invoices.view
  router.use(requirePermission("invoices.view"));

  router.get("/:id/phases",               (req, res) => ctrl.getPhases(req, res, supabase));
  router.post("/:id/phases",              requirePermission("invoices.edit"), (req, res) => ctrl.savePhases(req, res, supabase));
  router.get("/:id/deductions",           (req, res) => ctrl.getDeductions(req, res, supabase));
  router.post("/:id/deductions",          requirePermission("invoices.edit"), (req, res) => ctrl.saveDeductions(req, res, supabase));
  router.get("/:id/einvoice/ubl",         requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoiceUbl(req, res, supabase));
  router.post("/:id/einvoice/ubl/snapshot", requirePermission("invoices.edit"), (req, res) => ctrl.postEinvoiceUblSnapshot(req, res, supabase));
  router.get("/:id/einvoice/cii",         requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoiceCii(req, res, supabase));
  router.post("/:id/einvoice/cii/snapshot", requirePermission("invoices.edit"), (req, res) => ctrl.postEinvoiceCiiSnapshot(req, res, supabase));
  router.get("/:id/einvoice/peppol",       requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoicePeppol(req, res, supabase));
  router.get("/:id",                      (req, res) => ctrl.getFinalInvoice(req, res, supabase));
  router.post("/:id/book",                requirePermission("invoices.book"), (req, res) => ctrl.bookFinalInvoice(req, res, supabase));

  return router;
};
