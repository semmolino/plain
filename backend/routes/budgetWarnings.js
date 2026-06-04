'use strict';

const express = require('express');
const ctrl = require('../controllers/budgetWarnings');

module.exports = (supabase) => {
  const router = express.Router();

  // Projekt-Overview (Aggregat + Regeln + Fired-History)
  router.get   ('/projects/:projectId',         (req, res) => ctrl.getOverview(req, res, supabase));
  router.put   ('/projects/:projectId/mute',    (req, res) => ctrl.setProjectMute(req, res, supabase));

  // Regel-CRUD
  router.post  ('/projects/:projectId/rules',   (req, res) => ctrl.createRule(req, res, supabase));
  router.put   ('/rules/:ruleId',               (req, res) => ctrl.updateRule(req, res, supabase));
  router.delete('/rules/:ruleId',               (req, res) => ctrl.deleteRule(req, res, supabase));

  return router;
};
