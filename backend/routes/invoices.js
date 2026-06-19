"use strict";

const express = require("express");
const ctrl    = require("../controllers/invoices");
const att     = require("../controllers/attachments");
const { renderDocumentPdf } = require("../services_pdf_render");
const { sendMail }          = require("../services/emailService");
const { requirePermission, requireAnyPermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // Phase 2: gesamte invoices-Routes erfordern invoices.view
  router.use(requirePermission("invoices.view"));

  router.get("/",                              (req, res) => ctrl.listInvoices(req, res, supabase));
  router.post("/init",                         requireAnyPermission("invoices.create_single","invoices.create_final","invoices.create_credit"), (req, res) => ctrl.initInvoice(req, res, supabase));
  router.patch("/:id",                         requirePermission("invoices.edit"), (req, res) => ctrl.patchInvoice(req, res, supabase));
  router.get("/:id/billing-proposal",          (req, res) => ctrl.getBillingProposal(req, res, supabase));
  router.put("/:id/performance",               requirePermission("invoices.edit"), (req, res) => ctrl.putPerformance(req, res, supabase));
  router.get("/:id/tec",                       (req, res) => ctrl.getTec(req, res, supabase));
  router.post("/:id/tec",                      requirePermission("invoices.edit"), (req, res) => ctrl.postTec(req, res, supabase));
  router.get("/:id/einvoice/ubl",              requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoiceUbl(req, res, supabase));
  router.post("/:id/einvoice/ubl/snapshot",    requirePermission("invoices.edit"), (req, res) => ctrl.postEinvoiceUblSnapshot(req, res, supabase));
  router.get("/:id/einvoice/cii",              requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoiceCii(req, res, supabase));
  router.get("/:id/einvoice/peppol",           requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoicePeppol(req, res, supabase));
  router.post("/:id/einvoice/cii/snapshot",    requirePermission("invoices.edit"), (req, res) => ctrl.postEinvoiceCiiSnapshot(req, res, supabase));
  router.post("/:id/book",                     requirePermission("invoices.book"),   (req, res) => ctrl.bookInvoice(req, res, supabase));
  router.post("/:id/cancel",                   requirePermission("invoices.cancel"), (req, res) => ctrl.cancelInvoice(req, res, supabase));
  router.delete("/:id",                        requirePermission("invoices.delete"), (req, res) => ctrl.deleteInvoice(req, res, supabase));
  router.get("/:id/pdf",                       requirePermission("invoices.download_pdf"), (req, res) => ctrl.getPdf(req, res, supabase));
  router.get("/:id/pdf-hybrid",                requirePermission("invoices.download_pdf"), (req, res) => ctrl.getPdfHybrid(req, res, supabase));
  router.get("/:id/validate",                  (req, res) => ctrl.validateInvoice(req, res, supabase));

  // Anlagen (Branch 9) -- bearbeiten = invoices.edit
  router.get   ("/:id/attachments",            (req, res) => att.list  (req, res, supabase));
  router.post  ("/:id/attachments",            requirePermission("invoices.edit"), (req, res) => att.add   (req, res, supabase));
  router.patch ("/:id/attachments/:attId",     requirePermission("invoices.edit"), (req, res) => att.patch (req, res, supabase));
  router.delete("/:id/attachments/:attId",     requirePermission("invoices.edit"), (req, res) => att.remove(req, res, supabase));

  // POST /invoices/:id/email  — send invoice PDF via SMTP
  router.post("/:id/email", requirePermission("invoices.send_email"), async (req, res) => {
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
        supabase,
        tenantId,
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
