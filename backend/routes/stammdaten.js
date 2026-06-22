"use strict";

const express = require("express");
const ctrl = require("../controllers/stammdaten");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  router.post("/status",                                             requirePermission("settings.basedata.edit"), (req, res) => ctrl.postStatus(req, res, supabase));
  router.post("/typ",                                                requirePermission("settings.basedata.edit"), (req, res) => ctrl.postTyp(req, res, supabase));
  router.patch("/typ/:id",                                           requirePermission("settings.basedata.edit"), (req, res) => ctrl.patchTyp(req, res, supabase));
  router.delete("/typ/:id",                                          requirePermission("settings.basedata.edit"), (req, res) => ctrl.deleteTyp(req, res, supabase));
  router.get("/typen",                                               (req, res) => ctrl.getTypen(req, res, supabase));
  router.post("/department",                                         requirePermission("settings.basedata.edit"), (req, res) => ctrl.postDepartment(req, res, supabase));
  router.get("/departments",                                         (req, res) => ctrl.getDepartments(req, res, supabase));
  router.patch("/department/:id",                                    requirePermission("settings.basedata.edit"), (req, res) => ctrl.patchDepartment(req, res, supabase));
  router.delete("/department/:id",                                   requirePermission("settings.basedata.edit"), (req, res) => ctrl.deleteDepartment(req, res, supabase));
  router.get("/countries",                                           (req, res) => ctrl.getCountries(req, res, supabase));
  router.get("/billing-types",                                       (req, res) => ctrl.getBillingTypes(req, res, supabase));
  router.get("/fee-groups",                                          (req, res) => ctrl.getFeeGroups(req, res, supabase));
  router.get("/fee-masters",                                         (req, res) => ctrl.getFeeMasters(req, res, supabase));
  router.get("/fee-zones",                                           (req, res) => ctrl.getFeeZones(req, res, supabase));
  router.get("/fee-calculation-masters",                               (req, res) => ctrl.listFeeCalcMasters(req, res, supabase));
  router.post("/fee-calculation-masters/init",                        requirePermission("projects.calculations.edit"), (req, res) => ctrl.postFeeCalcMasterInit(req, res, supabase));
  router.get("/fee-surcharges-global",                                (req, res) => ctrl.listFeeSurchargesGlobal(req, res, supabase));
  router.get("/fee-calculation-masters/:id/surcharges",               (req, res) => ctrl.listFeeCalcSurcharges(req, res, supabase));
  router.post("/fee-calculation-masters/:id/surcharges/save",         requirePermission("projects.calculations.edit"), (req, res) => ctrl.saveFeeCalcSurcharges(req, res, supabase));
  router.get("/fee-calculation-masters/:id/bl",                       (req, res) => ctrl.listFeeCalcBl(req, res, supabase));
  router.post("/fee-calculation-masters/:id/bl/save",                 requirePermission("projects.calculations.edit"), (req, res) => ctrl.saveFeeCalcBl(req, res, supabase));
  router.get("/fee-calculation-masters/:id/pdf",                      (req, res) => ctrl.getHonorarPdf(req, res, supabase));
  router.get("/fee-calculation-masters/:id",                          (req, res) => ctrl.getFeeCalcMasterDetail(req, res, supabase));
  router.patch("/fee-calculation-masters/:id/basis",                  requirePermission("projects.calculations.edit"), (req, res) => ctrl.patchFeeCalcMasterBasis(req, res, supabase));
  router.post("/fee-calculation-masters/:id/phases/init",             requirePermission("projects.calculations.edit"), (req, res) => ctrl.postFeeCalcPhasesInit(req, res, supabase));
  router.patch("/fee-calculation-phases/:id",                         requirePermission("projects.calculations.edit"), (req, res) => ctrl.patchFeeCalcPhase(req, res, supabase));
  router.post("/fee-calculation-masters/:id/phases/save",             requirePermission("projects.calculations.edit"), (req, res) => ctrl.postFeeCalcPhasesSave(req, res, supabase));
  router.delete("/fee-calculation-masters/:id",                       requirePermission("projects.calculations.delete"), (req, res) => ctrl.deleteFeeCalcMaster(req, res, supabase));
  router.post("/fee-calculation-masters/:id/add-to-project-structure", requirePermission("projects.calculations.edit"), (req, res) => ctrl.postFeeCalcAddToStructure(req, res, supabase));
  router.post("/fee-calculation-masters/:id/add-to-offer-structure",   requirePermission("projects.calculations.edit"), (req, res) => ctrl.postFeeCalcAddToOfferStructure(req, res, supabase));
  router.post("/fee-calculation-masters/:id/sync-to-structure",        requirePermission("projects.calculations.edit"), (req, res) => ctrl.syncFeeCalcToStructure(req, res, supabase));
  router.get("/companies",                                           (req, res) => ctrl.getCompanies(req, res, supabase));
  router.post("/company",                                            requirePermission("settings.company.edit"), (req, res) => ctrl.postCompany(req, res, supabase));
  router.put("/company/:id",                                         requirePermission("settings.company.edit"), (req, res) => ctrl.putCompany(req, res, supabase));
  router.get("/companies/:id/assets",                                (req, res) => ctrl.getCompanyAssets(req, res, supabase));
  router.put("/companies/:id/logo",                                  requirePermission("settings.company.edit"), (req, res) => ctrl.putCompanyLogo(req, res, supabase));
  router.put("/companies/:id/signature",                             requirePermission("settings.company.edit"), (req, res) => ctrl.putCompanySignature(req, res, supabase));
  router.post("/address",                                            requirePermission("addresses.create"), (req, res) => ctrl.postAddress(req, res, supabase));
  router.post("/rollen",                                             requirePermission("settings.basedata.edit"), (req, res) => ctrl.postRollen(req, res, supabase));
  router.get("/rollen",                                              (req, res) => ctrl.getRollen(req, res, supabase));
  router.patch("/rolle/:id",                                         requirePermission("settings.basedata.edit"), (req, res) => ctrl.patchRolle(req, res, supabase));
  router.delete("/rolle/:id",                                        requirePermission("settings.basedata.edit"), (req, res) => ctrl.deleteRolle(req, res, supabase));
  router.get("/logo",                                                (req, res) => ctrl.getLogo(req, res, supabase));
  router.put("/logo",                                                requirePermission("settings.company.edit"), (req, res) => ctrl.putLogo(req, res, supabase));
  router.get("/salutations",                                         (req, res) => ctrl.getSalutations(req, res, supabase));
  router.get("/genders",                                             (req, res) => ctrl.getGenders(req, res, supabase));
  router.get("/addresses/search",                                    requirePermission("addresses.view"),   (req, res) => ctrl.searchAddresses(req, res, supabase));
  router.get("/addresses/list",                                      requirePermission("addresses.view"),   (req, res) => ctrl.listAddresses(req, res, supabase));
  router.patch("/addresses/:id",                                     requirePermission("addresses.edit"),   (req, res) => ctrl.patchAddress(req, res, supabase));
  router.delete("/addresses/:id",                                    requirePermission("addresses.delete"), (req, res) => ctrl.deleteAddress(req, res, supabase));
  router.get("/contacts/search",                                     requirePermission("addresses.contacts.view"), (req, res) => ctrl.searchContacts(req, res, supabase));
  router.get("/contacts/by-address",                                 requirePermission("addresses.contacts.view"), (req, res) => ctrl.getContactsByAddress(req, res, supabase));
  router.get("/contacts/list",                                       requirePermission("addresses.contacts.view"), (req, res) => ctrl.listContacts(req, res, supabase));
  router.patch("/contacts/:id",                                      requirePermission("addresses.contacts.edit"),   (req, res) => ctrl.patchContact(req, res, supabase));
  router.delete("/contacts/:id",                                     requirePermission("addresses.contacts.delete"), (req, res) => ctrl.deleteContact(req, res, supabase));
  router.get("/vat/search",                                          (req, res) => ctrl.searchVat(req, res, supabase));
  router.get("/vat",                                                 (req, res) => ctrl.getVat(req, res, supabase));
  router.get("/currencies",                                          (req, res) => ctrl.getCurrencies(req, res, supabase));
  router.get("/defaults",                                            (req, res) => ctrl.getDefaults(req, res, supabase));
  router.put("/defaults",                                            requirePermission("settings.defaults.edit"), (req, res) => ctrl.putDefault(req, res, supabase));
  router.get("/payment-means/search",                                (req, res) => ctrl.searchPaymentMeans(req, res, supabase));

  // Setup-Progress (Aggregat fuer Dashboard-Checkliste)
  router.get("/setup-progress",                                      async (req, res) => {
    try {
      const svc = require("../services/setupProgress");
      const r = await svc.computeSetupProgress(supabase, { tenantId: req.tenantId, employeeId: req.employeeId, hasFeature: req.hasFeature });
      res.json({ data: r });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });
  router.post("/contacts",                                           requirePermission("addresses.contacts.create"), (req, res) => ctrl.postContact(req, res, supabase));

  router.get("/monatsabschluss",                                     (req, res) => ctrl.getMonatsabschluss(req, res, supabase));
  router.put("/monatsabschluss",                                     requirePermission("settings.monthly_close.edit"), (req, res) => ctrl.putMonatsabschluss(req, res, supabase));
  router.post("/monatsabschluss/run",                                requirePermission("settings.monthly_close.edit"), (req, res) => ctrl.runMonatsabschlussNow(req, res, supabase));
  router.get("/monatsabschluss/pdf",                                 (req, res) => ctrl.getMonatsabschlussPdf(req, res, supabase));

  // Working-time models
  router.get("/working-time-models/country-states",                  (req, res) => ctrl.getCountryStates(req, res, supabase));
  router.get("/working-time-models",                                  (req, res) => ctrl.getWorkingTimeModels(req, res, supabase));
  router.post("/working-time-models",                                 requirePermission("settings.work_time.edit"), (req, res) => ctrl.postWorkingTimeModel(req, res, supabase));
  router.patch("/working-time-models/:id",                            requirePermission("settings.work_time.edit"), (req, res) => ctrl.patchWorkingTimeModel(req, res, supabase));
  router.delete("/working-time-models/:id",                           requirePermission("settings.work_time.edit"), (req, res) => ctrl.deleteWorkingTimeModel(req, res, supabase));

  return router;
};
