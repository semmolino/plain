"use strict";

const { renderDocumentPdf } = require("../services_pdf_render");
const svc = require("../services/invoices");
const { loadInvoiceData } = require("../services_einvoice_data");
const { generateCiiXml } = require("../services_einvoice_cii");
const { generateUblXml, generatePeppolXml } = require("../services_einvoice_ubl");
const { embedXmlIntoPdf } = require("../services_einvoice_pdf_embed");
const { validateEInvoiceData } = require("../services_einvoice_validator");

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
  const invoiceType = ["schlussrechnung", "teilschlussrechnung", "gutschrift"].includes(b.invoice_type)
    ? b.invoice_type
    : "rechnung";

  if (!employeeId || !projectId || !contractId) {
    return res.status(400).json({ error: "Pflichtfelder fehlen (Mitarbeiter/Projekt/Vertrag)" });
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
    .eq("TENANT_ID", req.tenantId)
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
      .select("ID, STATUS_ID, PROJECT_ID, CONTRACT_ID, VAT_PERCENT, VAT_ID")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
    if (String(inv.STATUS_ID) === "2") {
      return res.status(400).json({ error: "Gebuchte Rechnungen können nicht geändert werden" });
    }

    // Self-Heal: VAT_PERCENT aus Vertrag / Tenant-Standard nachziehen
    if (inv.VAT_PERCENT == null || svc.toNum(inv.VAT_PERCENT) === 0) {
      try {
        let resolvedVatId = null;
        if (inv.CONTRACT_ID) {
          const { data: cRow } = await supabase
            .from("CONTRACT").select("VAT_ID").eq("ID", inv.CONTRACT_ID).maybeSingle();
          resolvedVatId = cRow?.VAT_ID ?? null;
        }
        if (!resolvedVatId) {
          const { data: settingsRows } = await supabase
            .from("TENANT_SETTINGS").select("KEY, VALUE")
            .eq("TENANT_ID", req.tenantId).eq("KEY", "default_vat_id");
          const defVatId = settingsRows?.[0]?.VALUE;
          if (defVatId) resolvedVatId = Number(defVatId);
        }
        // Last-Resort: höchster VAT-Eintrag (i.d.R. 19%)
        if (!resolvedVatId) {
          const { data: anyVat } = await supabase
            .from("VAT").select("ID").order("VAT_PERCENT", { ascending: false }).limit(1);
          if (anyVat && anyVat.length > 0) resolvedVatId = anyVat[0].ID;
        }
        if (resolvedVatId) {
          const { data: vat } = await supabase
            .from("VAT").select("VAT_PERCENT").eq("ID", resolvedVatId).maybeSingle();
          const newVatPct = vat?.VAT_PERCENT ?? null;
          if (newVatPct != null) {
            await supabase.from("INVOICE")
              .update({ VAT_ID: resolvedVatId, VAT_PERCENT: newVatPct })
              .eq("ID", id);
            inv.VAT_ID = resolvedVatId;
            inv.VAT_PERCENT = newVatPct;
          }
        }
      } catch (_) { /* soft-fail */ }
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
    // Recompute auch bei stalem Entwurf (gespeicherter Betrag > Vorschlag,
    // z.B. nach Storno einer früheren Rechnung sinkt der abrechenbare Anteil).
    const isStale = perfSuggested > 0 && bt1Sums.net > perfSuggested + 0.5;
    if ((bt1Sums.net <= 0 || isStale) && perfSuggested > 0) {
      await svc.applyPerformanceAmount(supabase, {
        invoiceId: id,
        contractId: inv.CONTRACT_ID,
        projectId: inv.PROJECT_ID,
        amount: perfSuggested,
      });
    }

    // Compute bookings sum from TEC entries already assigned to this invoice (no auto-assignment).
    if (bt2Ids.length > 0) {
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
        vat_percent: Number(inv.VAT_PERCENT ?? 0),
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
      .eq("TENANT_ID", req.tenantId)
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
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
    if (String(inv.STATUS_ID) === "2") {
      return res.status(400).json({ error: "Gebuchte Rechnungen können nicht geändert werden" });
    }

    const structures = await svc.loadProjectStructuresForContext(supabase, { contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
    const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
    if (bt2Ids.length === 0) return res.json({ data: [], hasBt2: false });

    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("ID, DATE_VOUCHER, POSTING_DESCRIPTION, SP_TOT, STRUCTURE_ID, PARTIAL_PAYMENT_ID, INVOICE_ID, EMPLOYEE:EMPLOYEE_ID(SHORT_NAME)")
      .in("STRUCTURE_ID", bt2Ids)
      .neq("STATUS", "DRAFT")
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

    return res.json({ data: out, hasBt2: true });
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
      .eq("TENANT_ID", req.tenantId)
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
    .eq("TENANT_ID", req.tenantId)
    .maybeSingle();

  if (invRowErr) {
    logError({ step: "load_invoice_min" }, invRowErr);
    return res.status(500).json({ error: invRowErr.message });
  }
  if (!invRow) return res.status(404).json({ error: "INVOICE nicht gefunden" });

  const isBooked = String(invRow.STATUS_ID) === "2";
  const fname = `XRechnung_${invRow.INVOICE_NUMBER || invRow.ID}.xml`;

  if (isBooked && !preview && invRow.DOCUMENT_XML_ASSET_ID) {
    try {
      return await svc.streamXmlAsset({ supabase, res, assetId: invRow.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
    } catch (snapErr) {
      console.warn("[EINVOICE_XRECHNUNG] snapshot missing on disk, regenerating live", { invoice_id: invRow.ID, asset_id: invRow.DOCUMENT_XML_ASSET_ID });
    }
  }

  try {
    const { data: invFull, error: invFullErr } = await supabase.from("INVOICE").select("*").eq("ID", invoiceId).eq("TENANT_ID", req.tenantId).maybeSingle();
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
    .eq("TENANT_ID", req.tenantId)
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
    const { data: invFull, error: invFullErr } = await supabase.from("INVOICE").select("*").eq("ID", invoiceId).eq("TENANT_ID", req.tenantId).maybeSingle();
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
    .eq("TENANT_ID", req.tenantId)
    .maybeSingle();
  if (invErr || !inv) return res.status(500).json({ error: "INVOICE konnte nicht geladen werden" });

  if (String(inv.STATUS_ID) === "2") {
    return res.status(400).json({ error: "Rechnung ist bereits gebucht" });
  }

  const releasePpIds = Array.isArray(req.body?.release_partial_payment_ids)
    ? req.body.release_partial_payment_ids.map(n => parseInt(String(n), 10)).filter(Number.isFinite)
    : [];

  const force = String(req.query.force || req.body?.force || "") === "1" || req.body?.force === true;

  try {
    const result = await svc.bookInvoice(supabase, {
      id, inv,
      releasePpIds,
      tenantId: req.tenantId,
      force,
    });
    return res.json(result);
  } catch (e) {
    const status = e?.status || 500;
    if (e?.validation) {
      return res.status(status).json({ error: e.message, validation: e.validation });
    }
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/invoices/:id
// ---------------------------------------------------------------------------
async function deleteInvoice(req, res, supabase) {
  const { id } = req.params;

  try {
    await svc.deleteInvoice(supabase, { id, tenantId: req.tenantId });
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
  const deletePayments = req.body?.delete_payments === true;

  try {
    const result = await svc.cancelInvoice(supabase, { id, tenantId: req.tenantId, deletePayments });
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
    const { inv, project, contract } = await svc.getInvoice(supabase, { id, tenantId: req.tenantId });
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
        .eq("TENANT_ID", req.tenantId)
        .maybeSingle();

      if (!invRowErr && invRow && String(invRow.STATUS_ID) === "2" && invRow.DOCUMENT_PDF_ASSET_ID) {
        const fname = `Rechnung_${invRow.INVOICE_NUMBER || invRow.ID}.pdf`;
        return svc.streamPdfAsset({ supabase, res, assetId: invRow.DOCUMENT_PDF_ASSET_ID, dispositionName: fname, download });
      }
    }

    // Preview-Only: wenn der Wizard SE-Release-IDs mitschickt, in die
    // Preview einsynthetisieren (siehe buildPdfViewModel).
    const releasePpIds = String(req.query.release_pp_ids || "")
      .split(",").map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0);

    const { pdf } = await renderDocumentPdf({
      supabase,
      docType: "INVOICE",
      docId: invoiceId,
      templateId: Number.isFinite(templateId) ? templateId : null,
      previewReleasePpIds: preview ? releasePpIds : [],
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
// GET /api/invoices/:id/einvoice/peppol
// Branch 11: Peppol BIS Billing 3.0 XML
// ---------------------------------------------------------------------------
async function getEinvoicePeppol(req, res, supabase) {
  const invoiceId = parseInt(String(req.params.id || ""), 10);
  if (!invoiceId || Number.isNaN(invoiceId)) return res.status(400).json({ error: "invalid id" });

  const download = String(req.query.download || "") === "1";

  try {
    const { data: invRow } = await supabase
      .from("INVOICE")
      .select("INVOICE_NUMBER")
      .eq("ID", invoiceId)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (!invRow) return res.status(404).json({ error: "INVOICE nicht gefunden" });

    const data = await loadInvoiceData(supabase, invoiceId, "INVOICE", req.tenantId);
    const xml = generatePeppolXml(data);
    const fname = `Peppol_${invRow.INVOICE_NUMBER || invoiceId}.xml`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${fname}"`);
    return res.send(xml);
  } catch (err) {
    console.error("[EINVOICE_PEPPOL_INV]", { invoice_id: invoiceId, error: err?.message, stack: err?.stack });
    return res.status(500).json({ error: `Peppol XML konnte nicht erzeugt werden: ${err?.message || err}` });
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/validate
// Validiert die InvoiceData gegen die EN16931 Business-Rules.
// Liefert { ok, errors, warnings } -- ohne Buchung.
// ---------------------------------------------------------------------------
async function validateInvoice(req, res, supabase) {
  try {
    const invoiceId = parseInt(req.params.id, 10);
    if (!invoiceId || Number.isNaN(invoiceId)) return res.status(400).json({ error: "invalid id" });

    const data = await loadInvoiceData(supabase, invoiceId, "INVOICE", req.tenantId);
    const result = validateEInvoiceData(data);
    return res.json(result);
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/pdf-hybrid?profile=EN16931&format=cii|ubl
// Hybrid PDF mit eingebetteter ZUGFeRD / Factur-X / XRechnung XML
// ---------------------------------------------------------------------------
async function getPdfHybrid(req, res, supabase) {
  try {
    const invoiceId = parseInt(req.params.id, 10);
    if (!invoiceId || Number.isNaN(invoiceId)) return res.status(400).json({ error: "invalid id" });

    const profile  = String(req.query.profile || "EN16931").toUpperCase();
    const format   = String(req.query.format  || "cii").toLowerCase();   // 'cii' | 'ubl'
    const download = String(req.query.download || "") === "1";
    const templateId = req.query.template_id ? parseInt(String(req.query.template_id), 10) : null;

    const releasePpIds = String(req.query.release_pp_ids || "")
      .split(",").map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0);

    const [{ pdf }, data] = await Promise.all([
      renderDocumentPdf({
        supabase,
        docType: "INVOICE",
        docId: invoiceId,
        templateId: Number.isFinite(templateId) ? templateId : null,
        previewReleasePpIds: releasePpIds,
      }),
      loadInvoiceData(supabase, invoiceId, "INVOICE", req.tenantId),
    ]);

    const xml = format === "ubl"
      ? generateUblXml(data)
      : generateCiiXml(data, profile);

    const xmlProfileKey = format === "ubl" ? "XRECHNUNG" : profile;
    const xmlFilename   = format === "ubl" ? "xrechnung.xml" : "factur-x.xml";

    const { data: invRow } = await supabase
      .from("INVOICE")
      .select("INVOICE_NUMBER")
      .eq("ID", invoiceId)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    const pdfName = `Rechnung_${invRow?.INVOICE_NUMBER || invoiceId}_ZUGFeRD.pdf`;

    const hybrid = await embedXmlIntoPdf({
      pdfBuffer: Buffer.from(pdf),
      xml,
      profileKey: xmlProfileKey,
      filename: xmlFilename,
      title: `Rechnung ${invRow?.INVOICE_NUMBER || invoiceId}`,
      author: "PlaIn",
      producer: "PlaIn — Hybrid PDF",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${pdfName}"`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(hybrid);
  } catch (e) {
    console.error("[PDF_HYBRID_INV]", { invoice_id: req.params.id, error: e?.message, stack: e?.stack });
    res.status(500).json({ error: String(e?.message || e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/invoices/:id/einvoice/cii?profile=EN16931
// ---------------------------------------------------------------------------
async function getEinvoiceCii(req, res, supabase) {
  const invoiceId = parseInt(String(req.params.id || ""), 10);
  if (!invoiceId || Number.isNaN(invoiceId)) return res.status(400).json({ error: "invalid id" });

  const profile  = String(req.query.profile  || "EXTENDED").toUpperCase();
  const download = String(req.query.download || "") === "1";
  const preview  = String(req.query.preview  || "") === "1";

  const { data: invRow, error: invRowErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, DOCUMENT_XML_PROFILE, INVOICE_NUMBER, COMPANY_ID")
    .eq("ID", invoiceId)
    .eq("TENANT_ID", req.tenantId)
    .maybeSingle();

  if (invRowErr) return res.status(500).json({ error: invRowErr.message });
  if (!invRow)   return res.status(404).json({ error: "INVOICE nicht gefunden" });

  const fname      = `ZUGFeRD_${invRow.INVOICE_NUMBER || invRow.ID}.xml`;
  const profileKey = `zugferd-${profile.toLowerCase()}`;

  // Serve snapshot only if format matches
  if (!preview && String(invRow.STATUS_ID) === "2" && invRow.DOCUMENT_XML_ASSET_ID && invRow.DOCUMENT_XML_PROFILE === profileKey) {
    try {
      return await svc.streamXmlAsset({ supabase, res, assetId: invRow.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
    } catch (snapErr) {
      console.warn("[EINVOICE_CII_INV] snapshot missing on disk, regenerating live", { invoice_id: invRow.ID, asset_id: invRow.DOCUMENT_XML_ASSET_ID });
    }
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

  const profile = String(req.query.profile || "EXTENDED").toUpperCase();

  const { data: invRow, error: invRowErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, INVOICE_NUMBER, COMPANY_ID")
    .eq("ID", invoiceId)
    .eq("TENANT_ID", req.tenantId)
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
  getPdfHybrid,
  validateInvoice,
  getEinvoicePeppol,
};
