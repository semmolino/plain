const express = require("express");

module.exports = (supabase) => {
  const router = express.Router();

  // GET /api/documents/:docType/:id/pdf?... -> redirect to existing endpoints
  router.get("/:docType/:id/pdf", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const docType = String(req.params.docType || "").toUpperCase().trim();
    const id = req.params.id;

    const qs = req.originalUrl.includes("?")
      ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
      : "";

    if (docType === "INVOICE") {
      return res.redirect(307, `/api/invoices/${id}/pdf${qs}`);
    }
    if (docType === "PARTIAL_PAYMENT") {
      return res.redirect(307, `/api/partial-payments/${id}/pdf${qs}`);
    }

    return res.status(400).json({ error: `Unsupported docType: ${docType}` });
  });

  return router;
};
