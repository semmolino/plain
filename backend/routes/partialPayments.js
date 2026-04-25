"use strict";

const express = require("express");
const ctrl = require("../controllers/partialPayments");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/",                              (req, res) => ctrl.listPartialPayments(req, res, supabase));
  router.post("/init",                         (req, res) => ctrl.initPartialPayment(req, res, supabase));
  router.patch("/:id",                         (req, res) => ctrl.patchPartialPayment(req, res, supabase));
  router.get("/:id/billing-proposal",          (req, res) => ctrl.getBillingProposal(req, res, supabase));
  router.put("/:id/performance",               (req, res) => ctrl.putPerformance(req, res, supabase));
  router.get("/:id/tec",                       (req, res) => ctrl.getTec(req, res, supabase));
  router.post("/:id/tec",                      (req, res) => ctrl.postTec(req, res, supabase));
  router.get("/:id/einvoice/ubl",              (req, res) => ctrl.getEinvoiceUbl(req, res, supabase));
  router.post("/:id/einvoice/ubl/snapshot",    (req, res) => ctrl.postEinvoiceUblSnapshot(req, res, supabase));
  router.get("/:id/einvoice/cii",              (req, res) => ctrl.getEinvoiceCii(req, res, supabase));
  router.post("/:id/einvoice/cii/snapshot",    (req, res) => ctrl.postEinvoiceCiiSnapshot(req, res, supabase));
  router.post("/:id/book",                     (req, res) => ctrl.bookPartialPayment(req, res, supabase));
  router.post("/:id/cancel",                   (req, res) => ctrl.cancelPartialPayment(req, res, supabase));
  router.delete("/:id",                        (req, res) => ctrl.deletePartialPayment(req, res, supabase));
  router.get("/:id/pdf",                       (req, res) => ctrl.getPdf(req, res, supabase));
  router.get("/:id",                           (req, res) => ctrl.getPartialPayment(req, res, supabase));

  return router;
};
