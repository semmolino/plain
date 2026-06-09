"use strict";

const express = require("express");
const ctrl    = require("../controllers/partialPayments");
const att     = require("../controllers/attachments");
const { renderDocumentPdf } = require("../services_pdf_render");
const { sendMail }    = require("../services/emailService");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/",                              (req, res) => ctrl.listPartialPayments(req, res, supabase));
  router.get("/open-se",                       (req, res) => ctrl.listOpenSeForProject(req, res, supabase));
  router.get("/se-overview",                   (req, res) => ctrl.seOverviewForProject(req, res, supabase));
  router.post("/init",                         (req, res) => ctrl.initPartialPayment(req, res, supabase));
  router.patch("/:id",                         (req, res) => ctrl.patchPartialPayment(req, res, supabase));
  router.get("/:id/billing-proposal",          (req, res) => ctrl.getBillingProposal(req, res, supabase));
  router.put("/:id/performance",               (req, res) => ctrl.putPerformance(req, res, supabase));
  router.get("/:id/tec",                       (req, res) => ctrl.getTec(req, res, supabase));
  router.post("/:id/tec",                      (req, res) => ctrl.postTec(req, res, supabase));
  router.get("/:id/einvoice/ubl",              (req, res) => ctrl.getEinvoiceUbl(req, res, supabase));
  router.post("/:id/einvoice/ubl/snapshot",    (req, res) => ctrl.postEinvoiceUblSnapshot(req, res, supabase));
  router.get("/:id/einvoice/cii",              (req, res) => ctrl.getEinvoiceCii(req, res, supabase));
  router.post("/:id/einvoice/cii/snapshot",    (req, res) => ctrl.postEinvoiceCiiSnapshot(req, res, supabase));
  router.post("/:id/book",                     (req, res) => ctrl.bookPartialPayment(req, res, supabase));
  router.post("/:id/cancel",                   (req, res) => ctrl.cancelPartialPayment(req, res, supabase));
  router.delete("/:id",                        (req, res) => ctrl.deletePartialPayment(req, res, supabase));
  router.get("/:id/pdf",                       (req, res) => ctrl.getPdf(req, res, supabase));
  router.get("/:id/pdf-hybrid",                (req, res) => ctrl.getPdfHybrid(req, res, supabase));
  router.get("/:id/validate",                  (req, res) => ctrl.validatePp(req, res, supabase));

  // Anlagen (Branch 9)
  router.get   ("/:id/attachments",            (req, res) => att.list  (req, res, supabase));
  router.post  ("/:id/attachments",            (req, res) => att.add   (req, res, supabase));
  router.patch ("/:id/attachments/:attId",     (req, res) => att.patch (req, res, supabase));
  router.delete("/:id/attachments/:attId",     (req, res) => att.remove(req, res, supabase));

  // POST /partial-payments/:id/email  — send partial payment PDF via SMTP
  router.post("/:id/email", async (req, res) => {
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
