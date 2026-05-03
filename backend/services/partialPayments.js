"use strict";

const { generateUblInvoiceXml } = require("../services_einvoice_ubl");
const { renderDocumentPdf } = require("../services_pdf_render");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// File-system helpers (same pattern as services/invoices.js)
// ---------------------------------------------------------------------------

function uploadRoot() {
  return path.join(__dirname, "..", "uploads");
}

function safeFileName(name, fallback) {
  const base = String(name || fallback || "document").replace(/[\/:*?"<>|]+/g, "_").trim();
  return base.length ? base : "document";
}

async function loadAssetRow({ supabase, assetId }) {
  const { data, error } = await supabase.from("ASSET").select("*").eq("ID", assetId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function streamPdfAsset({ supabase, res, assetId, dispositionName, download }) {
  const asset = await loadAssetRow({ supabase, assetId });
  if (!asset) return res.status(404).json({ error: "PDF asset not found" });

  const root = uploadRoot();
  const filePath = path.join(root, asset.STORAGE_KEY);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "PDF file missing on disk" });

  res.setHeader("Content-Type", "application/pdf");
  const disp = download ? "attachment" : "inline";
  res.setHeader("Content-Disposition", `${disp}; filename="${encodeURIComponent(dispositionName || asset.FILE_NAME || "document.pdf")}"`);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function streamXmlAsset({ supabase, res, assetId, dispositionName, download }) {
  const asset = await loadAssetRow({ supabase, assetId });
  if (!asset) return res.status(404).json({ error: "XML asset not found" });

  const root = uploadRoot();
  const filePath = path.join(root, asset.STORAGE_KEY);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "XML file missing on disk" });

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  const disp = download ? "attachment" : "inline";
  res.setHeader("Content-Disposition", `${disp}; filename="${encodeURIComponent(dispositionName || asset.FILE_NAME || "document.xml")}"`);
  fs.createReadStream(filePath).pipe(res);
  return true;
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

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

const toNum = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

const round2 = (v) => Math.round(toNum(v) * 100) / 100;

const isNullOrZero = (v) => v === null || v === undefined || String(v) === "0";

const isUninvoiced = (invoiceId) =>
  invoiceId === null || invoiceId === undefined || String(invoiceId) === "0" || String(invoiceId) === "2";

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

async function getCountryNameLong(supabase, countryId) {
  if (!countryId) return null;
  const { data, error } = await supabase.from("COUNTRY").select("NAME_LONG").eq("ID", countryId).maybeSingle();
  if (error) return null;
  return data?.NAME_LONG ?? null;
}

async function getCountryNameShort(supabase, countryId) {
  if (!countryId) return null;
  const { data, error } = await supabase.from("COUNTRY").select("NAME_SHORT").eq("ID", countryId).maybeSingle();
  if (error) return null;
  return data?.NAME_SHORT ?? null;
}

async function getSalutationText(supabase, salutationId) {
  if (!salutationId) return null;
  const { data, error } = await supabase.from("SALUTATION").select("SALUTATION").eq("ID", salutationId).maybeSingle();
  if (error) return null;
  return data?.SALUTATION ?? null;
}

// ---------------------------------------------------------------------------
// Project-structure helpers
// ---------------------------------------------------------------------------

async function loadProjectStructuresForContext(supabase, { contractId, projectId }) {
  if (contractId) {
    const { data: byContract, error: byContractErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, BILLING_TYPE_ID, REVENUE_COMPLETION, EXTRAS_PERCENT")
      .eq("CONTRACT_ID", contractId);
    if (!byContractErr && Array.isArray(byContract) && byContract.length > 0) return byContract;
  }

  const { data: byProject, error: byProjectErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, BILLING_TYPE_ID, REVENUE_COMPLETION, EXTRAS_PERCENT")
    .eq("PROJECT_ID", projectId);
  if (byProjectErr) throw new Error(byProjectErr.message);
  return byProject || [];
}

// ---------------------------------------------------------------------------
// PARTIAL_PAYMENT_STRUCTURE helpers
// ---------------------------------------------------------------------------

const PPS_TABLE_CANDIDATES = ["PARTIAL_PAYMENT_STRUCTURE", "PARTIAL_PAYMENT_STRUCTURE"];

const isMissingPpsRelation = (err) => {
  const msg = String(err?.message || "");
  return (
    /relation\s+\"public\.(partial_payment_structure|PARTIAL_PAYMENT_STRUCTURE)\"/i.test(msg) &&
    /does\s+not\s+exist/i.test(msg)
  );
};

async function execWithPpsTableFallback(supabase, makeQuery) {
  let lastError = null;
  for (const table of PPS_TABLE_CANDIDATES) {
    const resp = await makeQuery(supabase, table);
    if (!resp?.error) return resp;
    lastError = resp.error;
    if (!isMissingPpsRelation(resp.error)) break;
  }
  return { data: null, error: lastError };
}

async function sumTecForStructures(supabase, { structureIds, partialPaymentId }) {
  if (!Array.isArray(structureIds) || structureIds.length === 0) {
    return { tecRows: [], eligible: [], assignedSum: 0, toAssignIds: [] };
  }

  const { data: tecRows, error: tecErr } = await supabase
    .from("TEC")
    .select("ID, SP_TOT, PARTIAL_PAYMENT_ID, INVOICE_ID, STRUCTURE_ID")
    .in("STRUCTURE_ID", structureIds)
    .neq("STATUS", "DRAFT");
  if (tecErr) throw new Error(tecErr.message);

  const eligible = (tecRows || []).filter((t) => {
    if (!isUninvoiced(t.INVOICE_ID)) return false;
    const ppId = t.PARTIAL_PAYMENT_ID;
    return isNullOrZero(ppId) || String(ppId) === String(partialPaymentId);
  });

  const toAssignIds = eligible.filter((t) => isNullOrZero(t.PARTIAL_PAYMENT_ID)).map((t) => t.ID);

  const assignedSum = round2(
    eligible.reduce((acc, t) => {
      const isAssigned = String(t.PARTIAL_PAYMENT_ID) === String(partialPaymentId) || toAssignIds.includes(t.ID);
      return acc + (isAssigned ? toNum(t.SP_TOT) : 0);
    }, 0)
  );

  return { tecRows: tecRows || [], eligible, assignedSum, toAssignIds };
}

async function loadPreviouslyBilledByStructure(supabase, { contractId, projectId, structureIds, excludePartialPaymentId, bookedStatusId = 2 }) {
  if (!Array.isArray(structureIds) || structureIds.length === 0) return new Map();

  let ppQ = supabase.from("PARTIAL_PAYMENT").select("ID");
  if (contractId !== null && contractId !== undefined) ppQ = ppQ.eq("CONTRACT_ID", contractId);
  else if (projectId !== null && projectId !== undefined) ppQ = ppQ.eq("PROJECT_ID", projectId);
  if (bookedStatusId !== null && bookedStatusId !== undefined) ppQ = ppQ.eq("STATUS_ID", bookedStatusId);
  if (excludePartialPaymentId) ppQ = ppQ.neq("ID", excludePartialPaymentId);

  const { data: ppRows, error: ppErr } = await ppQ;
  if (ppErr) throw new Error(ppErr.message);
  const ppIds = (ppRows || []).map((r) => r.ID);
  if (ppIds.length === 0) return new Map();

  const { data, error } = await execWithPpsTableFallback(supabase, (sb, table) =>
    sb.from(table).select("STRUCTURE_ID, AMOUNT_NET").in("STRUCTURE_ID", structureIds).in("PARTIAL_PAYMENT_ID", ppIds)
  );
  if (error) throw new Error(error.message);

  const map = new Map();
  (data || []).forEach((r) => {
    const sid = r.STRUCTURE_ID;
    const cur = map.get(String(sid)) || 0;
    map.set(String(sid), round2(cur + toNum(r.AMOUNT_NET)));
  });
  return map;
}

async function sumPpsForPartialPayment(supabase, { partialPaymentId, structureIds }) {
  const { data, error } = await execWithPpsTableFallback(supabase, (sb, table) => {
    let q = sb.from(table).select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET").eq("PARTIAL_PAYMENT_ID", partialPaymentId);
    if (Array.isArray(structureIds) && structureIds.length > 0) q = q.in("STRUCTURE_ID", structureIds);
    return q;
  });
  if (error) throw new Error(error.message);

  const sum = (data || []).reduce((acc, r) => {
    acc.net += toNum(r.AMOUNT_NET);
    acc.extras += toNum(r.AMOUNT_EXTRAS_NET);
    return acc;
  }, { net: 0, extras: 0 });

  return { net: round2(sum.net), extras: round2(sum.extras), rows: data || [] };
}

function distributeAcrossRemaining({ total, remainingByStructure }) {
  const entries = Array.from(remainingByStructure.entries())
    .map(([sid, rem]) => ({ sid: String(sid), rem: toNum(rem) }))
    .filter((x) => x.rem > 0);
  const sumRem = entries.reduce((acc, x) => acc + x.rem, 0);
  if (sumRem <= 0) return { allocations: new Map(), sumRemaining: 0 };

  const totalRounded = round2(total);
  let running = 0;
  const alloc = new Map();

  entries.forEach((e, idx) => {
    if (idx === entries.length - 1) {
      const rest = round2(totalRounded - running);
      alloc.set(e.sid, rest < 0 ? 0 : rest);
    } else {
      const share = round2((totalRounded * e.rem) / sumRem);
      alloc.set(e.sid, share);
      running = round2(running + share);
    }
  });

  return { allocations: alloc, sumRemaining: round2(sumRem) };
}

async function writePpsRows(supabase, { partialPaymentId, structureIds, rows }) {
  if (Array.isArray(structureIds) && structureIds.length > 0) {
    const { error: delErr } = await execWithPpsTableFallback(supabase, (sb, table) =>
      sb.from(table).delete().eq("PARTIAL_PAYMENT_ID", partialPaymentId).in("STRUCTURE_ID", structureIds)
    );
    if (delErr) throw new Error(delErr.message);
  }

  const toInsert = (rows || []).filter((r) => toNum(r.AMOUNT_NET) !== 0 || toNum(r.AMOUNT_EXTRAS_NET) !== 0);
  if (toInsert.length > 0) {
    const { error: insErr } = await execWithPpsTableFallback(supabase, (sb, table) => sb.from(table).insert(toInsert));
    if (insErr) throw new Error(insErr.message);
  }
}

async function recomputePartialPaymentTotals(supabase, partialPaymentId) {
  const { data: pp, error: ppErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, VAT_PERCENT")
    .eq("ID", partialPaymentId)
    .maybeSingle();
  if (ppErr || !pp) throw new Error("PARTIAL_PAYMENT konnte nicht geladen werden");

  const sums = await sumPpsForPartialPayment(supabase, { partialPaymentId });
  const amountNet = sums.net;
  const amountExtras = sums.extras;
  const totalNet = round2(amountNet + amountExtras);
  const vatPercent = toNum(pp.VAT_PERCENT);
  const taxAmountNet = round2(totalNet * vatPercent / 100);
  const totalGross = round2(totalNet + taxAmountNet);

  const { error: upErr } = await supabase.from("PARTIAL_PAYMENT").update({
    AMOUNT_NET: amountNet,
    AMOUNT_EXTRAS_NET: amountExtras,
    TOTAL_AMOUNT_NET: totalNet,
    TAX_AMOUNT_NET: taxAmountNet,
    TOTAL_AMOUNT_GROSS: totalGross,
  }).eq("ID", partialPaymentId);
  if (upErr) throw new Error(upErr.message);

  return { amount_net: amountNet, amount_extras_net: amountExtras, total_amount_net: totalNet, tax_amount_net: taxAmountNet, total_amount_gross: totalGross };
}

async function applyPerformanceAmount(supabase, { partialPaymentId, contractId, projectId, amount, tenantId = undefined }) {
  if (tenantId === undefined && projectId) {
    const { data: projT } = await supabase.from("PROJECT").select("TENANT_ID").eq("ID", projectId).maybeSingle();
    tenantId = projT?.TENANT_ID ?? null;
  }

  const structures = await loadProjectStructuresForContext(supabase, { contractId, projectId });
  const bt1 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1);
  const bt1Ids = bt1.map((s) => s.ID);

  if (bt1Ids.length === 0) {
    if (round2(amount) !== 0) throw new Error("Keine abrechenbaren Elemente nach Leistungsstand (BT=1)");
    return { performance_amount: 0, bt1Ids: [] };
  }

  const prev = await loadPreviouslyBilledByStructure(supabase, {
    contractId,
    projectId,
    structureIds: bt1Ids,
    excludePartialPaymentId: partialPaymentId,
    bookedStatusId: 2,
  });

  const remaining = new Map();
  bt1.forEach((s) => {
    const sid = String(s.ID);
    const billed = prev.get(sid) || 0;
    const rem = round2(toNum(s.REVENUE_COMPLETION) - billed);
    remaining.set(sid, rem > 0 ? rem : 0);
  });

  const { allocations, sumRemaining } = distributeAcrossRemaining({ total: amount, remainingByStructure: remaining });
  const totalRounded = round2(amount);
  if (totalRounded > sumRemaining + 0.01) {
    throw new Error(`Betrag übersteigt abrechenbaren Leistungsstand (max. ${sumRemaining})`);
  }

  const idList = bt1Ids.map((x) => String(x));
  const rows = bt1.map((s) => {
    const sid = String(s.ID);
    const amt = allocations.get(sid) || 0;
    const extrasPercent = toNum(s.EXTRAS_PERCENT);
    const extras = round2(amt * (extrasPercent / 100));
    return {
      PARTIAL_PAYMENT_ID: partialPaymentId,
      STRUCTURE_ID: s.ID,
      AMOUNT_NET: amt,
      AMOUNT_EXTRAS_NET: extras,
      TENANT_ID: tenantId ?? null,
    };
  });

  await writePpsRows(supabase, { partialPaymentId, structureIds: idList, rows });

  const perfSum = round2(rows.reduce((acc, r) => acc + toNum(r.AMOUNT_NET), 0));
  return { performance_amount: perfSum, bt1Ids: idList };
}

async function updateBt2FromTec(supabase, { partialPaymentId, contractId, projectId, tenantId = undefined }) {
  if (tenantId === undefined && projectId) {
    const { data: projT } = await supabase.from("PROJECT").select("TENANT_ID").eq("ID", projectId).maybeSingle();
    tenantId = projT?.TENANT_ID ?? null;
  }

  const structures = await loadProjectStructuresForContext(supabase, { contractId, projectId });
  const bt2 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2);
  const bt2Ids = bt2.map((s) => s.ID);
  const idList = bt2Ids.map((x) => String(x));

  if (bt2Ids.length === 0) return { bookings_sum: 0, bt2Ids: [] };

  const { data: tecRows, error: tecErr } = await supabase
    .from("TEC")
    .select("STRUCTURE_ID, SP_TOT")
    .eq("PARTIAL_PAYMENT_ID", partialPaymentId)
    .in("STRUCTURE_ID", bt2Ids)
    .neq("STATUS", "DRAFT");
  if (tecErr) throw new Error(tecErr.message);

  const bySid = new Map();
  (tecRows || []).forEach((t) => {
    const sid = String(t.STRUCTURE_ID);
    const cur = bySid.get(sid) || 0;
    bySid.set(sid, round2(cur + toNum(t.SP_TOT)));
  });

  const rows = bt2.map((s) => {
    const sid = String(s.ID);
    const amt = bySid.get(sid) || 0;
    const extrasPercent = toNum(s.EXTRAS_PERCENT);
    const extras = round2(amt * (extrasPercent / 100));
    return {
      PARTIAL_PAYMENT_ID: partialPaymentId,
      STRUCTURE_ID: s.ID,
      AMOUNT_NET: amt,
      AMOUNT_EXTRAS_NET: extras,
      TENANT_ID: tenantId ?? null,
    };
  });

  await writePpsRows(supabase, { partialPaymentId, structureIds: idList, rows });

  const bookingsSum = round2(Array.from(bySid.values()).reduce((acc, v) => acc + toNum(v), 0));
  return { bookings_sum: bookingsSum, bt2Ids: idList };
}

// ---------------------------------------------------------------------------
// High-level actions
// ---------------------------------------------------------------------------

async function listPartialPayments(supabase, { tenantId, limit, statusId, q }) {
  let query = supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, DUE_DATE, TOTAL_AMOUNT_NET, TAX_AMOUNT_NET, TOTAL_AMOUNT_GROSS, STATUS_ID, PROJECT_ID, CONTRACT_ID, CONTACT, ADDRESS_NAME_1, COMMENT, VAT_ID, VAT_PERCENT, CANCELS_PARTIAL_PAYMENT_ID")
    .eq("TENANT_ID", tenantId)
    .order("PARTIAL_PAYMENT_DATE", { ascending: false })
    .limit(limit);

  if (statusId) query = query.eq("STATUS_ID", statusId);
  if (q) {
    const esc = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    query = query.or(`PARTIAL_PAYMENT_NUMBER.ilike.%${esc}%,CONTACT.ilike.%${esc}%`);
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  const ppRows = Array.isArray(rows) ? rows : [];

  const ppIds = Array.from(new Set(ppRows.map((r) => r.ID).filter(Boolean)));
  const payedGrossMap = {};
  if (ppIds.length > 0) {
    const { data: pays, error: payErr } = await supabase.from("PAYMENT").select("PARTIAL_PAYMENT_ID, AMOUNT_PAYED_GROSS").in("PARTIAL_PAYMENT_ID", ppIds);
    if (!payErr) {
      (pays || []).forEach((p) => {
        const k = p.PARTIAL_PAYMENT_ID;
        const v = typeof p.AMOUNT_PAYED_GROSS === "number" ? p.AMOUNT_PAYED_GROSS : parseFloat(String(p.AMOUNT_PAYED_GROSS ?? "0"));
        if (!Number.isFinite(v)) return;
        payedGrossMap[k] = (payedGrossMap[k] || 0) + v;
      });
    }
  }

  const projectIds = Array.from(new Set(ppRows.map((r) => r.PROJECT_ID).filter(Boolean)));
  const contractIds = Array.from(new Set(ppRows.map((r) => r.CONTRACT_ID).filter(Boolean)));

  const projectMap = {};
  if (projectIds.length > 0) {
    const { data: projects } = await supabase.from("PROJECT").select("ID, NAME_SHORT, NAME_LONG").in("ID", projectIds);
    (projects || []).forEach((p) => { projectMap[p.ID] = `${p.NAME_SHORT ?? ""}: ${p.NAME_LONG ?? ""}`.trim(); });
  }

  const contractMap = {};
  if (contractIds.length > 0) {
    let contracts = null;
    const { data: c1, error: c1Err } = await supabase.from("CONTRACT").select("ID, NAME_SHORT, NAME_LONG").in("ID", contractIds);
    if (!c1Err) contracts = c1;
    if (!Array.isArray(contracts) || contracts.length === 0) {
      const { data: c2 } = await supabase.from("CONTRACTS").select("ID, NAME_SHORT, NAME_LONG").in("ID", contractIds);
      contracts = c2;
    }
    (contracts || []).forEach((c) => { contractMap[c.ID] = `${c.NAME_SHORT ?? ""}: ${c.NAME_LONG ?? ""}`.trim(); });
  }

  return ppRows.map((r) => ({
    ID: r.ID,
    PARTIAL_PAYMENT_NUMBER: r.PARTIAL_PAYMENT_NUMBER ?? "",
    PARTIAL_PAYMENT_DATE: r.PARTIAL_PAYMENT_DATE ?? null,
    DUE_DATE: r.DUE_DATE ?? null,
    TOTAL_AMOUNT_NET: r.TOTAL_AMOUNT_NET ?? 0,
    TAX_AMOUNT_NET: r.TAX_AMOUNT_NET ?? 0,
    TOTAL_AMOUNT_GROSS: r.TOTAL_AMOUNT_GROSS ?? 0,
    STATUS_ID: r.STATUS_ID ?? null,
    PROJECT_ID: r.PROJECT_ID ?? null,
    CONTRACT_ID: r.CONTRACT_ID ?? null,
    VAT_PERCENT: r.VAT_PERCENT ?? null,
    PROJECT: projectMap[r.PROJECT_ID] ?? String(r.PROJECT_ID ?? ""),
    CONTRACT: contractMap[r.CONTRACT_ID] ?? String(r.CONTRACT_ID ?? ""),
    CONTACT: r.CONTACT ?? "",
    ADDRESS_NAME_1: r.ADDRESS_NAME_1 ?? "",
    AMOUNT_PAYED_GROSS: payedGrossMap[r.ID] ?? 0,
    COMMENT: r.COMMENT ?? "",
  }));
}

async function initPartialPayment(supabase, { companyId, employeeId, projectId, contractId }) {
  const { data: company, error: companyErr } = await supabase
    .from("COMPANY")
    .select(`ID, COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID, POST_OFFICE_BOX, BIC, TAX_NUMBER, IBAN, "TAX-ID", "CREDITOR-ID"`)
    .eq("ID", companyId)
    .maybeSingle();
  if (companyErr || !company) throw { status: 500, message: "Firma konnte nicht geladen werden" };

  const companyCountryLong = await getCountryNameLong(supabase, company.COUNTRY_ID);

  const empId = (() => { const n = parseInt(String(employeeId), 10); return Number.isFinite(n) ? n : employeeId; })();
  let employee = null;
  let employeeSalutation = null;

  const { data: emp1, error: empErr1 } = await supabase.from("EMPLOYEE").select("ID, FIRST_NAME, LAST_NAME, SHORT_NAME, MAIL, MOBILE, SALUTATION_ID").eq("ID", empId).maybeSingle();
  if (empErr1) {
    const { data: emp2, error: empErr2 } = await supabase.from("EMPLOYEE").select("ID, FIRST_NAME, LAST_NAME, SHORT_NAME, MAIL, MOBILE").eq("ID", empId).maybeSingle();
    if (empErr2 || !emp2) throw { status: 500, message: `Mitarbeiter konnte nicht geladen werden: ${empErr2?.message || empErr1.message || "unbekannter Fehler"}` };
    employee = emp2;
  } else {
    employee = emp1;
    employeeSalutation = await getSalutationText(supabase, employee?.SALUTATION_ID);
  }
  if (!employee) throw { status: 500, message: "Mitarbeiter konnte nicht geladen werden" };

  const { data: project, error: projectErr } = await supabase.from("PROJECT").select("ID, NAME_SHORT, NAME_LONG, TENANT_ID").eq("ID", projectId).maybeSingle();
  if (projectErr || !project) throw { status: 500, message: "Projekt konnte nicht geladen werden" };

  let contractRow = null;
  const { data: c1, error: c1Err } = await supabase.from("CONTRACT").select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID").eq("ID", contractId).maybeSingle();
  if (!c1Err && c1) contractRow = c1;
  if (!contractRow) {
    const { data: c2, error: c2Err } = await supabase.from("CONTRACTS").select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID").eq("ID", contractId).maybeSingle();
    if (c2Err || !c2) throw { status: 500, message: "Vertrag konnte nicht geladen werden" };
    contractRow = c2;
  }

  if (String(contractRow.PROJECT_ID) !== String(projectId)) throw { status: 400, message: "Der gewählte Vertrag gehört nicht zum gewählten Projekt" };

  const invoiceAddressId = contractRow.INVOICE_ADDRESS_ID;
  const { data: invoiceAddress, error: addrErr } = await supabase
    .from("ADDRESS")
    .select("ID, ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID, POST_OFFICE_BOX, CUSTOMER_NUMBER, BUYER_REFERENCE")
    .eq("ID", invoiceAddressId)
    .maybeSingle();
  if (addrErr || !invoiceAddress) throw { status: 500, message: "Rechnungsadresse konnte nicht geladen werden" };
  const addressCountryShort = await getCountryNameShort(supabase, invoiceAddress.COUNTRY_ID);

  const invoiceContactId = contractRow.INVOICE_CONTACT_ID;
  const { data: invoiceContact, error: contactErr } = await supabase
    .from("CONTACTS")
    .select("ID, FIRST_NAME, LAST_NAME, SALUTATION_ID, EMAIL, MOBILE")
    .eq("ID", invoiceContactId)
    .maybeSingle();
  if (contactErr || !invoiceContact) throw { status: 500, message: "Rechnungskontakt konnte nicht geladen werden" };

  let contactSalutation = null;
  if (invoiceContact.SALUTATION_ID) {
    const { data: s, error: sErr } = await supabase.from("SALUTATION").select("SALUTATION").eq("ID", invoiceContact.SALUTATION_ID).maybeSingle();
    if (!sErr) contactSalutation = s?.SALUTATION ?? null;
  }

  const insertRow = {
    COMPANY_ID: companyId,
    EMPLOYEE_ID: employeeId,
    PROJECT_ID: projectId,
    CONTRACT_ID: contractId,
    CURRENCY_ID: contractRow.CURRENCY_ID ?? null,
    STATUS_ID: 1,
    COMPANY_NAME_1: company.COMPANY_NAME_1 ?? null,
    COMPANY_NAME_2: company.COMPANY_NAME_2 ?? null,
    COMPANY_STREET: company.STREET ?? null,
    COMPANY_POST_CODE: company.POST_CODE ?? null,
    COMPANY_CITY: company.CITY ?? null,
    COMPANY_COUNTRY: companyCountryLong,
    COMPANY_POST_OFFICE_BOX: company.POST_OFFICE_BOX ?? null,
    COMPANY_BIC: company.BIC ?? null,
    "COMPANY_TAX-ID": company["TAX-ID"] ?? null,
    COMPANY_TAX_NUMBER: company.TAX_NUMBER ?? null,
    COMPANY_IBAN: company.IBAN ?? null,
    "COMPANY_CREDITOR-ID": company["CREDITOR-ID"] ?? null,
    EMPLOYEE: `${employee.SHORT_NAME ?? ""}: ${(employee.FIRST_NAME ?? "").trim()} ${(employee.LAST_NAME ?? "").trim()}`.trim(),
    EMPLOYEE_SALUTATION: employeeSalutation,
    EMPLOYEE_MAIL: employee.MAIL ?? null,
    EMPLOYEE_PHONE: employee.MOBILE ?? null,
    PARTIAL_PAYMENT_ADDRESS_ID: invoiceAddressId,
    ADDRESS_NAME_1: invoiceAddress.ADDRESS_NAME_1 ?? null,
    ADDRESS_NAME_2: invoiceAddress.ADDRESS_NAME_2 ?? null,
    ADDRESS_STREET: invoiceAddress.STREET ?? null,
    ADDRESS_POST_CODE: invoiceAddress.POST_CODE ?? null,
    ADDRESS_CITY: invoiceAddress.CITY ?? null,
    ADDRESS_COUNTRY: addressCountryShort,
    ADDRESS_POST_OFFICE_BOX: invoiceAddress.POST_OFFICE_BOX ?? null,
    ADDRESS_DEBITOR_NUMBER: invoiceAddress.CUSTOMER_NUMBER ?? null,
    BUYER_REFERENCE: invoiceAddress.BUYER_REFERENCE ?? null,
    ADDRESS_REFERENCE_NUMBER: invoiceAddress.BUYER_REFERENCE ?? null,
    PARTIAL_PAYMENT_CONTACT_ID: invoiceContactId,
    CONTACT: `${(invoiceContact.FIRST_NAME ?? "").trim()} ${(invoiceContact.LAST_NAME ?? "").trim()}`.trim(),
    CONTACT_SALUTATION: contactSalutation,
    CONTACT_MAIL: invoiceContact.EMAIL ?? null,
    CONTACT_PHONE: invoiceContact.MOBILE ?? null,
    TENANT_ID: project.TENANT_ID ?? null,
  };

  const { data: created, error: insertErr } = await supabase.from("PARTIAL_PAYMENT").insert([insertRow]).select("ID").single();
  if (insertErr) throw { status: 500, message: insertErr.message };

  return { id: created.ID };
}

async function getPartialPayment(supabase, { id }) {
  const { data: pp, error } = await supabase.from("PARTIAL_PAYMENT").select("*").eq("ID", id).maybeSingle();
  if (error || !pp) throw { status: 500, message: "PARTIAL_PAYMENT konnte nicht geladen werden" };

  const { data: project } = await supabase.from("PROJECT").select("NAME_SHORT, NAME_LONG").eq("ID", pp.PROJECT_ID).maybeSingle();

  let contract = null;
  const { data: c1 } = await supabase.from("CONTRACT").select("NAME_SHORT, NAME_LONG").eq("ID", pp.CONTRACT_ID).maybeSingle();
  contract = c1;
  if (!contract) {
    const { data: c2 } = await supabase.from("CONTRACTS").select("NAME_SHORT, NAME_LONG").eq("ID", pp.CONTRACT_ID).maybeSingle();
    contract = c2;
  }

  return { pp, project, contract };
}

async function deletePartialPayment(supabase, { id }) {
  const { data: pp, error: ppErr } = await supabase.from("PARTIAL_PAYMENT").select("ID, STATUS_ID").eq("ID", id).maybeSingle();
  if (ppErr || !pp) throw { status: 404, message: "PARTIAL_PAYMENT nicht gefunden" };
  if (String(pp.STATUS_ID) === "2") throw { status: 400, message: "Gebuchte Abschlagsrechnungen können nicht gelöscht werden" };

  const { error: tecErr } = await supabase.from("TEC").update({ PARTIAL_PAYMENT_ID: null }).eq("PARTIAL_PAYMENT_ID", id);
  if (tecErr) throw new Error(tecErr.message);

  const { error: ppsErr } = await execWithPpsTableFallback(supabase, (sb, table) =>
    sb.from(table).delete().eq("PARTIAL_PAYMENT_ID", id)
  );
  if (ppsErr) throw new Error(ppsErr.message);

  const { error: delErr } = await supabase.from("PARTIAL_PAYMENT").delete().eq("ID", id);
  if (delErr) throw new Error(delErr.message);
}

async function bookPartialPayment(supabase, { id, pp }) {
  if (!pp.PARTIAL_PAYMENT_NUMBER || !String(pp.PARTIAL_PAYMENT_NUMBER).trim()) {
    const { data: num, error: numErr } = await supabase.rpc("next_document_number", {
      p_company_id: pp.COMPANY_ID,
      p_doc_type: "PARTIAL_PAYMENT",
    });
    if (numErr || !num) throw { status: 500, message: `Nummernkreis konnte nicht verwendet werden: ${numErr?.message || "unknown error"}` };

    const { error: upNumErr } = await supabase.from("PARTIAL_PAYMENT").update({ PARTIAL_PAYMENT_NUMBER: num }).eq("ID", id);
    if (upNumErr) throw { status: 500, message: upNumErr.message };
    pp.PARTIAL_PAYMENT_NUMBER = num;
  }

  const vatPercent = toNum(pp.VAT_PERCENT);
  const totalNet = toNum(pp.TOTAL_AMOUNT_NET);
  const taxAmountNet = round2(totalNet * vatPercent / 100);
  const totalGross = round2(totalNet + taxAmountNet);

  let pdfAsset = null, tpl = null, theme = null;
  try {
    const r = await renderDocumentPdf({
      supabase,
      docType: "PARTIAL_PAYMENT",
      docId: parseInt(id, 10),
      templateId: pp.DOCUMENT_TEMPLATE_ID ? parseInt(String(pp.DOCUMENT_TEMPLATE_ID), 10) : null,
    });
    tpl = r.template;
    theme = r.theme;
    const fileName = `Abschlagsrechnung_${pp.PARTIAL_PAYMENT_NUMBER || pp.ID}.pdf`;
    pdfAsset = await storeGeneratedPdfAsAsset({ supabase, companyId: pp.COMPANY_ID, fileName, pdfBuffer: r.pdf, assetType: "PDF_PARTIAL_PAYMENT" });
  } catch (e) {
    console.error("[BOOK_PP][PDF]", { partial_payment_id: id, error: e?.message || String(e), stack: e?.stack });
    throw { status: 500, message: `PDF konnte nicht erzeugt werden: ${e?.message || e}` };
  }

  let xmlAsset = null;
  try {
    const { data: ppFull, error: ppFullErr } = await supabase.from("PARTIAL_PAYMENT").select("*").eq("ID", id).maybeSingle();
    if (ppFullErr || !ppFull) throw new Error(ppFullErr?.message || "PARTIAL_PAYMENT nicht gefunden");

    const xml = await generateUblInvoiceXml({ supabase, partialPayment: ppFull });
    const xmlName = `XRechnung_${pp.PARTIAL_PAYMENT_NUMBER || pp.ID}.xml`;
    xmlAsset = await storeGeneratedXmlAsAsset({ supabase, companyId: pp.COMPANY_ID, fileName: xmlName, xmlString: xml, assetType: "XML_XRECHNUNG_PARTIAL_PAYMENT" });
  } catch (e) {
    console.error("[BOOK_PP][XRECHNUNG_XML]", { partial_payment_id: id, error: e?.message || String(e), stack: e?.stack });
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    throw { status: 500, message: `E-Rechnung konnte nicht erzeugt werden: ${e?.message || e}` };
  }

  const ppUpdate = {
    STATUS_ID: 2,
    TAX_AMOUNT_NET: taxAmountNet,
    TOTAL_AMOUNT_GROSS: totalGross,
    DOCUMENT_TEMPLATE_ID: tpl?.ID ?? null,
    DOCUMENT_LAYOUT_KEY_SNAPSHOT: tpl?.LAYOUT_KEY ?? null,
    DOCUMENT_THEME_SNAPSHOT_JSON: theme ?? null,
    DOCUMENT_LOGO_ASSET_ID_SNAPSHOT: tpl?.LOGO_ASSET_ID ?? null,
    DOCUMENT_PDF_ASSET_ID: pdfAsset?.ID ?? null,
    DOCUMENT_RENDERED_AT: new Date().toISOString(),
    DOCUMENT_XML_ASSET_ID: xmlAsset?.ID ?? null,
    DOCUMENT_XML_PROFILE: "xrechnung-ubl",
    DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
  };

  const { error: upErr } = await supabase.from("PARTIAL_PAYMENT").update(ppUpdate).eq("ID", id);
  if (upErr) {
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
    throw { status: 500, message: upErr.message };
  }

  const { data: project, error: projErr } = await supabase.from("PROJECT").select("ID, PARTIAL_PAYMENTS").eq("ID", pp.PROJECT_ID).maybeSingle();
  if (projErr || !project) {
    await supabase.from("PARTIAL_PAYMENT").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null, DOCUMENT_XML_ASSET_ID: null }).eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
    throw { status: 500, message: "Projekt konnte nicht geladen werden" };
  }

  const { error: projUpErr } = await supabase.from("PROJECT").update({ PARTIAL_PAYMENTS: round2(toNum(project.PARTIAL_PAYMENTS) + toNum(pp.TOTAL_AMOUNT_NET)) }).eq("ID", pp.PROJECT_ID);
  if (projUpErr) {
    await supabase.from("PARTIAL_PAYMENT").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null, DOCUMENT_XML_ASSET_ID: null }).eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
    throw { status: 500, message: projUpErr.message };
  }

  try {
    const sums = await sumPpsForPartialPayment(supabase, { partialPaymentId: id });
    const rows = sums.rows || [];

    if (rows.length > 0) {
      const addByStructure = new Map();
      rows.forEach((r) => {
        const sid = String(r.STRUCTURE_ID);
        const cur = addByStructure.get(sid) || 0;
        addByStructure.set(sid, round2(cur + toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET)));
      });

      const structureIds = Array.from(addByStructure.keys()).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));

      if (structureIds.length > 0) {
        const { data: psRows, error: psErr } = await supabase.from("PROJECT_STRUCTURE").select("ID, PARTIAL_PAYMENTS").in("ID", structureIds);
        if (psErr) throw new Error(psErr.message);

        const currentById = new Map();
        (psRows || []).forEach((s) => currentById.set(String(s.ID), toNum(s.PARTIAL_PAYMENTS)));

        const updates = structureIds.map((sid) => {
          const key = String(sid);
          return { ID: sid, PARTIAL_PAYMENTS: round2((currentById.get(key) || 0) + (addByStructure.get(key) || 0)) };
        });

        const { error: psUpErr } = await supabase.from("PROJECT_STRUCTURE").upsert(updates, { onConflict: "ID" });
        if (psUpErr) throw new Error(psUpErr.message);
      }
    }
  } catch (e) {
    await supabase.from("PARTIAL_PAYMENT").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null, DOCUMENT_XML_ASSET_ID: null }).eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
    throw { status: 500, message: `PROJECT_STRUCTURE konnte nicht aktualisiert werden: ${e?.message || e}` };
  }

  // If this is a Storno-AR, mark the original partial payment as cancelled
  if (pp.CANCELS_PARTIAL_PAYMENT_ID) {
    await supabase.from("PARTIAL_PAYMENT").update({ STATUS_ID: 3 }).eq("ID", pp.CANCELS_PARTIAL_PAYMENT_ID);
  }

  return { success: true, pdf_asset_id: pdfAsset?.ID ?? null, xml_asset_id: xmlAsset?.ID ?? null };
}

// ---------------------------------------------------------------------------
// cancelPartialPayment – create a draft Storno-AR for a booked partial payment
// ---------------------------------------------------------------------------
async function cancelPartialPayment(supabase, { id }) {
  const { data: orig, error: origErr } = await supabase
    .from("PARTIAL_PAYMENT").select("*").eq("ID", id).maybeSingle();
  if (origErr || !orig) throw { status: 404, message: "Abschlagsrechnung nicht gefunden" };
  if (String(orig.STATUS_ID) !== "2") throw { status: 400, message: "Nur gebuchte Abschlagsrechnungen können storniert werden" };

  // Prevent duplicate
  const { data: existing } = await supabase
    .from("PARTIAL_PAYMENT").select("ID, STATUS_ID").eq("CANCELS_PARTIAL_PAYMENT_ID", id).maybeSingle();
  if (existing) {
    const label = String(existing.STATUS_ID) === "2" ? "gebucht" : "als Entwurf angelegt";
    throw { status: 409, message: `Es existiert bereits eine Storno-Abschlagsrechnung (${label}) für diesen Eintrag` };
  }

  const {
    ID: _id, PARTIAL_PAYMENT_NUMBER: _num, STATUS_ID: _st,
    DOCUMENT_PDF_ASSET_ID: _pdf, DOCUMENT_XML_ASSET_ID: _xml,
    DOCUMENT_XML_PROFILE: _xp, DOCUMENT_XML_RENDERED_AT: _xr,
    DOCUMENT_RENDERED_AT: _dr, DOCUMENT_TEMPLATE_ID: _tpl,
    DOCUMENT_LAYOUT_KEY_SNAPSHOT: _lk, DOCUMENT_THEME_SNAPSHOT_JSON: _th,
    DOCUMENT_LOGO_ASSET_ID_SNAPSHOT: _lo,
    ...rest
  } = orig;

  const cancelRow = {
    ...rest,
    CANCELS_PARTIAL_PAYMENT_ID: parseInt(id, 10),
    STATUS_ID:         1,
    AMOUNT_NET:       -round2(toNum(orig.AMOUNT_NET)),
    AMOUNT_EXTRAS_NET:-round2(toNum(orig.AMOUNT_EXTRAS_NET)),
    TOTAL_AMOUNT_NET: -round2(toNum(orig.TOTAL_AMOUNT_NET)),
    TAX_AMOUNT_NET:   -round2(toNum(orig.TAX_AMOUNT_NET)),
    TOTAL_AMOUNT_GROSS:-round2(toNum(orig.TOTAL_AMOUNT_GROSS)),
  };

  const { data: created, error: insertErr } = await supabase
    .from("PARTIAL_PAYMENT").insert([cancelRow]).select("ID").single();
  if (insertErr) throw { status: 500, message: insertErr.message };

  const newId = created.ID;

  // Auto-book: immediately finalise the Storno-AR so original is marked Storniert at once
  const cancelPp = { ...cancelRow, ID: newId };
  await bookPartialPayment(supabase, { id: newId, pp: cancelPp });

  return { id: newId };
}

module.exports = {
  streamPdfAsset,
  streamXmlAsset,
  storeGeneratedPdfAsAsset,
  storeGeneratedXmlAsAsset,
  bestEffortDeleteAsset,
  toNum,
  round2,
  isNullOrZero,
  isUninvoiced,
  loadProjectStructuresForContext,
  execWithPpsTableFallback,
  sumTecForStructures,
  loadPreviouslyBilledByStructure,
  sumPpsForPartialPayment,
  writePpsRows,
  recomputePartialPaymentTotals,
  applyPerformanceAmount,
  updateBt2FromTec,
  listPartialPayments,
  initPartialPayment,
  getPartialPayment,
  deletePartialPayment,
  cancelPartialPayment,
  bookPartialPayment,
  generateUblInvoiceXml,
};
