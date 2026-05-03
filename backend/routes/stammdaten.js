"use strict";

const express = require("express");
const ctrl = require("../controllers/stammdaten");

module.exports = (supabase) => {
  const router = express.Router();

  router.post("/status",                                             (req, res) => ctrl.postStatus(req, res, supabase));
  router.post("/typ",                                                (req, res) => ctrl.postTyp(req, res, supabase));
  router.get("/countries",                                           (req, res) => ctrl.getCountries(req, res, supabase));
  router.get("/billing-types",                                       (req, res) => ctrl.getBillingTypes(req, res, supabase));
  router.get("/fee-groups",                                          (req, res) => ctrl.getFeeGroups(req, res, supabase));
  router.get("/fee-masters",                                         (req, res) => ctrl.getFeeMasters(req, res, supabase));
  router.get("/fee-zones",                                           (req, res) => ctrl.getFeeZones(req, res, supabase));
  router.post("/fee-calculation-masters/init",                       (req, res) => ctrl.postFeeCalcMasterInit(req, res, supabase));
  router.patch("/fee-calculation-masters/:id/basis",                 (req, res) => ctrl.patchFeeCalcMasterBasis(req, res, supabase));
  router.post("/fee-calculation-masters/:id/phases/init",            (req, res) => ctrl.postFeeCalcPhasesInit(req, res, supabase));
  router.patch("/fee-calculation-phases/:id",                        (req, res) => ctrl.patchFeeCalcPhase(req, res, supabase));
  router.post("/fee-calculation-masters/:id/phases/save",            (req, res) => ctrl.postFeeCalcPhasesSave(req, res, supabase));
  router.delete("/fee-calculation-masters/:id",                      (req, res) => ctrl.deleteFeeCalcMaster(req, res, supabase));
  router.post("/fee-calculation-masters/:id/add-to-project-structure", (req, res) => ctrl.postFeeCalcAddToStructure(req, res, supabase));
  router.get("/companies",                                           (req, res) => ctrl.getCompanies(req, res, supabase));
  router.post("/company",                                            (req, res) => ctrl.postCompany(req, res, supabase));
  router.post("/address",                                            (req, res) => ctrl.postAddress(req, res, supabase));
  router.post("/rollen",                                             (req, res) => ctrl.postRollen(req, res, supabase));
  router.get("/salutations",                                         (req, res) => ctrl.getSalutations(req, res, supabase));
  router.get("/genders",                                             (req, res) => ctrl.getGenders(req, res, supabase));
  router.get("/addresses/search",                                    (req, res) => ctrl.searchAddresses(req, res, supabase));
  router.get("/addresses/list",                                      (req, res) => ctrl.listAddresses(req, res, supabase));
  router.patch("/addresses/:id",                                     (req, res) => ctrl.patchAddress(req, res, supabase));
  router.get("/contacts/search",                                     (req, res) => ctrl.searchContacts(req, res, supabase));
  router.get("/contacts/by-address",                                 (req, res) => ctrl.getContactsByAddress(req, res, supabase));
  router.get("/contacts/list",                                       (req, res) => ctrl.listContacts(req, res, supabase));
  router.patch("/contacts/:id",                                      (req, res) => ctrl.patchContact(req, res, supabase));
  router.get("/vat/search",                                          (req, res) => ctrl.searchVat(req, res, supabase));
  router.get("/vat",                                                 (req, res) => ctrl.getVat(req, res, supabase));
  router.get("/currencies",                                          (req, res) => ctrl.getCurrencies(req, res, supabase));
  router.get("/defaults",                                            (req, res) => ctrl.getDefaults(req, res, supabase));
  router.put("/defaults",                                            (req, res) => ctrl.putDefault(req, res, supabase));
  router.get("/payment-means/search",                                (req, res) => ctrl.searchPaymentMeans(req, res, supabase));
  router.post("/contacts",                                           (req, res) => ctrl.postContact(req, res, supabase));

  return router;
};
