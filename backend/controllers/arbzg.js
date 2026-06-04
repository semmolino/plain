'use strict';

const svc = require('../services/arbzg');

// ── Settings ────────────────────────────────────────────────────────────────
async function getSettings(req, res, supabase) {
  try {
    const data = await svc.getArbzgSettings(supabase, req.tenantId);
    res.json({ data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

async function saveSettings(req, res, supabase) {
  try {
    await svc.saveArbzgSettings(supabase, req.tenantId, req.body || {});
    const data = await svc.getArbzgSettings(supabase, req.tenantId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

// ── Limits / aktives Modell für einen Mitarbeiter ───────────────────────────
async function getLimits(req, res, supabase) {
  const empId = Number(req.params.employeeId);
  const date  = req.query.date || new Date().toISOString().slice(0, 10);
  if (!empId) return res.status(400).json({ error: 'employeeId fehlt' });
  try {
    const settings  = await svc.getArbzgSettings(supabase, req.tenantId);
    const model     = await svc.getActiveWorkModel(supabase, req.tenantId, empId, date);
    const breakRule = await svc.getBreakRule(
      supabase, req.tenantId, model?.BREAK_RULE_ID ?? settings.defaultBreakRuleId
    );
    res.json({ data: { settings, model, breakRule, employeeId: empId, date } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

// ── Preflight (Live-Check ohne Schreibvorgang) ──────────────────────────────
async function preflight(req, res, supabase) {
  const b = req.body || {};
  try {
    const r = await svc.validateBookingArbZG(supabase, {
      tenantId:    req.tenantId,
      employeeId:  Number(b.employee_id),
      dateVoucher: b.date_voucher,
      timeStart:   b.time_start || null,
      timeFinish:  b.time_finish || null,
      quantityInt: Number(b.quantity_int || 0),
      entryKind:   b.entry_kind || 'WORK',
      excludeTecId: b.exclude_tec_id ? Number(b.exclude_tec_id) : null,
    });
    res.json({ data: {
      issues:    r.issues,
      dayTotal:  r.dayTotal,
      breakRule: r.breakRule && { ID: r.breakRule.ID, NAME: r.breakRule.NAME,
                                  T1_HOURS: r.breakRule.T1_HOURS, T1_BREAK_MIN: r.breakRule.T1_BREAK_MIN,
                                  T2_HOURS: r.breakRule.T2_HOURS, T2_BREAK_MIN: r.breakRule.T2_BREAK_MIN },
    }});
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

// ── Audit-Liste ─────────────────────────────────────────────────────────────
async function listAudit(req, res, supabase) {
  const { employee_id, date_from, date_to, event_type, severity } = req.query;
  try {
    let q = supabase
      .from('ARBZG_AUDIT')
      .select('ID, EMPLOYEE_ID, DATE_VOUCHER, EVENT_TYPE, SEVERITY, DETAILS, TEC_ID, CREATED_AT')
      .eq('TENANT_ID', req.tenantId)
      .order('CREATED_AT', { ascending: false })
      .limit(1000);
    if (employee_id) q = q.eq('EMPLOYEE_ID', Number(employee_id));
    if (date_from)   q = q.gte('DATE_VOUCHER', date_from);
    if (date_to)     q = q.lte('DATE_VOUCHER', date_to);
    if (event_type)  q = q.eq('EVENT_TYPE', event_type);
    if (severity)    q = q.eq('SEVERITY', severity);
    const { data, error } = await q;
    if (error) {
      if (/relation .*ARBZG_AUDIT/i.test(error.message)) {
        return res.json({ data: [], warning: 'ARBZG_AUDIT-Tabelle nicht vorhanden — Migration 0052 ausstehend' });
      }
      throw { status: 500, message: error.message };
    }
    res.json({ data: data || [] });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

// ── Audit-Export (CSV) ──────────────────────────────────────────────────────
async function exportAudit(req, res, supabase) {
  const { date_from, date_to, employee_id } = req.query;
  try {
    let q = supabase
      .from('ARBZG_AUDIT')
      .select('ID, EMPLOYEE_ID, DATE_VOUCHER, EVENT_TYPE, SEVERITY, DETAILS, TEC_ID, CREATED_AT')
      .eq('TENANT_ID', req.tenantId)
      .order('CREATED_AT', { ascending: true })
      .limit(50000);
    if (employee_id) q = q.eq('EMPLOYEE_ID', Number(employee_id));
    if (date_from)   q = q.gte('DATE_VOUCHER', date_from);
    if (date_to)     q = q.lte('DATE_VOUCHER', date_to);
    const { data, error } = await q;
    if (error) throw { status: 500, message: error.message };

    // Mitarbeiter-Lookup für lesbares Kürzel
    const empIds = [...new Set((data || []).map(r => r.EMPLOYEE_ID))];
    const { data: emps } = await supabase
      .from('EMPLOYEE')
      .select('ID, SHORT_NAME, FIRST_NAME, LAST_NAME')
      .in('ID', empIds);
    const empMap = Object.fromEntries((emps || []).map(e => [e.ID, e]));

    // CSV bauen (RFC4180, ; als Trenner, UTF-8 BOM für Excel)
    const header = ['ID','Kürzel','Vorname','Nachname','Datum','Event','Schwere','TEC_ID','Erfasst_am','Details'];
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[";\r\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [header.join(';')];
    for (const r of data || []) {
      const e = empMap[r.EMPLOYEE_ID] || {};
      lines.push([
        r.ID, e.SHORT_NAME || '', e.FIRST_NAME || '', e.LAST_NAME || '',
        r.DATE_VOUCHER, r.EVENT_TYPE, r.SEVERITY, r.TEC_ID ?? '',
        r.CREATED_AT, JSON.stringify(r.DETAILS || {}),
      ].map(escape).join(';'));
    }
    const csv = '﻿' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="arbzg_audit_${date_from || 'all'}_${date_to || 'all'}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

// ── Pausenregeln (CRUD) ─────────────────────────────────────────────────────
async function listBreakRules(req, res, supabase) {
  try {
    const { data, error } = await supabase
      .from('BREAK_RULE')
      .select('ID, NAME, T1_HOURS, T1_BREAK_MIN, T2_HOURS, T2_BREAK_MIN, MIN_BLOCK_MIN, CREATED_AT')
      .eq('TENANT_ID', req.tenantId)
      .order('NAME', { ascending: true });
    if (error) throw { status: 500, message: error.message };
    res.json({ data: data || [] });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

async function upsertBreakRule(req, res, supabase) {
  const b = req.body || {};
  const row = {
    TENANT_ID:     req.tenantId,
    NAME:          b.name,
    T1_HOURS:      Number(b.t1_hours ?? 6),
    T1_BREAK_MIN:  Number(b.t1_break_min ?? 30),
    T2_HOURS:      Number(b.t2_hours ?? 9),
    T2_BREAK_MIN:  Number(b.t2_break_min ?? 45),
    MIN_BLOCK_MIN: Number(b.min_block_min ?? 15),
  };
  try {
    if (b.id) {
      const { data, error } = await supabase
        .from('BREAK_RULE').update(row).eq('ID', b.id).eq('TENANT_ID', req.tenantId)
        .select('*').single();
      if (error) throw { status: 500, message: error.message };
      return res.json({ data });
    }
    const { data, error } = await supabase
      .from('BREAK_RULE').insert([row]).select('*').single();
    if (error) throw { status: 500, message: error.message };
    res.json({ data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

async function deleteBreakRule(req, res, supabase) {
  try {
    const { error } = await supabase
      .from('BREAK_RULE').delete().eq('ID', req.params.id).eq('TENANT_ID', req.tenantId);
    if (error) throw { status: 500, message: error.message };
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

module.exports = {
  getSettings, saveSettings,
  getLimits, preflight,
  listAudit, exportAudit,
  listBreakRules, upsertBreakRule, deleteBreakRule,
};
