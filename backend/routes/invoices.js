"use strict";

const express = require("express");
const ctrl    = require("../controllers/invoices");
const att     = require("../controllers/attachments");
const { renderDocumentPdf } = require("../services_pdf_render");
const { sendMail }          = require("../services/emailService");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/",                              (req, res) => ctrl.listInvoices(req, res, supabase));
  router.post("/init",                         (req, res) => ctrl.initInvoice(req, res, supabase));
  router.patch("/:id",                         (req, res) => ctrl.patchInvoice(req, res, supabase));
  router.get("/:id/billing-proposal",          (req, res) => ctrl.getBillingProposal(req, res, supabase));
  router.put("/:id/performance",               (req, res) => ctrl.putPerformance(req, res, supabase));
  router.get("/:id/tec",                       (req, res) => ctrl.getTec(req, res, supabase));
  router.post("/:id/tec",                      (req, res) => ctrl.postTec(req, res, supabase));
  router.get("/:id/einvoice/ubl",              (req, res) => ctrl.getEinvoiceUbl(req, res, supabase));
  router.post("/:id/einvoice/ubl/snapshot",    (req, res) => ctrl.postEinvoiceUblSnapshot(req, res, supabase));
  router.get("/:id/einvoice/cii",              (req, res) => ctrl.getEinvoiceCii(req, res, supabase));
  router.post("/:id/einvoice/cii/snapshot",    (req, res) => ctrl.postEinvoiceCiiSnapshot(req, res, supabase));
  router.post("/:id/book",                     (req, res) => ctrl.bookInvoice(req, res, supabase));
  router.post("/:id/cancel",                   (req, res) => ctrl.cancelInvoice(req, res, supabase));
  router.delete("/:id",                        (req, res) => ctrl.deleteInvoice(req, res, supabase));
  router.get("/:id/pdf",                       (req, res) => ctrl.getPdf(req, res, supabase));
  router.get("/:id/pdf-hybrid",                (req, res) => ctrl.getPdfHybrid(req, res, supabase));
  router.get("/:id/validate",                  (req, res) => ctrl.validateInvoice(req, res, supabase));

  // Anlagen (Branch 9)
  router.get   ("/:id/attachments",            (req, res) => att.list  (req, res, supabase));
  router.post  ("/:id/attachments",            (req, res) => att.add   (req, res, supabase));
  router.patch ("/:id/attachments/:attId",     (req, res) => att.patch (req, res, supabase));
  router.delete("/:id/attachments/:attId",     (req, res) => att.remove(req, res, supabase));

  // POST /invoices/:id/email  — send invoice PDF via SMTP
  router.post("/:id/email", async (req, res) => {
    try {
      const invoiceId = Number(req.params.id);
      const tenantId  = req.tenantId;
      const { emailTo, emailSubject, emailBody } = req.body || {};
      if (!emailTo) return res.status(400).json({ error: "emailTo erforderlich" });

      const { data: inv } = await supabase
        .from("INVOICE")
        .select("INVOICE_NUMBER")
        .eq("ID", invoiceId)
        .eq("TENANT_ID", tenantId)
        .maybeSingle();
      if (!inv) return res.status(404).json({ error: "Rechnung nicht gefunden" });

      const { pdf } = await renderDocumentPdf({ supabase, docType: "INVOICE", docId: invoiceId });
      const safeName = (inv.INVOICE_NUMBER || `Rechnung_${invoiceId}`).replace(/[/\\?%*:|"<>\s]/g, '-');
      const pdfBuffer = Buffer.from(pdf);
      await sendMail({
        to:          emailTo,
        subject:     emailSubject || `Rechnung ${inv.INVOICE_NUMBER}`,
        html:        emailBody ? `<pre style="font-family:inherit;white-space:pre-wrap">${emailBody}</pre>` : undefined,
        text:        emailBody,
        attachments: [{ filename: `${safeName}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
      });
      return res.json({ sent: true });
    } catch (e) {
      return res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/:id",                           (req, res) => ctrl.getInvoice(req, res, supabase));

  return router;
};
