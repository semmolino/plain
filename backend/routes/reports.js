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
