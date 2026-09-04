const express = require("express");
const { requirePermission } = require("../middleware/permissions");
const wipSvc = require("../services/wipReport");
const { loadParentSurchargesByProject: loadSurcharges } = require("../services/reportSurcharges");

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

  // Zuschläge der Nicht-Blattknoten und der Projektebene, die die blattbasierten
  // Views nicht sehen. Logik liegt in services/reportSurcharges.js, damit der
  // Report „Teilfertige Leistungen" dieselbe Korrektur benutzt und nicht eine
  // zweite Kopie davon.
  // Returns Map<projectId(string), surchargeSum(number)>
  const loadParentSurchargesByProject = (projectIds, tenantId) =>
    loadSurcharges(supabase, tenantId, projectIds);

  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

  // Aggregierter Projektverlauf (kumulierte Honorar/Leistung/Kosten/Abgerechnet/
  // Bezahlt-Kurven über die Zeit). projectIds = Array (Teilmenge) ODER null (alle
  // Projekte des Mandanten). Wird von /projects/timeline UND /dashboard/projects-
  // timeline genutzt. Gibt ein (ggf. leeres) Array zurück.
  async function buildProjectsTimeline(tenantId, dateFrom, dateTo, projectIds) {
    let structQ = supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, PROJECT_ID, FATHER_ID, BILLING_TYPE_ID, REVENUE, EXTRAS, created_at")
      .eq("TENANT_ID", tenantId);
    if (projectIds) structQ = structQ.in("PROJECT_ID", projectIds);
    const { data: structures, error: sErr } = await structQ;
    if (sErr) throw sErr;
    if (!structures || structures.length === 0) return [];

    const fatherIds = new Set(structures.map(s => s.FATHER_ID).filter(Boolean));
    const leaves    = structures.filter(s => !fatherIds.has(s.ID));
    const leafIds   = leaves.map(s => s.ID);
    if (leafIds.length === 0) return [];

    const { data: progressRows } = await supabase
      .from("PROJECT_PROGRESS")
      .select("STRUCTURE_ID, REVENUE, EXTRAS, REVENUE_COMPLETION, EXTRAS_COMPLETION, created_at")
      .eq("TENANT_ID", tenantId)
      .in("STRUCTURE_ID", leafIds)
      .order("created_at", { ascending: true });

    let tecQ = supabase
      .from("TEC")
      .select("STRUCTURE_ID, DATE_VOUCHER, CP_TOT, SP_TOT")
      .eq("TENANT_ID", tenantId)
      .in("STRUCTURE_ID", leafIds)
      .order("DATE_VOUCHER", { ascending: true });
    if (dateTo) tecQ = tecQ.lte("DATE_VOUCHER", dateTo);
    const { data: tecRows } = await tecQ;

    let ppQ = supabase
      .from("PARTIAL_PAYMENT")
      .select("PARTIAL_PAYMENT_DATE, AMOUNT_NET, AMOUNT_EXTRAS_NET")
      .eq("TENANT_ID", tenantId)
      .eq("STATUS_ID", 2)
      .order("PARTIAL_PAYMENT_DATE", { ascending: true });
    if (projectIds) ppQ = ppQ.in("PROJECT_ID", projectIds);
    if (dateTo) ppQ = ppQ.lte("PARTIAL_PAYMENT_DATE", dateTo);
    const { data: ppRows } = await ppQ;

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

    let payQ = supabase
      .from("PAYMENT")
      .select("PAYMENT_DATE, AMOUNT_PAYED_NET")
      .eq("TENANT_ID", tenantId)
      .order("PAYMENT_DATE", { ascending: true });
    if (projectIds) payQ = payQ.in("PROJECT_ID", projectIds);
    if (dateTo) payQ = payQ.lte("PAYMENT_DATE", dateTo);
    const { data: payRows } = await payQ;

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
    if (sortedDates.length === 0) return [];

    const distinctProjectIds = [...new Set(structures.map(s => s.PROJECT_ID).filter(Boolean))];
    const parentSurchargesMap = await loadParentSurchargesByProject(distinctProjectIds, tenantId);
    let totalParentSurcharges = 0;
    for (const v of parentSurchargesMap.values()) totalParentSurcharges += v;

    return sortedDates.map(date => {
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

    // Add parent-level surcharges (leaf-based view misses these)
    const parentSurchargesMap = await loadParentSurchargesByProject([projectId], tenantId);
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

  // ── Leistungsphasen-Report (einzelnes Projekt) ───────────────────────────
  // Aggregiert die Blatt-Kennzahlen der Projektstruktur je HOAI-Leistungsphase.
  // Eine Buchung/ein Blatt gehört zu der Phase, die man findet, wenn man im
  // Strukturbaum über FATHER_ID nach oben läuft, bis ein Knoten mit
  // FEE_CALC_PHASE_ID (= aus einer Honorarberechnung erzeugter LPH-Knoten)
  // erreicht ist. Metriken kommen unverändert aus der bestehenden Struktur-View,
  // damit die LPH-Summen mit der Projektelement-Tabelle übereinstimmen.
  //
  // Antwort: { data: { hasPhases, phases: [ … ], totals: { … } } }
  // hasPhases=false → das Projekt wurde nicht aus einer HOAI-Berechnung erzeugt;
  // das Frontend blendet den Report dann aus.
  router.get("/project/:projectId/phases", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const projectId = parseInt(req.params.projectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "Ungültige Projekt-ID." });

    // Sortierschlüssel: führende Zahl aus dem Kürzel ("LPH 5" → 5). Phasen sind
    // nicht garantiert in LPH-Reihenfolge angelegt (z. B. Bauleitplanung).
    const phaseSortKey = (nameShort) => {
      const m = String(nameShort || "").match(/\d+/);
      return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
    };

    try {
      // 1) Strukturknoten (für Baum + LPH-Zuordnung + Phasen-Labels)
      const { data: nodes, error: nErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, FATHER_ID, NAME_SHORT, NAME_LONG, FEE_CALC_PHASE_ID")
        .eq("TENANT_ID", tenantId)
        .eq("PROJECT_ID", projectId);
      if (nErr) return res.status(500).json({ error: nErr.message });
      if (!nodes || nodes.length === 0) {
        return res.json({ data: { hasPhases: false, phases: [], totals: null } });
      }

      const byId       = new Map(nodes.map((n) => [n.ID, n]));
      const hasPhases  = nodes.some((n) => n.FEE_CALC_PHASE_ID != null);
      if (!hasPhases) {
        return res.json({ data: { hasPhases: false, phases: [], totals: null } });
      }

      // Für jeden Knoten den LPH-Vorfahren (Strukturknoten mit FEE_CALC_PHASE_ID)
      // ermitteln. Zyklen-Schutz über besuchte IDs.
      const phaseAncestor = (startId) => {
        let cur = byId.get(startId);
        const seen = new Set();
        while (cur && !seen.has(cur.ID)) {
          if (cur.FEE_CALC_PHASE_ID != null) return cur;
          seen.add(cur.ID);
          cur = cur.FATHER_ID != null ? byId.get(cur.FATHER_ID) : null;
        }
        return null;
      };

      // 2) Blatt-Kennzahlen aus der bestehenden Struktur-View (gleiche Zahlen
      //    wie die Projektelement-Tabelle).
      const { data: viewRows, error: vErr } = await supabase
        .from("VW_REPORT_PROJECT_DETAIL_STRUCTURE")
        .select("STRUCTURE_ID, IS_LEAF, HOURS_TOTAL, COST_TOTAL, EARNED_VALUE_NET, HONORAR_NET")
        .eq("TENANT_ID", tenantId)
        .eq("PROJECT_ID", projectId);
      if (vErr) return res.status(500).json({ error: vErr.message });

      // 3) Blätter je Phase (bzw. "ohne Phasenzuordnung") aggregieren.
      const buckets = new Map(); // key: phaseNodeId | "none"
      const ensure  = (key, meta) => {
        if (!buckets.has(key)) {
          buckets.set(key, {
            key, ...meta,
            HONORAR_NET: 0, EARNED_VALUE_NET: 0, HOURS_TOTAL: 0, COST_TOTAL: 0,
          });
        }
        return buckets.get(key);
      };

      for (const r of (viewRows || [])) {
        if (!r.IS_LEAF) continue;
        const anc = phaseAncestor(r.STRUCTURE_ID);
        let bucket;
        if (anc) {
          bucket = ensure(anc.ID, {
            PHASE_STRUCTURE_ID: anc.ID,
            CALC_PHASE_ID: anc.FEE_CALC_PHASE_ID,
            NAME_SHORT: anc.NAME_SHORT,
            NAME_LONG:  anc.NAME_LONG,
            SORT_KEY:   phaseSortKey(anc.NAME_SHORT),
            IS_UNASSIGNED: false,
          });
        } else {
          bucket = ensure("none", {
            PHASE_STRUCTURE_ID: null,
            NAME_SHORT: "Ohne Phasenzuordnung",
            NAME_LONG:  null,
            SORT_KEY:   Number.MAX_SAFE_INTEGER,
            IS_UNASSIGNED: true,
          });
        }
        bucket.HONORAR_NET      += Number(r.HONORAR_NET      || 0);
        bucket.EARNED_VALUE_NET += Number(r.EARNED_VALUE_NET || 0);
        bucket.HOURS_TOTAL      += Number(r.HOURS_TOTAL      || 0);
        bucket.COST_TOTAL       += Number(r.COST_TOTAL       || 0);
      }

      // 4) Kennzahlen je Phase ableiten (Kostenquote, DB, Leistungsstand %, Ampel).
      const decorate = (b) => {
        const honorar = round2(b.HONORAR_NET);
        const earned  = round2(b.EARNED_VALUE_NET);
        const cost    = round2(b.COST_TOTAL);
        const hours   = round2(b.HOURS_TOTAL);
        const lstPct  = honorar > 0 ? round2((earned / honorar) * 100) : null;
        // Kostenquote gegen erbrachte Leistung (wie in der Struktur-View).
        const kq      = earned > 0 ? cost / earned : null;
        const db      = round2(earned - cost);
        const flags   = [];
        if (kq != null && kq >= 0.9)                       flags.push("kostenquote_kritisch");
        else if (kq != null && kq >= 0.75)                 flags.push("kostenquote_warn");
        if (db < 0 && (cost > 500 || earned > 500))        flags.push("db_negativ");
        let ampel = "gruen";
        if (flags.includes("kostenquote_kritisch") || flags.includes("db_negativ")) ampel = "rot";
        else if (flags.includes("kostenquote_warn"))                                ampel = "orange";
        return {
          PHASE_STRUCTURE_ID: b.PHASE_STRUCTURE_ID,
          CALC_PHASE_ID: b.CALC_PHASE_ID ?? null,
          NAME_SHORT: b.NAME_SHORT,
          NAME_LONG:  b.NAME_LONG,
          IS_UNASSIGNED: b.IS_UNASSIGNED,
          SORT_KEY: b.SORT_KEY,
          HONORAR_NET: honorar,
          EARNED_VALUE_NET: earned,
          LEISTUNGSSTAND_PERCENT: lstPct,
          HOURS_TOTAL: hours,
          COST_TOTAL: cost,
          KOSTENQUOTE: kq,
          DB: db,
          ampel, flags,
        };
      };

      const phases = [...buckets.values()]
        .map(decorate)
        .filter((p) => p.HONORAR_NET !== 0 || p.COST_TOTAL !== 0 || p.HOURS_TOTAL !== 0)
        .sort((a, b) => a.SORT_KEY - b.SORT_KEY
          || String(a.NAME_SHORT).localeCompare(String(b.NAME_SHORT)));

      // 4b) Block-Zuordnung auflösen: Phasenknoten → FEE_CALCULATION_PHASE →
      //     FEE_PHASE.BLOCK_ID → LPH_BLOCK. Soft-fail, wenn Migration 0097 fehlt.
      let hasBlocks = false;
      try {
        const calcPhaseIds = [...new Set(phases.map((p) => p.CALC_PHASE_ID).filter(Boolean))];
        if (calcPhaseIds.length) {
          const { data: calcPhases, error: cpErr } = await supabase
            .from("FEE_CALCULATION_PHASE").select("ID, FEE_PHASE_ID").in("ID", calcPhaseIds);
          if (cpErr) throw cpErr;
          const calcToFeePhase = new Map((calcPhases || []).map((r) => [r.ID, r.FEE_PHASE_ID]));
          const feePhaseIds = [...new Set((calcPhases || []).map((r) => r.FEE_PHASE_ID).filter(Boolean))];

          // Mandantengetrennte Zuordnung aus der Join-Tabelle (FEE_PHASE ist global).
          let feePhaseToBlock = new Map();
          if (feePhaseIds.length) {
            const { data: links, error: fpErr } = await supabase
              .from("LPH_BLOCK_PHASE").select("FEE_PHASE_ID, BLOCK_ID")
              .eq("TENANT_ID", tenantId).in("FEE_PHASE_ID", feePhaseIds);
            if (fpErr) throw fpErr; // fehlende Tabelle → catch unten
            feePhaseToBlock = new Map((links || []).map((r) => [r.FEE_PHASE_ID, r.BLOCK_ID]));
          }

          const blockIds = [...new Set([...feePhaseToBlock.values()].filter(Boolean))];
          let blockMeta = new Map();
          if (blockIds.length) {
            const { data: blocks, error: blErr } = await supabase
              .from("LPH_BLOCK").select("ID, NAME_SHORT, SORT_ORDER")
              .eq("TENANT_ID", tenantId).in("ID", blockIds);
            if (blErr) throw blErr;
            blockMeta = new Map((blocks || []).map((r) => [r.ID, r]));
          }

          for (const p of phases) {
            const feePhaseId = p.CALC_PHASE_ID != null ? calcToFeePhase.get(p.CALC_PHASE_ID) : null;
            const blockId    = feePhaseId != null ? feePhaseToBlock.get(feePhaseId) : null;
            const meta       = blockId != null ? blockMeta.get(blockId) : null;
            p.BLOCK_ID   = blockId ?? null;
            p.BLOCK_NAME = meta ? meta.NAME_SHORT : null;
            p.BLOCK_SORT = meta ? Number(meta.SORT_ORDER) : null;
            if (meta) hasBlocks = true;
          }
        }
      } catch (blockErr) {
        // Migration 0097 noch nicht gelaufen o. Ä. → Report bleibt ohne Blöcke.
        for (const p of phases) { p.BLOCK_ID = null; p.BLOCK_NAME = null; p.BLOCK_SORT = null; }
        hasBlocks = false;
      }

      // Internes Feld nicht ausliefern.
      for (const p of phases) delete p.CALC_PHASE_ID;

      // 5) Summenzeile.
      const sum = (k) => phases.reduce((s, p) => s + Number(p[k] || 0), 0);
      const tHonorar = round2(sum("HONORAR_NET"));
      const tEarned  = round2(sum("EARNED_VALUE_NET"));
      const tCost    = round2(sum("COST_TOTAL"));
      const totals = {
        HONORAR_NET: tHonorar,
        EARNED_VALUE_NET: tEarned,
        LEISTUNGSSTAND_PERCENT: tHonorar > 0 ? round2((tEarned / tHonorar) * 100) : null,
        HOURS_TOTAL: round2(sum("HOURS_TOTAL")),
        COST_TOTAL: tCost,
        KOSTENQUOTE: tEarned > 0 ? tCost / tEarned : null,
        DB: round2(tEarned - tCost),
      };

      res.json({ data: { hasPhases: true, hasBlocks, phases, totals } });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // ── Portfolio: Leistungsphasen-Matrix über alle (in-scope) Projekte ───────
  // Universelle Dimension über Projekte hinweg ist die LPH-Nummer (aus dem
  // Kürzel "LPH n"), da Blocknamen je Leistungsbild variieren. Liefert:
  //   - phases:   vorhandene LPH-Nummern (Spalten) mit Beispiel-Label
  //   - projects: je Projekt eine Zeile mit Zellen je LPH + Projektsumme
  //   - byPhase:  Portfolio-Aggregat je LPH inkl. Stunden-/Honoraranteil
  //   - totals:   Gesamtsumme
  router.get("/phases/matrix", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;

    const phaseNum = (nameShort) => {
      const m = String(nameShort || "").match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    };
    const ampelFor = (earned, cost) => {
      const kq = earned > 0 ? cost / earned : null;
      const db = earned - cost;
      if ((kq != null && kq >= 0.9) || (db < 0 && (cost > 500 || earned > 500))) return "rot";
      if (kq != null && kq >= 0.75) return "orange";
      return "gruen";
    };

    try {
      // Projekte des Mandanten (ggf. auf Reporting-Scope eingeschränkt).
      let projQ = supabase
        .from("PROJECT")
        .select("ID, NAME_SHORT, NAME_LONG")
        .eq("TENANT_ID", tenantId);
      const { data: allProjects, error: pErr } = await projQ;
      if (pErr) return res.status(500).json({ error: pErr.message });

      let projects = allProjects || [];
      if (req.reportScopeProjectIds !== null) {
        projects = projects.filter((p) => req.reportScopeProjectIds.has(p.ID));
      }
      if (projects.length === 0) {
        return res.json({ data: { phases: [], projects: [], byPhase: [], totals: null } });
      }
      const projectIds = projects.map((p) => p.ID);

      // Strukturknoten + Blatt-Kennzahlen in einem Rutsch für alle Projekte.
      const [{ data: nodes, error: nErr }, { data: viewRows, error: vErr }] = await Promise.all([
        supabase.from("PROJECT_STRUCTURE")
          .select("ID, PROJECT_ID, FATHER_ID, NAME_SHORT, FEE_CALC_PHASE_ID")
          .eq("TENANT_ID", tenantId).in("PROJECT_ID", projectIds),
        supabase.from("VW_REPORT_PROJECT_DETAIL_STRUCTURE")
          .select("STRUCTURE_ID, PROJECT_ID, IS_LEAF, HOURS_TOTAL, COST_TOTAL, EARNED_VALUE_NET, HONORAR_NET")
          .eq("TENANT_ID", tenantId).in("PROJECT_ID", projectIds),
      ]);
      if (nErr) return res.status(500).json({ error: nErr.message });
      if (vErr) return res.status(500).json({ error: vErr.message });

      // Knoten je Projekt indexieren.
      const byIdPerProject = new Map(); // projectId → Map(nodeId → node)
      for (const n of (nodes || [])) {
        if (!byIdPerProject.has(n.PROJECT_ID)) byIdPerProject.set(n.PROJECT_ID, new Map());
        byIdPerProject.get(n.PROJECT_ID).set(n.ID, n);
      }
      const phaseAncestor = (projectId, startId) => {
        const byId = byIdPerProject.get(projectId);
        if (!byId) return null;
        let cur = byId.get(startId);
        const seen = new Set();
        while (cur && !seen.has(cur.ID)) {
          if (cur.FEE_CALC_PHASE_ID != null) return cur;
          seen.add(cur.ID);
          cur = cur.FATHER_ID != null ? byId.get(cur.FATHER_ID) : null;
        }
        return null;
      };

      // Aggregation: matrix[projectId][phaseNum] und portfolioByPhase[phaseNum].
      const emptyAgg = () => ({ HONORAR_NET: 0, EARNED_VALUE_NET: 0, HOURS_TOTAL: 0, COST_TOTAL: 0 });
      const matrix       = new Map(); // projectId → Map(num → agg)
      const phaseLabels  = new Map(); // num → label (erstes gesehenes)
      const byPhase      = new Map(); // num → agg
      const projectsWithPhases = new Set();

      for (const r of (viewRows || [])) {
        if (!r.IS_LEAF) continue;
        const anc = phaseAncestor(r.PROJECT_ID, r.STRUCTURE_ID);
        if (!anc) continue; // nur phasenzugeordnete Blätter zählen
        const num = phaseNum(anc.NAME_SHORT);
        if (num == null) continue;
        projectsWithPhases.add(r.PROJECT_ID);
        if (!phaseLabels.has(num)) phaseLabels.set(num, anc.NAME_SHORT);

        if (!matrix.has(r.PROJECT_ID)) matrix.set(r.PROJECT_ID, new Map());
        const pm = matrix.get(r.PROJECT_ID);
        if (!pm.has(num)) pm.set(num, emptyAgg());
        if (!byPhase.has(num)) byPhase.set(num, emptyAgg());
        for (const agg of [pm.get(num), byPhase.get(num)]) {
          agg.HONORAR_NET      += Number(r.HONORAR_NET      || 0);
          agg.EARNED_VALUE_NET += Number(r.EARNED_VALUE_NET || 0);
          agg.HOURS_TOTAL      += Number(r.HOURS_TOTAL      || 0);
          agg.COST_TOTAL       += Number(r.COST_TOTAL       || 0);
        }
      }

      const phaseNumsSorted = [...phaseLabels.keys()].sort((a, b) => a - b);
      const phasesOut = phaseNumsSorted.map((num) => ({ num, label: phaseLabels.get(num) }));

      const decorateCell = (agg) => {
        const honorar = round2(agg.HONORAR_NET);
        const earned  = round2(agg.EARNED_VALUE_NET);
        const cost    = round2(agg.COST_TOTAL);
        return {
          HONORAR_NET: honorar,
          EARNED_VALUE_NET: earned,
          HOURS_TOTAL: round2(agg.HOURS_TOTAL),
          COST_TOTAL: cost,
          LEISTUNGSSTAND_PERCENT: honorar > 0 ? round2((earned / honorar) * 100) : null,
          KOSTENQUOTE: earned > 0 ? cost / earned : null,
          DB: round2(earned - cost),
          ampel: ampelFor(earned, cost),
        };
      };

      // Projektzeilen (nur Projekte mit Phasenstruktur).
      const projectRows = projects
        .filter((p) => projectsWithPhases.has(p.ID))
        .map((p) => {
          const pm = matrix.get(p.ID) || new Map();
          const cells = {};
          const tot = emptyAgg();
          for (const num of phaseNumsSorted) {
            const agg = pm.get(num);
            if (!agg) continue;
            cells[num] = decorateCell(agg);
            tot.HONORAR_NET += agg.HONORAR_NET; tot.EARNED_VALUE_NET += agg.EARNED_VALUE_NET;
            tot.HOURS_TOTAL += agg.HOURS_TOTAL; tot.COST_TOTAL += agg.COST_TOTAL;
          }
          return {
            PROJECT_ID: p.ID, NAME_SHORT: p.NAME_SHORT, NAME_LONG: p.NAME_LONG,
            cells, total: decorateCell(tot),
          };
        })
        .sort((a, b) => String(a.NAME_SHORT).localeCompare(String(b.NAME_SHORT)));

      // Portfolio-Gesamtsummen für Anteile.
      let totHonorar = 0, totHours = 0;
      for (const agg of byPhase.values()) { totHonorar += agg.HONORAR_NET; totHours += agg.HOURS_TOTAL; }

      const byPhaseOut = phaseNumsSorted.map((num) => {
        const agg = byPhase.get(num) || emptyAgg();
        const cell = decorateCell(agg);
        return {
          num, label: phaseLabels.get(num), ...cell,
          // Anteil an Stunden vs. Anteil am Honorar — Ist-Stundenlast vs.
          // HOAI-Gewichtung. Weichen sie stark ab, wird die Phase über-/unterkalkuliert.
          HOURS_SHARE:   totHours   > 0 ? round2((agg.HOURS_TOTAL / totHours)   * 100) : null,
          HONORAR_SHARE: totHonorar > 0 ? round2((agg.HONORAR_NET / totHonorar) * 100) : null,
        };
      });

      const grandTot = emptyAgg();
      for (const agg of byPhase.values()) {
        grandTot.HONORAR_NET += agg.HONORAR_NET; grandTot.EARNED_VALUE_NET += agg.EARNED_VALUE_NET;
        grandTot.HOURS_TOTAL += agg.HOURS_TOTAL; grandTot.COST_TOTAL += agg.COST_TOTAL;
      }

      res.json({ data: {
        phases: phasesOut,
        projects: projectRows,
        byPhase: byPhaseOut,
        totals: projectRows.length ? decorateCell(grandTot) : null,
      }});
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
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
    const parentSurchargesMap = await loadParentSurchargesByProject(projectIds, tenantId);
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
      const parentSurchargesMap = await loadParentSurchargesByProject([projectId], tenantId);
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
      const data = await buildProjectsTimeline(tenantId, dateFrom, dateTo, projectIds);
      res.json({ data });
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
    const parentSurchargesMap = await loadParentSurchargesByProject(projectIds, tenantId);
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
    // scope=own → nur Projekte, in denen der eingeloggte Nutzer Projektleiter ist
    // (Projektleiter-Dashboard). Sonst: alle Projekte des Mandanten.
    const scopeOwn = req.query.scope === "own";
    let query = supabase
      .from("VW_REPORT_PROJECT_DETAIL")
      .select([
        "PROJECT_ID", "NAME_SHORT", "NAME_LONG",
        "PROJECT_STATUS_ID", "PROJECT_STATUS_NAME_SHORT",
        "PROJECT_MANAGER_ID", "PROJECT_MANAGER_DISPLAY",
        "DEPARTMENT_ID", "DEPARTMENT_NAME",
        "BUDGET_TOTAL_NET", "LEISTUNGSSTAND_PERCENT", "LEISTUNGSSTAND_VALUE",
        "COST_TOTAL", "COST_RATIO", "BILLED_NET_TOTAL", "OPEN_NET_TOTAL",
      ].join(", "))
      .eq("TENANT_ID", tenantId);
    if (scopeOwn) {
      if (!req.employeeId) return res.json({ data: [] });
      query = query.eq("PROJECT_MANAGER_ID", req.employeeId);
    }
    const { data, error } = await query.order("BUDGET_TOTAL_NET", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Add parent-level surcharges per project (leaf-based view misses these)
    const projIds = (data || []).map(p => p.PROJECT_ID).filter(Boolean);
    const parentSurchargesMap = await loadParentSurchargesByProject(projIds, tenantId);

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

    // Interne Positionen (IS_INTERNAL) sind nicht abrechenbar — der Rechnungs-
    // Wizard schließt sie aus, die View VW_REPORT_PROJECT_DETAIL zählt sie aber
    // noch mit. Daher hier den Fertigstellungswert interner Blatt-Elemente vom
    // offenen Betrag abziehen: open_ohne_intern = open − Fertigstellung(intern).
    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const projectIds = [...new Set((data || []).map((p) => p.PROJECT_ID))];
    const internalByProject = new Map();
    if (projectIds.length) {
      const { data: structs } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, PROJECT_ID, FATHER_ID, BILLING_TYPE_ID, REVENUE_COMPLETION, EXTRAS_COMPLETION, IS_INTERNAL")
        .eq("TENANT_ID", tenantId)
        .in("PROJECT_ID", projectIds);
      const all = structs || [];
      const parentIds = new Set(all.filter((s) => s.FATHER_ID != null).map((s) => String(s.FATHER_ID)));
      const internalLeaves = all.filter((s) => s.IS_INTERNAL && !parentIds.has(String(s.ID)));
      // BT=2-Blätter: Erlös = Σ TEC.SP_TOT; BT=1-Blätter: REVENUE_COMPLETION + EXTRAS_COMPLETION.
      const bt2Ids = internalLeaves.filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
      const spBySid = new Map();
      if (bt2Ids.length) {
        const { data: tec } = await supabase
          .from("TEC").select("STRUCTURE_ID, SP_TOT").in("STRUCTURE_ID", bt2Ids).neq("STATUS", "DRAFT");
        for (const t of tec || []) {
          const k = String(t.STRUCTURE_ID);
          spBySid.set(k, (spBySid.get(k) || 0) + Number(t.SP_TOT || 0));
        }
      }
      for (const s of internalLeaves) {
        const val = Number(s.BILLING_TYPE_ID) === 2
          ? (spBySid.get(String(s.ID)) || 0)
          : (Number(s.REVENUE_COMPLETION || 0) + Number(s.EXTRAS_COMPLETION || 0));
        const k = String(s.PROJECT_ID);
        internalByProject.set(k, (internalByProject.get(k) || 0) + val);
      }
    }

    const projects = (data || [])
      .map((p) => ({
        PROJECT_ID:              p.PROJECT_ID,
        NAME_SHORT:              p.NAME_SHORT,
        NAME_LONG:               p.NAME_LONG,
        PROJECT_MANAGER_DISPLAY: p.PROJECT_MANAGER_DISPLAY,
        OPEN_NET_TOTAL:          round2(Math.max(0, (Number(p.OPEN_NET_TOTAL) || 0) - (internalByProject.get(String(p.PROJECT_ID)) || 0))),
      }))
      .filter((p) => p.OPEN_NET_TOTAL > 0.005)
      .sort((a, b) => b.OPEN_NET_TOTAL - a.OPEN_NET_TOTAL);

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

  // Größte offene Posten: unbezahlte Rechnungen + Abschlagsrechnungen
  // (finalisiert, nicht storniert, offener Brutto-Betrag = Brutto − Zahlungen > 0),
  // absteigend nach offenem Betrag. Query: ?limit=10
  router.get("/dashboard/open-invoices", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const today = new Date().toISOString().slice(0, 10);
    try {
      const [{ data: invs, error: ie }, { data: pps, error: pe }] = await Promise.all([
        supabase.from("INVOICE")
          .select("ID, INVOICE_NUMBER, INVOICE_DATE, DUE_DATE, TOTAL_AMOUNT_GROSS, ADDRESS_NAME_1, PROJECT_ID")
          .eq("TENANT_ID", tenantId).eq("STATUS_ID", 2)
          .neq("INVOICE_TYPE", "stornorechnung").neq("INVOICE_TYPE", "storno_partial"),
        supabase.from("PARTIAL_PAYMENT")
          .select("ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, DUE_DATE, TOTAL_AMOUNT_GROSS, ADDRESS_NAME_1, PROJECT_ID")
          .eq("TENANT_ID", tenantId).eq("STATUS_ID", 2)
          .is("CANCELS_PARTIAL_PAYMENT_ID", null),
      ]);
      if (ie) throw ie;
      if (pe) throw pe;

      const invIds = (invs || []).map(r => r.ID);
      const ppIds  = (pps  || []).map(r => r.ID);
      const invPay = {}, ppPay = {};
      if (invIds.length) {
        const { data: pays } = await supabase.from("PAYMENT")
          .select("INVOICE_ID, AMOUNT_PAYED_GROSS").in("INVOICE_ID", invIds);
        for (const p of (pays || [])) invPay[p.INVOICE_ID] = (invPay[p.INVOICE_ID] || 0) + parseFloat(p.AMOUNT_PAYED_GROSS ?? "0");
      }
      if (ppIds.length) {
        const { data: pays } = await supabase.from("PAYMENT")
          .select("PARTIAL_PAYMENT_ID, AMOUNT_PAYED_GROSS").in("PARTIAL_PAYMENT_ID", ppIds);
        for (const p of (pays || [])) ppPay[p.PARTIAL_PAYMENT_ID] = (ppPay[p.PARTIAL_PAYMENT_ID] || 0) + parseFloat(p.AMOUNT_PAYED_GROSS ?? "0");
      }

      const daysOverdue = (due) => (due && due < today) ? Math.floor((new Date(today) - new Date(due)) / 86400000) : 0;
      const posten = [];
      for (const inv of (invs || [])) {
        const open = round2(Math.max(0, Number(inv.TOTAL_AMOUNT_GROSS || 0) - (invPay[inv.ID] || 0)));
        if (open <= 0.005) continue;
        posten.push({
          sourceType: "invoice", sourceId: inv.ID, number: inv.INVOICE_NUMBER || `#${inv.ID}`,
          date: inv.INVOICE_DATE, dueDate: inv.DUE_DATE || null, addressName: inv.ADDRESS_NAME_1 || null,
          projectId: inv.PROJECT_ID || null, openAmount: open, daysOverdue: daysOverdue(inv.DUE_DATE),
        });
      }
      for (const pp of (pps || [])) {
        const open = round2(Math.max(0, Number(pp.TOTAL_AMOUNT_GROSS || 0) - (ppPay[pp.ID] || 0)));
        if (open <= 0.005) continue;
        posten.push({
          sourceType: "pp", sourceId: pp.ID, number: pp.PARTIAL_PAYMENT_NUMBER || `#${pp.ID}`,
          date: pp.PARTIAL_PAYMENT_DATE, dueDate: pp.DUE_DATE || null, addressName: pp.ADDRESS_NAME_1 || null,
          projectId: pp.PROJECT_ID || null, openAmount: open, daysOverdue: daysOverdue(pp.DUE_DATE),
        });
      }
      posten.sort((a, b) => b.openAmount - a.openAmount);
      res.json({ data: posten.slice(0, limit) });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Company snapshot für Dashboard-KPIs: gleitende 12 Monate (Umsatz/Stunden/MA)
  // plus aktueller Auftragsbestand. Liefert Auftragsreichweite, Umsatz pro
  // Mitarbeiter und Anteil Projektmitarbeiter — offen (kein reports.view nötig),
  // damit das Dashboard sie ohne Reporting-Recht nutzen kann.
  router.get("/dashboard/company-snapshot", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    try {
      const periodMonths = 12;
      const todayD = new Date();
      const to   = todayD.toISOString().slice(0, 10);
      const fromD = new Date(todayD); fromD.setMonth(fromD.getMonth() - periodMonths);
      const from = fromD.toISOString().slice(0, 10);

      const [invoiceRes, ppRes, tecRes, empRes, backlogRes] = await Promise.all([
        supabase.from("INVOICE").select("TOTAL_AMOUNT_NET")
          .eq("TENANT_ID", tenantId).eq("STATUS_ID", 2)
          .gte("INVOICE_DATE", from).lte("INVOICE_DATE", to)
          .neq("INVOICE_TYPE", "stornorechnung").neq("INVOICE_TYPE", "storno_partial"),
        supabase.from("PARTIAL_PAYMENT").select("AMOUNT_NET, AMOUNT_EXTRAS_NET")
          .eq("TENANT_ID", tenantId).eq("STATUS_ID", 2)
          .gte("PARTIAL_PAYMENT_DATE", from).lte("PARTIAL_PAYMENT_DATE", to)
          .is("CANCELS_PARTIAL_PAYMENT_ID", null),
        supabase.from("TEC").select("EMPLOYEE_ID, QUANTITY_INT, CP_TOT")
          .eq("TENANT_ID", tenantId).gte("DATE_VOUCHER", from).lte("DATE_VOUCHER", to),
        supabase.from("EMPLOYEE").select("ID")
          .eq("TENANT_ID", tenantId).or("ACTIVE.is.null,ACTIVE.neq.2"),
        supabase.from("VW_REPORT_PROJECT_LIST_ROOT").select("BUDGET_TOTAL_NET, BILLED_NET_TOTAL")
          .eq("TENANT_ID", tenantId),
      ]);
      for (const r of [invoiceRes, ppRes, tecRes, empRes, backlogRes]) if (r.error) throw r.error;

      const invoiceRevenue = (invoiceRes.data || []).reduce((s, r) => s + Number(r.TOTAL_AMOUNT_NET || 0), 0);
      const ppRevenue      = (ppRes.data || []).reduce((s, r) => s + Number(r.AMOUNT_NET || 0) + Number(r.AMOUNT_EXTRAS_NET || 0), 0);
      const revenue        = round2(invoiceRevenue + ppRevenue);
      const tecRows        = tecRes.data || [];
      const totalHours     = round2(tecRows.reduce((s, r) => s + Number(r.QUANTITY_INT || 0), 0));
      const directCosts    = round2(tecRows.reduce((s, r) => s + Number(r.CP_TOT || 0), 0));
      const projectEmployeeCount = new Set(tecRows.map(r => r.EMPLOYEE_ID)).size;
      const employeeCount  = (empRes.data || []).length;
      const backlog        = round2((backlogRes.data || []).reduce((s, r) =>
        s + Math.max(0, Number(r.BUDGET_TOTAL_NET || 0) - Number(r.BILLED_NET_TOTAL || 0)), 0));

      const monthlyRevenue           = revenue / periodMonths;
      const umsatzProMitarbeiter     = employeeCount > 0 ? Math.round(revenue / employeeCount) : null;
      const anteilProjektmitarbeiter = employeeCount > 0 ? Math.round((projectEmployeeCount / employeeCount) * 1000) / 10 : null;
      const auftragsreichweite       = monthlyRevenue > 0 ? Math.round((backlog / monthlyRevenue) * 10) / 10 : null;

      res.json({ data: {
        periodMonths,
        raw: { revenue, directCosts, totalHours, employeeCount, projectEmployeeCount, backlog },
        kpis: { umsatzProMitarbeiter, anteilProjektmitarbeiter, auftragsreichweite },
      }});
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Aggregierter Projektverlauf fürs Dashboard (offen, kein reports.view nötig).
  // scope=own → nur Projekte, in denen der Nutzer Projektleiter ist (Projektleiter-
  // Dashboard). date_from/date_to optional (Period-Achse).
  router.get("/dashboard/projects-timeline", async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    try {
      let projectIds = null;
      if (req.query.scope === "own") {
        if (!req.employeeId) return res.json({ data: [] });
        const { data: own } = await supabase
          .from("PROJECT").select("ID")
          .eq("TENANT_ID", tenantId).eq("PROJECT_MANAGER_ID", req.employeeId);
        projectIds = (own || []).map(r => r.ID);
        if (projectIds.length === 0) return res.json({ data: [] });
      }
      const data = await buildProjectsTimeline(tenantId, dateFrom, dateTo, projectIds);
      res.json({ data });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
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

  // ── Teilfertige Leistungen (kaufmaennischer Abschluss-Report) ─────────────
  // Konzept: docs/TEILFERTIGE_LEISTUNGEN_CONCEPT.md
  //
  // Der Report ist eine Unternehmenszahl, keine Projektkennzahl. Ohne
  // reports.scope.all saehe der Nutzer eine auf seine Projekte gefilterte
  // Summe — die sieht aus wie eine Bilanzposition, ist aber keine. Deshalb
  // 403 statt Teilsumme.
  function requireFullScope(req, res, next) {
    if (req.reportScopeProjectIds === null) return next();
    return res.status(403).json({
      error: "Teilfertige Leistungen ist eine Unternehmensauswertung und verlangt das Recht auf alle Projekte (reports.scope.all).",
    });
  }

  const wipChain = [requirePermission("reports.wip.view"), requireFullScope];

  function wipOptions(req) {
    return {
      asOf:              (req.query.as_of      || "").toString().trim() || undefined,
      compareTo:         (req.query.compare_to || "").toString().trim() || undefined,
      method:            (req.query.method     || "").toString().trim() || undefined,
      costFactorPercent: req.query.cost_factor != null && req.query.cost_factor !== ""
        ? req.query.cost_factor
        : undefined,
    };
  }

  router.get("/wip", ...wipChain, async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    try {
      const data = await wipSvc.buildWipReport(supabase, tenantId, wipOptions(req));
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/wip/pdf", ...wipChain, requirePermission("reports.export"), async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    try {
      const { renderWipPdf } = require("../services_pdf_render");
      const { pdf, report } = await renderWipPdf({ supabase, tenantId, opts: wipOptions(req) });
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `inline; filename="Teilfertige_Leistungen_${report.asOf}.pdf"`);
      res.send(pdf);
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // Festschreiben ist Abschlussarbeit — dasselbe Recht wie beim Monatsabschluss.
  router.post("/wip/close", ...wipChain, requirePermission("settings.monthly_close.edit"), async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    try {
      const body = req.body || {};
      const data = await wipSvc.saveClosing(supabase, tenantId, {
        asOf:              body.as_of,
        compareTo:         body.compare_to,
        method:            body.method,
        costFactorPercent: body.cost_factor,
        label:             body.label,
        employeeId:        req.employeeId ?? null,
      });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/wip/closings", ...wipChain, async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    try {
      const data = await wipSvc.listClosings(supabase, tenantId);
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/wip/closings/:id", ...wipChain, async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Ungueltige ID." });
    try {
      const data = await wipSvc.getClosing(supabase, tenantId, id, {
        withDrift: req.query.drift === "1" || req.query.drift === "true",
      });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.delete("/wip/closings/:id", ...wipChain, requirePermission("settings.monthly_close.edit"), async (req, res) => {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Ungueltige ID." });
    try {
      const data = await wipSvc.deleteClosing(supabase, tenantId, id);
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  return router;
};
