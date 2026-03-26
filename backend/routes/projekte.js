"use strict";

const express = require("express");
const ctrl = require("../controllers/projekte");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/statuses",                              (req, res) => ctrl.getStatuses(req, res, supabase));
  router.get("/types",                                 (req, res) => ctrl.getTypes(req, res, supabase));
  router.get("/managers",                              (req, res) => ctrl.getManagers(req, res, supabase));
  router.get("/employees/active",                      (req, res) => ctrl.getActiveEmployees(req, res, supabase));
  router.get("/roles/active",                          (req, res) => ctrl.getActiveRoles(req, res, supabase));
  router.post("/",                                     (req, res) => ctrl.createProject(req, res, supabase));
  router.get("/",                                      (req, res) => ctrl.listProjects(req, res, supabase));
  router.get("/list",                                  (req, res) => ctrl.listProjectsFull(req, res, supabase));
  router.patch("/:id",                                 (req, res) => ctrl.patchProject(req, res, supabase));
  router.get("/search",                                (req, res) => ctrl.searchProjects(req, res, supabase));
  router.get("/contracts/search",                      (req, res) => ctrl.searchContracts(req, res, supabase));
  router.get("/:id/structure",                         (req, res) => ctrl.getProjectStructure(req, res, supabase));
  router.patch("/structure/:id/completion-percents",   (req, res) => ctrl.patchStructureCompletionPercents(req, res, supabase));
  router.post("/:id/progress-snapshot",                (req, res) => ctrl.progressSnapshot(req, res, supabase));
  router.get("/structure/:id/tec-sum",                 (req, res) => ctrl.getTecSum(req, res, supabase));
  router.post("/:id/structure",                        (req, res) => ctrl.createStructureNode(req, res, supabase));
  router.patch("/structure/:id",                       (req, res) => ctrl.patchStructure(req, res, supabase));
  router.patch("/structure/:id/inherit",               (req, res) => ctrl.inheritStructure(req, res, supabase));
  router.patch("/structure/:id/move",                  (req, res) => ctrl.moveStructure(req, res, supabase));
  router.delete("/structure/:id",                      (req, res) => ctrl.deleteStructure(req, res, supabase));

  return router;
};
