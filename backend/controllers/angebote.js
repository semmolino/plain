'use strict';

const svc = require('../services/angebote');
const { renderOfferPdf } = require('../services_pdf_render');

async function getOfferStatuses(req, res, supabase) {
  try {
    const data = await svc.getOfferStatuses(supabase, { tenantId: req.tenantId });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function postOfferStatus(req, res, supabase) {
  try {
    const data = await svc.createOfferStatus(supabase, { tenantId: req.tenantId, name_short: req.body?.name_short });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function listOffers(req, res, supabase) {
  try {
    const data = await svc.listOffers(supabase, { tenantId: req.tenantId });
    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

async function getOffer(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.getOffer(supabase, { tenantId: req.tenantId, offerId: id });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function createOffer(req, res, supabase) {
  try {
    const data = await svc.createOffer(supabase, { tenantId: req.tenantId, body: req.body });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function updateOffer(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.updateOffer(supabase, { tenantId: req.tenantId, offerId: id, body: req.body });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function deleteOffer(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    await svc.deleteOffer(supabase, { tenantId: req.tenantId, offerId: id });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function getOfferStructure(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.getOfferStructure(supabase, { tenantId: req.tenantId, offerId: id });
    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

async function addOfferStructureNode(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.addOfferStructureNode(supabase, { tenantId: req.tenantId, offerId: id, body: req.body });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function updateOfferStructureNode(req, res, supabase) {
  try {
    const nodeId = parseInt(req.params.nodeId, 10);
    if (!nodeId) return res.status(400).json({ error: 'Ungültige Node-ID' });
    const data = await svc.updateOfferStructureNode(supabase, { tenantId: req.tenantId, nodeId, body: req.body });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function deleteOfferStructureNode(req, res, supabase) {
  try {
    const nodeId = parseInt(req.params.nodeId, 10);
    if (!nodeId) return res.status(400).json({ error: 'Ungültige Node-ID' });
    await svc.deleteOfferStructureNode(supabase, { nodeId });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

async function convertOffer(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const data = await svc.convertOfferToProject(supabase, { tenantId: req.tenantId, offerId: id, body: req.body });
    return res.json({ data });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function getOfferPdf(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Ungültige ID' });
    const download = String(req.query.download || '') === '1';

    const { pdf, offer } = await renderOfferPdf({ supabase, offerId: id, tenantId: req.tenantId });

    const filename = `Angebot_${offer.NAME_SHORT || id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

module.exports = {
  getOfferStatuses,
  postOfferStatus,
  listOffers,
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
  getOfferStructure,
  addOfferStructureNode,
  updateOfferStructureNode,
  deleteOfferStructureNode,
  convertOffer,
  getOfferPdf,
};
