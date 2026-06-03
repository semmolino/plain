"use strict";

const { renderDocumentPdf } = require("../services_pdf_render");
const svc = require("../services/partialPayments");
const { loadInvoiceData } = require("../services_einvoice_data");
const { generateCiiXml } = require("../services_einvoice_cii");

// ---------------------------------------------------------------------------
// GET /api/v1/partial-payments/open-se?project_id=...
// List open Sicherheitseinbehalte for a project (Phase 2)
// Returns PARTIAL_PAYMENTs that:
//  - belong to the given project
//  - have SE_AMOUNT > 0
//  - are NOT yet released (SE_RELEASED_BY_INVOICE_ID IS NULL)
//  - are booked (STATUS_ID = 2)
// ---------------------------------------------------------------------------
async function listOpenSeForProject(req, res, supabase) {
  const projectId = parseInt(String(req.query.project_id ?? ""), 10);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return res.status(400).json({ error: "project_id erforderlich" });
  }
  try {
    const baseCols = "ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, TOTAL_AMOUNT_NET, TOTAL_AMOUNT_GROSS, STATUS_ID";
    const seCols = ", SE_PERCENT, SE_BASIS, SE_BASIS_AMT, SE_AMOUNT, SE_RELEASED_BY_INVOICE_ID";

    // Try with SE columns
    let { data, error } = await supabase
      .from("PARTIAL_PAYMENT")
      .select(baseCols + seCols)
      .eq("TENANT_ID", req.tenantId)
      .eq("PROJECT_ID", projectId)
      .eq("STATUS_ID", 2)
      .gt("SE_AMOUNT", 0)
      .is("SE_RELEASED_BY_INVOICE_ID", null)
      .order("PARTIAL_PAYMENT_DATE", { ascending: true });

    if (error && String(error.message || "").includes("SE_")) {
      // Migration 0047 not yet run — return empty list
      return res.json({ data: [] });
    }
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

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

  if (!employeeId || !projectId || !contractId) {
    return res.status(400).json({ error: "Pflichtfelder fehlen (Mitarbeiter/Projekt/Vertrag)" });
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
      .eq("TENANT_ID", req.tenantId)
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

  if (b.discount_1_percent  !== undefined) payload.DISCOUNT_1_PERCENT  = b.discount_1_percent  != null ? toNum(b.discount_1_percent)  : null;
  if (b.discount_2_percent  !== undefined) payload.DISCOUNT_2_PERCENT  = b.discount_2_percent  != null ? toNum(b.discount_2_percent)  : null;
  if (b.discount_1_reason   !== undefined) payload.DISCOUNT_1_REASON   = b.discount_1_reason   != null ? String(b.discount_1_reason).trim() || null : null;
  if (b.discount_2_reason   !== undefined) payload.DISCOUNT_2_REASON   = b.discount_2_reason   != null ? String(b.discount_2_reason).trim() || null : null;
  if (b.total_discounts     !== undefined) payload.TOTAL_DISCOUNTS     = b.total_discounts     != null ? toNum(b.total_discounts)     : null;
  if (b.cash_discount_percent !== undefined) payload.CASH_DISCOUNT_PERCENT = b.cash_discount_percent != null ? toNum(b.cash_discount_percent) : null;
  if (b.cash_discount_days    !== undefined) payload.CASH_DISCOUNT_DAYS    = b.cash_discount_days    != null ? parseInt(String(b.cash_discount_days), 10) : null;
  if (b.cash_discount_amount  !== undefined) payload.CASH_DISCOUNT  = b.cash_discount_amount  != null ? toNum(b.cash_discount_amount)  : null;

  // Sicherheitseinbehalt (Phase 1)
  if (b.se_percent    !== undefined) payload.SE_PERCENT    = b.se_percent    != null && b.se_percent !== "" ? toNum(b.se_percent)    : null;
  if (b.se_basis      !== undefined) {
    const v = String(b.se_basis || "").toUpperCase();
    payload.SE_BASIS = v === "NETTO" ? "NETTO" : v === "BRUTTO" ? "BRUTTO" : null;
  }
  if (b.se_basis_amt  !== undefined) payload.SE_BASIS_AMT  = b.se_basis_amt  != null && b.se_basis_amt !== "" ? toNum(b.se_basis_amt)  : null;
  if (b.se_amount     !== undefined) payload.SE_AMOUNT     = b.se_amount     != null && b.se_amount !== "" ? toNum(b.se_amount)     : null;

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
      .eq("TENANT_ID", req.tenantId)
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

  let { error } = await supabase.from("PARTIAL_PAYMENT").update(payload).eq("ID", id).eq("TENANT_ID", req.tenantId);
  if (error && String(error.message || "").includes("SE_")) {
    // Migration 0047 not yet run — retry without SE fields
    const stripped = { ...payload };
    delete stripped.SE_PERCENT; delete stripped.SE_BASIS; delete stripped.SE_BASIS_AMT; delete stripped.SE_AMOUNT;
    const r = await supabase.from("PARTIAL_PAYMENT").update(stripped).eq("ID", id).eq("TENANT_ID", req.tenantId);
    error = r.error;
  }
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
    .eq("TENANT_ID", req.tenantId)
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

  // Compute bookings sum from TEC entries already assigned to this PP (no auto-assignment).
  // The user selects which entries to include manually in the wizard.
  let bookingsSum = 0;
  try {
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
      vat_percent: svc.toNum(pp.VAT_PERCENT),
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
    .eq("TENANT_ID", req.tenantId)
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
    .eq("TENANT_ID", req.tenantId)
    .maybeSingle();
  if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

  let structures = [];
  try {
    structures = await svc.loadProjectStructuresForContext(supabase, { contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
  } catch (e) {
    return res.status(500).json({ error: "Projektstruktur konnte nicht geladen werden: " + e.message });
  }

  const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
  if (!Array.isArray(bt2Ids) || bt2Ids.length === 0) return res.json({ data: [], hasBt2: false });

  const { data: tecRows, error: tecErr } = await supabase
    .from("TEC")
    .select("ID, DATE_VOUCHER, POSTING_DESCRIPTION, SP_TOT, PARTIAL_PAYMENT_ID, INVOICE_ID, STRUCTURE_ID, EMPLOYEE:EMPLOYEE_ID(SHORT_NAME)")
    .in("STRUCTURE_ID", bt2Ids)
    .neq("STATUS", "DRAFT")
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

  return res.json({ data: rows, hasBt2: true });
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
    .eq("TENANT_ID", req.tenantId)
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
    const { pp, project, contract } = await svc.getPartialPayment(supabase, { id, tenantId: req.tenantId });
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
    await svc.deletePartialPayment(supabase, { id, tenantId: req.tenantId });
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
  const deletePayments = req.body?.delete_payments === true;
  try {
    const result = await svc.cancelPartialPayment(supabase, { id, tenantId: req.tenantId, deletePayments });
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
    .eq("TENANT_ID", req.tenantId)
    .maybeSingle();

  if (ppRowErr) { logError({ step: "load_pp_min" }, ppRowErr); return res.status(500).json({ error: ppRowErr.message }); }
  if (!ppRow) return res.status(404).json({ error: "PARTIAL_PAYMENT nicht gefunden" });

  const isBooked = String(ppRow.STATUS_ID) === "2";
  const fname = `XRechnung_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.xml`;

  if (isBooked && !preview && ppRow.DOCUMENT_XML_ASSET_ID) {
    try {
      return await svc.streamXmlAsset({ supabase, res, assetId: ppRow.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
    } catch (snapErr) {
      console.warn("[EINVOICE_XRECHNUNG_PP] snapshot missing on disk, regenerating live", { partial_payment_id: ppRow.ID, asset_id: ppRow.DOCUMENT_XML_ASSET_ID });
    }
  }

  try {
    const { data: ppFull, error: ppFullErr } = await supabase.from("PARTIAL_PAYMENT").select("*").eq("ID", ppId).eq("TENANT_ID", req.tenantId).maybeSingle();
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
    .eq("TENANT_ID", req.tenantId)
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
    const { data: ppFull, error: ppFullErr } = await supabase.from("PARTIAL_PAYMENT").select("*").eq("ID", ppId).eq("TENANT_ID", req.tenantId).maybeSingle();
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
    .eq("TENANT_ID", req.tenantId)
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
        .eq("TENANT_ID", req.tenantId)
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

  const profile  = String(req.query.profile  || "EXTENDED").toUpperCase();
  const download = String(req.query.download || "") === "1";
  const preview  = String(req.query.preview  || "") === "1";

  const { data: ppRow, error: ppRowErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, DOCUMENT_XML_PROFILE, PARTIAL_PAYMENT_NUMBER, COMPANY_ID")
    .eq("ID", ppId)
    .eq("TENANT_ID", req.tenantId)
    .maybeSingle();

  if (ppRowErr) return res.status(500).json({ error: ppRowErr.message });
  if (!ppRow)   return res.status(404).json({ error: "PARTIAL_PAYMENT nicht gefunden" });

  const fname      = `ZUGFeRD_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.xml`;
  const profileKey = `zugferd-${profile.toLowerCase()}`;

  if (!preview && String(ppRow.STATUS_ID) === "2" && ppRow.DOCUMENT_XML_ASSET_ID && ppRow.DOCUMENT_XML_PROFILE === profileKey) {
    try {
      return await svc.streamXmlAsset({ supabase, res, assetId: ppRow.DOCUMENT_XML_ASSET_ID, dispositionName: fname, download });
    } catch (snapErr) {
      console.warn("[EINVOICE_CII_PP] snapshot missing on disk, regenerating live", { partial_payment_id: ppRow.ID, asset_id: ppRow.DOCUMENT_XML_ASSET_ID });
    }
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

  const profile = String(req.query.profile || "EXTENDED").toUpperCase();

  const { data: ppRow, error: ppRowErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, PARTIAL_PAYMENT_NUMBER, COMPANY_ID")
    .eq("ID", ppId)
    .eq("TENANT_ID", req.tenantId)
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
  listOpenSeForProject,
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
