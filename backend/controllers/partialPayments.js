"use strict";

const { renderDocumentPdf } = require("../services_pdf_render");
const svc = require("../services/partialPayments");
const { loadInvoiceData } = require("../services_einvoice_data");
const { generateCiiXml } = require("../services_einvoice_cii");

// ---------------------------------------------------------------------------
// GET /api/partial-payments
// ---------------------------------------------------------------------------
async function listPartialPayments(req, res, supabase) {
  const limit = (() => {
    const n = parseInt(String(req.query.limit ?? "200"), 10);
    if (!Number.isFinite(n) || n <= 0) return 200;
    return Math.min(n, 1000);
  })();
  const statusId = req.query.status_id ? String(req.query.status_id) : "";
  const q = String(req.query.q ?? "").trim();

  try {
    const data = await svc.listPartialPayments(supabase, { tenantId: req.tenantId, limit, statusId, q });
    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// POST /api/partial-payments/init
// ---------------------------------------------------------------------------
async function initPartialPayment(req, res, supabase) {
  const b = req.body || {};
  const { company_id: companyId, employee_id: employeeId, project_id: projectId, contract_id: contractId } = b;

  if (!companyId || !employeeId || !projectId || !contractId) {
    return res.status(400).json({ error: "Pflichtfelder fehlen (Firma/Mitarbeiter/Projekt/Vertrag)" });
  }

  try {
    const result = await svc.initPartialPayment(supabase, { companyId, employeeId, projectId, contractId });
    return res.json(result);
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/partial-payments/:id
// ---------------------------------------------------------------------------
async function patchPartialPayment(req, res, supabase) {
  const { id } = req.params;
  const b = req.body || {};

  const toNum = svc.toNum;
  const round2 = svc.round2;

  const payload = {};

  if (b.partial_payment_number !== undefined) {
    const num = String(b.partial_payment_number || "").trim();
    if (!num) return res.status(400).json({ error: "Abschlagsrechnung Nr. ist erforderlich" });

    const { data: existing, error: existErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("ID")
      .eq("PARTIAL_PAYMENT_NUMBER", num)
      .neq("ID", id)
      .limit(1);
    if (existErr) return res.status(500).json({ error: existErr.message });
    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(409).json({ error: "Abschlagsrechnung Nr. ist bereits vergeben" });
    }
    payload.PARTIAL_PAYMENT_NUMBER = num;
  }

  if (b.partial_payment_date !== undefined) payload.PARTIAL_PAYMENT_DATE = b.partial_payment_date || null;
  if (b.due_date !== undefined) payload.DUE_DATE = b.due_date || null;
  if (b.billing_period_start !== undefined) payload.BILLING_PERIOD_START = b.billing_period_start || null;
  if (b.billing_period_finish !== undefined) payload.BILLING_PERIOD_FINISH = b.billing_period_finish || null;

  if (b.amount_net !== undefined || b.amount_extras_net !== undefined) {
    const amountNet = toNum(b.amount_net);
    const amountExtras = toNum(b.amount_extras_net);
    payload.AMOUNT_NET = amountNet;
    payload.AMOUNT_EXTRAS_NET = amountExtras;
    payload.TOTAL_AMOUNT_NET = amountNet + amountExtras;
  }

  if (b.comment !== undefined) payload.COMMENT = String(b.comment || "").trim() || null;

  if (b.vat_id !== undefined) {
    const vatId = b.vat_id;
    if (!vatId) return res.status(400).json({ error: "Mehrwertsteuersatz ist erforderlich" });

    const { data: vat, error: vatErr } = await supabase.from("VAT").select("ID, VAT_PERCENT").eq("ID", vatId).maybeSingle();
    if (vatErr || !vat) return res.status(500).json({ error: "VAT konnte nicht geladen werden" });
    payload.VAT_ID = vatId;
    payload.VAT_PERCENT = vat.VAT_PERCENT ?? null;
  }

  const needsTaxRecalc = payload.TOTAL_AMOUNT_NET !== undefined || payload.VAT_PERCENT !== undefined;
  if (needsTaxRecalc) {
    const { data: cur, error: curErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("TOTAL_AMOUNT_NET, VAT_PERCENT")
      .eq("ID", id)
      .maybeSingle();
    if (curErr) return res.status(500).json({ error: curErr.message });

    const totalNet = payload.TOTAL_AMOUNT_NET !== undefined ? payload.TOTAL_AMOUNT_NET : cur?.TOTAL_AMOUNT_NET;
    const vatPercent = payload.VAT_PERCENT !== undefined ? payload.VAT_PERCENT : cur?.VAT_PERCENT;

    if (totalNet !== undefined && totalNet !== null) {
      const net = toNum(totalNet);
      const vat = toNum(vatPercent);
      payload.TAX_AMOUNT_NET = round2(net * vat / 100);
      payload.TOTAL_AMOUNT_GROSS = round2(net + payload.TAX_AMOUNT_NET);
    }
  }

  if (b.payment_means_id !== undefined) {
    const pm = b.payment_means_id;
    if (!pm) return res.status(400).json({ error: "Zahlungsart ist erforderlich" });
    payload.PAYMENT_MEANS_ID = pm;
  }

  const { error } = await supabase.from("PARTIAL_PAYMENT").update(payload).eq("ID", id);
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ success: true });
}

// ---------------------------------------------------------------------------
// GET /api/partial-payments/:id/billing-proposal
// ---------------------------------------------------------------------------
async function getBillingProposal(req, res, supabase) {
  const { id } = req.params;

  const { data: pp, error: ppErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, PROJECT_ID, CONTRACT_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET, VAT_PERCENT")
    .eq("ID", id)
    .maybeSingle();
  if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

  let structures = [];
  try {
    structures = await svc.loadProjectStructuresForContext(supabase, { contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
  } catch (e) {
    return res.status(500).json({ error: "Projektstruktur konnte nicht geladen werden: " + e.message });
  }

  const bt1 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1);
  const bt1Ids = bt1.map((s) => s.ID);

  let performanceSuggested = 0;
  try {
    const prev = await svc.loadPreviouslyBilledByStructure(supabase, {
      contractId: pp.CONTRACT_ID,
      projectId: pp.PROJECT_ID,
      structureIds: bt1Ids,
      excludePartialPaymentId: id,
      bookedStatusId: 2,
    });

    performanceSuggested = svc.round2(
      bt1.reduce((acc, s) => {
        const sid = String(s.ID);
        const billed = prev.get(sid) || 0;
        const billable = svc.round2(svc.toNum(s.REVENUE_COMPLETION) - billed);
        return acc + (billable > 0 ? billable : 0);
      }, 0)
    );
  } catch (e) {
    return res.status(500).json({ error: "Vorschlag (Leistungsstand) konnte nicht berechnet werden: " + e.message });
  }

  const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);

  let performanceAmount = 0;
  try {
    const bt1Existing = await svc.sumPpsForPartialPayment(supabase, { partialPaymentId: id, structureIds: bt1Ids });
    performanceAmount = bt1Existing.net;

    if (performanceAmount <= 0 && performanceSuggested > 0) {
      const r = await svc.applyPerformanceAmount(supabase, {
        partialPaymentId: id,
        contractId: pp.CONTRACT_ID,
        projectId: pp.PROJECT_ID,
        amount: performanceSuggested,
      });
      performanceAmount = r.performance_amount;
    }
  } catch (e) {
    return res.status(500).json({ error: "Leistungsstand konnte nicht gespeichert werden: " + e.message });
  }

  let bookingsSum = 0;
  try {
    const { data: already, error: alreadyErr } = await supabase.from("TEC").select("ID").eq("PARTIAL_PAYMENT_ID", id).limit(1);
    if (alreadyErr) throw new Error(alreadyErr.message);
    const hasAssigned = Array.isArray(already) && already.length > 0;

    if (!hasAssigned) {
      const { toAssignIds } = await svc.sumTecForStructures(supabase, { structureIds: bt2Ids, partialPaymentId: id });
      if (Array.isArray(toAssignIds) && toAssignIds.length > 0) {
        const { error: upErr } = await supabase.from("TEC").update({ PARTIAL_PAYMENT_ID: id }).in("ID", toAssignIds);
        if (upErr) throw new Error(upErr.message);
      }
    }

    const bt2Res = await svc.updateBt2FromTec(supabase, { partialPaymentId: id, contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
    bookingsSum = bt2Res.bookings_sum;
  } catch (e) {
    return res.status(500).json({ error: "Buchungen konnten nicht geladen/zugeordnet werden: " + e.message });
  }

  let totals = null;
  try {
    totals = await svc.recomputePartialPaymentTotals(supabase, id);
  } catch (e) {
    return res.status(500).json({ error: "Summen konnten nicht aktualisiert werden: " + e.message });
  }

  return res.json({
    data: {
      performance_suggested: performanceSuggested,
      performance_amount: performanceAmount,
      bookings_sum: bookingsSum,
      amount_net: totals.amount_net,
      amount_extras_net: totals.amount_extras_net,
      total_amount_net: totals.total_amount_net,
      total_amount_gross: totals.total_amount_gross,
    },
  });
}

// ---------------------------------------------------------------------------
// PUT /api/partial-payments/:id/performance
// ---------------------------------------------------------------------------
async function putPerformance(req, res, supabase) {
  const { id } = req.params;
  const amount = svc.round2(svc.toNum(req.body?.amount));

  const { data: pp, error: ppErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, PROJECT_ID, CONTRACT_ID")
    .eq("ID", id)
    .maybeSingle();
  if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

  try {
    const r = await svc.applyPerformanceAmount(supabase, { partialPaymentId: id, contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID, amount });
    const bt2Res = await svc.updateBt2FromTec(supabase, { partialPaymentId: id, contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
    const totals = await svc.recomputePartialPaymentTotals(supabase, id);
    return res.json({
      data: {
        performance_amount: r.performance_amount,
        bookings_sum: bt2Res.bookings_sum,
        amount_net: totals.amount_net,
        amount_extras_net: totals.amount_extras_net,
        total_amount_net: totals.total_amount_net,
        total_amount_gross: totals.total_amount_gross,
      },
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/partial-payments/:id/tec
// ---------------------------------------------------------------------------
async function getTec(req, res, supabase) {
  const { id } = req.params;

  const { data: pp, error: ppErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, PROJECT_ID, CONTRACT_ID")
    .eq("ID", id)
    .maybeSingle();
  if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

  let structures = [];
  try {
    structures = await svc.loadProjectStructuresForContext(supabase, { contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
  } catch (e) {
    return res.status(500).json({ error: "Projektstruktur konnte nicht geladen werden: " + e.message });
  }

  const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
  if (!Array.isArray(bt2Ids) || bt2Ids.length === 0) return res.json({ data: [] });

  const { data: tecRows, error: tecErr } = await supabase
    .from("TEC")
    .select("ID, DATE_VOUCHER, POSTING_DESCRIPTION, SP_TOT, PARTIAL_PAYMENT_ID, INVOICE_ID, STRUCTURE_ID, EMPLOYEE:EMPLOYEE_ID(SHORT_NAME)")
    .in("STRUCTURE_ID", bt2Ids)
    .order("DATE_VOUCHER", { ascending: true });
  if (tecErr) return res.status(500).json({ error: tecErr.message });

  const rows = (tecRows || [])
    .filter((t) => {
      if (!svc.isUninvoiced(t.INVOICE_ID)) return false;
      const ppId = t.PARTIAL_PAYMENT_ID;
      return svc.isNullOrZero(ppId) || String(ppId) === String(id);
    })
    .map((t) => ({
      ID: t.ID,
      DATE_VOUCHER: t.DATE_VOUCHER,
      POSTING_DESCRIPTION: t.POSTING_DESCRIPTION,
      SP_TOT: t.SP_TOT,
      EMPLOYEE_SHORT_NAME: t.EMPLOYEE?.SHORT_NAME ?? "",
      ASSIGNED: String(t.PARTIAL_PAYMENT_ID) === String(id),
    }));

  return res.json({ data: rows });
}

// ---------------------------------------------------------------------------
// POST /api/partial-payments/:id/tec
// ---------------------------------------------------------------------------
async function postTec(req, res, supabase) {
  const { id } = req.params;
  const b = req.body || {};

  const idsAssign = Array.isArray(b.ids_assign) ? b.ids_assign.map((x) => String(x)) : [];
  const idsUnassign = Array.isArray(b.ids_unassign) ? b.ids_unassign.map((x) => String(x)) : [];
  const performanceAmountProvided = b.performance_amount !== undefined ? svc.round2(svc.toNum(b.performance_amount)) : null;

  const { data: pp, error: ppErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, PROJECT_ID, CONTRACT_ID")
    .eq("ID", id)
    .maybeSingle();
  if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

  try {
    if (performanceAmountProvided !== null) {
      await svc.applyPerformanceAmount(supabase, {
        partialPaymentId: id,
        contractId: pp.CONTRACT_ID,
        projectId: pp.PROJECT_ID,
        amount: performanceAmountProvided,
      });
    }
  } catch (e) {
    return res.status(400).json({ error: e.message || String(e) });
  }

  if (idsUnassign.length > 0) {
    const { error: unErr } = await supabase.from("TEC").update({ PARTIAL_PAYMENT_ID: null }).in("ID", idsUnassign).eq("PARTIAL_PAYMENT_ID", id);
    if (unErr) return res.status(500).json({ error: unErr.message });
  }

  if (idsAssign.length > 0) {
    const { data: cand, error: candErr } = await supabase.from("TEC").select("ID, PARTIAL_PAYMENT_ID, INVOICE_ID").in("ID", idsAssign);
    if (candErr) return res.status(500).json({ error: candErr.message });

    const assignableIds = (cand || [])
      .filter((t) => svc.isNullOrZero(t.PARTIAL_PAYMENT_ID) && svc.isUninvoiced(t.INVOICE_ID))
      .map((t) => t.ID);

    if (assignableIds.length > 0) {
      const { error: asErr } = await supabase.from("TEC").update({ PARTIAL_PAYMENT_ID: id }).in("ID", assignableIds);
      if (asErr) return res.status(500).json({ error: asErr.message });
    }
  }

  try {
    const bt2Res = await svc.updateBt2FromTec(supabase, { partialPaymentId: id, contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
    const structures = await svc.loadProjectStructuresForContext(supabase, { contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
    const bt1Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1).map((s) => s.ID);
    const bt1Sum = await svc.sumPpsForPartialPayment(supabase, { partialPaymentId: id, structureIds: bt1Ids });
    const totals = await svc.recomputePartialPaymentTotals(supabase, id);

    return res.json({
      data: {
        bookings_sum: bt2Res.bookings_sum,
        performance_amount: bt1Sum.net,
        amount_net: totals.amount_net,
        amount_extras_net: totals.amount_extras_net,
        total_amount_net: totals.total_amount_net,
        total_amount_gross: totals.total_amount_gross,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/partial-payments/:id
// ---------------------------------------------------------------------------
async function getPartialPayment(req, res, supabase) {
  const { id } = req.params;
  try {
    const { pp, project, contract } = await svc.getPartialPayment(supabase, { id });
    return res.json({ data: { pp, project, contract } });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/partial-payments/:id
// ---------------------------------------------------------------------------
async function deletePartialPayment(req, res, supabase) {
  const { id } = req.params;
  try {
    await svc.deletePartialPayment(supabase, { id });
    return res.json({ ok: true });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// POST /api/partial-payments/:id/cancel
// ---------------------------------------------------------------------------
async function cancelPartialPayment(req, res, supabase) {
  const { id } = req.params;
  try {
    const result = await svc.cancelPartialPayment(supabase, { id });
    return res.json(result);
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/partial-payments/:id/einvoice/ubl
// ---------------------------------------------------------------------------
async function getEinvoiceUbl(req, res, supabase) {
  const ppId = parseInt(String(req.params.id || ""), 10);
  if (!ppId || Number.isNaN(ppId)) return res.status(400).json({ error: "invalid id" });

  const preview = String(req.query.preview || "") === "1";
  const download = String(req.query.download || "") === "1";

  const logCtx = (extra = {}) => ({ tag: "EINVOICE_XRECHNUNG_PP", partial_payment_id: ppId, preview, download, ...extra });
  const logError = (extra, err) => {
    console.error("[EINVOICE_XRECHNUNG_PP]", { ...logCtx(extra), error: err?.message || String(err), stack: err?.stack });
  };

  const { data: ppRow, error: ppRowErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, PARTIAL_PAYMENT_NUMBER, COMPANY_ID")
    .eq("ID", ppId)
    .maybeSingle();

  if (ppRowErr) { logError({ step: "load_pp_min" }, ppRowErr); return res.status(500).json({ error: ppRowErr.message }); }
  if (!ppRow) return res.status(404).json({ error: "PARTIAL_PAYMENT nicht gefunden" });

  const isBooked = String(ppRow.STATUS_ID) === "2";
  const fname = `XRechnung_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.xml`;

  if (isBooked && !preview) {
    if (!ppRow.DOCUMENT_XML_ASSET_ID) {
      console.warn("[EINVOICE_XRECHNUNG_PP]", logCtx({ step: "booked_snapshot_missing" }));
      return res.status(409).json({
        error: "BOOKED_XML_SNAPSHOT_MISSING",
        message: "Partial payment is booked, but the XRechnung XML snapshot is missing. Regeneration is blocked to preserve immutability.",
        partial_payment_id: ppRow.ID,
      });
    }
    return svc.streamXmlAsset({ supabase, res, assetId: ppRow.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
  }

  try {
    const { data: ppFull, error: ppFullErr } = await supabase.from("PARTIAL_PAYMENT").select("*").eq("ID", ppId).maybeSingle();
    if (ppFullErr || !ppFull) throw new Error(ppFullErr?.message || "PARTIAL_PAYMENT nicht gefunden");

    const xml = await svc.generateUblInvoiceXml({ supabase, partialPayment: ppFull });
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${fname}"`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.status(200).send(xml);
  } catch (err) {
    logError({ step: "generate_xml_live", status_id: ppRow.STATUS_ID, company_id: ppRow.COMPANY_ID }, err);
    return res.status(500).json({
      error: "EINVOICE_GENERATION_FAILED",
      message: `E-Rechnung konnte nicht erzeugt werden: ${err?.message || err}`,
      partial_payment_id: ppRow.ID,
    });
  }
}

// ---------------------------------------------------------------------------
// POST /api/partial-payments/:id/einvoice/ubl/snapshot
// ---------------------------------------------------------------------------
async function postEinvoiceUblSnapshot(req, res, supabase) {
  const ppId = parseInt(String(req.params.id || ""), 10);
  if (!ppId || Number.isNaN(ppId)) return res.status(400).json({ error: "invalid id" });

  const { data: ppRow, error: ppRowErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, PARTIAL_PAYMENT_NUMBER, COMPANY_ID")
    .eq("ID", ppId)
    .maybeSingle();

  if (ppRowErr) {
    console.error("[EINVOICE_SNAPSHOT_PP]", { step: "load_pp_min", partial_payment_id: ppId, error: ppRowErr.message });
    return res.status(500).json({ error: ppRowErr.message });
  }
  if (!ppRow) return res.status(404).json({ error: "PARTIAL_PAYMENT nicht gefunden" });
  if (String(ppRow.STATUS_ID) !== "2") return res.status(400).json({ error: "Snapshot ist nur fuer gebuchte Abschlagsrechnungen (STATUS_ID=2) erlaubt" });

  if (ppRow.DOCUMENT_XML_ASSET_ID) {
    return res.json({ success: true, partial_payment_id: ppRow.ID, xml_asset_id: ppRow.DOCUMENT_XML_ASSET_ID, already_existed: true });
  }

  const fname = `XRechnung_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.xml`;

  try {
    const { data: ppFull, error: ppFullErr } = await supabase.from("PARTIAL_PAYMENT").select("*").eq("ID", ppId).maybeSingle();
    if (ppFullErr || !ppFull) throw new Error(ppFullErr?.message || "PARTIAL_PAYMENT nicht gefunden");

    const xml = await svc.generateUblInvoiceXml({ supabase, partialPayment: ppFull });
    const xmlAsset = await svc.storeGeneratedXmlAsAsset({ supabase, companyId: ppRow.COMPANY_ID, fileName: fname, xmlString: xml, assetType: "XML_XRECHNUNG_PARTIAL_PAYMENT" });

    const { error: upErr } = await supabase.from("PARTIAL_PAYMENT").update({
      DOCUMENT_XML_ASSET_ID: xmlAsset?.ID ?? null,
      DOCUMENT_XML_PROFILE: "xrechnung-ubl",
      DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
    }).eq("ID", ppId);

    if (upErr) {
      await svc.bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      throw new Error(upErr.message);
    }

    return res.json({ success: true, partial_payment_id: ppRow.ID, xml_asset_id: xmlAsset.ID, already_existed: false });
  } catch (e) {
    console.error("[EINVOICE_SNAPSHOT_PP]", { partial_payment_id: ppId, error: e?.message || String(e), stack: e?.stack });
    return res.status(500).json({ error: `Snapshot konnte nicht erzeugt werden: ${e?.message || e}` });
  }
}

// ---------------------------------------------------------------------------
// POST /api/partial-payments/:id/book
// ---------------------------------------------------------------------------
async function bookPartialPayment(req, res, supabase) {
  const { id } = req.params;

  const { data: pp, error: ppErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, COMPANY_ID, PROJECT_ID, CONTRACT_ID, TOTAL_AMOUNT_NET, VAT_PERCENT, STATUS_ID, PARTIAL_PAYMENT_NUMBER, DOCUMENT_TEMPLATE_ID")
    .eq("ID", id)
    .maybeSingle();
  if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

  if (String(pp.STATUS_ID) === "2") {
    return res.status(400).json({ error: "PARTIAL_PAYMENT ist bereits gebucht" });
  }

  try {
    const result = await svc.bookPartialPayment(supabase, { id, pp });
    return res.json(result);
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/partial-payments/:id/pdf
// ---------------------------------------------------------------------------
async function getPdf(req, res, supabase) {
  try {
    const ppId = parseInt(req.params.id, 10);
    if (!ppId || Number.isNaN(ppId)) return res.status(400).json({ error: "invalid id" });

    const preview = String(req.query.preview || "") === "1";
    const download = String(req.query.download || "") === "1";
    const templateId = req.query.template_id ? parseInt(String(req.query.template_id), 10) : null;

    if (!preview) {
      const { data: ppRow, error: ppRowErr } = await supabase
        .from("PARTIAL_PAYMENT")
        .select("ID, STATUS_ID, DOCUMENT_PDF_ASSET_ID, PARTIAL_PAYMENT_NUMBER")
        .eq("ID", ppId)
        .maybeSingle();

      if (!ppRowErr && ppRow && String(ppRow.STATUS_ID) === "2" && ppRow.DOCUMENT_PDF_ASSET_ID) {
        const fname = `Abschlagsrechnung_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.pdf`;
        return svc.streamPdfAsset({ supabase, res, assetId: ppRow.DOCUMENT_PDF_ASSET_ID, dispositionName: fname, download });
      }
    }

    const { pdf } = await renderDocumentPdf({
      supabase,
      docType: "PARTIAL_PAYMENT",
      docId: ppId,
      templateId: Number.isFinite(templateId) ? templateId : null,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="Abschlagsrechnung_${ppId}.pdf"`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(Buffer.from(pdf));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}

// ---------------------------------------------------------------------------
// GET /api/partial-payments/:id/einvoice/cii?profile=EN16931
// ---------------------------------------------------------------------------
async function getEinvoiceCii(req, res, supabase) {
  const ppId = parseInt(String(req.params.id || ""), 10);
  if (!ppId || Number.isNaN(ppId)) return res.status(400).json({ error: "invalid id" });

  const profile  = String(req.query.profile  || "EN16931").toUpperCase();
  const download = String(req.query.download || "") === "1";
  const preview  = String(req.query.preview  || "") === "1";

  const { data: ppRow, error: ppRowErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, DOCUMENT_XML_PROFILE, PARTIAL_PAYMENT_NUMBER, COMPANY_ID")
    .eq("ID", ppId)
    .maybeSingle();

  if (ppRowErr) return res.status(500).json({ error: ppRowErr.message });
  if (!ppRow)   return res.status(404).json({ error: "PARTIAL_PAYMENT nicht gefunden" });

  const fname      = `ZUGFeRD_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.xml`;
  const profileKey = `zugferd-${profile.toLowerCase()}`;

  if (!preview && String(ppRow.STATUS_ID) === "2" && ppRow.DOCUMENT_XML_ASSET_ID && ppRow.DOCUMENT_XML_PROFILE === profileKey) {
    return svc.streamXmlAsset({ supabase, res, assetId: ppRow.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
  }

  try {
    const data = await loadInvoiceData(supabase, ppId, "PARTIAL_PAYMENT", req.tenantId);
    const xml  = generateCiiXml(data, profile);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${fname}"`);
    return res.send(xml);
  } catch (err) {
    console.error("[EINVOICE_CII_PP]", { partial_payment_id: ppId, profile, error: err?.message, stack: err?.stack });
    return res.status(500).json({ error: `E-Rechnung (CII) konnte nicht erzeugt werden: ${err?.message || err}`, partial_payment_id: ppRow.ID });
  }
}

// ---------------------------------------------------------------------------
// POST /api/partial-payments/:id/einvoice/cii/snapshot?profile=EN16931
// ---------------------------------------------------------------------------
async function postEinvoiceCiiSnapshot(req, res, supabase) {
  const ppId = parseInt(String(req.params.id || ""), 10);
  if (!ppId || Number.isNaN(ppId)) return res.status(400).json({ error: "invalid id" });

  const profile = String(req.query.profile || "EN16931").toUpperCase();

  const { data: ppRow, error: ppRowErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, PARTIAL_PAYMENT_NUMBER, COMPANY_ID")
    .eq("ID", ppId)
    .maybeSingle();

  if (ppRowErr) return res.status(500).json({ error: ppRowErr.message });
  if (!ppRow)   return res.status(404).json({ error: "PARTIAL_PAYMENT nicht gefunden" });
  if (String(ppRow.STATUS_ID) !== "2") {
    return res.status(400).json({ error: "Snapshot ist nur fuer gebuchte Abschlagsrechnungen (STATUS_ID=2) erlaubt" });
  }
  if (ppRow.DOCUMENT_XML_ASSET_ID) {
    return res.json({ success: true, partial_payment_id: ppRow.ID, xml_asset_id: ppRow.DOCUMENT_XML_ASSET_ID, already_existed: true });
  }

  const fname = `ZUGFeRD_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.xml`;
  try {
    const data     = await loadInvoiceData(supabase, ppId, "PARTIAL_PAYMENT", req.tenantId);
    const xml      = generateCiiXml(data, profile);
    const xmlAsset = await svc.storeGeneratedXmlAsAsset({ supabase, companyId: ppRow.COMPANY_ID, fileName: fname, xmlString: xml, assetType: "XML_ZUGFERD_PARTIAL_PAYMENT" });

    const { error: upErr } = await supabase.from("PARTIAL_PAYMENT").update({
      DOCUMENT_XML_ASSET_ID:    xmlAsset?.ID ?? null,
      DOCUMENT_XML_PROFILE:     `zugferd-${profile.toLowerCase()}`,
      DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
    }).eq("ID", ppId);

    if (upErr) {
      await svc.bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      throw new Error(upErr.message);
    }

    return res.json({ success: true, partial_payment_id: ppRow.ID, xml_asset_id: xmlAsset.ID, already_existed: false });
  } catch (e) {
    console.error("[EINVOICE_CII_SNAPSHOT_PP]", { partial_payment_id: ppId, error: e?.message, stack: e?.stack });
    return res.status(500).json({ error: `Snapshot konnte nicht erzeugt werden: ${e?.message || e}` });
  }
}

module.exports = {
  listPartialPayments,
  initPartialPayment,
  patchPartialPayment,
  getBillingProposal,
  putPerformance,
  getTec,
  postTec,
  getPartialPayment,
  deletePartialPayment,
  cancelPartialPayment,
  getEinvoiceUbl,
  postEinvoiceUblSnapshot,
  getEinvoiceCii,
  postEinvoiceCiiSnapshot,
  bookPartialPayment,
  getPdf,
};
