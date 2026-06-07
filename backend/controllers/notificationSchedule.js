'use strict';

const svc                       = require('../services/notificationSchedule');
const leistungsstandReminder    = require('../services/leistungsstandReminderChecker');

async function list(req, res, supabase) {
  try {
    const data = await svc.listAllSchedules(supabase, req.tenantId);
    res.json({ data });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || String(e) }); }
}

async function get(req, res, supabase) {
  try {
    const typeKey = String(req.params.typeKey || '').trim();
    if (!typeKey) return res.status(400).json({ error: 'typeKey fehlt' });
    const data = await svc.getSchedule(supabase, { tenantId: req.tenantId, typeKey });
    res.json({ data });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || String(e) }); }
}

async function upsert(req, res, supabase) {
  try {
    const typeKey = String(req.params.typeKey || '').trim();
    if (!typeKey) return res.status(400).json({ error: 'typeKey fehlt' });
    const data = await svc.upsertSchedule(supabase, {
      tenantId:   req.tenantId,
      typeKey,
      body:       req.body || {},
      employeeId: req.employeeId,
    });
    res.json({ data });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || String(e) }); }
}

// Manueller Trigger zum Testen — laeuft nur fuer leistungsstand_reminder
async function runNow(req, res, supabase) {
  try {
    const typeKey = String(req.params.typeKey || '').trim();
    if (typeKey !== 'leistungsstand_reminder') {
      return res.status(400).json({ error: 'Manueller Trigger nur fuer leistungsstand_reminder' });
    }
    const created = await leistungsstandReminder.runNowForTenant(supabase, req.tenantId);
    res.json({ ok: true, created });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || String(e) }); }
}

module.exports = { list, get, upsert, runNow };
