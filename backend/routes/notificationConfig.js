'use strict';

const express = require('express');
const ctrl    = require('../controllers/notificationConfig');
const { requirePermission } = require('../middleware/permissions');

module.exports = (supabase) => {
  const router = express.Router();

  router.get('/',           (req, res) => ctrl.listAll(req, res, supabase));
  router.put('/:typeKey',   requirePermission('settings.notifications.edit'), (req, res) => ctrl.upsert(req, res, supabase));

  return router;
};
