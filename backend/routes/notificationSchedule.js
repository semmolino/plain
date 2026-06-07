'use strict';

const express = require('express');
const ctrl    = require('../controllers/notificationSchedule');

module.exports = (supabase) => {
  const router = express.Router();

  router.get   ('/',                (req, res) => ctrl.list(req, res, supabase));
  router.get   ('/:typeKey',        (req, res) => ctrl.get(req, res, supabase));
  router.put   ('/:typeKey',        (req, res) => ctrl.upsert(req, res, supabase));
  router.post  ('/:typeKey/run-now',(req, res) => ctrl.runNow(req, res, supabase));

  return router;
};
