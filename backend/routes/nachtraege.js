'use strict';

const express = require('express');
const ctrl    = require('../controllers/nachtraege');
const { requirePermission } = require('../middleware/permissions');

module.exports = (supabase) => {
  const router = express.Router();

  // Alle Nachtrags-Routen ausser dem globalen /statuses-Lookup erfordern nachtraege.view
  router.use((req, res, next) => {
    if (req.path === '/statuses') return next();
    return requirePermission('nachtraege.view')(req, res, next);
  });

  router.get('/statuses',                  (req, res) => ctrl.listStatuses(req, res, supabase));
  router.get('/',                          (req, res) => ctrl.list(req, res, supabase));
  router.post('/',                         requirePermission('nachtraege.create'), (req, res) => ctrl.create(req, res, supabase));

  router.get('/:id/structure',             (req, res) => ctrl.getStructure(req, res, supabase));
  router.post('/:id/structure',            requirePermission('nachtraege.edit'),   (req, res) => ctrl.addStructureNode(req, res, supabase));
  router.put('/:id/structure/:nodeId',     requirePermission('nachtraege.edit'),   (req, res) => ctrl.updateStructureNode(req, res, supabase));
  router.delete('/:id/structure/:nodeId',  requirePermission('nachtraege.edit'),   (req, res) => ctrl.deleteStructureNode(req, res, supabase));

  router.post('/:id/release',              requirePermission('nachtraege.release'), (req, res) => ctrl.release(req, res, supabase));
  router.get('/:id/releases',              (req, res) => ctrl.listReleases(req, res, supabase));
  router.put('/:id/review',                requirePermission('nachtraege.review'),  (req, res) => ctrl.saveReview(req, res, supabase));
  router.get('/:id/pdf',                   (req, res) => ctrl.getPdf(req, res, supabase));

  router.put('/:id',                       requirePermission('nachtraege.edit'),   (req, res) => ctrl.update(req, res, supabase));
  router.delete('/:id',                    requirePermission('nachtraege.delete'), (req, res) => ctrl.remove(req, res, supabase));
  router.get('/:id',                       (req, res) => ctrl.get(req, res, supabase));

  return router;
};
