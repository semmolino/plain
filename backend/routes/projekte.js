"use strict";

const express = require("express");
const ctrl = require("../controllers/projekte");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // Phase 2: alle projekte-Routes ausser den reinen Stammdaten-Lookups
  // (departments, statuses, types, managers, employees/active, roles/active)
  // benoetigen projects.view. Lookups bleiben offen, weil sie auf dem
  // Dashboard und in Wizards anderer Module gebraucht werden.
  const VIEW_GUARD = requirePermission("projects.view");
  const lookupPaths = new Set([
    "/departments","/statuses","/types","/managers","/employees/active","/roles/active",
  ]);
  router.use((req, res, next) => {
    if (lookupPaths.has(req.path)) return next();
    return VIEW_GUARD(req, res, next);
  });

  router.get("/departments",                           (req, res) => ctrl.getDepartments(req, res, supabase));
  router.get("/statuses",                              (req, res) => ctrl.getStatuses(req, res, supabase));
  router.get("/types",                                 (req, res) => ctrl.getTypes(req, res, supabase));
  router.get("/managers",                              (req, res) => ctrl.getManagers(req, res, supabase));
  router.get("/employees/active",                      (req, res) => ctrl.getActiveEmployees(req, res, supabase));
  router.get("/roles/active",                          (req, res) => ctrl.getActiveRoles(req, res, supabase));

  router.post("/",                                     requirePermission("projects.create"), (req, res) => ctrl.createProject(req, res, supabase));
  router.get("/",                                      (req, res) => ctrl.listProjects(req, res, supabase));
  router.get("/list",                                  (req, res) => ctrl.listProjectsFull(req, res, supabase));

  // Static paths MUST come before /:id-style dynamic routes
  router.get("/search",                                (req, res) => ctrl.searchProjects(req, res, supabase));
  router.get("/contracts/search",                      (req, res) => ctrl.searchContracts(req, res, supabase));
  router.patch("/contract/:id",                        requirePermission("projects.contracts.edit"), (req, res) => ctrl.patchContract(req, res, supabase));
  router.patch("/structure/:id/completion-percents",   requirePermission("projects.performance.edit"), (req, res) => ctrl.patchStructureCompletionPercents(req, res, supabase));
  router.get("/structure/:id/tec-sum",                 (req, res) => ctrl.getTecSum(req, res, supabase));
  router.get("/structure/:id/child-check",             (req, res) => ctrl.checkParentForChild(req, res, supabase));
  router.post("/structure/:id/transfer-to-child",      requirePermission("projects.structure.edit"), (req, res) => ctrl.transferFatherToChild(req, res, supabase));
  router.patch("/structure/:id/inherit",               requirePermission("projects.structure.edit"), (req, res) => ctrl.inheritStructure(req, res, supabase));
  router.patch("/structure/:id/move",                  requirePermission("projects.structure.edit"), (req, res) => ctrl.moveStructure(req, res, supabase));
  router.patch("/structure/:id",                       requirePermission("projects.structure.edit"), (req, res) => ctrl.patchStructure(req, res, supabase));
  router.delete("/structure/:id",                      requirePermission("projects.structure.edit"), (req, res) => ctrl.deleteStructure(req, res, supabase));

  // Project-scoped routes
  router.get("/:id/structure",                         (req, res) => ctrl.getProjectStructure(req, res, supabase));
  router.post("/:id/structure",                        requirePermission("projects.structure.edit"), (req, res) => ctrl.createStructureNode(req, res, supabase));
  router.post("/:id/progress-snapshot",                requirePermission("projects.performance.snapshot"), (req, res) => ctrl.progressSnapshot(req, res, supabase));
  router.get("/:id/leistungsstand",                    (req, res) => ctrl.getLeistungsstand(req, res, supabase));
  router.post("/:id/leistungsstand",                   requirePermission("projects.performance.edit"), (req, res) => ctrl.saveLeistungsstand(req, res, supabase));
  router.get("/:id/contract",                          (req, res) => ctrl.getContractByProject(req, res, supabase));
  router.post("/:id/copy",                             requirePermission("projects.create"), (req, res) => ctrl.copyProject(req, res, supabase));
  router.patch("/:id/internal-cascade",                requirePermission("projects.edit"), (req, res) => ctrl.patchProjectInternalCascade(req, res, supabase));

  // Single-project /:id endpoints — LAST among GET/PATCH/DELETE
  router.get("/:id",                                   (req, res) => ctrl.getProject(req, res, supabase));
  router.patch("/:id",                                 requirePermission("projects.edit"),   (req, res) => ctrl.patchProject(req, res, supabase));
  router.delete("/:id",                                requirePermission("projects.delete"), (req, res) => ctrl.deleteProject(req, res, supabase));

  return router;
};
