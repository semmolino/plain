'use strict';

const express = require('express');
const ctrl    = require('../controllers/angebote');
const { requirePermission } = require('../middleware/permissions');

module.exports = (supabase) => {
  const router = express.Router();

  // Phase 2: alle Angebote-Routen ausser /statuses-Lookup erfordern offers.view
  router.use((req, res, next) => {
    if (req.path === '/statuses') return next();
    return requirePermission('offers.view')(req, res, next);
  });

  router.get('/statuses',                   (req, res) => ctrl.getOfferStatuses(req, res, supabase));
  router.get('/',                           (req, res) => ctrl.listOffers(req, res, supabase));
  router.post('/',                          (req, res) => ctrl.createOffer(req, res, supabase));
  router.put('/:id',                        (req, res) => ctrl.updateOffer(req, res, supabase));
  router.delete('/:id',                     (req, res) => ctrl.deleteOffer(req, res, supabase));
  router.get('/:id/structure',              (req, res) => ctrl.getOfferStructure(req, res, supabase));
  router.post('/:id/structure',             (req, res) => ctrl.addOfferStructureNode(req, res, supabase));
  router.put('/:id/structure/:nodeId/move', (req, res) => ctrl.moveOfferStructureNode(req, res, supabase));
  router.put('/:id/structure/:nodeId',      (req, res) => ctrl.updateOfferStructureNode(req, res, supabase));
  router.delete('/:id/structure/:nodeId',   (req, res) => ctrl.deleteOfferStructureNode(req, res, supabase));
  router.get('/:id/pdf',                          (req, res) => ctrl.getOfferPdf(req, res, supabase));
  router.get('/:id/auftragsbestaetigung',         (req, res) => ctrl.getAuftragsbestaetigungPdf(req, res, supabase));
  router.post('/:id/convert',                     (req, res) => ctrl.convertOffer(req, res, supabase));
  router.post('/:id/copy',                        (req, res) => ctrl.copyOffer(req, res, supabase));
  router.get('/:id',                        (req, res) => ctrl.getOffer(req, res, supabase));

  return router;
};
