'use strict';

const express = require('express');
const svc     = require('../services/costRateCalc');

module.exports = (supabase) => {
  const router = express.Router();

  // GET  /kostensatz/overhead?year=
  router.get('/overhead', async (req, res) => {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    try {
      const data = await svc.getOverheadItems(supabase, req.tenantId, year);
      res.json({ data });
    } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }) }
  });

  // POST /kostensatz/overhead  { year, items[] }
  router.post('/overhead', async (req, res) => {
    const { year, items } = req.body;
    if (!year) return res.status(400).json({ error: 'year required' });
    try {
      const data = await svc.saveOverheadItems(supabase, req.tenantId, year, items || []);
      res.json({ data });
    } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }) }
  });

  // POST /kostensatz/overhead/copy  { from_year, to_year }
  router.post('/overhead/copy', async (req, res) => {
    const { from_year, to_year } = req.body;
    if (!from_year || !to_year) return res.status(400).json({ error: 'from_year and to_year required' });
    try {
      const data = await svc.copyOverheadFromYear(supabase, req.tenantId, from_year, to_year);
      res.json({ data });
    } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }) }
  });

  // GET  /kostensatz/params/:employeeId?year=
  router.get('/params/:employeeId', async (req, res) => {
    const empId = parseInt(req.params.employeeId);
    const year  = parseInt(req.query.year) || new Date().getFullYear();
    try {
      const data = await svc.getEmployeeParams(supabase, req.tenantId, empId, year);
      res.json({ data });
    } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }) }
  });

  // POST /kostensatz/params/:employeeId  { year, ...params }
  router.post('/params/:employeeId', async (req, res) => {
    const empId = parseInt(req.params.employeeId);
    const { year, ...params } = req.body;
    if (!year) return res.status(400).json({ error: 'year required' });
    try {
      const data = await svc.upsertEmployeeParams(supabase, req.tenantId, empId, year, params);
      res.json({ data });
    } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }) }
  });

  // POST /kostensatz/params-bulk  { year, params: [{employee_id, ...}] }
  router.post('/params-bulk', async (req, res) => {
    const { year, params } = req.body;
    if (!year || !Array.isArray(params)) return res.status(400).json({ error: 'year and params[] required' });
    try {
      await svc.bulkUpsertEmployeeParams(supabase, req.tenantId, year, params);
      res.json({ ok: true });
    } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }) }
  });

  // POST /kostensatz/calculate  { year, employee_ids[]?, profit_markup_pct? }
  router.post('/calculate', async (req, res) => {
    const { year, employee_ids, profit_markup_pct } = req.body;
    if (!year) return res.status(400).json({ error: 'year required' });
    try {
      const data = await svc.calculateCostRates(
        supabase, req.tenantId, year,
        employee_ids || null,
        Number(profit_markup_pct) || 0
      );
      res.json({ data });
    } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }) }
  });

  // POST /kostensatz/import  { rates: [{employee_id, rate}], valid_from, recalc_bookings? }
  router.post('/import', async (req, res) => {
    const { rates, valid_from, recalc_bookings } = req.body;
    if (!valid_from || !Array.isArray(rates) || !rates.length)
      return res.status(400).json({ error: 'valid_from and rates[] required' });
    try {
      await svc.importCostRates(supabase, req.tenantId, rates, valid_from, !!recalc_bookings);
      res.json({ ok: true });
    } catch (e) { res.status(e?.status || 500).json({ error: e?.message || String(e) }) }
  });

  return router;
};
