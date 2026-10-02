const express = require("express");
const svc     = require("../services/mahnungenService");
const { renderMahnungPdf } = require("../services_pdf_render");
const { requirePermission } = require("../middleware/permissions");
const { localDateStr } = require("../services/notificationSchedule");
const { streamPdfAsset } = require("../services/generatedAssets");
const { readDefaults, writeDefaults } = require("../services/tenantDefaults");
const { defaultStufeLabel } = require("../services/mahnstufen");

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
      // Basiszinssatz fuer Verzugszinsen (TENANT_SETTINGS, services/tenantDefaults.js)
      const d = await readDefaults(supabase, tid(req)).catch(() => ({}));
      res.json({ data, baseRate: {
        percent: d.dunning_base_rate_percent != null ? Number(d.dunning_base_rate_percent) : null,
        since:   d.dunning_base_rate_since ?? null,
      } });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // PUT /mahnungen/settings — gehoert in Mahnungs-Konfiguration (Einstellungen)
  router.put("/settings", requirePermission("settings.dunning_config.edit"), async (req, res) => {
    try {
      const result = await svc.saveSettings(supabase, { tenantId: tid(req), levels: req.body.levels });
      const br = req.body && req.body.baseRate;
      if (br && typeof br === "object") {
        await writeDefaults(supabase, tid(req), {
          dunning_base_rate_percent: br.percent ?? null,
          dunning_base_rate_since:   br.since ?? null,
        }, (perm) => req.hasPermission(perm));
      }
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

  // PUT /mahnungen/text-templates/:type — Textvorlagen (settings)
  router.put("/text-templates/:type", requirePermission("settings.text_templates.edit"), async (req, res) => {
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

  // PUT /mahnungen/upsert — Mahnung anlegen/bearbeiten
  router.put("/upsert", requirePermission("dunning.edit"), async (req, res) => {
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

  // GET /mahnungen/history/:historyId/pdf — die Mahnung, wie sie verschickt
  // bzw. bei Setzen der Stufe ausgefertigt wurde (Archiv, Migration 0183).
  // Steht vor den /:id-Routen; der Pfad ist ohnehin eindeutig.
  router.get("/history/:historyId/pdf", async (req, res) => {
    try {
      const tenantId = tid(req);
      const { assetId, row } = await svc.getHistoryPdfAsset(supabase, { historyId: Number(req.params.historyId), tenantId });
      const day = String(row.DATE_ACTION || "").slice(0, 10);
      await streamPdfAsset({ supabase, res, assetId, tenantId, dispositionName: `Mahnung_Stufe_${row.MAHNSTUFE}_${day}.pdf`, download: req.query.download === "1" });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

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

  // GET /mahnungen/:id/email-preview — Empfaenger + Betreff/Text aus der
  // Mahnungs-Textvorlage, Platzhalter gegen diese Mahnung aufgeloest.
  router.get("/:id/email-preview", async (req, res) => {
    try {
      const data = await svc.getMahnungEmailPreview(supabase, {
        mahnungId: Number(req.params.id),
        tenantId:  tid(req),
      });
      res.json(data);
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // POST /mahnungen/:id/send — Mahnung versenden
  router.post("/:id/send", requirePermission("dunning.send"), async (req, res) => {
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
      const today = localDateStr();
      let docNumber = `Mahnung_${req.params.id}`;
      if (mahnung.INVOICE_ID) {
        const { data: inv } = await supabase.from("INVOICE").select("INVOICE_NUMBER").eq("ID", mahnung.INVOICE_ID).maybeSingle();
        if (inv?.INVOICE_NUMBER) docNumber = inv.INVOICE_NUMBER;
      } else if (mahnung.PP_ID) {
        const { data: pp } = await supabase.from("ADVANCE_INVOICE").select("ADVANCE_INVOICE_NUMBER").eq("ID", mahnung.PP_ID).maybeSingle();
        if (pp?.ADVANCE_INVOICE_NUMBER) docNumber = pp.ADVANCE_INVOICE_NUMBER;
      }
      const stufeLabel  = defaultStufeLabel(mahnung.MAHNSTUFE).replace(/\.?\s+/g, '_');
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
