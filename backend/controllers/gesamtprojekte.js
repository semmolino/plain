"use strict";

// Gesamtprojekte — duenne Controller, Logik in services/gesamtprojekte.js.

const svc = require("../services/gesamtprojekte");

function fail(res, e) {
  return res.status(e?.status || 500).json({ error: e?.message || String(e) });
}

/** Rechnungsempfaenger stehen im Vertrag — nur mit dessen Leserecht. */
const canViewContracts = (req) =>
  !!req._permissionsUnrestricted || !!req.permissions?.has?.("projects.contracts.view");

async function listGroups(req, res, supabase) {
  try {
    res.json({ data: await svc.listGroups(supabase, { tenantId: req.tenantId }) });
  } catch (e) { fail(res, e); }
}

async function getGroup(req, res, supabase) {
  try {
    res.json({ data: await svc.getGroup(supabase, {
      tenantId: req.tenantId, id: req.params.id, withInvoiceAddress: canViewContracts(req),
    }) });
  } catch (e) { fail(res, e); }
}

async function createGroup(req, res, supabase) {
  try {
    const { group, moved } = await svc.createGroup(supabase, { tenantId: req.tenantId, body: req.body });
    res.status(201).json({ data: group, moved });
  } catch (e) { fail(res, e); }
}

async function patchGroup(req, res, supabase) {
  try {
    res.json({ data: await svc.patchGroup(supabase, { tenantId: req.tenantId, id: req.params.id, body: req.body }) });
  } catch (e) { fail(res, e); }
}

async function deleteGroup(req, res, supabase) {
  try {
    res.json({ data: await svc.deleteGroup(supabase, { tenantId: req.tenantId, id: req.params.id }) });
  } catch (e) { fail(res, e); }
}

async function setMembers(req, res, supabase) {
  try {
    const result = await svc.setMembers(supabase, {
      tenantId: req.tenantId, id: req.params.id, projectIds: req.body?.project_ids,
    });
    const group = await svc.getGroup(supabase, {
      tenantId: req.tenantId, id: req.params.id, withInvoiceAddress: canViewContracts(req),
    });
    res.json({ data: group, ...result });
  } catch (e) { fail(res, e); }
}

async function suggestAbbr(req, res, supabase) {
  try {
    res.json({ data: { abbr: await svc.suggestMemberAbbr(supabase, { tenantId: req.tenantId, groupId: req.params.id }) } });
  } catch (e) { fail(res, e); }
}

module.exports = { listGroups, getGroup, createGroup, patchGroup, deleteGroup, setMembers, suggestAbbr };
