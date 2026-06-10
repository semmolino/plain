const express = require("express");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  const currentYear = () => new Date().getFullYear();

  // Resolve the tenant's company ID from the JWT tenant_id
  async function resolveCompanyId(tenantId) {
    const { data, error } = await supabase
      .from("COMPANY")
      .select("ID")
      .eq("TENANT_ID", tenantId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.ID ?? null;
  }

  // Get number ranges for the authenticated tenant's company/year
  // - GLOBAL: shared counter for INVOICE/PARTIAL_PAYMENT
  // - PROJECT: separate counter for projects
  router.get("/", async (req, res) => {
    const year = parseInt(String(req.query.year || currentYear()), 10);

    if (!Number.isFinite(year) || year < 2000 || year > 3000) {
      return res.status(400).json({ error: "Ungültiges Jahr" });
    }

    let companyId;
    try {
      companyId = await resolveCompanyId(req.tenantId);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    if (!companyId) return res.status(404).json({ error: "Kein Unternehmen für diesen Mandanten gefunden." });

    const { data, error } = await supabase
      .from("DOCUMENT_NUMBER_RANGE")
      .select("DOC_TYPE, NEXT_COUNTER, YEAR")
      .eq("COMPANY_ID", companyId)
      .eq("YEAR", year);

    if (error) return res.status(500).json({ error: error.message });

    let nextCounter = 1;
    let hasGlobal = false;
    let projectNextCounter = 1;
    let offerNextCounter = 1;

    (data || []).forEach((r) => {
      const t = String(r.DOC_TYPE || "").toUpperCase();
      const v = parseInt(String(r.NEXT_COUNTER ?? 1), 10);
      if (!Number.isFinite(v) || v < 1) return;
      if (t === "GLOBAL") {
        hasGlobal = true;
        nextCounter = v;
      }
      if (t === "PROJECT") {
        projectNextCounter = v;
      }
      if (t === "OFFER") {
        offerNextCounter = v;
      }
    });

    // If GLOBAL does not exist yet, show the highest NEXT_COUNTER across legacy rows
    if (!hasGlobal) {
      (data || []).forEach((r) => {
        const v = parseInt(String(r.NEXT_COUNTER ?? 1), 10);
        if (Number.isFinite(v) && v >= 1) nextCounter = Math.max(nextCounter, v);
      });
    }

    return res.json({ year, next_counter: nextCounter, project_next_counter: projectNextCounter, offer_next_counter: offerNextCounter });
  });

  // Upsert the ranges for the authenticated tenant's company
  // Body:
  // - year (optional)
  // - next_counter (required, 1..9999) => GLOBAL
  // - project_next_counter (optional, 1..999) => PROJECT
  router.post("/set", requirePermission("settings.numbers.edit"), async (req, res) => {
    const b = req.body || {};
    const year = parseInt(String(b.year || currentYear()), 10);
    const nextCounter = parseInt(String(b.next_counter || ""), 10);

    const projectProvided = b.project_next_counter !== undefined && b.project_next_counter !== null && String(b.project_next_counter) !== "";
    const projectNextCounter = projectProvided ? parseInt(String(b.project_next_counter), 10) : null;
    const offerProvided = b.offer_next_counter !== undefined && b.offer_next_counter !== null && String(b.offer_next_counter) !== "";
    const offerNextCounter = offerProvided ? parseInt(String(b.offer_next_counter), 10) : null;

    if (!Number.isFinite(year) || year < 2000 || year > 3000) {
      return res.status(400).json({ error: "Ungültiges Jahr" });
    }
    if (!Number.isFinite(nextCounter) || nextCounter < 1 || nextCounter > 9999) {
      return res.status(400).json({ error: "next_counter muss zwischen 1 und 9999 liegen" });
    }
    if (projectProvided && (!Number.isFinite(projectNextCounter) || projectNextCounter < 1 || projectNextCounter > 999)) {
      return res.status(400).json({ error: "project_next_counter muss zwischen 1 und 999 liegen" });
    }
    if (offerProvided && (!Number.isFinite(offerNextCounter) || offerNextCounter < 1 || offerNextCounter > 999)) {
      return res.status(400).json({ error: "offer_next_counter muss zwischen 1 und 999 liegen" });
    }

    let companyId;
    try {
      companyId = await resolveCompanyId(req.tenantId);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    if (!companyId) return res.status(404).json({ error: "Kein Unternehmen für diesen Mandanten gefunden." });

    const upsert = async (docType, counter) => {
      const { error } = await supabase
        .from("DOCUMENT_NUMBER_RANGE")
        .upsert(
          {
            COMPANY_ID: companyId,
            DOC_TYPE: docType,
            YEAR: year,
            NEXT_COUNTER: counter,
            UPDATED_AT: new Date().toISOString(),
          },
          { onConflict: "COMPANY_ID,DOC_TYPE,YEAR" }
        );
      if (error) throw new Error(error.message);
    };

    try {
      await upsert("GLOBAL", nextCounter);
      if (projectProvided) {
        await upsert("PROJECT", projectNextCounter);
      }
      if (offerProvided) {
        await upsert("OFFER", offerNextCounter);
      }
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message || String(err) });
    }
  });

  // ── Template-Konfiguration (Aufbau der Nummern) ─────────────────────────
  const tmplSvc = require("../services/numberRangeTemplates");

  router.get("/templates", async (req, res) => {
    try {
      const rows = await tmplSvc.listTemplates(supabase, { tenantId: req.tenantId });
      res.json({ data: rows });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.put("/templates", requirePermission("settings.numbers.edit"), async (req, res) => {
    try {
      const { company_id, doc_type, template } = req.body || {};
      await tmplSvc.upsertTemplate(supabase, {
        tenantId:   req.tenantId,
        employeeId: req.employeeId,
        companyId:  parseInt(company_id, 10),
        docType:    String(doc_type || "").toUpperCase(),
        template:   String(template || "").trim(),
      });
      const rows = await tmplSvc.listTemplates(supabase, { tenantId: req.tenantId });
      res.json({ data: rows });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // POST /preview: rendert ein Template lokal (ohne Counter zu verbrauchen).
  router.post("/templates/preview", async (req, res) => {
    try {
      const { template, counter, company_id } = req.body || {};
      const v = tmplSvc.validateTemplate(String(template || ""));
      if (!v.ok) return res.status(400).json({ error: v.error });

      // Company-Code besorgen
      let companyCode = "BUE";
      if (company_id) {
        try {
          const { data } = await supabase
            .from("COMPANY")
            .select("COMPANY_NAME_SHORT")
            .eq("ID", parseInt(company_id, 10))
            .maybeSingle();
          if (data?.COMPANY_NAME_SHORT) companyCode = data.COMPANY_NAME_SHORT;
        } catch (_) {}
      }
      const rendered = tmplSvc.renderTemplate(String(template), { counter: parseInt(counter, 10) || 1, companyCode });
      res.json({ data: { rendered } });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  return router;
};
