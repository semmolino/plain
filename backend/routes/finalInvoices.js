// Teil-/Schlussrechnung routes
// Base path: /api/final-invoices
//
// Uses the INVOICE table (same as regular Rechnungen) but with
// INVOICE_TYPE = 'schlussrechnung' or 'teilschlussrechnung'.
//
// The wizard calls:
//   POST   /api/invoices/init          (with invoice_type param — existing route, extended)
//   PATCH  /api/invoices/:id           (existing route, reused for dates/VAT/comment)
//   DELETE /api/invoices/:id           (existing route, reused for draft abort)
//   GET    /api/invoices/:id/pdf       (existing route, reused)
//   GET    /api/final-invoices/:id/phases
//   POST   /api/final-invoices/:id/phases
//   GET    /api/final-invoices/:id/deductions
//   POST   /api/final-invoices/:id/deductions
//   GET    /api/final-invoices/:id
//   POST   /api/final-invoices/:id/book

const express = require("express");
const { generateUblInvoiceXml } = require("../services_einvoice_ubl");
const { renderDocumentPdf } = require("../services_pdf_render");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function uploadRoot() {
  return path.join(__dirname, "..", "uploads");
}

function safeFileName(name, fallback) {
  const base = String(name || fallback || "document").replace(/[\/:*?"<>|]+/g, "_").trim();
  return base.length ? base : "document";
}

async function storeGeneratedPdfAsAsset({ supabase, companyId, fileName, pdfBuffer, assetType }) {
  const root = uploadRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  const uuid = crypto.randomUUID();
  const dir = path.join(root, String(companyId), "generated");
  fs.mkdirSync(dir, { recursive: true });
  const outName = `${uuid}.pdf`;
  const absPath = path.join(dir, outName);
  fs.writeFileSync(absPath, Buffer.from(pdfBuffer));
  const storageKey = path.relative(root, absPath).replace(/\\/g, "/");
  const sha256 = crypto.createHash("sha256").update(Buffer.from(pdfBuffer)).digest("hex");
  const row = {
    COMPANY_ID: companyId,
    ASSET_TYPE: assetType || "PDF",
    FILE_NAME: safeFileName(fileName, "document.pdf"),
    MIME_TYPE: "application/pdf",
    FILE_SIZE: Buffer.byteLength(Buffer.from(pdfBuffer)),
    STORAGE_KEY: storageKey,
    SHA256: sha256,
  };
  const { data, error } = await supabase.from("ASSET").insert([row]).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function storeGeneratedXmlAsAsset({ supabase, companyId, fileName, xmlString, assetType }) {
  const root = uploadRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  const uuid = crypto.randomUUID();
  const dir = path.join(root, String(companyId), "generated");
  fs.mkdirSync(dir, { recursive: true });
  const outName = `${uuid}.xml`;
  const absPath = path.join(dir, outName);
  const buf = Buffer.from(String(xmlString || ""), "utf8");
  fs.writeFileSync(absPath, buf);
  const storageKey = path.relative(root, absPath).replace(/\\/g, "/");
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const row = {
    COMPANY_ID: companyId,
    ASSET_TYPE: assetType || "XML",
    FILE_NAME: safeFileName(fileName, "document.xml"),
    MIME_TYPE: "application/xml",
    FILE_SIZE: Buffer.byteLength(buf),
    STORAGE_KEY: storageKey,
    SHA256: sha256,
  };
  const { data, error } = await supabase.from("ASSET").insert([row]).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function bestEffortDeleteAsset({ supabase, asset }) {
  try {
    if (asset?.STORAGE_KEY) {
      const fp = path.join(uploadRoot(), asset.STORAGE_KEY);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  } catch (_) {}
  try {
    if (asset?.ID) await supabase.from("ASSET").delete().eq("ID", asset.ID);
  } catch (_) {}
}

module.exports = (supabase) => {
  const router = express.Router();

  const toNum = (v) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (v) => Math.round(toNum(v) * 100) / 100;

  // Recompute INVOICE.TOTAL_AMOUNT_NET = sum(INVOICE_STRUCTURE) - sum(INVOICE_DEDUCTION)
  async function recomputeTotal(invoiceId) {
    const { data: isRows, error: isErr } = await supabase
      .from("INVOICE_STRUCTURE")
      .select("AMOUNT_NET, AMOUNT_EXTRAS_NET")
      .eq("INVOICE_ID", invoiceId);
    if (isErr) throw new Error(isErr.message);

    const phaseTotal = round2(
      (isRows || []).reduce((s, r) => s + toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET), 0)
    );

    const { data: idRows, error: idErr } = await supabase
      .from("INVOICE_DEDUCTION")
      .select("DEDUCTION_AMOUNT_NET")
      .eq("INVOICE_ID", invoiceId);
    if (idErr) throw new Error(idErr.message);

    const deductionsTotal = round2(
      (idRows || []).reduce((s, r) => s + toNum(r.DEDUCTION_AMOUNT_NET), 0)
    );

    const totalNet = round2(phaseTotal - deductionsTotal);

    const { error: upErr } = await supabase
      .from("INVOICE")
      .update({ TOTAL_AMOUNT_NET: totalNet })
      .eq("ID", invoiceId);
    if (upErr) throw new Error(upErr.message);

    return { phaseTotal, deductionsTotal, totalNet };
  }

  // ----------------------------
  // GET /api/final-invoices/:id/phases
  // Returns all PROJECT_STRUCTURE rows for this invoice's project/contract,
  // annotated with selection state and whether the phase is already closed.
  // ----------------------------
  router.get("/:id/phases", async (req, res) => {
    const { id } = req.params;

    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, STATUS_ID, PROJECT_ID, CONTRACT_ID, INVOICE_TYPE")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (invErr || !inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });

    // Load PROJECT_STRUCTURE — prefer CONTRACT_ID, fall back to PROJECT_ID
    let psRows = [];
    if (inv.CONTRACT_ID) {
      const { data: byContract } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, NAME_SHORT, NAME_LONG, BILLING_TYPE_ID, REVENUE_COMPLETION, EXTRAS_PERCENT, PARTIAL_PAYMENTS, INVOICED, CLOSED_BY_INVOICE_ID, FATHER_ID")
        .eq("CONTRACT_ID", inv.CONTRACT_ID);
      if (Array.isArray(byContract) && byContract.length > 0) psRows = byContract;
    }
    if (psRows.length === 0) {
      const { data: byProject, error: psErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, NAME_SHORT, NAME_LONG, BILLING_TYPE_ID, REVENUE_COMPLETION, EXTRAS_PERCENT, PARTIAL_PAYMENTS, INVOICED, CLOSED_BY_INVOICE_ID, FATHER_ID")
        .eq("PROJECT_ID", inv.PROJECT_ID);
      if (psErr) return res.status(500).json({ error: psErr.message });
      psRows = byProject || [];
    }

    // Load currently selected phases for this invoice
    const { data: isRows } = await supabase
      .from("INVOICE_STRUCTURE")
      .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
      .eq("INVOICE_ID", id);
    const selectedMap = new Map((isRows || []).map((r) => [String(r.STRUCTURE_ID), r]));

    const phases = psRows.map((ps) => {
      const revenue = toNum(ps.REVENUE_COMPLETION);
      const extrasAmount = round2(revenue * toNum(ps.EXTRAS_PERCENT) / 100);
      const totalEarned = round2(revenue + extrasAmount);
      const alreadyBilled = round2(toNum(ps.PARTIAL_PAYMENTS) + toNum(ps.INVOICED));
      const sel = selectedMap.get(String(ps.ID));
      const closedByOther = ps.CLOSED_BY_INVOICE_ID && String(ps.CLOSED_BY_INVOICE_ID) !== String(id);
      return {
        ID: ps.ID,
        FATHER_ID: ps.FATHER_ID ?? null,
        NAME_SHORT: ps.NAME_SHORT ?? "",
        NAME_LONG: ps.NAME_LONG ?? "",
        BILLING_TYPE_ID: ps.BILLING_TYPE_ID,
        REVENUE_COMPLETION: revenue,
        EXTRAS_AMOUNT: extrasAmount,
        TOTAL_EARNED: totalEarned,
        ALREADY_BILLED: alreadyBilled,
        AMOUNT_NET: sel ? toNum(sel.AMOUNT_NET) : revenue,
        AMOUNT_EXTRAS_NET: sel ? toNum(sel.AMOUNT_EXTRAS_NET) : extrasAmount,
        SELECTED: !!sel,
        CLOSED_BY_INVOICE_ID: ps.CLOSED_BY_INVOICE_ID ?? null,
        CLOSED: !!closedByOther,
      };
    });

    return res.json({ data: phases });
  });

  // ----------------------------
  // POST /api/final-invoices/:id/phases
  // Body: { structure_ids: [1, 2, 3] }
  // Replaces INVOICE_STRUCTURE rows for this invoice and recomputes TOTAL_AMOUNT_NET.
  // ----------------------------
  router.post("/:id/phases", async (req, res) => {
    const { id } = req.params;
    const b = req.body || {};
    const structureIds = Array.isArray(b.structure_ids)
      ? b.structure_ids.map(Number).filter((n) => Number.isFinite(n))
      : [];

    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, STATUS_ID, TENANT_ID")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (invErr || !inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
    if (String(inv.STATUS_ID) === "2") return res.status(400).json({ error: "Gebuchte Rechnungen können nicht geändert werden" });

    // Replace INVOICE_STRUCTURE for this invoice
    const { error: delErr } = await supabase
      .from("INVOICE_STRUCTURE")
      .delete()
      .eq("INVOICE_ID", id);
    if (delErr) return res.status(500).json({ error: delErr.message });

    if (structureIds.length > 0) {
      const { data: psRows, error: psErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, REVENUE_COMPLETION, EXTRAS_PERCENT")
        .in("ID", structureIds);
      if (psErr) return res.status(500).json({ error: psErr.message });

      const rows = (psRows || []).map((ps) => ({
        INVOICE_ID: parseInt(id, 10),
        STRUCTURE_ID: ps.ID,
        AMOUNT_NET: toNum(ps.REVENUE_COMPLETION),
        AMOUNT_EXTRAS_NET: round2(toNum(ps.REVENUE_COMPLETION) * toNum(ps.EXTRAS_PERCENT) / 100),
        TENANT_ID: inv.TENANT_ID,
      }));

      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("INVOICE_STRUCTURE").insert(rows);
        if (insErr) return res.status(500).json({ error: insErr.message });
      }
    }

    try {
      const totals = await recomputeTotal(id);
      return res.json({ ok: true, ...totals });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ----------------------------
  // GET /api/final-invoices/:id/deductions
  // Returns booked PARTIAL_PAYMENTs for this invoice's project,
  // annotated with whether each is currently selected for deduction.
  // ----------------------------
  router.get("/:id/deductions", async (req, res) => {
    const { id } = req.params;

    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, PROJECT_ID, STATUS_ID")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (invErr || !inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });

    // All booked partial payments for this project
    const { data: ppRows, error: ppErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, TOTAL_AMOUNT_NET")
      .eq("PROJECT_ID", inv.PROJECT_ID)
      .eq("STATUS_ID", 2)
      .eq("TENANT_ID", req.tenantId)
      .order("PARTIAL_PAYMENT_DATE", { ascending: true });
    if (ppErr) return res.status(500).json({ error: ppErr.message });

    // Load currently selected deductions for this invoice
    const { data: idRows } = await supabase
      .from("INVOICE_DEDUCTION")
      .select("PARTIAL_PAYMENT_ID, DEDUCTION_AMOUNT_NET")
      .eq("INVOICE_ID", id);
    const selectedMap = new Map(
      (idRows || []).map((r) => [String(r.PARTIAL_PAYMENT_ID), toNum(r.DEDUCTION_AMOUNT_NET)])
    );

    const deductions = (ppRows || []).map((pp) => ({
      PARTIAL_PAYMENT_ID: pp.ID,
      PARTIAL_PAYMENT_NUMBER: pp.PARTIAL_PAYMENT_NUMBER ?? "",
      PARTIAL_PAYMENT_DATE: pp.PARTIAL_PAYMENT_DATE ?? null,
      TOTAL_AMOUNT_NET: toNum(pp.TOTAL_AMOUNT_NET),
      SELECTED: selectedMap.has(String(pp.ID)),
      DEDUCTION_AMOUNT_NET: selectedMap.has(String(pp.ID))
        ? selectedMap.get(String(pp.ID))
        : toNum(pp.TOTAL_AMOUNT_NET),
    }));

    return res.json({ data: deductions });
  });

  // ----------------------------
  // POST /api/final-invoices/:id/deductions
  // Body: { items: [{ partial_payment_id, deduction_amount_net }] }
  // Replaces INVOICE_DEDUCTION rows and recomputes TOTAL_AMOUNT_NET.
  // ----------------------------
  router.post("/:id/deductions", async (req, res) => {
    const { id } = req.params;
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];

    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, STATUS_ID, TENANT_ID")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (invErr || !inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
    if (String(inv.STATUS_ID) === "2") return res.status(400).json({ error: "Gebuchte Rechnungen können nicht geändert werden" });

    const { error: delErr } = await supabase
      .from("INVOICE_DEDUCTION")
      .delete()
      .eq("INVOICE_ID", id);
    if (delErr) return res.status(500).json({ error: delErr.message });

    if (items.length > 0) {
      const rows = items
        .filter((item) => item.partial_payment_id)
        .map((item) => ({
          INVOICE_ID: parseInt(id, 10),
          PARTIAL_PAYMENT_ID: parseInt(item.partial_payment_id, 10),
          DEDUCTION_AMOUNT_NET: round2(toNum(item.deduction_amount_net)),
          TENANT_ID: inv.TENANT_ID,
        }));

      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("INVOICE_DEDUCTION").insert(rows);
        if (insErr) return res.status(500).json({ error: insErr.message });
      }
    }

    try {
      const totals = await recomputeTotal(id);
      return res.json({ ok: true, ...totals });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ----------------------------
  // GET /api/final-invoices/:id
  // Full invoice data including phase selection and deductions.
  // ----------------------------
  router.get("/:id", async (req, res) => {
    const { id } = req.params;

    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("*")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (invErr || !inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });

    // Phase subtotal and deduction total for summary display
    const { data: isRows } = await supabase
      .from("INVOICE_STRUCTURE")
      .select("AMOUNT_NET, AMOUNT_EXTRAS_NET")
      .eq("INVOICE_ID", id);
    const phaseTotal = round2(
      (isRows || []).reduce((s, r) => s + toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET), 0)
    );

    const { data: idRows } = await supabase
      .from("INVOICE_DEDUCTION")
      .select("DEDUCTION_AMOUNT_NET, PARTIAL_PAYMENT_ID")
      .eq("INVOICE_ID", id);
    const deductionsTotal = round2(
      (idRows || []).reduce((s, r) => s + toNum(r.DEDUCTION_AMOUNT_NET), 0)
    );

    return res.json({
      ...inv,
      PHASE_TOTAL: phaseTotal,
      DEDUCTIONS_TOTAL: deductionsTotal,
    });
  });

  // ----------------------------
  // POST /api/final-invoices/:id/book
  // Books a Schluss- or Teilschlussrechnung:
  //   1. Assigns INVOICE number (INVOICE number range)
  //   2. Generates PDF + XRechnung XML snapshots
  //   3. Sets STATUS_ID = 2
  //   4. Updates PROJECT.INVOICED += TOTAL_AMOUNT_NET
  //   5. Marks selected PROJECT_STRUCTURE rows as CLOSED_BY_INVOICE_ID
  // ----------------------------
  router.post("/:id/book", async (req, res) => {
    const { id } = req.params;

    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, COMPANY_ID, PROJECT_ID, TOTAL_AMOUNT_NET, VAT_PERCENT, STATUS_ID, INVOICE_NUMBER, DOCUMENT_TEMPLATE_ID, INVOICE_TYPE, TENANT_ID")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (invErr || !inv) return res.status(500).json({ error: "INVOICE konnte nicht geladen werden" });
    if (String(inv.STATUS_ID) === "2") return res.status(400).json({ error: "Rechnung ist bereits gebucht" });

    const validTypes = ["schlussrechnung", "teilschlussrechnung"];
    if (!validTypes.includes(inv.INVOICE_TYPE)) {
      return res.status(400).json({ error: "Nur Schluss- und Teilschlussrechnungen können über diesen Endpunkt gebucht werden" });
    }

    const vatPercent = toNum(inv.VAT_PERCENT);
    const totalNet = toNum(inv.TOTAL_AMOUNT_NET);
    const taxAmountNet = round2(totalNet * vatPercent / 100);
    const totalGross = round2(totalNet + taxAmountNet);

    // Assign invoice number (uses same INVOICE number range as regular Rechnungen)
    if (!inv.INVOICE_NUMBER || !String(inv.INVOICE_NUMBER).trim()) {
      const { data: num, error: numErr } = await supabase.rpc("next_document_number", {
        p_company_id: inv.COMPANY_ID,
        p_doc_type: "INVOICE",
      });
      if (numErr || !num) {
        return res.status(500).json({ error: `Nummernkreis: ${numErr?.message || "unknown"}` });
      }
      await supabase.from("INVOICE").update({ INVOICE_NUMBER: num }).eq("ID", id);
      inv.INVOICE_NUMBER = num;
    }

    const prefix = inv.INVOICE_TYPE === "schlussrechnung" ? "Schlussrechnung" : "Teilschlussrechnung";

    // Generate PDF
    let pdfAsset = null, tpl = null, theme = null;
    try {
      const r = await renderDocumentPdf({
        supabase,
        docType: "INVOICE",
        docId: parseInt(id, 10),
        templateId: inv.DOCUMENT_TEMPLATE_ID ? parseInt(String(inv.DOCUMENT_TEMPLATE_ID), 10) : null,
      });
      tpl = r.template;
      theme = r.theme;
      pdfAsset = await storeGeneratedPdfAsAsset({
        supabase,
        companyId: inv.COMPANY_ID,
        fileName: `${prefix}_${inv.INVOICE_NUMBER || inv.ID}.pdf`,
        pdfBuffer: r.pdf,
        assetType: "PDF_INVOICE",
      });
    } catch (e) {
      console.error("[BOOK_FINAL][PDF]", { id, error: e?.message, stack: e?.stack });
      return res.status(500).json({ error: `PDF konnte nicht erzeugt werden: ${e?.message || e}` });
    }

    // Generate XRechnung XML
    let xmlAsset = null;
    try {
      const { data: invFull } = await supabase.from("INVOICE").select("*").eq("ID", id).maybeSingle();
      const xml = await generateUblInvoiceXml({ supabase, invoice: invFull, docType: "INVOICE" });
      xmlAsset = await storeGeneratedXmlAsAsset({
        supabase,
        companyId: inv.COMPANY_ID,
        fileName: `XRechnung_${inv.INVOICE_NUMBER || inv.ID}.xml`,
        xmlString: xml,
        assetType: "XML_XRECHNUNG_INVOICE",
      });
    } catch (e) {
      console.error("[BOOK_FINAL][XRECHNUNG]", { id, error: e?.message, stack: e?.stack });
      await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
      return res.status(500).json({ error: `E-Rechnung konnte nicht erzeugt werden: ${e?.message || e}` });
    }

    // Update INVOICE status + snapshots
    const { error: upErr } = await supabase.from("INVOICE").update({
      STATUS_ID: 2,
      TAX_AMOUNT_NET: taxAmountNet,
      TOTAL_AMOUNT_GROSS: totalGross,
      DOCUMENT_TEMPLATE_ID: tpl?.ID ?? null,
      DOCUMENT_LAYOUT_KEY_SNAPSHOT: tpl?.LAYOUT_KEY ?? null,
      DOCUMENT_THEME_SNAPSHOT_JSON: theme ?? null,
      DOCUMENT_LOGO_ASSET_ID_SNAPSHOT: tpl?.LOGO_ASSET_ID ?? null,
      DOCUMENT_PDF_ASSET_ID: pdfAsset?.ID ?? null,
      DOCUMENT_XML_ASSET_ID: xmlAsset?.ID ?? null,
      DOCUMENT_XML_PROFILE: "xrechnung-ubl",
      DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
      DOCUMENT_RENDERED_AT: new Date().toISOString(),
    }).eq("ID", id);
    if (upErr) {
      await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
      await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      return res.status(500).json({ error: upErr.message });
    }

    // Update PROJECT.INVOICED += TOTAL_AMOUNT_NET (net after deductions = actual cash billed)
    const { data: project } = await supabase
      .from("PROJECT")
      .select("ID, INVOICED")
      .eq("ID", inv.PROJECT_ID)
      .maybeSingle();
    if (project) {
      await supabase.from("PROJECT")
        .update({ INVOICED: round2(toNum(project.INVOICED) + totalNet) })
        .eq("ID", inv.PROJECT_ID);
    }

    // Mark selected PROJECT_STRUCTURE rows as definitively closed
    try {
      const { data: isRows } = await supabase
        .from("INVOICE_STRUCTURE")
        .select("STRUCTURE_ID")
        .eq("INVOICE_ID", id);
      const structureIds = (isRows || [])
        .map((r) => parseInt(r.STRUCTURE_ID, 10))
        .filter((n) => Number.isFinite(n));
      if (structureIds.length > 0) {
        await supabase.from("PROJECT_STRUCTURE")
          .update({ CLOSED_BY_INVOICE_ID: parseInt(id, 10) })
          .in("ID", structureIds);
      }
    } catch (e) {
      console.error("[BOOK_FINAL][CLOSE_PHASES]", e);
      // Non-fatal: booking already completed
    }

    return res.json({ success: true, number: inv.INVOICE_NUMBER, pdf_asset_id: pdfAsset?.ID ?? null });
  });

  return router;
};
