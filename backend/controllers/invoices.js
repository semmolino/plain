"use strict";

const { renderDocumentPdf } = require("../services_pdf_render");
const svc = require("../services/invoices");
const { loadInvoiceData } = require("../services_einvoice_data");
const { generateCiiXml } = require("../services_einvoice_cii");

// ---------------------------------------------------------------------------
// GET /api/invoices
// ---------------------------------------------------------------------------
async function listInvoices(req, res, supabase) {
  const limit = (() => {
    const n = parseInt(String(req.query.limit ?? "50"), 10);
    if (!Number.isFinite(n) || n <= 0) return 50;
    return Math.min(n, 500);
  })();
  const q = String(req.query.q ?? "").trim();

  try {
    const data = await svc.listInvoices(supabase, { tenantId: req.tenantId, limit, q });
    return res.json({ data });
  } catch (e) {
    const msg = (e?.message || "").toLowerCase();
    if (msg.includes("relation") && msg.includes("invoice") && msg.includes("does not exist")) {
      return res.status(501).json({ error: "INVOICE Tabelle ist in der Datenbank nicht vorhanden." });
    }
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// POST /api/invoices/init
// ---------------------------------------------------------------------------
async function initInvoice(req, res, supabase) {
  const b = req.body || {};
  const { company_id: companyId, employee_id: employeeId, project_id: projectId, contract_id: contractId } = b;
  const invoiceType = ["schlussrechnung", "teilschlussrechnung"].includes(b.invoice_type)
    ? b.invoice_type
    : "rechnung";

  if (!companyId || !employeeId || !projectId || !contractId) {
    return res.status(400).json({ error: "Pflichtfelder fehlen (Firma/Mitarbeiter/Projekt/Vertrag)" });
  }

  try {
    const result = await svc.initInvoice(supabase, { companyId, employeeId, projectId, contractId, invoiceType });
    return res.json(result);
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/invoices/:id
// ---------------------------------------------------------------------------
async function patchInvoice(req, res, supabase) {
  const { id } = req.params;

  // Load current state first (needed for VAT recompute + status check)
  const { data: inv, error: invErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, TOTAL_AMOUNT_NET, VAT_PERCENT")
    .eq("ID", id)
    .maybeSingle();
  if (invErr) return res.status(500).json({ error: invErr.message });
  if (!inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
  if (String(inv.STATUS_ID) === "2") {
    return res.status(400).json({ error: "Gebuchte Rechnungen können nicht geändert werden" });
  }

  try {
    const result = await svc.patchInvoice(supabase, { id, body: req.body || {}, currentInv: inv });
    return res.json(result);
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/billing-proposal
// ---------------------------------------------------------------------------
async function getBillingProposal(req, res, supabase) {
  const { id } = req.params;

  try {
    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, STATUS_ID, PROJECT_ID, CONTRACT_ID")
      .eq("ID", id)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
    if (String(inv.STATUS_ID) === "2") {
      return res.status(400).json({ error: "Gebuchte Rechnungen können nicht geändert werden" });
    }

    const structures = await svc.loadProjectStructuresForContext(supabase, { contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
    const bt1 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1);
    const bt2 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2);
    const bt1Ids = bt1.map((s) => s.ID);
    const bt2Ids = bt2.map((s) => s.ID);

    const prev = await svc.loadPreviouslyBilledByStructure(supabase, {
      contractId: inv.CONTRACT_ID,
      projectId: inv.PROJECT_ID,
      structureIds: bt1Ids,
      excludeInvoiceId: id,
      bookedStatusId: 2,
    });

    const perfSuggested = svc.round2(
      bt1.reduce((acc, s) => {
        const billed = prev.get(String(s.ID)) || 0;
        const rem = svc.round2(svc.toNum(s.REVENUE_COMPLETION) - billed);
        return acc + (rem > 0 ? rem : 0);
      }, 0)
    );

    const bt1Sums = await svc.sumInvStructureForInvoice(supabase, { invoiceId: id, structureIds: bt1Ids });
    if (bt1Sums.net <= 0 && perfSuggested > 0) {
      await svc.applyPerformanceAmount(supabase, {
        invoiceId: id,
        contractId: inv.CONTRACT_ID,
        projectId: inv.PROJECT_ID,
        amount: perfSuggested,
      });
    }

    if (bt2Ids.length > 0) {
      const { data: hasAny, error: hasAnyErr } = await supabase
        .from("TEC")
        .select("ID")
        .eq("INVOICE_ID", id)
        .limit(1);
      if (hasAnyErr) throw new Error(hasAnyErr.message);

      if (!Array.isArray(hasAny) || hasAny.length === 0) {
        const { toAssignIds } = await svc.findTecIdsToAutoAssign(supabase, { invoiceId: id, structureIds: bt2Ids });
        if (toAssignIds.length > 0) {
          const { error: asErr } = await supabase.from("TEC").update({ INVOICE_ID: id }).in("ID", toAssignIds);
          if (asErr) throw new Error(asErr.message);
        }
      }

      await svc.updateBt2FromTec(supabase, { invoiceId: id, contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
    }

    const totals = await svc.recomputeInvoiceTotals(supabase, id);
    const bt1Now = await svc.sumInvStructureForInvoice(supabase, { invoiceId: id, structureIds: bt1Ids });
    const bt2Now = await svc.sumInvStructureForInvoice(supabase, { invoiceId: id, structureIds: bt2Ids });

    return res.json({
      data: {
        performance_suggested: perfSuggested,
        performance_amount: bt1Now.net,
        bookings_sum: bt2Now.net,
        ...totals,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/invoices/:id/performance
// ---------------------------------------------------------------------------
async function putPerformance(req, res, supabase) {
  const { id } = req.params;
  const amount = svc.toNum(req.body?.amount);

  try {
    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, STATUS_ID, PROJECT_ID, CONTRACT_ID")
      .eq("ID", id)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
    if (String(inv.STATUS_ID) === "2") {
      return res.status(400).json({ error: "Gebuchte Rechnungen können nicht geändert werden" });
    }

    const perf = await svc.applyPerformanceAmount(supabase, {
      invoiceId: id,
      contractId: inv.CONTRACT_ID,
      projectId: inv.PROJECT_ID,
      amount,
    });

    const structures = await svc.loadProjectStructuresForContext(supabase, { contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
    const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
    if (bt2Ids.length > 0) {
      await svc.updateBt2FromTec(supabase, { invoiceId: id, contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
    }

    const totals = await svc.recomputeInvoiceTotals(supabase, id);
    const bt2Now = await svc.sumInvStructureForInvoice(supabase, { invoiceId: id, structureIds: bt2Ids });

    return res.json({
      data: {
        performance_amount: perf.performance_amount,
        bookings_sum: bt2Now.net,
        ...totals,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/tec
// ---------------------------------------------------------------------------
async function getTec(req, res, supabase) {
  const { id } = req.params;

  try {
    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, STATUS_ID, PROJECT_ID, CONTRACT_ID")
      .eq("ID", id)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
    if (String(inv.STATUS_ID) === "2") {
      return res.status(400).json({ error: "Gebuchte Rechnungen können nicht geändert werden" });
    }

    const structures = await svc.loadProjectStructuresForContext(supabase, { contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
    const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
    if (bt2Ids.length === 0) return res.json({ data: [] });

    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("ID, DATE_VOUCHER, POSTING_DESCRIPTION, SP_TOT, STRUCTURE_ID, PARTIAL_PAYMENT_ID, INVOICE_ID, EMPLOYEE:EMPLOYEE_ID(SHORT_NAME)")
      .in("STRUCTURE_ID", bt2Ids)
      .order("DATE_VOUCHER", { ascending: true });
    if (tecErr) throw new Error(tecErr.message);

    const out = (tecRows || [])
      .filter((t) => {
        if (!svc.isNullOrZero(t.PARTIAL_PAYMENT_ID)) return false;
        return svc.isNullOrZero(t.INVOICE_ID) || String(t.INVOICE_ID) === String(id);
      })
      .map((t) => ({
        ID: t.ID,
        DATE_VOUCHER: t.DATE_VOUCHER,
        EMPLOYEE_SHORT_NAME: t.EMPLOYEE?.SHORT_NAME ?? "",
        POSTING_DESCRIPTION: t.POSTING_DESCRIPTION ?? "",
        SP_TOT: svc.round2(t.SP_TOT),
        ASSIGNED: String(t.INVOICE_ID) === String(id),
      }));

    return res.json({ data: out });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/tec
// ---------------------------------------------------------------------------
async function postTec(req, res, supabase) {
  const { id } = req.params;
  const idsAssign = Array.isArray(req.body?.ids_assign) ? req.body.ids_assign.map(String) : [];
  const idsUnassign = Array.isArray(req.body?.ids_unassign) ? req.body.ids_unassign.map(String) : [];
  const perfAmount = req.body?.performance_amount;

  try {
    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, STATUS_ID, PROJECT_ID, CONTRACT_ID")
      .eq("ID", id)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
    if (String(inv.STATUS_ID) === "2") {
      return res.status(400).json({ error: "Gebuchte Rechnungen können nicht geändert werden" });
    }

    if (perfAmount !== undefined) {
      await svc.applyPerformanceAmount(supabase, {
        invoiceId: id,
        contractId: inv.CONTRACT_ID,
        projectId: inv.PROJECT_ID,
        amount: svc.toNum(perfAmount),
      });
    }

    if (idsUnassign.length > 0) {
      const { error: unErr } = await supabase
        .from("TEC")
        .update({ INVOICE_ID: null })
        .in("ID", idsUnassign)
        .eq("INVOICE_ID", id);
      if (unErr) throw new Error(unErr.message);
    }

    if (idsAssign.length > 0) {
      const { data: rows, error: selErr } = await supabase
        .from("TEC")
        .select("ID, PARTIAL_PAYMENT_ID, INVOICE_ID")
        .in("ID", idsAssign);
      if (selErr) throw new Error(selErr.message);

      const allow = (rows || [])
        .filter((t) => svc.isNullOrZero(t.PARTIAL_PAYMENT_ID) && svc.isNullOrZero(t.INVOICE_ID))
        .map((t) => t.ID);

      if (allow.length > 0) {
        const { error: asErr } = await supabase.from("TEC").update({ INVOICE_ID: id }).in("ID", allow);
        if (asErr) throw new Error(asErr.message);
      }
    }

    const bt2 = await svc.updateBt2FromTec(supabase, { invoiceId: id, contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });

    const structures = await svc.loadProjectStructuresForContext(supabase, { contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
    const bt1Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1).map((s) => s.ID);
    const bt1Now = await svc.sumInvStructureForInvoice(supabase, { invoiceId: id, structureIds: bt1Ids });
    const totals = await svc.recomputeInvoiceTotals(supabase, id);

    return res.json({
      data: {
        bookings_sum: bt2.bookings_sum,
        performance_amount: bt1Now.net,
        ...totals,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/einvoice/ubl
// ---------------------------------------------------------------------------
async function getEinvoiceUbl(req, res, supabase) {
  const invoiceId = parseInt(String(req.params.id || ""), 10);
  if (!invoiceId || Number.isNaN(invoiceId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const preview = String(req.query.preview || "") === "1";
  const download = String(req.query.download || "") === "1";

  const logCtx = (extra = {}) => ({ tag: "EINVOICE_XRECHNUNG", invoice_id: invoiceId, preview, download, ...extra });
  const logError = (extra, err) => {
    console.error("[EINVOICE_XRECHNUNG]", { ...logCtx(extra), error: err?.message || String(err), stack: err?.stack });
  };

  const { data: invRow, error: invRowErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, INVOICE_NUMBER, COMPANY_ID")
    .eq("ID", invoiceId)
    .maybeSingle();

  if (invRowErr) {
    logError({ step: "load_invoice_min" }, invRowErr);
    return res.status(500).json({ error: invRowErr.message });
  }
  if (!invRow) return res.status(404).json({ error: "INVOICE nicht gefunden" });

  const isBooked = String(invRow.STATUS_ID) === "2";
  const fname = `XRechnung_${invRow.INVOICE_NUMBER || invRow.ID}.xml`;

  if (isBooked && !preview) {
    if (!invRow.DOCUMENT_XML_ASSET_ID) {
      console.warn("[EINVOICE_XRECHNUNG]", logCtx({ step: "booked_snapshot_missing" }));
      return res.status(409).json({
        error: "BOOKED_XML_SNAPSHOT_MISSING",
        message: "Invoice is booked, but the XRechnung XML snapshot is missing. Regeneration is blocked to preserve immutability.",
        invoice_id: invRow.ID,
      });
    }
    return svc.streamXmlAsset({ supabase, res, assetId: invRow.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
  }

  try {
    const { data: invFull, error: invFullErr } = await supabase.from("INVOICE").select("*").eq("ID", invoiceId).maybeSingle();
    if (invFullErr || !invFull) throw new Error(invFullErr?.message || "INVOICE nicht gefunden");

    const xml = await svc.generateUblInvoiceXml({ supabase, invoice: invFull, docType: "INVOICE" });
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${fname}"`);
    return res.send(xml);
  } catch (err) {
    logError({ step: "generate_xml_live", status_id: invRow.STATUS_ID, company_id: invRow.COMPANY_ID }, err);
    return res.status(500).json({
      error: "EINVOICE_GENERATION_FAILED",
      message: `E-Rechnung konnte nicht erzeugt werden: ${err?.message || err}`,
      invoice_id: invRow.ID,
    });
  }
}

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/einvoice/ubl/snapshot
// ---------------------------------------------------------------------------
async function postEinvoiceUblSnapshot(req, res, supabase) {
  const invoiceId = parseInt(String(req.params.id || ""), 10);
  if (!invoiceId || Number.isNaN(invoiceId)) return res.status(400).json({ error: "invalid id" });

  const { data: invRow, error: invRowErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, INVOICE_NUMBER, COMPANY_ID")
    .eq("ID", invoiceId)
    .maybeSingle();

  if (invRowErr) {
    console.error("[EINVOICE_SNAPSHOT]", { step: "load_invoice_min", invoice_id: invoiceId, error: invRowErr.message });
    return res.status(500).json({ error: invRowErr.message });
  }
  if (!invRow) return res.status(404).json({ error: "INVOICE nicht gefunden" });

  if (String(invRow.STATUS_ID) !== "2") {
    return res.status(400).json({ error: "Snapshot ist nur fuer gebuchte Rechnungen (STATUS_ID=2) erlaubt" });
  }

  if (invRow.DOCUMENT_XML_ASSET_ID) {
    return res.json({ success: true, invoice_id: invRow.ID, xml_asset_id: invRow.DOCUMENT_XML_ASSET_ID, already_existed: true });
  }

  const fname = `XRechnung_${invRow.INVOICE_NUMBER || invRow.ID}.xml`;

  try {
    const { data: invFull, error: invFullErr } = await supabase.from("INVOICE").select("*").eq("ID", invoiceId).maybeSingle();
    if (invFullErr || !invFull) throw new Error(invFullErr?.message || "INVOICE nicht gefunden");

    const xml = await svc.generateUblInvoiceXml({ supabase, invoice: invFull, docType: "INVOICE" });
    const xmlAsset = await svc.storeGeneratedXmlAsAsset({ supabase, companyId: invRow.COMPANY_ID, fileName: fname, xmlString: xml, assetType: "XML_XRECHNUNG_INVOICE" });

    const { error: upErr } = await supabase.from("INVOICE").update({
      DOCUMENT_XML_ASSET_ID: xmlAsset?.ID ?? null,
      DOCUMENT_XML_PROFILE: "xrechnung-ubl",
      DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
    }).eq("ID", invoiceId);

    if (upErr) {
      await svc.bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      throw new Error(upErr.message);
    }

    return res.json({ success: true, invoice_id: invRow.ID, xml_asset_id: xmlAsset.ID, already_existed: false });
  } catch (e) {
    console.error("[EINVOICE_SNAPSHOT]", { invoice_id: invoiceId, error: e?.message || String(e), stack: e?.stack });
    return res.status(500).json({ error: `Snapshot konnte nicht erzeugt werden: ${e?.message || e}` });
  }
}

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/book
// ---------------------------------------------------------------------------
async function bookInvoice(req, res, supabase) {
  const { id } = req.params;

  const { data: inv, error: invErr } = await supabase
    .from("INVOICE")
    .select("ID, COMPANY_ID, PROJECT_ID, CONTRACT_ID, TOTAL_AMOUNT_NET, VAT_PERCENT, STATUS_ID, INVOICE_NUMBER, DOCUMENT_TEMPLATE_ID")
    .eq("ID", id)
    .maybeSingle();
  if (invErr || !inv) return res.status(500).json({ error: "INVOICE konnte nicht geladen werden" });

  if (String(inv.STATUS_ID) === "2") {
    return res.status(400).json({ error: "Rechnung ist bereits gebucht" });
  }

  try {
    const result = await svc.bookInvoice(supabase, { id, inv });
    return res.json(result);
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/invoices/:id
// ---------------------------------------------------------------------------
async function deleteInvoice(req, res, supabase) {
  const { id } = req.params;

  try {
    await svc.deleteInvoice(supabase, { id });
    return res.json({ ok: true });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/cancel
// ---------------------------------------------------------------------------
async function cancelInvoice(req, res, supabase) {
  const { id } = req.params;

  try {
    const result = await svc.cancelInvoice(supabase, { id });
    return res.json(result);
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id
// ---------------------------------------------------------------------------
async function getInvoice(req, res, supabase) {
  const { id } = req.params;

  try {
    const { inv, project, contract } = await svc.getInvoice(supabase, { id });
    return res.json({ data: { inv, project, contract } });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/pdf
// ---------------------------------------------------------------------------
async function getPdf(req, res, supabase) {
  try {
    const invoiceId = parseInt(req.params.id, 10);
    if (!invoiceId || Number.isNaN(invoiceId)) return res.status(400).json({ error: "invalid id" });

    const preview = String(req.query.preview || "") === "1";
    const download = String(req.query.download || "") === "1";
    const templateId = req.query.template_id ? parseInt(String(req.query.template_id), 10) : null;

    if (!preview) {
      const { data: invRow, error: invRowErr } = await supabase
        .from("INVOICE")
        .select("ID, STATUS_ID, DOCUMENT_PDF_ASSET_ID, INVOICE_NUMBER")
        .eq("ID", invoiceId)
        .maybeSingle();

      if (!invRowErr && invRow && String(invRow.STATUS_ID) === "2" && invRow.DOCUMENT_PDF_ASSET_ID) {
        const fname = `Rechnung_${invRow.INVOICE_NUMBER || invRow.ID}.pdf`;
        return svc.streamPdfAsset({ supabase, res, assetId: invRow.DOCUMENT_PDF_ASSET_ID, dispositionName: fname, download });
      }
    }

    const { pdf } = await renderDocumentPdf({
      supabase,
      docType: "INVOICE",
      docId: invoiceId,
      templateId: Number.isFinite(templateId) ? templateId : null,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="Rechnung_${invoiceId}.pdf"`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(Buffer.from(pdf));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/einvoice/cii?profile=EN16931
// ---------------------------------------------------------------------------
async function getEinvoiceCii(req, res, supabase) {
  const invoiceId = parseInt(String(req.params.id || ""), 10);
  if (!invoiceId || Number.isNaN(invoiceId)) return res.status(400).json({ error: "invalid id" });

  const profile  = String(req.query.profile  || "EN16931").toUpperCase();
  const download = String(req.query.download || "") === "1";
  const preview  = String(req.query.preview  || "") === "1";

  const { data: invRow, error: invRowErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, DOCUMENT_XML_PROFILE, INVOICE_NUMBER, COMPANY_ID")
    .eq("ID", invoiceId)
    .maybeSingle();

  if (invRowErr) return res.status(500).json({ error: invRowErr.message });
  if (!invRow)   return res.status(404).json({ error: "INVOICE nicht gefunden" });

  const fname      = `ZUGFeRD_${invRow.INVOICE_NUMBER || invRow.ID}.xml`;
  const profileKey = `zugferd-${profile.toLowerCase()}`;

  // Serve snapshot only if format matches
  if (!preview && String(invRow.STATUS_ID) === "2" && invRow.DOCUMENT_XML_ASSET_ID && invRow.DOCUMENT_XML_PROFILE === profileKey) {
    return svc.streamXmlAsset({ supabase, res, assetId: invRow.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
  }

  try {
    const data = await loadInvoiceData(supabase, invoiceId, "INVOICE", req.tenantId);
    const xml  = generateCiiXml(data, profile);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${fname}"`);
    return res.send(xml);
  } catch (err) {
    console.error("[EINVOICE_CII_INV]", { invoice_id: invoiceId, profile, error: err?.message, stack: err?.stack });
    return res.status(500).json({ error: `E-Rechnung (CII) konnte nicht erzeugt werden: ${err?.message || err}`, invoice_id: invRow.ID });
  }
}

// ---------------------------------------------------------------------------
// POST /api/invoices/:id/einvoice/cii/snapshot?profile=EN16931
// ---------------------------------------------------------------------------
async function postEinvoiceCiiSnapshot(req, res, supabase) {
  const invoiceId = parseInt(String(req.params.id || ""), 10);
  if (!invoiceId || Number.isNaN(invoiceId)) return res.status(400).json({ error: "invalid id" });

  const profile = String(req.query.profile || "EN16931").toUpperCase();

  const { data: invRow, error: invRowErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, INVOICE_NUMBER, COMPANY_ID")
    .eq("ID", invoiceId)
    .maybeSingle();

  if (invRowErr) return res.status(500).json({ error: invRowErr.message });
  if (!invRow)   return res.status(404).json({ error: "INVOICE nicht gefunden" });
  if (String(invRow.STATUS_ID) !== "2") {
    return res.status(400).json({ error: "Snapshot ist nur fuer gebuchte Rechnungen (STATUS_ID=2) erlaubt" });
  }
  if (invRow.DOCUMENT_XML_ASSET_ID) {
    return res.json({ success: true, invoice_id: invRow.ID, xml_asset_id: invRow.DOCUMENT_XML_ASSET_ID, already_existed: true });
  }

  const fname = `ZUGFeRD_${invRow.INVOICE_NUMBER || invRow.ID}.xml`;
  try {
    const data     = await loadInvoiceData(supabase, invoiceId, "INVOICE", req.tenantId);
    const xml      = generateCiiXml(data, profile);
    const xmlAsset = await svc.storeGeneratedXmlAsAsset({ supabase, companyId: invRow.COMPANY_ID, fileName: fname, xmlString: xml, assetType: "XML_ZUGFERD_INVOICE" });

    const { error: upErr } = await supabase.from("INVOICE").update({
      DOCUMENT_XML_ASSET_ID:   xmlAsset?.ID ?? null,
      DOCUMENT_XML_PROFILE:    `zugferd-${profile.toLowerCase()}`,
      DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
    }).eq("ID", invoiceId);

    if (upErr) {
      await svc.bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      throw new Error(upErr.message);
    }

    return res.json({ success: true, invoice_id: invRow.ID, xml_asset_id: xmlAsset.ID, already_existed: false });
  } catch (e) {
    console.error("[EINVOICE_CII_SNAPSHOT_INV]", { invoice_id: invoiceId, error: e?.message, stack: e?.stack });
    return res.status(500).json({ error: `Snapshot konnte nicht erzeugt werden: ${e?.message || e}` });
  }
}

module.exports = {
  listInvoices,
  initInvoice,
  patchInvoice,
  getBillingProposal,
  putPerformance,
  getTec,
  postTec,
  getEinvoiceUbl,
  postEinvoiceUblSnapshot,
  getEinvoiceCii,
  postEinvoiceCiiSnapshot,
  bookInvoice,
  deleteInvoice,
  cancelInvoice,
  getInvoice,
  getPdf,
};
