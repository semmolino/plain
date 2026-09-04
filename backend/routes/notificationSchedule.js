'use strict';

const express = require('express');
const ctrl    = require('../controllers/notificationSchedule');
const { requirePermission } = require('../middleware/permissions');

module.exports = (supabase) => {
  const router = express.Router();

  // Lesen bleibt offen: die Einstellungsseite zeigt die Zeitplaene jedem an,
  // der sie oeffnen darf. Schreiben und Ausloesen nicht — ein umgestellter
  // Zeitplan schaltet Erinnerungen still ab (niemand bemerkt eine ausbleibende
  // Mahnung), und "jetzt ausfuehren" verschickt E-Mails an echte Empfaenger.
  // Wiederholt aufgerufen bringt das den Mandanten beim Versender in Verruf.
  const GUARD = requirePermission('settings.notifications.edit');

  router.get   ('/',                (req, res) => ctrl.list(req, res, supabase));
  router.get   ('/:typeKey',        (req, res) => ctrl.get(req, res, supabase));
  router.put   ('/:typeKey',        GUARD, (req, res) => ctrl.upsert(req, res, supabase));
  router.post  ('/:typeKey/run-now',GUARD, (req, res) => ctrl.runNow(req, res, supabase));

  return router;
};
