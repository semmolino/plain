'use strict';

const express = require('express');
const ctrl = require('../controllers/arbzg');
const { requirePermission } = require('../middleware/permissions');

module.exports = (supabase) => {
  const router = express.Router();

  // Settings (tenant-weit)
  router.get ('/settings',                (req, res) => ctrl.getSettings(req, res, supabase));
  router.put ('/settings',                requirePermission('settings.work_time.edit'), (req, res) => ctrl.saveSettings(req, res, supabase));

  // Aktives Modell + Pausenregel für einen Mitarbeiter
  router.get ('/limits/:employeeId',      (req, res) => ctrl.getLimits(req, res, supabase));

  // Live-Validierung (kein Schreibvorgang)
  router.post('/preflight',               (req, res) => ctrl.preflight(req, res, supabase));

  // Audit
  router.get ('/audit',                   (req, res) => ctrl.listAudit(req, res, supabase));
  router.get ('/audit/export',            (req, res) => ctrl.exportAudit(req, res, supabase));

  // Pausenregeln-CRUD
  router.get ('/break-rules',             (req, res) => ctrl.listBreakRules(req, res, supabase));
  router.put ('/break-rules',             requirePermission('settings.work_time.edit'), (req, res) => ctrl.upsertBreakRule(req, res, supabase));
  router.delete('/break-rules/:id',       requirePermission('settings.work_time.edit'), (req, res) => ctrl.deleteBreakRule(req, res, supabase));

  return router;
};
