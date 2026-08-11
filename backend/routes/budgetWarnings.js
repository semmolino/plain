'use strict';

const express = require('express');
const ctrl = require('../controllers/budgetWarnings');
const { requirePermission } = require('../middleware/permissions');

module.exports = (supabase) => {
  const router = express.Router();

  // Diese Datei trug bisher gar keine Gates: jede gueltige Sitzung konnte
  // Budgetregeln fremder Projekte lesen, aendern und loeschen — und die
  // Ueberwachung stummschalten, was genau die Manipulationen verdeckt haette,
  // die sie melden soll (Pentest 2026-08-06).
  //
  // Es gibt bereits passende Permissions aus Migration 0062; eine neue ist
  // nicht noetig.

  // Projekt-Overview (Aggregat + Regeln + Fired-History)
  router.get   ('/projects/:projectId',         requirePermission('projects.budget.view'), (req, res) => ctrl.getOverview(req, res, supabase));
  router.put   ('/projects/:projectId/mute',    requirePermission('projects.budget.edit'), (req, res) => ctrl.setProjectMute(req, res, supabase));

  // Regel-CRUD
  router.post  ('/projects/:projectId/rules',   requirePermission('projects.budget.edit'), (req, res) => ctrl.createRule(req, res, supabase));
  router.put   ('/rules/:ruleId',               requirePermission('projects.budget.edit'), (req, res) => ctrl.updateRule(req, res, supabase));
  router.delete('/rules/:ruleId',               requirePermission('projects.budget.edit'), (req, res) => ctrl.deleteRule(req, res, supabase));

  return router;
};
