'use strict';

const express = require('express');
const ctrl = require('../controllers/arbzg');
const { requirePermission } = require('../middleware/permissions');

const hasPerm = (req, k) => (typeof req.hasPermission === 'function' ? req.hasPermission(k) : false);

/**
 * Eigene Daten immer; fremde nur mit einem der Rechte (Runde 10). Vorher waren
 * Audit und Export ohne jedes Recht lesbar — Verstoesse aller Mitarbeiter des
 * Mandanten samt Details —, und Grenzen/Vorpruefung verrieten Modell und
 * gebuchte Stunden eines anderen fuer einen Tag.
 */
function ownOr(pick, ...keys) {
  return (req, res, next) => {
    const target = Number(pick(req));
    if (target && target === req.employeeId) return next();
    if (keys.some(k => hasPerm(req, k))) return next();
    return res.status(403).json({ error: `Fehlende Berechtigung (eine von): ${keys.join(', ')}` });
  };
}

module.exports = (supabase) => {
  const router = express.Router();
  // Wer fuer andere buchen darf, braucht deren Grenzen im Buchungsdialog.
  const LIMITS_GUARD = (pick) => ownOr(pick, 'employees.bookings.view_all', 'projects.bookings.create');
  const AUDIT_GUARD  = ownOr(req => req.query.employee_id, 'employees.bookings.view_all');

  // Settings (tenant-weit)
  router.get ('/settings',                (req, res) => ctrl.getSettings(req, res, supabase));
  router.put ('/settings',                requirePermission('settings.work_time.edit'), (req, res) => ctrl.saveSettings(req, res, supabase));

  // Aktives Modell + Pausenregel für einen Mitarbeiter
  router.get ('/limits/:employeeId',      LIMITS_GUARD(req => req.params.employeeId), (req, res) => ctrl.getLimits(req, res, supabase));

  // Live-Validierung (kein Schreibvorgang)
  router.post('/preflight',               LIMITS_GUARD(req => req.body?.employee_id), (req, res) => ctrl.preflight(req, res, supabase));

  // Audit
  router.get ('/audit',                   AUDIT_GUARD, (req, res) => ctrl.listAudit(req, res, supabase));
  router.get ('/audit/export',            AUDIT_GUARD, (req, res) => ctrl.exportAudit(req, res, supabase));

  // Pausenregeln-CRUD
  router.get ('/break-rules',             (req, res) => ctrl.listBreakRules(req, res, supabase));
  router.put ('/break-rules',             requirePermission('settings.work_time.edit'), (req, res) => ctrl.upsertBreakRule(req, res, supabase));
  router.delete('/break-rules/:id',       requirePermission('settings.work_time.edit'), (req, res) => ctrl.deleteBreakRule(req, res, supabase));

  return router;
};
