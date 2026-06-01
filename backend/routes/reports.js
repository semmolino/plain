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
          const leafTec = (tecRows || []).filter(r =>
            r.STRUCTURE_ID === leaf.ID && r.DATE_VOUCHER <= date
          );

          if (leaf.BILLING_TYPE_ID === 2) {
            // Hourly: honorar = cumulative SP_TOT (earned revenue = billed selling price)
            const sp = leafTec.reduce((s, r) => s + +(r.SP_TOT || 0), 0);
            honorar       += sp;
            leistungsstand += sp;
          } else {
            // Fixed-fee: honorar = REVENUE + EXTRAS from last budget update or structure
            const lastBudget = [...leafProg].reverse().find(r => r.REVENUE != null);
            if (lastBudget) {
              honorar += +(lastBudget.REVENUE || 0) + +(lastBudget.EXTRAS || 0);
            } else {
              honorar += +(leaf.REVENUE || 0) + +(leaf.EXTRAS || 0);
            }
            // Leistungsstand for fixed-fee: from progress completion value
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
          const leafTec = (tecRows || []).filter(r =>
            r.STRUCTURE_ID === leaf.ID && r.DATE_VOUCHER <= date
          );

          if (leaf.BILLING_TYPE_ID === 2) {
            const sp = leafTec.reduce((s, r) => s + +(r.SP_TOT || 0), 0);
            honorar        += sp;
            leistungsstand += sp;
          } else {
            const lastBudget = [...leafProg].reverse().find(r => r.REVENUE != null);
            if (lastBudget) {
              honorar += +(lastBudget.REVENUE || 0) + +(lastBudget.EXTRAS || 0);
            } else {
              honorar += +(leaf.REVENUE || 0) + +(leaf.EXTRAS || 0);
            }
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
      .select("PROJECT_ID, NAME_SHORT, NAME_LONG, BUDGET_TOTAL_NET, LEISTUNGSSTAND_VALUE, HOURS_TOTAL, COST_TOTAL, PARTIAL_PAYMENT_NET_TOTAL, INVOICE_NET_TOTAL")
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

  // Alert conditions for the dashboard alert strip
  router.get("/dashboard/alerts", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const today = new Date().toISOString().slice(0, 10);
    const alerts = [];

    const { count: overdueCount } = await supabase
      .from("INVOICE")
      .select("ID", { count: "exact", head: true })
      .eq("TENANT_ID", tenantId)
      .eq("STATUS_ID", 2)
      .not("DUE_DATE", "is", null)
      .lt("DUE_DATE", today)
      .neq("INVOICE_TYPE", "stornorechnung");
    if (overdueCount > 0) alerts.push({
      severity: "red",
      type: "overdue_invoices",
      message: `${overdueCount} Rechnung${overdueCount > 1 ? "en" : ""} überfällig`,
      count: overdueCount,
      action_url: "/rechnungen",
    });

    const { data: projectList } = await supabase
      .from("VW_REPORT_PROJECT_LIST_ROOT")
      .select("PROJECT_ID, COST_TOTAL, BUDGET_TOTAL_NET")
      .eq("TENANT_ID", tenantId);
    const atRisk = (projectList || []).filter(p =>
      Number(p.BUDGET_TOTAL_NET) > 0 &&
      Number(p.COST_TOTAL) / Number(p.BUDGET_TOTAL_NET) > 0.9
    );
    if (atRisk.length > 0) alerts.push({
      severity: "amber",
      type: "budget_critical",
      message: `${atRisk.length} Projekt${atRisk.length > 1 ? "e" : ""} über 90% Budget`,
      count: atRisk.length,
      action_url: "/projekte",
    });

    const today2 = new Date().toISOString().slice(0, 10);
    const { count: mahnCount } = await supabase
      .from("MAHNUNG")
      .select("ID", { count: "exact", head: true })
      .eq("TENANT_ID", tenantId)
      .eq("IS_CLOSED", false);
    if ((mahnCount ?? 0) > 0) alerts.push({
      severity: "amber",
      type: "open_mahnungen",
      message: `${mahnCount} offene Mahnung${mahnCount > 1 ? "en" : ""}`,
      count: mahnCount,
      action_url: "/rechnungen?tab=mahnungen",
    });

    res.json({ data: alerts });
  });

  // List of overdue invoices for Controller view
  router.get("/dashboard/overdue-invoices", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("INVOICE")
      .select("ID, INVOICE_NUMBER, INVOICE_DATE, DUE_DATE, TOTAL_AMOUNT_NET, PROJECT_ID")
      .eq("TENANT_ID", tenantId)
      .eq("STATUS_ID", 2)
      .not("DUE_DATE", "is", null)
      .lt("DUE_DATE", today)
      .neq("INVOICE_TYPE", "stornorechnung")
      .order("DUE_DATE", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    const result = (data || []).map(r => ({
      ...r,
      days_overdue: Math.floor((new Date(today) - new Date(r.DUE_DATE)) / 86400000),
    }));
    res.json({ data: result });
  });

  // Risk-Cockpit: all projects with ampel + flags
  router.get("/dashboard/risk-projects", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { data, error } = await supabase
      .from("VW_REPORT_PROJECT_DETAIL")
      .select([
        "PROJECT_ID", "NAME_SHORT", "NAME_LONG",
        "PROJECT_STATUS_ID", "PROJECT_STATUS_NAME_SHORT",
        "PROJECT_MANAGER_ID", "PROJECT_MANAGER_DISPLAY",
        "DEPARTMENT_ID", "DEPARTMENT_NAME",
        "BUDGET_TOTAL_NET", "LEISTUNGSSTAND_PERCENT", "LEISTUNGSSTAND_VALUE",
        "COST_TOTAL", "COST_RATIO", "BILLED_NET_TOTAL", "OPEN_NET_TOTAL",
      ].join(", "))
      .eq("TENANT_ID", tenantId)
      .order("BUDGET_TOTAL_NET", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const result = (data || []).map(p => {
      const budget    = Number(p.BUDGET_TOTAL_NET)      || 0;
      const costs     = Number(p.COST_TOTAL)            || 0;
      const leistung  = Number(p.LEISTUNGSSTAND_VALUE)  || 0;
      const openNet   = Number(p.OPEN_NET_TOTAL)        || 0;
      const costRatio = budget > 0 ? costs / budget : 0;
      const db        = leistung - costs;
      const flags = [];
      if (budget > 0 && costRatio >= 0.9)                       flags.push("budget_kritisch");
      if (db < 0 && (costs > 500 || leistung > 500))            flags.push("db_negativ");
      if (budget > 0 && costRatio >= 0.75 && costRatio < 0.9)   flags.push("budget_warn");
      if (openNet > 5000)                                        flags.push("abrechnung_potential");
      let ampel = "gruen";
      if (flags.includes("budget_kritisch") || flags.includes("db_negativ")) ampel = "rot";
      else if (flags.includes("budget_warn"))                                 ampel = "orange";
      else if (flags.includes("abrechnung_potential"))                        ampel = "gelb";
      return { ...p, ampel, flags, db };
    });
    res.json({ data: result });
  });

  // Billing summary: projects with open amounts + by-PL aggregation
  router.get("/dashboard/billing-summary", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { data, error } = await supabase
      .from("VW_REPORT_PROJECT_DETAIL")
      .select("PROJECT_ID, NAME_SHORT, PROJECT_MANAGER_ID, PROJECT_MANAGER_DISPLAY, OPEN_NET_TOTAL")
      .eq("TENANT_ID", tenantId)
      .gt("OPEN_NET_TOTAL", 0)
      .order("OPEN_NET_TOTAL", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const projects = (data || []).map(p => ({
      PROJECT_ID:              p.PROJECT_ID,
      NAME_SHORT:              p.NAME_SHORT,
      PROJECT_MANAGER_DISPLAY: p.PROJECT_MANAGER_DISPLAY,
      OPEN_NET_TOTAL:          Number(p.OPEN_NET_TOTAL) || 0,
    }));
    const byPlMap = {};
    for (const p of projects) {
      const name = p.PROJECT_MANAGER_DISPLAY || "(Unbekannt)";
      if (!byPlMap[name]) byPlMap[name] = { name, total: 0, count: 0 };
      byPlMap[name].total += p.OPEN_NET_TOTAL;
      byPlMap[name].count += 1;
    }
    const byPl = Object.values(byPlMap).sort((a, b) => b.total - a.total);
    res.json({ data: { projects, byPl } });
  });

  // Team hours: TEC confirmed hours per employee per month (last 6 months)
  router.get("/dashboard/team-hours", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const today   = new Date();
    const from    = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = today.toISOString().slice(0, 10);

    const [{ data: tec }, { data: employees }] = await Promise.all([
      supabase.from("TEC").select("EMPLOYEE_ID, DATE_VOUCHER, QUANTITY_INT")
        .eq("TENANT_ID", tenantId).eq("STATUS", "CONFIRMED")
        .gte("DATE_VOUCHER", fromStr).lte("DATE_VOUCHER", toStr),
      supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME")
        .eq("TENANT_ID", tenantId).or("ACTIVE.is.null,ACTIVE.neq.2"),
    ]);

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const byEmpMonth = {};
    for (const row of (tec || [])) {
      if (!row.DATE_VOUCHER) continue;
      const month = row.DATE_VOUCHER.substring(0, 7);
      if (!months.includes(month)) continue;
      const key = `${row.EMPLOYEE_ID}__${month}`;
      byEmpMonth[key] = (byEmpMonth[key] || 0) + Number(row.QUANTITY_INT || 0);
    }

    const activeEmpIds = new Set((tec || []).map(r => r.EMPLOYEE_ID));
    const result = (employees || [])
      .filter(e => activeEmpIds.has(e.ID))
      .map(e => {
        const empMonths = months.map(m => ({
          month: m,
          hours: Math.round((byEmpMonth[`${e.ID}__${m}`] || 0) * 100) / 100,
        }));
        const total = empMonths.reduce((s, m) => s + m.hours, 0);
        return {
          employee_id: e.ID,
          short_name:  e.SHORT_NAME || `${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`.trim(),
          months:      empMonths,
          total:       Math.round(total * 100) / 100,
        };
      })
      .filter(e => e.total > 0)
      .sort((a, b) => b.total - a.total);

    res.json({ data: { employees: result, months } });
  });

  // Hours booked per employee over last 28 days (Bereichsleiter view)
  router.get("/dashboard/team-utilization", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const today = new Date();
    const from  = new Date(today);
    from.setDate(from.getDate() - 28);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = today.toISOString().slice(0, 10);

    const [{ data: tec }, { data: employees }] = await Promise.all([
      supabase.from("TEC").select("EMPLOYEE_ID, QUANTITY_INT")
        .eq("TENANT_ID", tenantId).eq("STATUS", "CONFIRMED")
        .gte("DATE_VOUCHER", fromStr).lte("DATE_VOUCHER", toStr),
      supabase.from("EMPLOYEE").select("ID, SHORT_NAME")
        .eq("TENANT_ID", tenantId).or("ACTIVE.is.null,ACTIVE.neq.2"),
    ]);

    const byEmployee = {};
    for (const r of (tec || [])) {
      byEmployee[r.EMPLOYEE_ID] = (byEmployee[r.EMPLOYEE_ID] || 0) + Number(r.QUANTITY_INT || 0);
    }
    const result = (employees || []).map(e => ({
      employee_id:  e.ID,
      short_name:   e.SHORT_NAME,
      hours_4weeks: Math.round((byEmployee[e.ID] || 0) * 100) / 100,
    }));
    res.json({ data: result });
  });

  // ── Company-level KPIs (Unternehmenskennzahlen) ───────────────────────────
  // GET /reports/company-kpis?year=2026
  router.get("/company-kpis", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const year = parseInt(req.query.year || new Date().getFullYear(), 10);
    if (isNaN(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: "Ungültiges Jahr" });
    }
    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year}-12-31`;

    try {
      const [invoiceRes, ppRes, tecRes, empRes, backlogRes] = await Promise.all([
        // Revenue: booked invoices in year (no storno)
        supabase.from("INVOICE")
          .select("TOTAL_AMOUNT_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .gte("INVOICE_DATE", yearStart)
          .lte("INVOICE_DATE", yearEnd)
          .neq("INVOICE_TYPE", "stornorechnung")
          .neq("INVOICE_TYPE", "storno_partial"),

        // Revenue: confirmed partial payments in year
        supabase.from("PARTIAL_PAYMENT")
          .select("AMOUNT_NET, AMOUNT_EXTRAS_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .gte("PARTIAL_PAYMENT_DATE", yearStart)
          .lte("PARTIAL_PAYMENT_DATE", yearEnd)
          .is("CANCELS_PARTIAL_PAYMENT_ID", null),

        // TEC: all entries in year (employee_id, hours, costs)
        supabase.from("TEC")
          .select("EMPLOYEE_ID, QUANTITY_INT, CP_TOT")
          .eq("TENANT_ID", tenantId)
          .gte("DATE_VOUCHER", yearStart)
          .lte("DATE_VOUCHER", yearEnd),

        // Active employees
        supabase.from("EMPLOYEE")
          .select("ID")
          .eq("TENANT_ID", tenantId)
          .or("ACTIVE.is.null,ACTIVE.neq.2"),

        // Project backlog: remaining billable per project (budget - billed, capped at 0)
        supabase.from("VW_REPORT_PROJECT_LIST_ROOT")
          .select("BUDGET_TOTAL_NET, BILLED_NET_TOTAL")
          .eq("TENANT_ID", tenantId),
      ]);

      for (const r of [invoiceRes, ppRes, tecRes, empRes, backlogRes]) {
        if (r.error) throw r.error;
      }

      // Revenue
      const invoiceRevenue = (invoiceRes.data || []).reduce((s, r) => s + Number(r.TOTAL_AMOUNT_NET || 0), 0);
      const ppRevenue      = (ppRes.data || []).reduce((s, r) => s + Number(r.AMOUNT_NET || 0) + Number(r.AMOUNT_EXTRAS_NET || 0), 0);
      const revenue        = Math.round((invoiceRevenue + ppRevenue) * 100) / 100;

      // TEC metrics
      const tecRows      = tecRes.data || [];
      const totalHours   = Math.round(tecRows.reduce((s, r) => s + Number(r.QUANTITY_INT || 0), 0) * 100) / 100;
      const directCosts  = Math.round(tecRows.reduce((s, r) => s + Number(r.CP_TOT || 0), 0) * 100) / 100;
      const uniqueEmpIds = new Set(tecRows.map(r => r.EMPLOYEE_ID));
      const projectEmployeeCount = uniqueEmpIds.size;

      // Employee count
      const employeeCount = (empRes.data || []).length;

      // Backlog: sum of max(0, BUDGET - BILLED) across all projects
      const backlog = (backlogRes.data || []).reduce((s, r) => {
        const remaining = Number(r.BUDGET_TOTAL_NET || 0) - Number(r.BILLED_NET_TOTAL || 0);
        return s + Math.max(0, remaining);
      }, 0);
      const backlogRounded = Math.round(backlog * 100) / 100;

      // Computed KPIs (null when denominator is 0)
      const monthlyRevenue        = revenue / 12;
      const umsatzProMitarbeiter  = employeeCount > 0 ? Math.round(revenue / employeeCount) : null;
      const anteilProjektmitarb   = employeeCount > 0 ? Math.round((projectEmployeeCount / employeeCount) * 1000) / 10 : null;
      const mittlererStundensatz  = totalHours > 0 ? Math.round((directCosts / totalHours) * 100) / 100 : null;
      const auftragsreichweite    = monthlyRevenue > 0 ? Math.round((backlogRounded / monthlyRevenue) * 10) / 10 : null;
      const dbMarge               = revenue > 0 ? Math.round(((revenue - directCosts) / revenue) * 1000) / 10 : null;

      res.json({
        data: {
          year,
          raw: { revenue, directCosts, totalHours, employeeCount, projectEmployeeCount, backlog: backlogRounded },
          kpis: {
            umsatzProMitarbeiter,
            anteilProjektmitarbeiter: anteilProjektmitarb,
            mittlererStundensatz,
            auftragsreichweite,
            deckungsbeitragMarge: dbMarge,
          },
        },
      });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  return router;
};
