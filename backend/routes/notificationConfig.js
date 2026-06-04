'use strict';

const express = require('express');
const ctrl    = require('../controllers/notificationConfig');

module.exports = (supabase) => {
  const router = express.Router();

  router.get('/',           (req, res) => ctrl.listAll(req, res, supabase));
  router.put('/:typeKey',   (req, res) => ctrl.upsert(req, res, supabase));

  return router;
};
