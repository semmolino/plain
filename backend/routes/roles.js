"use strict";

const express = require("express");
const ctrl = require("../controllers/roles");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // /api/v1/permissions
  router.get("/permissions/me",        (req, res) => ctrl.getMyPermissions(req, res, supabase));
  router.get("/permissions",           requirePermission("roles.view"), (req, res) => ctrl.listPermissions(req, res, supabase));

  // /api/v1/roles
  router.get   ("/roles",              requirePermission("roles.view"),   (req, res) => ctrl.listRoles(req, res, supabase));
  router.get   ("/roles/employees",    requirePermission("roles.view"),   (req, res) => ctrl.listEmployeeRoleMap(req, res, supabase));
  router.get   ("/roles/:id",          requirePermission("roles.view"),   (req, res) => ctrl.getRole(req, res, supabase));
  router.post  ("/roles",              requirePermission("roles.create"), (req, res) => ctrl.createRole(req, res, supabase));
  router.patch ("/roles/:id",          requirePermission("roles.edit"),   (req, res) => ctrl.patchRole(req, res, supabase));
  router.delete("/roles/:id",          requirePermission("roles.delete"), (req, res) => ctrl.deleteRole(req, res, supabase));

  // /api/v1/employees/:id/roles
  router.put   ("/employees/:id/roles", requirePermission("employees.role.assign"), (req, res) => ctrl.setEmployeeRoles(req, res, supabase));

  return router;
};
