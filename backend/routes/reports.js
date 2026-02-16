const express = require("express");

/**
 * Reporting endpoints
 * Reads from Postgres views in schema: REPORTING
 *
 * Required query param:
 *   tenant_id
 */
module.exports = (supabase) => {
  const router = express.Router();

  function requireTenantId(req, res) {
    const tenantId = req.query.tenant_id;
    if (!tenantId) {
      res.status(400).json({ error: "Missing required query param: tenant_id" });
      return null;
    }
    return tenantId;
  }

  // Header KPIs (one row per project)
  router.get("/project/:projectId/header", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const projectId = req.params.projectId;

    const { data, error } = await supabase
      .from("VW_REPORT_PROJECT_DETAIL")
      .select("*")
      .eq("TENANT_ID", tenantId)
      .eq("PROJECT_ID", projectId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Project report header not found" });
    res.json({ data });
  });

  // Structure detail (many rows per project)
  router.get("/project/:projectId/structure", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const projectId = req.params.projectId;

    const { data, error } = await supabase
      .from("VW_REPORT_PROJECT_DETAIL_STRUCTURE")
      .select("*")
      .eq("TENANT_ID", tenantId)
      .eq("PROJECT_ID", projectId)
      .order("PARENT_STRUCTURE_ID", { ascending: true, nullsFirst: true })
      .order("STRUCTURE_ID", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  return router;
};
