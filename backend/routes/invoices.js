"use strict";

const express = require("express");
const ctrl    = require("../controllers/invoices");
const att     = require("../controllers/attachments");
const { documentPdfBuffer } = require("../services_pdf_render");
const { sendMail, plainTextHtml }          = require("../services/emailService");
const emailTemplates        = require("../services/emailTemplates");
const { requirePermission, requireAnyPermission } = require("../middleware/permissions");
const { requireDraftEdit } = require("../middleware/draftEdit");
const { documentLayoutHandlers } = require("../controllers/documentLayouts");

module.exports = (supabase) => {
  const router = express.Router();
  // Entwurf: invoices.edit ODER Anlege-Recht der Belegart (middleware/draftEdit.js)
  const draftEdit = requireDraftEdit(supabase, "INVOICE");

  // Phase 2: gesamte invoices-Routes erfordern invoices.view
  router.use(requirePermission("invoices.view"));

  router.get("/",                              (req, res) => ctrl.listInvoices(req, res, supabase));
  // Rechnungskorrektur: mit Bezug auf einen gebuchten Beleg (Migration 0179).
  // Gebucht wird wie jede Rechnung ueber POST /:id/book (invoices.book).
  router.get("/correction-basis",              (req, res) => ctrl.getCorrectionBasis(req, res, supabase));
  router.post("/corrections",                  requirePermission("invoices.create_credit"), (req, res) => ctrl.saveCorrection(req, res, supabase));
  router.post("/init",                         requireAnyPermission("invoices.create_single","invoices.create_final","invoices.create_credit"), (req, res) => ctrl.initInvoice(req, res, supabase));
  router.patch("/:id",                         draftEdit, (req, res) => ctrl.patchInvoice(req, res, supabase));
  router.get("/:id/billing-proposal",          (req, res) => ctrl.getBillingProposal(req, res, supabase));
  router.put("/:id/performance",               draftEdit, (req, res) => ctrl.putPerformance(req, res, supabase));
  router.get("/:id/tec",                       (req, res) => ctrl.getTec(req, res, supabase));
  router.post("/:id/tec",                      draftEdit, (req, res) => ctrl.postTec(req, res, supabase));
  router.get("/:id/einvoice/ubl",              requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoiceUbl(req, res, supabase));
  router.post("/:id/einvoice/ubl/snapshot",    requirePermission("invoices.edit"), (req, res) => ctrl.postEinvoiceUblSnapshot(req, res, supabase));
  router.get("/:id/einvoice/cii",              requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoiceCii(req, res, supabase));
  router.get("/:id/einvoice/peppol",           requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoicePeppol(req, res, supabase));
  router.post("/:id/einvoice/cii/snapshot",    requirePermission("invoices.edit"), (req, res) => ctrl.postEinvoiceCiiSnapshot(req, res, supabase));
  router.post("/:id/book",                     requirePermission("invoices.book"),   (req, res) => ctrl.bookInvoice(req, res, supabase));
  router.post("/:id/cancel",                   requirePermission("invoices.cancel"), (req, res) => ctrl.cancelInvoice(req, res, supabase));
  router.post("/:id/reissue",                  requirePermission("invoices.cancel"), (req, res) => ctrl.reissueInvoice(req, res, supabase));
  router.delete("/:id",                        requirePermission("invoices.delete"), (req, res) => ctrl.deleteInvoice(req, res, supabase));
  router.get("/:id/pdf",                       requirePermission("invoices.download_pdf"), (req, res) => ctrl.getPdf(req, res, supabase));
  router.get("/:id/pdf-hybrid",                requirePermission("invoices.download_pdf"), (req, res) => ctrl.getPdfHybrid(req, res, supabase));
  // Aufbau dieses Belegs (Vorlagen-Plan Stufe 3, controllers/documentLayouts.js)
  const layout = documentLayoutHandlers("INVOICE");
  router.get("/:id/layout",                    (req, res) => layout.getLayout(req, res, supabase));
  router.put("/:id/layout",                    draftEdit, (req, res) => layout.putLayout(req, res, supabase));
  router.post("/:id/pdf/preview",              requirePermission("invoices.download_pdf"), (req, res) => layout.previewHtml(req, res, supabase));
  router.get("/:id/validate",                  (req, res) => ctrl.validateInvoice(req, res, supabase));

  // Anlagen (Branch 9) -- bearbeiten = invoices.edit
  router.get   ("/:id/attachments",            (req, res) => att.list  (req, res, supabase));
  router.post  ("/:id/attachments",            draftEdit, (req, res) => att.add   (req, res, supabase));
  router.patch ("/:id/attachments/:attId",     draftEdit, (req, res) => att.patch (req, res, supabase));
  router.delete("/:id/attachments/:attId",     draftEdit, (req, res) => att.remove(req, res, supabase));

  // GET /invoices/:id/email-preview — Empfaenger + Betreff/Text aus der
  // E-Mail-Textvorlage, Platzhalter bereits gegen diese Rechnung aufgeloest.
  router.get("/:id/email-preview", requirePermission("invoices.send_email"), async (req, res) => {
    try {
      const composed = await emailTemplates.composeInvoiceEmail(supabase, {
        tenantId: req.tenantId,
        docType:  "INVOICE",
        docId:    Number(req.params.id),
      });
      return res.json(composed);
    } catch (e) {
      return res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  // POST /invoices/:id/email  — send invoice PDF via SMTP
  // emailSubject/emailBody sind optional: fehlen sie, greift die Textvorlage
  // des Mandanten. Platzhalter ({{belegnummer}} …) werden immer aufgeloest,
  // auch in selbst eingetippten Texten — dadurch funktioniert der Sammelversand
  // mit einem Text fuer viele Rechnungen.
  router.post("/:id/email", requirePermission("invoices.send_email"), async (req, res) => {
    try {
      const invoiceId = Number(req.params.id);
      const tenantId  = req.tenantId;
      const { emailTo, emailSubject, emailBody } = req.body || {};

      const { data: inv } = await supabase
        .from("INVOICE")
        .select("INVOICE_NUMBER")
        .eq("ID", invoiceId)
        .eq("TENANT_ID", tenantId)
        .maybeSingle();
      if (!inv) return res.status(404).json({ error: "Rechnung nicht gefunden" });

      const composed = await emailTemplates.composeInvoiceEmail(supabase, {
        tenantId, docType: "INVOICE", docId: invoiceId,
        subject: emailSubject, body: emailBody,
      });
      const to = emailTo || composed.to;
      if (!to) return res.status(400).json({ error: "Keine E-Mail-Adresse hinterlegt" });

      // gebucht: die archivierte Fassung, nicht neu gerendert
      const pdf = await documentPdfBuffer({ supabase, tenantId, docType: "INVOICE", docId: invoiceId });
      const safeName = (inv.INVOICE_NUMBER || `Rechnung_${invoiceId}`).replace(/[/\\?%*:|"<>\s]/g, '-');
      const pdfBuffer = Buffer.from(pdf);
      await sendMail({
        supabase,
        tenantId,
        to,
        subject:     composed.subject,
        html:        plainTextHtml(composed.body),
        text:        composed.body,
        attachments: [{ filename: `${safeName}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
        copyToTenant: true,
      });
      return res.json({ sent: true });
    } catch (e) {
      return res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/:id",                           (req, res) => ctrl.getInvoice(req, res, supabase));

  return router;
};
