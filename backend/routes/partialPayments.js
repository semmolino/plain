"use strict";

const express = require("express");
const ctrl    = require("../controllers/partialPayments");
const att     = require("../controllers/attachments");
const { renderDocumentPdf } = require("../services_pdf_render");
const { sendMail }    = require("../services/emailService");
const { requirePermission, requireAnyPermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // Phase 2: partial-payments = Abschlagsrechnungen → invoices.view.
  // Ausnahme: SE-Routen brauchen security_retention.view (kann auch ohne
  // invoices.view erteilt werden).
  router.use((req, res, next) => {
    if (req.path === "/se-overview" || req.path === "/se-summary" || req.path === "/open-se") {
      return requireAnyPermission("security_retention.view", "invoices.view")(req, res, next);
    }
    return requirePermission("invoices.view")(req, res, next);
  });

  router.get("/",                              (req, res) => ctrl.listPartialPayments(req, res, supabase));
  router.get("/open-se",                       (req, res) => ctrl.listOpenSeForProject(req, res, supabase));
  router.get("/se-overview",                   (req, res) => ctrl.seOverviewForProject(req, res, supabase));
  router.get("/se-summary",                    (req, res) => ctrl.seSummary(req, res, supabase));
  router.post("/init",                         requirePermission("invoices.create_partial"), (req, res) => ctrl.initPartialPayment(req, res, supabase));
  router.patch("/:id",                         requirePermission("invoices.edit"), (req, res) => ctrl.patchPartialPayment(req, res, supabase));
  router.get("/:id/billing-proposal",          (req, res) => ctrl.getBillingProposal(req, res, supabase));
  router.put("/:id/performance",               requirePermission("invoices.edit"), (req, res) => ctrl.putPerformance(req, res, supabase));
  router.get("/:id/tec",                       (req, res) => ctrl.getTec(req, res, supabase));
  router.post("/:id/tec",                      requirePermission("invoices.edit"), (req, res) => ctrl.postTec(req, res, supabase));
  router.get("/:id/einvoice/ubl",              requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoiceUbl(req, res, supabase));
  router.post("/:id/einvoice/ubl/snapshot",    requirePermission("invoices.edit"), (req, res) => ctrl.postEinvoiceUblSnapshot(req, res, supabase));
  router.get("/:id/einvoice/cii",              requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoiceCii(req, res, supabase));
  router.post("/:id/einvoice/cii/snapshot",    requirePermission("invoices.edit"), (req, res) => ctrl.postEinvoiceCiiSnapshot(req, res, supabase));
  router.post("/:id/book",                     requirePermission("invoices.book"),   (req, res) => ctrl.bookPartialPayment(req, res, supabase));
  router.post("/:id/cancel",                   requirePermission("invoices.cancel"), (req, res) => ctrl.cancelPartialPayment(req, res, supabase));
  router.delete("/:id",                        requirePermission("invoices.delete"), (req, res) => ctrl.deletePartialPayment(req, res, supabase));
  router.get("/:id/pdf",                       requirePermission("invoices.download_pdf"), (req, res) => ctrl.getPdf(req, res, supabase));
  router.get("/:id/pdf-hybrid",                requirePermission("invoices.download_pdf"), (req, res) => ctrl.getPdfHybrid(req, res, supabase));
  router.get("/:id/einvoice/peppol",           requirePermission("invoices.download_xml"), (req, res) => ctrl.getEinvoicePeppol(req, res, supabase));
  router.get("/:id/validate",                  (req, res) => ctrl.validatePp(req, res, supabase));

  // Anlagen (Branch 9)
  router.get   ("/:id/attachments",            (req, res) => att.list  (req, res, supabase));
  router.post  ("/:id/attachments",            requirePermission("invoices.edit"), (req, res) => att.add   (req, res, supabase));
  router.patch ("/:id/attachments/:attId",     requirePermission("invoices.edit"), (req, res) => att.patch (req, res, supabase));
  router.delete("/:id/attachments/:attId",     requirePermission("invoices.edit"), (req, res) => att.remove(req, res, supabase));

  // POST /partial-payments/:id/email  — send partial payment PDF via SMTP
  router.post("/:id/email", requirePermission("invoices.send_email"), async (req, res) => {
    try {
      const ppId     = Number(req.params.id);
      const tenantId = req.tenantId;
      const { emailTo, emailSubject, emailBody } = req.body || {};
      if (!emailTo) return res.status(400).json({ error: "emailTo erforderlich" });

      const { data: pp } = await supabase
        .from("PARTIAL_PAYMENT")
        .select("PARTIAL_PAYMENT_NUMBER")
        .eq("ID", ppId)
        .eq("TENANT_ID", tenantId)
        .maybeSingle();
      if (!pp) return res.status(404).json({ error: "Anzahlung nicht gefunden" });

      const { pdf } = await renderDocumentPdf({ supabase, docType: "PARTIAL_PAYMENT", docId: ppId });
      const pdfBuffer = Buffer.from(pdf);
      const safeName  = (pp.PARTIAL_PAYMENT_NUMBER || `Anzahlung_${ppId}`).replace(/[/\\?%*:|"<>\s]/g, '-');
      await sendMail({
        supabase,
        tenantId,
        to:          emailTo,
        subject:     emailSubject || `Abschlagsrechnung ${pp.PARTIAL_PAYMENT_NUMBER}`,
        html:        emailBody ? `<pre style="font-family:inherit;white-space:pre-wrap">${emailBody}</pre>` : undefined,
        text:        emailBody,
        attachments: [{ filename: `${safeName}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
      });
      return res.json({ sent: true });
    } catch (e) {
      return res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/:id",                           (req, res) => ctrl.getPartialPayment(req, res, supabase));

  return router;
};
