const express = require("express");

/**
 * Reporting endpoints
 * Reads from Postgres views / RPC functions
 *
 * Required query params:
 *   tenant_id
 *
 * Optional date-filter params:
 *   filter_mode  "now" | "as_of" | "period"  (default: "now")
 *   as_of_date   ISO date string, e.g. "2024-03-15"   (required when filter_mode="as_of")
 *   date_from    ISO date string                       (required when filter_mode="period")
 *   date_to      ISO date string                       (required when filter_mode="period")
 */
module.exports = (supabase) => {
  const router = express.Router();

  function requireTenantId(req, res) {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Kein Mandant für diesen Benutzer hinterlegt." });
      return null;
    }
    return tenantId;
  }

  // Parse date-filter params from request; returns { useRpc, rpcParams } or null on validation error.
  function parseDateFilter(req, res) {
    const mode = req.query.filter_mode || "now";

    if (mode === "now") {
      return { useRpc: false };
    }

    if (mode === "as_of") {
      const asOf = req.query.as_of_date;
      if (!asOf) {
        res.status(400).json({ error: "as_of_date is required when filter_mode=as_of" });
        return null;
      }
      // Send end-of-day so the entire selected day is included
      return { useRpc: true, rpcParams: { p_as_of: `${asOf}T23:59:59`, p_date_from: null, p_date_to: null } };
    }

    if (mode === "period") {
      const dateFrom = req.query.date_from;
      const dateTo   = req.query.date_to;
      if (!dateFrom || !dateTo) {
        res.status(400).json({ error: "date_from and date_to are required when filter_mode=period" });
        return null;
      }
      return { useRpc: true, rpcParams: { p_as_of: null, p_date_from: dateFrom, p_date_to: dateTo } };
    }

    res.status(400).json({ error: `Unknown filter_mode: ${mode}` });
    return null;
  }

  // Header KPIs (one row per project)
  router.get("/project/:projectId/header", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const projectId = req.params.projectId;
    const filter = parseDateFilter(req, res);
    if (filter === null) return;

    let data, error;

    if (filter.useRpc) {
      ({ data, error } = await supabase
        .rpc("fn_project_report_header", {
          p_tenant_id:  parseInt(tenantId, 10),
          p_project_id: parseInt(projectId, 10),
          ...filter.rpcParams,
        })
        .maybeSingle());
    } else {
      ({ data, error } = await supabase
        .from("VW_REPORT_PROJECT_DETAIL")
        .select("*")
        .eq("TENANT_ID", tenantId)
        .eq("PROJECT_ID", projectId)
        .maybeSingle());
    }

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: "Project report header not found" });
    res.json({ data });
  });

  // Structure detail (many rows per project)
  router.get("/project/:projectId/structure", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const projectId = req.params.projectId;
    const filter = parseDateFilter(req, res);
    if (filter === null) return;

    let data, error;

    if (filter.useRpc) {
      ({ data, error } = await supabase
        .rpc("fn_project_report_structure", {
          p_tenant_id:  parseInt(tenantId, 10),
          p_project_id: parseInt(projectId, 10),
          ...filter.rpcParams,
        }));
    } else {
      ({ data, error } = await supabase
        .from("VW_REPORT_PROJECT_DETAIL_STRUCTURE")
        .select("*")
        .eq("TENANT_ID", tenantId)
        .eq("PROJECT_ID", projectId)
        .order("PARENT_STRUCTURE_ID", { ascending: true, nullsFirst: true })
        .order("STRUCTURE_ID", { ascending: true }));
    }

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  // All projects with KPIs (multi-project list)
  router.get("/projects/list", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const filter = parseDateFilter(req, res);
    if (filter === null) return;

    let data, error;

    if (filter.useRpc) {
      ({ data, error } = await supabase
        .rpc("fn_project_list_report", {
          p_tenant_id: parseInt(tenantId, 10),
          ...filter.rpcParams,
        }));
    } else {
      ({ data, error } = await supabase
        .from("VW_REPORT_PROJECT_DETAIL")
        .select([
          "PROJECT_ID", "NAME_SHORT", "NAME_LONG",
          "PROJECT_STATUS_ID", "PROJECT_STATUS_NAME_SHORT",
          "PROJECT_TYPE_ID",   "PROJECT_TYPE_NAME_SHORT",
          "PROJECT_MANAGER_ID","PROJECT_MANAGER_DISPLAY",
          "ADDRESS_ID",        "ADDRESS_NAME",
          "COMPANY_ID",        "COMPANY_NAME",
          "DEPARTMENT_ID",     "DEPARTMENT_NAME",
          "BUDGET_TOTAL_NET",  "LEISTUNGSSTAND_PERCENT", "LEISTUNGSSTAND_VALUE",
          "HOURS_TOTAL",       "COST_TOTAL",             "COST_RATIO",
          "REMAINING_BUDGET_NET", "BILLED_NET_TOTAL",    "OPEN_NET_TOTAL",
          "PAYED_NET_TOTAL",   "SALES_TOTAL",            "QTY_EXT_TOTAL",
        ].join(", "))
        .eq("TENANT_ID", tenantId)
        .order("NAME_SHORT", { ascending: true }));
    }

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  // Project progress timeline (for chart visualization)
  // Query params:
  //   date_from  ISO date — leftmost X-axis point (omit for full history)
  //   date_to    ISO date — rightmost X-axis point (omit for today)
  // Returns one row per event date with cumulative: honorar, leistungsstand, kosten, abgerechnet, bezahlt
  router.get("/project/:projectId/timeline", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const projectId = parseInt(req.params.projectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "Ungültige Projekt-ID." });

    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    try {
      // 1. All structures for this project
      const { data: structures, error: sErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, FATHER_ID, BILLING_TYPE_ID, REVENUE, EXTRAS, created_at")
        .eq("TENANT_ID", tenantId)
        .eq("PROJECT_ID", projectId);
      if (sErr) return res.status(500).json({ error: sErr.message });
      if (!structures || structures.length === 0) return res.json({ data: [] });

      const fatherIds = new Set(structures.map(s => s.FATHER_ID).filter(Boolean));
      const leaves    = structures.filter(s => !fatherIds.has(s.ID));
      const leafIds   = leaves.map(s => s.ID);

      // 2. All PROJECT_PROGRESS rows for these leaves (full history — no date filter)
      const { data: progressRows } = await supabase
        .from("PROJECT_PROGRESS")
        .select("STRUCTURE_ID, REVENUE, EXTRAS, REVENUE_COMPLETION, EXTRAS_COMPLETION, created_at")
        .eq("TENANT_ID", tenantId)
        .in("STRUCTURE_ID", leafIds)
        .order("created_at", { ascending: true });

      // 3. TEC rows (fetch up to dateTo for efficiency; full history needed for cumulative)
      let tecQ = supabase
        .from("TEC")
        .select("STRUCTURE_ID, DATE_VOUCHER, CP_TOT, SP_TOT")
        .eq("TENANT_ID", tenantId)
        .in("STRUCTURE_ID", leafIds)
        .order("DATE_VOUCHER", { ascending: true });
      if (dateTo) tecQ = tecQ.lte("DATE_VOUCHER", dateTo);
      const { data: tecRows } = await tecQ;

      // 4. Partial payments
      let ppQ = supabase
        .from("PARTIAL_PAYMENT")
        .select("PARTIAL_PAYMENT_DATE, AMOUNT_NET, AMOUNT_EXTRAS_NET")
        .eq("TENANT_ID", tenantId)
        .eq("PROJECT_ID", projectId)
        .eq("STATUS_ID", 2)
        .order("PARTIAL_PAYMENT_DATE", { ascending: true });
      if (dateTo) ppQ = ppQ.lte("PARTIAL_PAYMENT_DATE", dateTo);
      const { data: ppRows } = await ppQ;

      // 5. Invoices (table may not exist in all tenants)
      let invRows = [];
      try {
        let invQ = supabase
          .from("INVOICE")
          .select("INVOICE_DATE, TOTAL_AMOUNT_NET")
          .eq("TENANT_ID", tenantId)
          .eq("PROJECT_ID", projectId)
          .eq("STATUS_ID", 2)
          .order("INVOICE_DATE", { ascending: true });
        if (dateTo) invQ = invQ.lte("INVOICE_DATE", dateTo);
        const { data: inv } = await invQ;
        invRows = inv || [];
      } catch (_) {}

      // 6. Payments
      let payQ = supabase
        .from("PAYMENT")
        .select("PAYMENT_DATE, AMOUNT_PAYED_NET")
        .eq("TENANT_ID", tenantId)
        .eq("PROJECT_ID", projectId)
        .order("PAYMENT_DATE", { ascending: true });
      if (dateTo) payQ = payQ.lte("PAYMENT_DATE", dateTo);
      const { data: payRows } = await payQ;

      // 7. Collect distinct event dates, apply date range filter for X axis
      const dateSet = new Set();
      (progressRows || []).forEach(r => { if (r.created_at) dateSet.add(r.created_at.substring(0, 10)); });
      (tecRows      || []).forEach(r => { if (r.DATE_VOUCHER) dateSet.add(r.DATE_VOUCHER); });
      (ppRows       || []).forEach(r => { if (r.PARTIAL_PAYMENT_DATE) dateSet.add(r.PARTIAL_PAYMENT_DATE); });
      invRows.forEach(r => { if (r.INVOICE_DATE) dateSet.add(r.INVOICE_DATE); });
      (payRows      || []).forEach(r => { if (r.PAYMENT_DATE) dateSet.add(r.PAYMENT_DATE); });

      // Aktuell mode (no dateTo): always anchor the chart to today as the final point
      if (!dateTo) dateSet.add(new Date().toISOString().substring(0, 10));

      let sortedDates = [...dateSet].sort();
      if (dateFrom) sortedDates = sortedDates.filter(d => d >= dateFrom);
      if (dateTo)   sortedDates = sortedDates.filter(d => d <= dateTo);

      if (sortedDates.length === 0) return res.json({ data: [] });

      // 8. Compute cumulative values at each event date
      const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

      const result = sortedDates.map(date => {
        let honorar       = 0;
        let leistungsstand = 0;

        for (const leaf of leaves) {
          const leafProg = (progressRows || []).filter(r =>
            r.STRUCTURE_ID === leaf.ID && r.created_at && r.created_at.substring(0, 10) <= date
          );

          // Budget: last PP row with non-null REVENUE ≤ date; fallback to structure's REVENUE/EXTRAS
          const lastBudget = [...leafProg].reverse().find(r => r.REVENUE != null);
          let rev = 0, ext = 0;
          if (lastBudget) {
            rev = +(lastBudget.REVENUE || 0);
            ext = +(lastBudget.EXTRAS  || 0);
          } else {
            rev = +(leaf.REVENUE || 0);
            ext = +(leaf.EXTRAS  || 0);
          }
          honorar += rev + ext;

          // Leistungsstand
          if (leaf.BILLING_TYPE_ID === 2) {
            const sp = (tecRows || [])
              .filter(r => r.STRUCTURE_ID === leaf.ID && r.DATE_VOUCHER <= date)
              .reduce((s, r) => s + +(r.SP_TOT || 0), 0);
            leistungsstand += sp;
          } else {
            const lastCompl = [...leafProg].reverse().find(r => r.REVENUE_COMPLETION != null);
            if (lastCompl) {
              leistungsstand += +(lastCompl.REVENUE_COMPLETION || 0) + +(lastCompl.EXTRAS_COMPLETION || 0);
            }
          }
        }

        const kosten = (tecRows || [])
          .filter(r => r.DATE_VOUCHER <= date)
          .reduce((s, r) => s + +(r.CP_TOT || 0), 0);

        const abgerechnet =
          (ppRows || []).filter(r => r.PARTIAL_PAYMENT_DATE <= date)
            .reduce((s, r) => s + +(r.AMOUNT_NET || 0) + +(r.AMOUNT_EXTRAS_NET || 0), 0) +
          invRows.filter(r => r.INVOICE_DATE <= date)
            .reduce((s, r) => s + +(r.TOTAL_AMOUNT_NET || 0), 0);

        const bezahlt = (payRows || []).filter(r => r.PAYMENT_DATE <= date)
          .reduce((s, r) => s + +(r.AMOUNT_PAYED_NET || 0), 0);

        return {
          DATE:                 date,
          HONORAR_NET:          round2(honorar),
          LEISTUNGSSTAND_VALUE: round2(leistungsstand),
          KOSTEN_TOTAL:         round2(kosten),
          ABGERECHNET_NET:      round2(abgerechnet),
          BEZAHLT_NET:          round2(bezahlt),
        };
      });

      res.json({ data: result });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Aggregate timeline across ALL projects for the tenant
  // Same metrics as single-project timeline, summed across every project.
  // Query params: date_from / date_to (same semantics as single-project endpoint)
  router.get("/projects/timeline", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    try {
      // 1. All structures for the entire tenant
      const { data: structures, error: sErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, FATHER_ID, BILLING_TYPE_ID, REVENUE, EXTRAS, created_at")
        .eq("TENANT_ID", tenantId);
      if (sErr) return res.status(500).json({ error: sErr.message });
      if (!structures || structures.length === 0) return res.json({ data: [] });

      const fatherIds = new Set(structures.map(s => s.FATHER_ID).filter(Boolean));
      const leaves    = structures.filter(s => !fatherIds.has(s.ID));
      const leafIds   = leaves.map(s => s.ID);
      if (leafIds.length === 0) return res.json({ data: [] });

      // 2. PROJECT_PROGRESS for all leaves (full history)
      const { data: progressRows } = await supabase
        .from("PROJECT_PROGRESS")
        .select("STRUCTURE_ID, REVENUE, EXTRAS, REVENUE_COMPLETION, EXTRAS_COMPLETION, created_at")
        .eq("TENANT_ID", tenantId)
        .in("STRUCTURE_ID", leafIds)
        .order("created_at", { ascending: true });

      // 3. TEC for all leaves (up to dateTo)
      let tecQ = supabase
        .from("TEC")
        .select("STRUCTURE_ID, DATE_VOUCHER, CP_TOT, SP_TOT")
        .eq("TENANT_ID", tenantId)
        .in("STRUCTURE_ID", leafIds)
        .order("DATE_VOUCHER", { ascending: true });
      if (dateTo) tecQ = tecQ.lte("DATE_VOUCHER", dateTo);
      const { data: tecRows } = await tecQ;

      // 4. Partial payments (all tenant projects)
      let ppQ = supabase
        .from("PARTIAL_PAYMENT")
        .select("PARTIAL_PAYMENT_DATE, AMOUNT_NET, AMOUNT_EXTRAS_NET")
        .eq("TENANT_ID", tenantId)
        .eq("STATUS_ID", 2)
        .order("PARTIAL_PAYMENT_DATE", { ascending: true });
      if (dateTo) ppQ = ppQ.lte("PARTIAL_PAYMENT_DATE", dateTo);
      const { data: ppRows } = await ppQ;

      // 5. Invoices (all tenant projects)
      let invRows = [];
      try {
        let invQ = supabase
          .from("INVOICE")
          .select("INVOICE_DATE, TOTAL_AMOUNT_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .order("INVOICE_DATE", { ascending: true });
        if (dateTo) invQ = invQ.lte("INVOICE_DATE", dateTo);
        const { data: inv } = await invQ;
        invRows = inv || [];
      } catch (_) {}

      // 6. Payments (all tenant projects)
      let payQ = supabase
        .from("PAYMENT")
        .select("PAYMENT_DATE, AMOUNT_PAYED_NET")
        .eq("TENANT_ID", tenantId)
        .order("PAYMENT_DATE", { ascending: true });
      if (dateTo) payQ = payQ.lte("PAYMENT_DATE", dateTo);
      const { data: payRows } = await payQ;

      // 7. Collect event dates
      const dateSet = new Set();
      (progressRows || []).forEach(r => { if (r.created_at) dateSet.add(r.created_at.substring(0, 10)); });
      (tecRows      || []).forEach(r => { if (r.DATE_VOUCHER) dateSet.add(r.DATE_VOUCHER); });
      (ppRows       || []).forEach(r => { if (r.PARTIAL_PAYMENT_DATE) dateSet.add(r.PARTIAL_PAYMENT_DATE); });
      invRows.forEach(r => { if (r.INVOICE_DATE) dateSet.add(r.INVOICE_DATE); });
      (payRows      || []).forEach(r => { if (r.PAYMENT_DATE) dateSet.add(r.PAYMENT_DATE); });

      if (!dateTo) dateSet.add(new Date().toISOString().substring(0, 10));

      let sortedDates = [...dateSet].sort();
      if (dateFrom) sortedDates = sortedDates.filter(d => d >= dateFrom);
      if (dateTo)   sortedDates = sortedDates.filter(d => d <= dateTo);

      if (sortedDates.length === 0) return res.json({ data: [] });

      const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

      const result = sortedDates.map(date => {
        let honorar = 0;
        let leistungsstand = 0;

        for (const leaf of leaves) {
          const leafProg = (progressRows || []).filter(r =>
            r.STRUCTURE_ID === leaf.ID && r.created_at && r.created_at.substring(0, 10) <= date
          );

          // Budget: last PP row with non-null REVENUE ≤ date; fallback to structure's REVENUE/EXTRAS
          const lastBudget = [...leafProg].reverse().find(r => r.REVENUE != null);
          let rev = 0, ext = 0;
          if (lastBudget) {
            rev = +(lastBudget.REVENUE || 0);
            ext = +(lastBudget.EXTRAS  || 0);
          } else {
            rev = +(leaf.REVENUE || 0);
            ext = +(leaf.EXTRAS  || 0);
          }
          honorar += rev + ext;

          if (leaf.BILLING_TYPE_ID === 2) {
            const sp = (tecRows || [])
              .filter(r => r.STRUCTURE_ID === leaf.ID && r.DATE_VOUCHER <= date)
              .reduce((s, r) => s + +(r.SP_TOT || 0), 0);
            leistungsstand += sp;
          } else {
            const lastCompl = [...leafProg].reverse().find(r => r.REVENUE_COMPLETION != null);
            if (lastCompl) {
              leistungsstand += +(lastCompl.REVENUE_COMPLETION || 0) + +(lastCompl.EXTRAS_COMPLETION || 0);
            }
          }
        }

        const kosten = (tecRows || [])
          .filter(r => r.DATE_VOUCHER <= date)
          .reduce((s, r) => s + +(r.CP_TOT || 0), 0);

        const abgerechnet =
          (ppRows || []).filter(r => r.PARTIAL_PAYMENT_DATE <= date)
            .reduce((s, r) => s + +(r.AMOUNT_NET || 0) + +(r.AMOUNT_EXTRAS_NET || 0), 0) +
          invRows.filter(r => r.INVOICE_DATE <= date)
            .reduce((s, r) => s + +(r.TOTAL_AMOUNT_NET || 0), 0);

        const bezahlt = (payRows || []).filter(r => r.PAYMENT_DATE <= date)
          .reduce((s, r) => s + +(r.AMOUNT_PAYED_NET || 0), 0);

        return {
          DATE:                 date,
          HONORAR_NET:          round2(honorar),
          LEISTUNGSSTAND_VALUE: round2(leistungsstand),
          KOSTEN_TOTAL:         round2(kosten),
          ABGERECHNET_NET:      round2(abgerechnet),
          BEZAHLT_NET:          round2(bezahlt),
        };
      });

      res.json({ data: result });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // ── Dashboard endpoints ──────────────────────────────────────────────────

  // KPI summary (single row)
  router.get("/dashboard/kpis", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { data, error } = await supabase
      .rpc("fn_dashboard_kpis", { p_tenant_id: parseInt(tenantId, 10) })
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || {} });
  });

  // Top-10 projects by budget
  router.get("/dashboard/projects", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { data, error } = await supabase
      .from("VW_REPORT_PROJECT_LIST_ROOT")
      .select("NAME_SHORT, NAME_LONG, BUDGET_TOTAL_NET, LEISTUNGSSTAND_VALUE, HOURS_TOTAL, COST_TOTAL, PARTIAL_PAYMENT_NET_TOTAL, INVOICE_NET_TOTAL")
      .eq("TENANT_ID", tenantId)
      .order("BUDGET_TOTAL_NET", { ascending: false })
      .limit(10);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  // Hours + costs per month (last 6 months)
  router.get("/dashboard/monthly", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { data, error } = await supabase
      .rpc("fn_dashboard_monthly", { p_tenant_id: parseInt(tenantId, 10) });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  // Project count by status
  router.get("/dashboard/by-status", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { data, error } = await supabase
      .rpc("fn_dashboard_by_status", { p_tenant_id: parseInt(tenantId, 10) });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  return router;
};
