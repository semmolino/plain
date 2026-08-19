'use strict';

const express = require('express');
const ctrl    = require('../controllers/notificationConfig');
const { requirePermission } = require('../middleware/permissions');

module.exports = (supabase) => {
  const router = express.Router();

  router.get('/',           (req, res) => ctrl.listAll(req, res, supabase));
  // Selbstauskunft zur Zustellung. Legt Serverzeit, Zeitplaene und
  // Push-Zustand offen — dieselbe Permission wie die uebrige Konfiguration.
  router.get('/diagnose',   requirePermission('settings.notifications.edit'), (req, res) => ctrl.diagnose(req, res, supabase));
  router.put('/:typeKey',   requirePermission('settings.notifications.edit'), (req, res) => ctrl.upsert(req, res, supabase));
  // Nur lesend (Empfaenger-Vorschau), aber sie legt Mitarbeiternamen offen und
  // gehoert zum selben Dialog — deshalb dieselbe Permission wie das Speichern.
  router.post('/:typeKey/preview', requirePermission('settings.notifications.edit'), (req, res) => ctrl.preview(req, res, supabase));

  return router;
};
