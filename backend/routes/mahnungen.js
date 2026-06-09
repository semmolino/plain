const express = require("express");
const svc     = require("../services/mahnungenService");
const { renderMahnungPdf } = require("../services_pdf_render");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // Phase 2: alle Mahnungen-Routen erfordern dunning.view
  router.use(requirePermission("dunning.view"));

  function tid(req) { return req.tenantId; }
  function eid(req) { return req.employeeId; }

  // ── Static routes first (before /:id to avoid conflicts) ──────────────────

  // GET /mahnungen/settings
  router.get("/settings", async (req, res) => {
    try {
      const data = await svc.getSettings(supabase, { tenantId: tid(req) });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // PUT /mahnungen/settings
  router.put("/settings", async (req, res) => {
    try {
      const result = await svc.saveSettings(supabase, { tenantId: tid(req), levels: req.body.levels });
      res.json(result);
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // GET /mahnungen/text-templates
  router.get("/text-templates", async (req, res) => {
    try {
      const data = await svc.getTextTemplates(supabase, { tenantId: tid(req) });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // PUT /mahnungen/text-templates/:type
  router.put("/text-templates/:type", async (req, res) => {
    try {
      const result = await svc.saveTextTemplate(supabase, {
        tenantId:     tid(req),
        documentType: req.params.type,
        headerText:   req.body.headerText,
        footerText:   req.body.footerText,
      });
      res.json(result);
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // GET /mahnungen/stats
  router.get("/stats", async (req, res) => {
    try {
      const data = await svc.getMahnungStats(supabase, { tenantId: tid(req) });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // GET /mahnungen — list
  router.get("/", async (req, res) => {
    try {
      const data = await svc.listMahnungen(supabase, { tenantId: tid(req) });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // PUT /mahnungen/upsert
  router.put("/upsert", async (req, res) => {
    try {
      const result = await svc.upsertMahnung(supabase, {
        body:       req.body,
        tenantId:   tid(req),
        employeeId: eid(req),
      });
      res.json(result);
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // ── Dynamic routes ─────────────────────────────────────────────────────────

  // GET /mahnungen/:id/history
  router.get("/:id/history", async (req, res) => {
    try {
      const data = await svc.getMahnungHistory(supabase, {
        mahnungId: Number(req.params.id),
        tenantId:  tid(req),
      });
      res.json({ data });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // POST /mahnungen/:id/send
  router.post("/:id/send", async (req, res) => {
    try {
      const result = await svc.sendMahnungEmail(supabase, {
        mahnungId:    Number(req.params.id),
        emailTo:      req.body.emailTo,
        emailSubject: req.body.emailSubject,
        emailBody:    req.body.emailBody,
        tenantId:     tid(req),
        employeeId:   eid(req),
      });
      res.json(result);
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // GET /mahnungen/:id/pdf
  router.get("/:id/pdf", async (req, res) => {
    try {
      const tenantId = tid(req);
      const { data: mahnung, error } = await supabase
        .from("MAHNUNG")
        .select("*")
        .eq("ID", Number(req.params.id))
        .eq("TENANT_ID", tenantId)
        .single();
      if (error || !mahnung) return res.status(404).json({ error: "Mahnung nicht gefunden" });

      const pdfBuffer = await renderMahnungPdf(supabase, {
        invoiceId: mahnung.INVOICE_ID || null,
        ppId:      mahnung.PP_ID || null,
        mahnstufe: mahnung.MAHNSTUFE,
        tenantId,
      });

      // Build filename: {Rechnungsnummer}_{YYYY-MM-DD}_{StufeLabel}
      const today = new Date().toISOString().slice(0, 10);
      let docNumber = `Mahnung_${req.params.id}`;
      if (mahnung.INVOICE_ID) {
        const { data: inv } = await supabase.from("INVOICE").select("INVOICE_NUMBER").eq("ID", mahnung.INVOICE_ID).maybeSingle();
        if (inv?.INVOICE_NUMBER) docNumber = inv.INVOICE_NUMBER;
      } else if (mahnung.PP_ID) {
        const { data: pp } = await supabase.from("PARTIAL_PAYMENT").select("PARTIAL_PAYMENT_NUMBER").eq("ID", mahnung.PP_ID).maybeSingle();
        if (pp?.PARTIAL_PAYMENT_NUMBER) docNumber = pp.PARTIAL_PAYMENT_NUMBER;
      }
      const stufeLabels = ['Keine', 'Zahlungserinnerung', '1_Mahnung', '2_Mahnung', '3_Mahnung'];
      const stufeLabel  = stufeLabels[mahnung.MAHNSTUFE] || `Stufe_${mahnung.MAHNSTUFE}`;
      const safeName    = docNumber.replace(/[/\\?%*:|"<>\s]/g, '-');
      const filename    = `${safeName}_${today}_${stufeLabel}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.send(pdfBuffer);
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  return router;
};
