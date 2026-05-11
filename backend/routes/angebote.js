'use strict';

const express = require('express');
const ctrl    = require('../controllers/angebote');

module.exports = (supabase) => {
  const router = express.Router();

  router.get('/statuses',                   (req, res) => ctrl.getOfferStatuses(req, res, supabase));
  router.post('/statuses',                  (req, res) => ctrl.postOfferStatus(req, res, supabase));
  router.get('/',                           (req, res) => ctrl.listOffers(req, res, supabase));
  router.post('/',                          (req, res) => ctrl.createOffer(req, res, supabase));
  router.put('/:id',                        (req, res) => ctrl.updateOffer(req, res, supabase));
  router.delete('/:id',                     (req, res) => ctrl.deleteOffer(req, res, supabase));
  router.get('/:id/structure',              (req, res) => ctrl.getOfferStructure(req, res, supabase));
  router.post('/:id/structure',             (req, res) => ctrl.addOfferStructureNode(req, res, supabase));
  router.put('/:id/structure/:nodeId',      (req, res) => ctrl.updateOfferStructureNode(req, res, supabase));
  router.delete('/:id/structure/:nodeId',   (req, res) => ctrl.deleteOfferStructureNode(req, res, supabase));
  router.get('/:id/pdf',                    (req, res) => ctrl.getOfferPdf(req, res, supabase));
  router.post('/:id/convert',              (req, res) => ctrl.convertOffer(req, res, supabase));
  router.get('/:id',                        (req, res) => ctrl.getOffer(req, res, supabase));

  return router;
};
