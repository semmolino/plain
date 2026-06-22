const express = require("express");
const { requirePermission } = require("../middleware/permissions");

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

  // Phase 4: dedizierte Reporting-Endpoints (/project/*, /projects/*,
  // /company-kpis, /trends, /finance/*) erfordern reports.view.
  // /dashboard/* bleibt offen, weil das Dashboard fuer jeden User mit
  // dashboard.view zugaenglich sein muss.
  router.use((req, res, next) => {
    if (req.path.startsWith("/dashboard/")) return next();
    return requirePermission("reports.view")(req, res, next);
  });

  // Phase 6: Reporting-Scope.
  // - User mit reports.scope.all sieht alle Projekte des Tenants.
  // - Ohne diese Permission: nur Projekte, in denen er Projektleiter ist.
  // req.reportScopeProjectIds  = null (=alle) ODER Set<number> (=eingeschraenkt).
  router.use(async (req, res, next) => {
    if (req.path.startsWith("/dashboard/")) return next();
    if (req._permissionsUnrestricted) { req.reportScopeProjectIds = null; return next(); }
    if (req.permissions.has("reports.scope.all")) { req.reportScopeProjectIds = null; return next(); }
    // Sonst: eigene Projekte ermitteln
    try {
      const { data } = await supabase
        .from("PROJECT")
        .select("ID")
        .eq("TENANT_ID", req.tenantId)
        .eq("PROJECT_MANAGER_ID", req.employeeId);
      req.reportScopeProjectIds = new Set((data || []).map(r => r.ID));
    } catch (_) {
      req.reportScopeProjectIds = new Set();  // sicher: leer
    }
    next();
  });

  // Phase 6: /project/:projectId/* Endpoints duerfen nur in-scope Projekte beantworten.
  router.use((req, res, next) => {
    if (req.reportScopeProjectIds === null) return next();
    const m = req.path.match(/^\/project\/(\d+)(?:\/|$)/);
    if (!m) return next();
    const pid = parseInt(m[1], 10);
    if (req.reportScopeProjectIds.has(pid)) return next();
    return res.status(403).json({ error: "Dieses Projekt liegt nicht in deinem Reporting-Scope" });
  });

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

  // Compute sum of parent (non-leaf) SURCHARGES_TOTAL per project PLUS the
  // project-level (root) SURCHARGES_TOTAL — these are the surcharges that the
  // leaf-based reporting views miss.
  // Returns Map<projectId(string), surchargeSum(number)>
  async function loadParentSurchargesByProject(projectIds) {
    const out = new Map();
    if (!projectIds || projectIds.length === 0) return out;

    // 1) Non-leaf structure-node surcharges
    const { data: structRows } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("PROJECT_ID, ID, FATHER_ID, SURCHARGES_TOTAL")
      .in("PROJECT_ID", projectIds);
    const fatherIds = new Set((structRows || []).filter(r => r.FATHER_ID != null).map(r => String(r.FATHER_ID)));
    for (const r of (structRows || [])) {
      if (!fatherIds.has(String(r.ID))) continue; // skip leaves
      const pid = String(r.PROJECT_ID);
      const inc = Number(r.SURCHARGES_TOTAL || 0);
      if (!inc) continue;
      out.set(pid, (out.get(pid) || 0) + inc);
    }

    // 2) Project-level (root) surcharges — Option A
    try {
      const { data: projRows } = await supabase
        .from("PROJECT")
        .select("ID, SURCHARGES_TOTAL")
        .in("ID", projectIds);
      for (const p of (projRows || [])) {
        const sur = Number(p.SURCHARGES_TOTAL || 0);
        if (!sur) continue;
        const pid = String(p.ID);
        out.set(pid, (out.get(pid) || 0) + sur);
      }
    } catch (_) { /* column may not exist yet (migration not run) — soft-fail */ }

    return out;
  }
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

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

    // Add parent-level surcharges (leaf-based view misses these)
    const parentSurchargesMap = await loadParentSurchargesByProject([projectId]);
    const parentSurcharges = parentSurchargesMap.get(String(projectId)) || 0;
    if (parentSurcharges) {
      data.BUDGET_TOTAL_NET    = round2(Number(data.BUDGET_TOTAL_NET || 0) + parentSurcharges);
      data.REMAINING_BUDGET_NET = round2(Number(data.REMAINING_BUDGET_NET || 0) + parentSurcharges);
    }
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

    // Phase 6: Scope-Filter — ohne reports.scope.all nur eigene Projekte
    let rows = data || [];
    if (req.reportScopeProjectIds !== null) {
      rows = rows.filter(r => req.reportScopeProjectIds.has(r.PROJECT_ID));
    }

    // Add parent-level surcharges per project
    const projectIds = rows.map(r => r.PROJECT_ID).filter(Boolean);
    const parentSurchargesMap = await loadParentSurchargesByProject(projectIds);
    for (const row of rows) {
      const sur = parentSurchargesMap.get(String(row.PROJECT_ID)) || 0;
      if (!sur) continue;
      row.BUDGET_TOTAL_NET     = round2(Number(row.BUDGET_TOTAL_NET || 0) + sur);
      row.REMAINING_BUDGET_NET = round2(Number(row.REMAINING_BUDGET_NET || 0) + sur);
    }
    res.json({ data: rows });
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

      // Parent-level surcharges (leaf-based loop misses these)
      const parentSurchargesMap = await loadParentSurchargesByProject([projectId]);
      const parentSurcharges = parentSurchargesMap.get(String(projectId)) || 0;

      // 8. Compute cumulative values at each event date
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

        // Add parent-level surcharges to honorar; allocate proportionally to leistungsstand
        if (parentSurcharges) {
          const ratio = honorar > 0 ? Math.min(1, leistungsstand / honorar) : 0;
          honorar       += parentSurcharges;
          leistungsstand += parentSurcharges * ratio;
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

    // Optional: auf eine Teilmenge von Projekten einschraenken (entspricht den
    // gesetzten Listen-Filtern). Param vorhanden aber leer => leeres Chart.
    const hasProjectFilter = req.query.project_ids !== undefined;
    const projectIds = hasProjectFilter
      ? String(req.query.project_ids).split(",").map(Number).filter(Number.isFinite)
      : null;
    if (hasProjectFilter && projectIds.length === 0) return res.json({ data: [] });

    try {
      // 1. Structures for the selected projects (or the entire tenant)
      let structQ = supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, PROJECT_ID, FATHER_ID, BILLING_TYPE_ID, REVENUE, EXTRAS, created_at")
        .eq("TENANT_ID", tenantId);
      if (projectIds) structQ = structQ.in("PROJECT_ID", projectIds);
      const { data: structures, error: sErr } = await structQ;
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

      // 4. Partial payments (selected projects, or all tenant projects)
      let ppQ = supabase
        .from("PARTIAL_PAYMENT")
        .select("PARTIAL_PAYMENT_DATE, AMOUNT_NET, AMOUNT_EXTRAS_NET")
        .eq("TENANT_ID", tenantId)
        .eq("STATUS_ID", 2)
        .order("PARTIAL_PAYMENT_DATE", { ascending: true });
      if (projectIds) ppQ = ppQ.in("PROJECT_ID", projectIds);
      if (dateTo) ppQ = ppQ.lte("PARTIAL_PAYMENT_DATE", dateTo);
      const { data: ppRows } = await ppQ;

      // 5. Invoices (selected projects, or all tenant projects)
      let invRows = [];
      try {
        let invQ = supabase
          .from("INVOICE")
          .select("INVOICE_DATE, TOTAL_AMOUNT_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .order("INVOICE_DATE", { ascending: true });
        if (projectIds) invQ = invQ.in("PROJECT_ID", projectIds);
        if (dateTo) invQ = invQ.lte("INVOICE_DATE", dateTo);
        const { data: inv } = await invQ;
        invRows = inv || [];
      } catch (_) {}

      // 6. Payments (selected projects, or all tenant projects)
      let payQ = supabase
        .from("PAYMENT")
        .select("PAYMENT_DATE, AMOUNT_PAYED_NET")
        .eq("TENANT_ID", tenantId)
        .order("PAYMENT_DATE", { ascending: true });
      if (projectIds) payQ = payQ.in("PROJECT_ID", projectIds);
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

      // Parent-level surcharges across all projects in this aggregation
      const distinctProjectIds = [...new Set(structures.map(s => s.PROJECT_ID).filter(Boolean))];
      const parentSurchargesMap = await loadParentSurchargesByProject(distinctProjectIds);
      let totalParentSurcharges = 0;
      for (const v of parentSurchargesMap.values()) totalParentSurcharges += v;

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

        if (totalParentSurcharges) {
          const ratio = honorar > 0 ? Math.min(1, leistungsstand / honorar) : 0;
          honorar        += totalParentSurcharges;
          leistungsstand += totalParentSurcharges * ratio;
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

  // Projects — all root projects with full fields; date-filtered via fn_project_list_report when params present
  router.get("/dashboard/projects", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const dateFrom = req.query.date_from;
    const dateTo   = req.query.date_to;

    let data, error;

    if (dateFrom && dateTo) {
      ({ data, error } = await supabase.rpc("fn_project_list_report", {
        p_tenant_id: parseInt(tenantId, 10),
        p_as_of:     null,
        p_date_from: dateFrom,
        p_date_to:   dateTo + "T23:59:59",
      }));
    } else {
      ({ data, error } = await supabase
        .from("VW_REPORT_PROJECT_DETAIL")
        .select([
          "PROJECT_ID", "NAME_SHORT", "NAME_LONG",
          "PROJECT_STATUS_ID", "PROJECT_STATUS_NAME_SHORT",
          "PROJECT_MANAGER_ID", "PROJECT_MANAGER_DISPLAY",
          "DEPARTMENT_ID", "DEPARTMENT_NAME",
          "BUDGET_TOTAL_NET", "LEISTUNGSSTAND_PERCENT", "LEISTUNGSSTAND_VALUE",
          "HOURS_TOTAL", "COST_TOTAL", "COST_RATIO",
          "REMAINING_BUDGET_NET", "BILLED_NET_TOTAL", "OPEN_NET_TOTAL",
          "PAYED_NET_TOTAL", "SALES_TOTAL", "QTY_EXT_TOTAL",
        ].join(", "))
        .eq("TENANT_ID", tenantId)
        .order("BUDGET_TOTAL_NET", { ascending: false }));
    }

    if (error) return res.status(500).json({ error: error.message });

    // Add parent-level surcharges per project
    const rows = data || [];
    const projectIds = rows.map(r => r.PROJECT_ID).filter(Boolean);
    const parentSurchargesMap = await loadParentSurchargesByProject(projectIds);
    for (const row of rows) {
      const sur = parentSurchargesMap.get(String(row.PROJECT_ID)) || 0;
      if (!sur) continue;
      row.BUDGET_TOTAL_NET     = round2(Number(row.BUDGET_TOTAL_NET || 0) + sur);
      row.REMAINING_BUDGET_NET = round2(Number(row.REMAINING_BUDGET_NET || 0) + sur);
    }
    res.json({ data: rows });
  });

  // Hours + costs per month — date-filtered by querying TEC directly when params present
  router.get("/dashboard/monthly", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const dateFrom = req.query.date_from;
    const dateTo   = req.query.date_to;

    if (dateFrom && dateTo) {
      const { data, error } = await supabase
        .from("TEC")
        .select("DATE_VOUCHER, QUANTITY_INT, CP_TOT")
        .eq("TENANT_ID", tenantId)
        .gte("DATE_VOUCHER", dateFrom)
        .lte("DATE_VOUCHER", dateTo);
      if (error) return res.status(500).json({ error: error.message });

      const byMonth = {};
      for (const row of (data || [])) {
        const m = String(row.DATE_VOUCHER).substring(0, 7);
        if (!byMonth[m]) byMonth[m] = { MONTH: m, HOURS_TOTAL: 0, COST_TOTAL: 0 };
        byMonth[m].HOURS_TOTAL = Math.round((byMonth[m].HOURS_TOTAL + Number(row.QUANTITY_INT || 0)) * 100) / 100;
        byMonth[m].COST_TOTAL  = Math.round((byMonth[m].COST_TOTAL  + Number(row.CP_TOT || 0)) * 100) / 100;
      }
      return res.json({ data: Object.values(byMonth).sort((a, b) => a.MONTH.localeCompare(b.MONTH)) });
    }

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

    // Add parent-level surcharges per project (leaf-based view misses these)
    const projIds = (data || []).map(p => p.PROJECT_ID).filter(Boolean);
    const parentSurchargesMap = await loadParentSurchargesByProject(projIds);

    const result = (data || []).map(p => {
      const sur       = parentSurchargesMap.get(String(p.PROJECT_ID)) || 0;
      const budget    = round2((Number(p.BUDGET_TOTAL_NET) || 0) + sur);
      const costs     = Number(p.COST_TOTAL)            || 0;
      // Allocate surcharge contribution to leistung proportionally to completion
      const leistRaw  = Number(p.LEISTUNGSSTAND_VALUE)  || 0;
      const baseHonor = Number(p.BUDGET_TOTAL_NET)      || 0;
      const leistung  = baseHonor > 0 && sur > 0
        ? round2(leistRaw + sur * Math.min(1, leistRaw / baseHonor))
        : leistRaw;
      const openNet   = Number(p.OPEN_NET_TOTAL)        || 0;
      const costRatio = budget > 0 ? costs / budget : 0;
      const db        = leistung - costs;
      // Write back so the modal/cards show the adjusted values
      p.BUDGET_TOTAL_NET     = budget;
      p.LEISTUNGSSTAND_VALUE = leistung;
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

  // Open Sicherheitseinbehalte across the whole tenant (Phase 3 — Dashboard KPI)
  // Returns { totalOpen: number, count: number, byProject: [...] }
  router.get("/dashboard/open-se", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    try {
      let { data, error } = await supabase
        .from("PARTIAL_PAYMENT")
        .select("ID, PROJECT_ID, SE_AMOUNT")
        .eq("TENANT_ID", tenantId)
        .eq("STATUS_ID", 2)
        .gt("SE_AMOUNT", 0)
        .is("SE_RELEASED_BY_INVOICE_ID", null);
      if (error && String(error.message || "").includes("SE_")) {
        // Migration 0047 not yet run
        return res.json({ data: { totalOpen: 0, count: 0, byProject: [] } });
      }
      if (error) return res.status(500).json({ error: error.message });
      let rows = data || [];

      // Phase 5: Exclude storno'd ARs
      if (rows.length > 0) {
        const ids = rows.map(r => r.ID);
        const { data: stornos } = await supabase
          .from("PARTIAL_PAYMENT")
          .select("CANCELS_PARTIAL_PAYMENT_ID")
          .in("CANCELS_PARTIAL_PAYMENT_ID", ids);
        const cancelled = new Set((stornos || []).map(s => s.CANCELS_PARTIAL_PAYMENT_ID));
        rows = rows.filter(r => !cancelled.has(r.ID));
      }

      const totalOpen = round2(rows.reduce((s, r) => s + Number(r.SE_AMOUNT || 0), 0));

      // Group by project + enrich with project name
      const byProjectMap = new Map();
      for (const r of rows) {
        const pid = r.PROJECT_ID;
        if (!pid) continue;
        if (!byProjectMap.has(pid)) byProjectMap.set(pid, { project_id: pid, total: 0, count: 0 });
        const e = byProjectMap.get(pid);
        e.total = round2(e.total + Number(r.SE_AMOUNT || 0));
        e.count += 1;
      }
      const projectIds = [...byProjectMap.keys()];
      if (projectIds.length > 0) {
        const { data: projs } = await supabase
          .from("PROJECT")
          .select("ID, NAME_SHORT, NAME_LONG")
          .in("ID", projectIds);
        (projs || []).forEach(p => {
          const e = byProjectMap.get(p.ID);
          if (e) { e.name_short = p.NAME_SHORT; e.name_long = p.NAME_LONG; }
        });
      }
      const byProject = [...byProjectMap.values()].sort((a, b) => b.total - a.total);

      return res.json({ data: { totalOpen, count: rows.length, byProject } });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── Dashboard: ArbZG-Statistik (laufende Woche + 30 Tage) ────────────────
  router.get("/dashboard/arbzg-stats", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    try {
      const today = new Date();
      const day   = today.getDay();
      const diffToMon = (day === 0 ? -6 : 1) - day;
      const monday = new Date(today);
      monday.setDate(today.getDate() + diffToMon);
      const weekStart = monday.toISOString().slice(0, 10);
      const minus30 = new Date(today); minus30.setDate(today.getDate() - 30);
      const m30Start = minus30.toISOString().slice(0, 10);

      const { data: weekRows, error: wErr } = await supabase
        .from("ARBZG_AUDIT")
        .select("EVENT_TYPE, SEVERITY")
        .eq("TENANT_ID", tenantId)
        .gte("DATE_VOUCHER", weekStart);
      if (wErr && /relation .*ARBZG_AUDIT/i.test(wErr.message)) {
        return res.json({ data: { warnWeek: 0, blockWeek: 0, over8hWeek: 0,
                                   warn30: 0, block30: 0, breakMissing30: 0,
                                   available: false } });
      }
      if (wErr) return res.status(500).json({ error: wErr.message });

      const warnWeek   = (weekRows || []).filter(r => r.SEVERITY === 'WARN').length;
      const blockWeek  = (weekRows || []).filter(r => r.SEVERITY === 'BLOCK').length;
      const over8hWeek = (weekRows || []).filter(r => r.EVENT_TYPE === 'OVER_8H').length;

      const { data: m30Rows } = await supabase
        .from("ARBZG_AUDIT")
        .select("EVENT_TYPE, SEVERITY")
        .eq("TENANT_ID", tenantId)
        .gte("DATE_VOUCHER", m30Start);

      const warn30         = (m30Rows || []).filter(r => r.SEVERITY === 'WARN').length;
      const block30        = (m30Rows || []).filter(r => r.SEVERITY === 'BLOCK').length;
      const breakMissing30 = (m30Rows || []).filter(r => r.EVENT_TYPE === 'BREAK_MISSING').length;

      return res.json({ data: {
        warnWeek, blockWeek, over8hWeek,
        warn30, block30, breakMissing30,
        available: true,
      }});
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Billing summary: projects with open amounts + by-PL aggregation
  router.get("/dashboard/billing-summary", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { data, error } = await supabase
      .from("VW_REPORT_PROJECT_DETAIL")
      .select("PROJECT_ID, NAME_SHORT, NAME_LONG, PROJECT_MANAGER_ID, PROJECT_MANAGER_DISPLAY, OPEN_NET_TOTAL")
      .eq("TENANT_ID", tenantId)
      .gt("OPEN_NET_TOTAL", 0)
      .order("OPEN_NET_TOTAL", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const projects = (data || []).map(p => ({
      PROJECT_ID:              p.PROJECT_ID,
      NAME_SHORT:              p.NAME_SHORT,
      NAME_LONG:               p.NAME_LONG,
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

  // Team hours: TEC confirmed hours per employee per month (date-range aware)
  router.get("/dashboard/team-hours", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    let fromStr, toStr;
    if (req.query.date_from && req.query.date_to) {
      fromStr = req.query.date_from;
      toStr   = req.query.date_to;
    } else {
      const today = new Date();
      const from  = new Date(today.getFullYear(), today.getMonth() - 5, 1);
      fromStr = from.toISOString().slice(0, 10);
      toStr   = today.toISOString().slice(0, 10);
    }

    const [{ data: tec }, { data: employees }] = await Promise.all([
      supabase.from("TEC").select("EMPLOYEE_ID, DATE_VOUCHER, QUANTITY_INT")
        .eq("TENANT_ID", tenantId).eq("STATUS", "CONFIRMED")
        .gte("DATE_VOUCHER", fromStr).lte("DATE_VOUCHER", toStr),
      supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME")
        .eq("TENANT_ID", tenantId).or("ACTIVE.is.null,ACTIVE.neq.2"),
    ]);

    // Build months array dynamically from the actual date range
    const months = [];
    const cur = new Date(fromStr + "T00:00:00");
    const end = new Date(toStr   + "T00:00:00");
    cur.setDate(1);
    while (cur <= end) {
      months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
      cur.setMonth(cur.getMonth() + 1);
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
  // GET /reports/company-kpis?period_type=year&year=2026
  // GET /reports/company-kpis?period_type=quarter&year=2026&quarter=2
  // GET /reports/company-kpis?period_type=month&year=2026&month=5
  router.get("/company-kpis", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const year = parseInt(req.query.year || new Date().getFullYear(), 10);
    if (isNaN(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: "Ungültiges Jahr" });
    }

    const periodType = req.query.period_type || 'year';
    let periodStart, periodEnd, periodMonths;

    if (periodType === 'quarter') {
      const q = Math.max(1, Math.min(4, parseInt(req.query.quarter || 1, 10)));
      const sm = (q - 1) * 3 + 1;
      const em = sm + 2;
      periodStart = `${year}-${String(sm).padStart(2, '0')}-01`;
      periodEnd   = `${year}-${String(em).padStart(2, '0')}-${String(new Date(year, em, 0).getDate()).padStart(2, '0')}`;
      periodMonths = 3;
    } else if (periodType === 'month') {
      const m = Math.max(1, Math.min(12, parseInt(req.query.month || 1, 10)));
      periodStart = `${year}-${String(m).padStart(2, '0')}-01`;
      periodEnd   = `${year}-${String(m).padStart(2, '0')}-${String(new Date(year, m, 0).getDate()).padStart(2, '0')}`;
      periodMonths = 1;
    } else {
      periodStart  = `${year}-01-01`;
      periodEnd    = `${year}-12-31`;
      periodMonths = 12;
    }

    try {
      const [invoiceRes, ppRes, tecRes, empRes, backlogRes] = await Promise.all([
        // Revenue: booked invoices in year (no storno)
        supabase.from("INVOICE")
          .select("TOTAL_AMOUNT_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .gte("INVOICE_DATE", periodStart)
          .lte("INVOICE_DATE", periodEnd)
          .neq("INVOICE_TYPE", "stornorechnung")
          .neq("INVOICE_TYPE", "storno_partial"),

        // Revenue: confirmed partial payments in year
        supabase.from("PARTIAL_PAYMENT")
          .select("AMOUNT_NET, AMOUNT_EXTRAS_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .gte("PARTIAL_PAYMENT_DATE", periodStart)
          .lte("PARTIAL_PAYMENT_DATE", periodEnd)
          .is("CANCELS_PARTIAL_PAYMENT_ID", null),

        // TEC: all entries in year (employee_id, hours, costs)
        supabase.from("TEC")
          .select("EMPLOYEE_ID, QUANTITY_INT, CP_TOT")
          .eq("TENANT_ID", tenantId)
          .gte("DATE_VOUCHER", periodStart)
          .lte("DATE_VOUCHER", periodEnd),

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
      const monthlyRevenue        = revenue / periodMonths;
      const umsatzProMitarbeiter  = employeeCount > 0 ? Math.round(revenue / employeeCount) : null;
      const anteilProjektmitarb   = employeeCount > 0 ? Math.round((projectEmployeeCount / employeeCount) * 1000) / 10 : null;
      const mittlererStundensatz  = totalHours > 0 ? Math.round((directCosts / totalHours) * 100) / 100 : null;
      const auftragsreichweite    = monthlyRevenue > 0 ? Math.round((backlogRounded / monthlyRevenue) * 10) / 10 : null;
      const dbMarge               = revenue > 0 ? Math.round(((revenue - directCosts) / revenue) * 1000) / 10 : null;

      res.json({
        data: {
          year,
          periodType,
          periodMonths,
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

  // ── Periodic Trends report ───────────────────────────────────────────────
  // GET /reports/trends?group_by=month|quarter|year&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
  router.get("/trends", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const groupBy = (req.query.group_by || "month");
    const today   = new Date();

    let dateFrom = req.query.date_from;
    let dateTo   = req.query.date_to;

    if (!dateFrom || !dateTo) {
      if (groupBy === "year") {
        const startYear = today.getFullYear() - 4;
        dateFrom = `${startYear}-01-01`;
        dateTo   = `${today.getFullYear()}-12-31`;
      } else if (groupBy === "quarter") {
        const startYear = today.getFullYear() - 2;
        dateFrom = `${startYear}-01-01`;
        dateTo   = today.toISOString().slice(0, 10);
      } else {
        const start = new Date(today.getFullYear(), today.getMonth() - 17, 1);
        dateFrom = start.toISOString().slice(0, 10);
        dateTo   = today.toISOString().slice(0, 10);
      }
    }

    // Build periods
    const periods = [];
    if (groupBy === "year") {
      const sy = parseInt(dateFrom.slice(0, 4));
      const ey = parseInt(dateTo.slice(0, 4));
      for (let y = sy; y <= ey; y++) {
        periods.push({ period: String(y), label: String(y), start: `${y}-01-01`, end: `${y}-12-31` });
      }
    } else if (groupBy === "quarter") {
      const cur = new Date(dateFrom + "T00:00:00");
      const end = new Date(dateTo   + "T00:00:00");
      while (cur <= end) {
        const y  = cur.getFullYear();
        const q  = Math.ceil((cur.getMonth() + 1) / 3);
        const sm = (q - 1) * 3 + 1;
        const em = sm + 2;
        const lastDay = new Date(y, em, 0).getDate();
        periods.push({
          period: `${y}-Q${q}`,
          label:  `Q${q} ${y}`,
          start:  `${y}-${String(sm).padStart(2, "0")}-01`,
          end:    `${y}-${String(em).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
        });
        cur.setMonth(cur.getMonth() + 3);
      }
    } else {
      const cur = new Date(dateFrom + "T00:00:00");
      const end = new Date(dateTo   + "T00:00:00");
      cur.setDate(1);
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = cur.getMonth() + 1;
        const lastDay = new Date(y, m, 0).getDate();
        const ms = String(m).padStart(2, "0");
        periods.push({
          period: `${y}-${ms}`,
          label:  `${ms}/${y}`,
          start:  `${y}-${ms}-01`,
          end:    `${y}-${ms}-${String(lastDay).padStart(2, "0")}`,
        });
        cur.setMonth(cur.getMonth() + 1);
      }
    }

    if (periods.length === 0) return res.json({ data: [] });

    const overallEnd = periods[periods.length - 1].end;

    try {
      const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

      // Fetch all data in parallel; some need all-time data for running totals
      const [tecRes, invRes, ppRes, payRes, projectsRes, allInvRes, allPpRes] = await Promise.all([
        supabase.from("TEC")
          .select("DATE_VOUCHER, QUANTITY_INT, CP_TOT")
          .eq("TENANT_ID", tenantId)
          .gte("DATE_VOUCHER", dateFrom)
          .lte("DATE_VOUCHER", overallEnd),
        supabase.from("INVOICE")
          .select("INVOICE_DATE, TOTAL_AMOUNT_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .neq("INVOICE_TYPE", "stornorechnung")
          .neq("INVOICE_TYPE", "storno_partial")
          .gte("INVOICE_DATE", dateFrom)
          .lte("INVOICE_DATE", overallEnd),
        supabase.from("PARTIAL_PAYMENT")
          .select("PARTIAL_PAYMENT_DATE, AMOUNT_NET, AMOUNT_EXTRAS_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .is("CANCELS_PARTIAL_PAYMENT_ID", null)
          .gte("PARTIAL_PAYMENT_DATE", dateFrom)
          .lte("PARTIAL_PAYMENT_DATE", overallEnd),
        supabase.from("PAYMENT")
          .select("PAYMENT_DATE, AMOUNT_PAYED_NET")
          .eq("TENANT_ID", tenantId)
          .gte("PAYMENT_DATE", dateFrom)
          .lte("PAYMENT_DATE", overallEnd),
        supabase.from("PROJECT")
          .select("ID, BUDGET_TOTAL_NET, created_at")
          .eq("TENANT_ID", tenantId)
          .not("BUDGET_TOTAL_NET", "is", null),
        // All-time invoices for running backlog calculation
        supabase.from("INVOICE")
          .select("INVOICE_DATE, TOTAL_AMOUNT_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .neq("INVOICE_TYPE", "stornorechnung")
          .neq("INVOICE_TYPE", "storno_partial")
          .lte("INVOICE_DATE", overallEnd),
        supabase.from("PARTIAL_PAYMENT")
          .select("PARTIAL_PAYMENT_DATE, AMOUNT_NET, AMOUNT_EXTRAS_NET")
          .eq("TENANT_ID", tenantId)
          .eq("STATUS_ID", 2)
          .is("CANCELS_PARTIAL_PAYMENT_ID", null)
          .lte("PARTIAL_PAYMENT_DATE", overallEnd),
      ]);

      const tec      = tecRes.data      || [];
      const invoices = invRes.data      || [];
      const pps      = ppRes.data       || [];
      const payments = payRes.data      || [];
      const projects = projectsRes.data || [];
      const allInv   = allInvRes.data   || [];
      const allPp    = allPpRes.data    || [];

      const result = periods.map(p => {
        const periodTec = tec.filter(r => r.DATE_VOUCHER >= p.start && r.DATE_VOUCHER <= p.end);
        const stunden   = round2(periodTec.reduce((s, r) => s + Number(r.QUANTITY_INT || 0), 0));
        const kosten    = round2(periodTec.reduce((s, r) => s + Number(r.CP_TOT || 0), 0));

        const periodInv = invoices.filter(r => r.INVOICE_DATE >= p.start && r.INVOICE_DATE <= p.end);
        const periodPp  = pps.filter(r => r.PARTIAL_PAYMENT_DATE >= p.start && r.PARTIAL_PAYMENT_DATE <= p.end);
        const fakturiert = round2(
          periodInv.reduce((s, r) => s + Number(r.TOTAL_AMOUNT_NET || 0), 0) +
          periodPp.reduce((s, r) => s + Number(r.AMOUNT_NET || 0) + Number(r.AMOUNT_EXTRAS_NET || 0), 0)
        );

        const periodPay = payments.filter(r => r.PAYMENT_DATE >= p.start && r.PAYMENT_DATE <= p.end);
        const bezahlt   = round2(periodPay.reduce((s, r) => s + Number(r.AMOUNT_PAYED_NET || 0), 0));

        const db      = round2(fakturiert - kosten);
        const dbMarge = fakturiert > 0 ? round2((db / fakturiert) * 100) : null;
        const avgStundensatz = stunden > 0 ? round2(kosten / stunden) : null;

        // Auftragsbestand: sum of project budgets created up to period end, minus total billed up to period end
        const contractedUpTo = projects
          .filter(pr => pr.created_at && pr.created_at.slice(0, 10) <= p.end)
          .reduce((s, pr) => s + Number(pr.BUDGET_TOTAL_NET || 0), 0);
        const billedUpTo = round2(
          allInv.filter(r => r.INVOICE_DATE <= p.end)
            .reduce((s, r) => s + Number(r.TOTAL_AMOUNT_NET || 0), 0) +
          allPp.filter(r => r.PARTIAL_PAYMENT_DATE <= p.end)
            .reduce((s, r) => s + Number(r.AMOUNT_NET || 0) + Number(r.AMOUNT_EXTRAS_NET || 0), 0)
        );
        const auftragsbestand = round2(Math.max(0, contractedUpTo - billedUpTo));

        return {
          period:          p.period,
          period_label:    p.label,
          period_start:    p.start,
          period_end:      p.end,
          stunden,
          kosten,
          avg_stundensatz: avgStundensatz,
          fakturiert,
          bezahlt,
          db,
          db_marge:        dbMarge,
          auftragsbestand,
        };
      });

      res.json({ data: result });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  return router;
};
