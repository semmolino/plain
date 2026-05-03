"use strict";

const { generateUblInvoiceXml } = require("../services_einvoice_ubl");
const { renderDocumentPdf } = require("../services_pdf_render");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// File-system helpers
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
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
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

function isTableMissingErr(err, tableName) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("relation") && msg.includes(String(tableName).toLowerCase()) && msg.includes("does not exist");
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

async function getCountryNameLong(supabase, countryId) {
  if (!countryId) return null;
  const { data, error } = await supabase
    .from("COUNTRY")
    .select("NAME_LONG")
    .eq("ID", countryId)
    .maybeSingle();
  if (error) return null;
  return data?.NAME_LONG ?? null;
}

async function getCountryNameShort(supabase, countryId) {
  if (!countryId) return null;
  const { data, error } = await supabase
    .from("COUNTRY")
    .select("NAME_SHORT")
    .eq("ID", countryId)
    .maybeSingle();
  if (error) return null;
  return data?.NAME_SHORT ?? null;
}

async function getSalutationText(supabase, salutationId) {
  if (!salutationId) return null;
  const { data, error } = await supabase
    .from("SALUTATION")
    .select("SALUTATION")
    .eq("ID", salutationId)
    .maybeSingle();
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

async function loadPreviouslyBilledByStructure(supabase, { contractId, projectId, structureIds, excludeInvoiceId, bookedStatusId = 2 }) {
  const ids = Array.isArray(structureIds) ? structureIds : [];
  if (ids.length === 0) return new Map();

  let invQ = supabase.from("INVOICE").select("ID").eq("STATUS_ID", bookedStatusId);
  if (contractId) invQ = invQ.eq("CONTRACT_ID", contractId);
  else invQ = invQ.eq("PROJECT_ID", projectId);
  if (excludeInvoiceId) invQ = invQ.neq("ID", excludeInvoiceId);

  const { data: invRows, error: invErr } = await invQ;
  if (invErr) throw new Error(invErr.message);

  const invoiceIds = (invRows || []).map((r) => r.ID).filter((x) => x !== null && x !== undefined);
  if (invoiceIds.length === 0) return new Map();

  const { data: rows, error } = await supabase
    .from("INVOICE_STRUCTURE")
    .select("STRUCTURE_ID, AMOUNT_NET")
    .in("INVOICE_ID", invoiceIds)
    .in("STRUCTURE_ID", ids);

  if (error) {
    if (isTableMissingErr(error, "invoice_structure")) return new Map();
    throw new Error(error.message);
  }

  const m = new Map();
  (rows || []).forEach((r) => {
    const sid = String(r.STRUCTURE_ID);
    const cur = m.get(sid) || 0;
    m.set(sid, round2(cur + toNum(r.AMOUNT_NET)));
  });
  return m;
}

async function sumInvStructureForInvoice(supabase, { invoiceId, structureIds }) {
  let q = supabase.from("INVOICE_STRUCTURE").select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET").eq("INVOICE_ID", invoiceId);
  if (Array.isArray(structureIds) && structureIds.length > 0) q = q.in("STRUCTURE_ID", structureIds);

  const { data: rows, error } = await q;
  if (error) {
    if (isTableMissingErr(error, "invoice_structure")) {
      return { net: 0, extras: 0, rows: [] };
    }
    throw new Error(error.message);
  }

  const arr = Array.isArray(rows) ? rows : [];
  const net = round2(arr.reduce((acc, r) => acc + toNum(r.AMOUNT_NET), 0));
  const extras = round2(arr.reduce((acc, r) => acc + toNum(r.AMOUNT_EXTRAS_NET), 0));
  return { net, extras, rows: arr };
}

async function writeInvoiceStructureRows(supabase, { invoiceId, rows }) {
  const arr = Array.isArray(rows) ? rows : [];
  const structureIds = Array.from(new Set(arr.map((r) => r.STRUCTURE_ID))).filter((x) => x !== null && x !== undefined);

  if (structureIds.length > 0) {
    const { error: delErr } = await supabase
      .from("INVOICE_STRUCTURE")
      .delete()
      .eq("INVOICE_ID", invoiceId)
      .in("STRUCTURE_ID", structureIds);
    if (delErr && !isTableMissingErr(delErr, "invoice_structure")) throw new Error(delErr.message);
  }

  if (arr.length === 0) return;

  const { error: insErr } = await supabase.from("INVOICE_STRUCTURE").insert(arr);
  if (insErr) {
    if (isTableMissingErr(insErr, "invoice_structure")) return;
    throw new Error(insErr.message);
  }
}

async function recomputeInvoiceTotals(supabase, invoiceId) {
  const { data: inv, error: invErr } = await supabase
    .from("INVOICE")
    .select("ID, VAT_PERCENT")
    .eq("ID", invoiceId)
    .maybeSingle();
  if (invErr || !inv) throw new Error("INVOICE konnte nicht geladen werden");

  const sums = await sumInvStructureForInvoice(supabase, { invoiceId });
  const amountNet = round2(sums.net);
  const amountExtras = round2(sums.extras);
  const totalNet = round2(amountNet + amountExtras);
  const vatPct = toNum(inv.VAT_PERCENT);
  const taxAmountNet = round2(totalNet * vatPct / 100);
  const totalGross = round2(totalNet + taxAmountNet);

  const { error: upErr } = await supabase
    .from("INVOICE")
    .update({
      AMOUNT_NET: amountNet,
      AMOUNT_EXTRAS_NET: amountExtras,
      TOTAL_AMOUNT_NET: totalNet,
      TAX_AMOUNT_NET: taxAmountNet,
      TOTAL_AMOUNT_GROSS: totalGross,
    })
    .eq("ID", invoiceId);
  if (upErr) throw new Error(upErr.message);

  return { amount_net: amountNet, amount_extras_net: amountExtras, total_amount_net: totalNet, tax_amount_net: taxAmountNet, total_amount_gross: totalGross };
}

async function applyPerformanceAmount(supabase, { invoiceId, contractId, projectId, amount, tenantId = undefined }) {
  if (tenantId === undefined && projectId) {
    const { data: projT } = await supabase.from("PROJECT").select("TENANT_ID").eq("ID", projectId).maybeSingle();
    tenantId = projT?.TENANT_ID ?? null;
  }
  const structures = await loadProjectStructuresForContext(supabase, { contractId, projectId });
  const bt1 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1);
  const bt1Ids = bt1.map((s) => s.ID);

  const prev = await loadPreviouslyBilledByStructure(supabase, {
    contractId,
    projectId,
    structureIds: bt1Ids,
    excludeInvoiceId: invoiceId,
    bookedStatusId: 2,
  });

  const remaining = new Map();
  bt1.forEach((s) => {
    const sid = String(s.ID);
    const billed = prev.get(sid) || 0;
    const rem = round2(toNum(s.REVENUE_COMPLETION) - billed);
    remaining.set(sid, rem > 0 ? rem : 0);
  });

  const { allocations } = distributeAcrossRemaining({ total: amount, remainingByStructure: remaining });

  const rows = bt1
    .map((s) => {
      const sid = String(s.ID);
      const aNet = round2(allocations.get(sid) || 0);
      if (aNet <= 0) return null;
      const extrasPct = toNum(s.EXTRAS_PERCENT);
      const aExtras = round2((aNet * extrasPct) / 100);
      return {
        INVOICE_ID: invoiceId,
        STRUCTURE_ID: s.ID,
        AMOUNT_NET: aNet,
        AMOUNT_EXTRAS_NET: aExtras,
        TENANT_ID: tenantId ?? null,
      };
    })
    .filter(Boolean);

  await writeInvoiceStructureRows(supabase, { invoiceId, rows });
  const sum = round2(rows.reduce((acc, r) => acc + toNum(r.AMOUNT_NET), 0));
  return { performance_amount: sum };
}

async function updateBt2FromTec(supabase, { invoiceId, contractId, projectId, tenantId = undefined }) {
  if (tenantId === undefined && projectId) {
    const { data: projT } = await supabase.from("PROJECT").select("TENANT_ID").eq("ID", projectId).maybeSingle();
    tenantId = projT?.TENANT_ID ?? null;
  }
  const structures = await loadProjectStructuresForContext(supabase, { contractId, projectId });
  const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
  if (bt2Ids.length === 0) {
    try {
      await supabase.from("INVOICE_STRUCTURE").delete().eq("INVOICE_ID", invoiceId).in("STRUCTURE_ID", []);
    } catch (_) {}
    return { bookings_sum: 0 };
  }

  const { data: tecRows, error: tecErr } = await supabase
    .from("TEC")
    .select("ID, STRUCTURE_ID, SP_TOT, PARTIAL_PAYMENT_ID, INVOICE_ID")
    .in("STRUCTURE_ID", bt2Ids)
    .eq("INVOICE_ID", invoiceId)
    .neq("STATUS", "DRAFT");

  if (tecErr) throw new Error(tecErr.message);

  const sumByStructure = new Map();
  (tecRows || []).forEach((t) => {
    if (!isNullOrZero(t.PARTIAL_PAYMENT_ID)) return;
    const sid = String(t.STRUCTURE_ID);
    const cur = sumByStructure.get(sid) || 0;
    sumByStructure.set(sid, round2(cur + toNum(t.SP_TOT)));
  });

  const rows = Array.from(sumByStructure.entries())
    .map(([sid, sum]) => {
      const sObj = (structures || []).find((x) => String(x.ID) === String(sid));
      const extrasPct = toNum(sObj?.EXTRAS_PERCENT);
      const aNet = round2(sum);
      const aExtras = round2((aNet * extrasPct) / 100);
      return { INVOICE_ID: invoiceId, STRUCTURE_ID: parseInt(String(sid), 10), AMOUNT_NET: aNet, AMOUNT_EXTRAS_NET: aExtras, TENANT_ID: tenantId ?? null };
    })
    .filter((r) => Number.isFinite(r.STRUCTURE_ID));

  await writeInvoiceStructureRows(supabase, { invoiceId, rows });
  const bookingsSum = round2(rows.reduce((acc, r) => acc + toNum(r.AMOUNT_NET), 0));
  return { bookings_sum: bookingsSum };
}

async function findTecIdsToAutoAssign(supabase, { invoiceId, structureIds }) {
  const ids = Array.isArray(structureIds) ? structureIds : [];
  if (ids.length === 0) return { toAssignIds: [] };

  const { data: tecRows, error } = await supabase
    .from("TEC")
    .select("ID, PARTIAL_PAYMENT_ID, INVOICE_ID")
    .in("STRUCTURE_ID", ids)
    .neq("STATUS", "DRAFT");
  if (error) throw new Error(error.message);

  const toAssignIds = (tecRows || [])
    .filter((t) => isNullOrZero(t.PARTIAL_PAYMENT_ID) && isNullOrZero(t.INVOICE_ID))
    .map((t) => t.ID);

  return { toAssignIds };
}

// ---------------------------------------------------------------------------
// List / query helpers
// ---------------------------------------------------------------------------

async function listInvoices(supabase, { tenantId, limit, q }) {
  let query = supabase
    .from("INVOICE")
    .select(
      "ID, INVOICE_NUMBER, INVOICE_DATE, DUE_DATE, TOTAL_AMOUNT_NET, TAX_AMOUNT_NET, TOTAL_AMOUNT_GROSS, STATUS_ID, PROJECT_ID, CONTRACT_ID, CONTACT, ADDRESS_NAME_1, COMMENT, VAT_ID, VAT_PERCENT, INVOICE_TYPE, CANCELS_INVOICE_ID"
    )
    .eq("TENANT_ID", tenantId)
    .order("INVOICE_DATE", { ascending: false })
    .limit(limit);

  if (q) {
    const esc = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    query = query.or(`INVOICE_NUMBER.ilike.%${esc}%`);
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  const invRows = Array.isArray(rows) ? rows : [];

  const invIds = Array.from(new Set(invRows.map(r => r.ID).filter(Boolean)));
  const payedGrossMap = {};
  if (invIds.length > 0) {
    const { data: pays, error: payErr } = await supabase
      .from("PAYMENT")
      .select("INVOICE_ID, AMOUNT_PAYED_GROSS")
      .in("INVOICE_ID", invIds);
    if (!payErr) {
      (pays || []).forEach(p => {
        const k = p.INVOICE_ID;
        const v = typeof p.AMOUNT_PAYED_GROSS === "number" ? p.AMOUNT_PAYED_GROSS : parseFloat(String(p.AMOUNT_PAYED_GROSS ?? "0"));
        if (!Number.isFinite(v)) return;
        payedGrossMap[k] = (payedGrossMap[k] || 0) + v;
      });
    }
  }

  const projectIds = Array.from(new Set(invRows.map(r => r.PROJECT_ID).filter(Boolean)));
  const contractIds = Array.from(new Set(invRows.map(r => r.CONTRACT_ID).filter(Boolean)));

  const projectMap = {};
  if (projectIds.length > 0) {
    const { data: projects } = await supabase.from("PROJECT").select("ID, NAME_SHORT, NAME_LONG").in("ID", projectIds);
    (projects || []).forEach(p => {
      projectMap[p.ID] = `${p.NAME_SHORT ?? ""}: ${p.NAME_LONG ?? ""}`.trim();
    });
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
    (contracts || []).forEach(c => {
      contractMap[c.ID] = `${c.NAME_SHORT ?? ""}: ${c.NAME_LONG ?? ""}`.trim();
    });
  }

  return invRows.map(r => ({
    ID: r.ID,
    INVOICE_NUMBER: r.INVOICE_NUMBER ?? "",
    INVOICE_DATE: r.INVOICE_DATE ?? null,
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

async function initInvoice(supabase, { companyId, employeeId, projectId, contractId, invoiceType }) {
  const company_q = await supabase
    .from("COMPANY")
    .select(`ID, COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID, POST_OFFICE_BOX, BIC, TAX_NUMBER, IBAN, "TAX-ID", "CREDITOR-ID"`)
    .eq("ID", companyId)
    .maybeSingle();
  if (company_q.error || !company_q.data) throw { status: 500, message: "Firma konnte nicht geladen werden" };
  const company = company_q.data;
  const companyCountryLong = await getCountryNameLong(supabase, company.COUNTRY_ID);

  const empId = (() => { const n = parseInt(String(employeeId), 10); return Number.isFinite(n) ? n : employeeId; })();
  let employee = null;
  let employeeSalutation = null;

  const { data: emp1, error: empErr1 } = await supabase
    .from("EMPLOYEE")
    .select("ID, FIRST_NAME, LAST_NAME, SHORT_NAME, MAIL, MOBILE, SALUTATION_ID")
    .eq("ID", empId)
    .maybeSingle();

  if (empErr1) {
    const { data: emp2, error: empErr2 } = await supabase
      .from("EMPLOYEE")
      .select("ID, FIRST_NAME, LAST_NAME, SHORT_NAME, MAIL, MOBILE")
      .eq("ID", empId)
      .maybeSingle();
    if (empErr2 || !emp2) throw { status: 500, message: `Mitarbeiter konnte nicht geladen werden: ${empErr2?.message || empErr1.message || "unbekannter Fehler"}` };
    employee = emp2;
  } else {
    employee = emp1;
    employeeSalutation = await getSalutationText(supabase, employee?.SALUTATION_ID);
  }
  if (!employee) throw { status: 500, message: "Mitarbeiter konnte nicht geladen werden" };

  const { data: project, error: projectErr } = await supabase
    .from("PROJECT")
    .select("ID, NAME_SHORT, NAME_LONG, TENANT_ID")
    .eq("ID", projectId)
    .maybeSingle();
  if (projectErr || !project) throw { status: 500, message: "Projekt konnte nicht geladen werden" };

  let contractRow = null;
  {
    const { data: c1, error: c1Err } = await supabase
      .from("CONTRACT")
      .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID")
      .eq("ID", contractId)
      .maybeSingle();
    if (!c1Err && c1) contractRow = c1;
  }
  if (!contractRow) {
    const { data: c2, error: c2Err } = await supabase
      .from("CONTRACTS")
      .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID")
      .eq("ID", contractId)
      .maybeSingle();
    if (c2Err || !c2) throw { status: 500, message: "Vertrag konnte nicht geladen werden" };
    contractRow = c2;
  }

  if (String(contractRow.PROJECT_ID) !== String(projectId)) {
    throw { status: 400, message: "Der gewählte Vertrag gehört nicht zum gewählten Projekt" };
  }

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
  const contactSalutation = await getSalutationText(supabase, invoiceContact.SALUTATION_ID);

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
    INVOICE_ADDRESS_ID: invoiceAddressId,
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
    INVOICE_CONTACT_ID: invoiceContactId,
    CONTACT: `${(invoiceContact.FIRST_NAME ?? "").trim()} ${(invoiceContact.LAST_NAME ?? "").trim()}`.trim(),
    CONTACT_SALUTATION: contactSalutation,
    CONTACT_MAIL: invoiceContact.EMAIL ?? null,
    CONTACT_PHONE: invoiceContact.MOBILE ?? null,
    TENANT_ID: project.TENANT_ID ?? null,
    INVOICE_TYPE: invoiceType,
  };

  const { data: created, error: insertErr } = await supabase
    .from("INVOICE")
    .insert([insertRow])
    .select("ID")
    .single();

  if (insertErr) {
    if (isTableMissingErr(insertErr, "invoice")) throw { status: 501, message: "INVOICE Tabelle ist in der Datenbank nicht vorhanden." };
    throw { status: 500, message: insertErr.message };
  }

  return { id: created.ID };
}

async function patchInvoice(supabase, { id, body, currentInv }) {
  const payload = {};

  if (body.invoice_number !== undefined) {
    const num = String(body.invoice_number || "").trim();
    if (!num) throw { status: 400, message: "Rechnungsnummer ist erforderlich" };

    const { data: existing, error: existErr } = await supabase
      .from("INVOICE")
      .select("ID")
      .eq("INVOICE_NUMBER", num)
      .neq("ID", id)
      .limit(1);
    if (existErr) throw { status: 500, message: existErr.message };
    if (Array.isArray(existing) && existing.length > 0) throw { status: 409, message: "Rechnungsnummer ist bereits vergeben" };

    payload.INVOICE_NUMBER = num;
  }

  if (body.invoice_date !== undefined) payload.INVOICE_DATE = body.invoice_date || null;
  if (body.due_date !== undefined) payload.DUE_DATE = body.due_date || null;
  if (body.billing_period_start !== undefined) payload.BILLING_PERIOD_START = body.billing_period_start || null;
  if (body.billing_period_finish !== undefined) payload.BILLING_PERIOD_FINISH = body.billing_period_finish || null;
  if (body.comment !== undefined) payload.COMMENT = String(body.comment || "").trim() || null;

  if (body.vat_id !== undefined) {
    const vatId = body.vat_id;
    if (!vatId) throw { status: 400, message: "Mehrwertsteuersatz ist erforderlich" };

    const { data: vat, error: vatErr } = await supabase.from("VAT").select("ID, VAT_PERCENT").eq("ID", vatId).maybeSingle();
    if (vatErr || !vat) throw { status: 500, message: "VAT konnte nicht geladen werden" };

    payload.VAT_ID = vatId;
    payload.VAT_PERCENT = vat.VAT_PERCENT ?? null;
  }

  if (body.payment_means_id !== undefined) {
    const pm = body.payment_means_id;
    if (!pm) throw { status: 400, message: "Zahlungsart ist erforderlich" };
    payload.PAYMENT_MEANS_ID = pm;
  }

  if (payload.VAT_PERCENT !== undefined) {
    const totalNet = toNum(currentInv.TOTAL_AMOUNT_NET);
    const vatPercent = toNum(payload.VAT_PERCENT);
    payload.TAX_AMOUNT_NET = round2(totalNet * vatPercent / 100);
    payload.TOTAL_AMOUNT_GROSS = round2(totalNet + payload.TAX_AMOUNT_NET);
  }

  if (Object.keys(payload).length === 0) return { ok: true };

  const { error: upErr } = await supabase.from("INVOICE").update(payload).eq("ID", id);
  if (upErr) throw { status: 500, message: upErr.message };

  return { ok: true };
}

async function getInvoice(supabase, { id }) {
  const { data: inv, error } = await supabase.from("INVOICE").select("*").eq("ID", id).maybeSingle();
  if (error || !inv) throw { status: 500, message: "INVOICE konnte nicht geladen werden" };

  const { data: project } = await supabase.from("PROJECT").select("NAME_SHORT, NAME_LONG").eq("ID", inv.PROJECT_ID).maybeSingle();

  let contract = null;
  const { data: c1 } = await supabase.from("CONTRACT").select("NAME_SHORT, NAME_LONG").eq("ID", inv.CONTRACT_ID).maybeSingle();
  contract = c1;
  if (!contract) {
    const { data: c2 } = await supabase.from("CONTRACTS").select("NAME_SHORT, NAME_LONG").eq("ID", inv.CONTRACT_ID).maybeSingle();
    contract = c2;
  }

  return { inv, project, contract };
}

async function deleteInvoice(supabase, { id }) {
  const { data: inv, error: invErr } = await supabase.from("INVOICE").select("ID, STATUS_ID").eq("ID", id).maybeSingle();
  if (invErr || !inv) throw { status: 404, message: "INVOICE nicht gefunden" };
  if (String(inv.STATUS_ID) === "2") throw { status: 400, message: "Gebuchte Rechnungen können nicht gelöscht werden" };

  {
    const { error: tecErr } = await supabase.from("TEC").update({ INVOICE_ID: null }).eq("INVOICE_ID", id);
    if (tecErr) {
      const msg = String(tecErr.message || "").toLowerCase();
      if (!msg.includes("does not exist") && !msg.includes("column")) throw new Error(tecErr.message);
    }
  }

  {
    const { error: sErr } = await supabase.from("INVOICE_STRUCTURE").delete().eq("INVOICE_ID", id);
    if (sErr && !isTableMissingErr(sErr, "invoice_structure")) throw new Error(sErr.message);
  }

  const { error: delErr } = await supabase.from("INVOICE").delete().eq("ID", id);
  if (delErr) throw new Error(delErr.message);
}

async function bookInvoice(supabase, { id, inv }) {
  const vatPercent = toNum(inv.VAT_PERCENT);
  const totalNet = toNum(inv.TOTAL_AMOUNT_NET);
  const taxAmountNet = round2(totalNet * vatPercent / 100);
  const totalGross = round2(totalNet + taxAmountNet);

  if (!inv.INVOICE_NUMBER || !String(inv.INVOICE_NUMBER).trim()) {
    const { data: num, error: numErr } = await supabase.rpc("next_document_number", {
      p_company_id: inv.COMPANY_ID,
      p_doc_type: "INVOICE",
    });
    if (numErr || !num) throw { status: 500, message: `Nummernkreis konnte nicht verwendet werden: ${numErr?.message || "unknown error"}` };

    const { error: upNumErr } = await supabase.from("INVOICE").update({ INVOICE_NUMBER: num }).eq("ID", id);
    if (upNumErr) throw { status: 500, message: upNumErr.message };
    inv.INVOICE_NUMBER = num;
  }

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
    const fileName = `Rechnung_${inv.INVOICE_NUMBER || inv.ID}.pdf`;
    pdfAsset = await storeGeneratedPdfAsAsset({ supabase, companyId: inv.COMPANY_ID, fileName, pdfBuffer: r.pdf, assetType: "PDF_INVOICE" });
  } catch (e) {
    console.error("[BOOK_INVOICE][PDF]", { invoice_id: id, error: e?.message || String(e), stack: e?.stack });
    throw { status: 500, message: `PDF konnte nicht erzeugt werden: ${e?.message || e}` };
  }

  let xmlAsset = null;
  try {
    const { data: invFull, error: invFullErr } = await supabase.from("INVOICE").select("*").eq("ID", id).maybeSingle();
    if (invFullErr || !invFull) throw new Error(invFullErr?.message || "INVOICE konnte nicht vollstaendig geladen werden");

    const xml = await generateUblInvoiceXml({ supabase, invoice: invFull, docType: "INVOICE" });
    const fileNameXml = `XRechnung_${invFull.INVOICE_NUMBER || invFull.ID || inv.ID}.xml`;
    xmlAsset = await storeGeneratedXmlAsAsset({ supabase, companyId: inv.COMPANY_ID, fileName: fileNameXml, xmlString: xml, assetType: "XML_XRECHNUNG_INVOICE" });
  } catch (e) {
    console.error("[BOOK_INVOICE][XRECHNUNG_XML]", { invoice_id: id, error: e?.message || String(e), stack: e?.stack });
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    throw { status: 500, message: `E-Rechnung konnte nicht erzeugt werden: ${e?.message || e}` };
  }

  const invUpdate = {
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
  };

  const { error: upErr } = await supabase.from("INVOICE").update(invUpdate).eq("ID", id);
  if (upErr) {
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
    throw { status: 500, message: upErr.message };
  }

  const { data: project, error: projErr } = await supabase.from("PROJECT").select("ID, INVOICED").eq("ID", inv.PROJECT_ID).maybeSingle();
  if (projErr || !project) {
    await supabase.from("INVOICE").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null }).eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    throw { status: 500, message: "Projekt konnte nicht geladen werden" };
  }

  const current = toNum(project.INVOICED);
  const add = toNum(inv.TOTAL_AMOUNT_NET);

  const { error: projUpErr } = await supabase.from("PROJECT").update({ INVOICED: round2(current + add) }).eq("ID", inv.PROJECT_ID);
  if (projUpErr) {
    await supabase.from("INVOICE").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null }).eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    throw { status: 500, message: projUpErr.message };
  }

  try {
    const sums = await sumInvStructureForInvoice(supabase, { invoiceId: id });
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
        const { data: psRows, error: psErr } = await supabase.from("PROJECT_STRUCTURE").select("ID, INVOICED").in("ID", structureIds);
        if (psErr) throw new Error(psErr.message);

        const currentById = new Map();
        (psRows || []).forEach((s) => currentById.set(String(s.ID), toNum(s.INVOICED)));

        const updates = structureIds.map((sid) => {
          const key = String(sid);
          const base = currentById.get(key) || 0;
          const inc = addByStructure.get(key) || 0;
          return { ID: sid, INVOICED: round2(base + inc) };
        });

        const { error: psUpErr } = await supabase.from("PROJECT_STRUCTURE").upsert(updates, { onConflict: "ID" });
        if (psUpErr) throw new Error(psUpErr.message);
      }
    }
  } catch (e) {
    await supabase.from("INVOICE").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null }).eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    throw { status: 500, message: `PROJECT_STRUCTURE konnte nicht aktualisiert werden: ${e?.message || e}` };
  }

  // If this is a Stornorechnung, mark the original invoice as cancelled
  if (inv.CANCELS_INVOICE_ID) {
    await supabase.from("INVOICE").update({ STATUS_ID: 3 }).eq("ID", inv.CANCELS_INVOICE_ID);
  }

  return { success: true, number: inv.INVOICE_NUMBER || null, pdf_asset_id: pdfAsset?.ID ?? null };
}

// ---------------------------------------------------------------------------
// cancelInvoice – create a draft Stornorechnung for a booked invoice
// The original is marked STATUS_ID=3 only when the Stornorechnung is booked.
// ---------------------------------------------------------------------------
async function cancelInvoice(supabase, { id }) {
  const { data: orig, error: origErr } = await supabase
    .from("INVOICE").select("*").eq("ID", id).maybeSingle();
  if (origErr || !orig) throw { status: 404, message: "Rechnung nicht gefunden" };
  if (String(orig.STATUS_ID) !== "2") throw { status: 400, message: "Nur gebuchte Rechnungen können storniert werden" };
  if (orig.INVOICE_TYPE === "stornorechnung") throw { status: 400, message: "Eine Stornorechnung kann nicht storniert werden" };

  // Prevent duplicate: check for an existing (non-deleted) Stornorechnung
  const { data: existing } = await supabase
    .from("INVOICE").select("ID, STATUS_ID").eq("CANCELS_INVOICE_ID", id).maybeSingle();
  if (existing) {
    const label = String(existing.STATUS_ID) === "2" ? "gebucht" : "als Entwurf angelegt";
    throw { status: 409, message: `Es existiert bereits eine Stornorechnung (${label}) für diese Rechnung` };
  }

  // Clone the row, negate monetary amounts, clear document assets
  const {
    ID: _id, INVOICE_NUMBER: _num, STATUS_ID: _st,
    DOCUMENT_PDF_ASSET_ID: _pdf, DOCUMENT_XML_ASSET_ID: _xml,
    DOCUMENT_XML_PROFILE: _xp, DOCUMENT_XML_RENDERED_AT: _xr,
    DOCUMENT_RENDERED_AT: _dr, DOCUMENT_TEMPLATE_ID: _tpl,
    DOCUMENT_LAYOUT_KEY_SNAPSHOT: _lk, DOCUMENT_THEME_SNAPSHOT_JSON: _th,
    DOCUMENT_LOGO_ASSET_ID_SNAPSHOT: _lo,
    ...rest
  } = orig;

  const cancelRow = {
    ...rest,
    INVOICE_TYPE:         "stornorechnung",
    CANCELS_INVOICE_ID:   parseInt(id, 10),
    STATUS_ID:            1,
    TOTAL_AMOUNT_NET:    -round2(toNum(orig.TOTAL_AMOUNT_NET)),
    TAX_AMOUNT_NET:      -round2(toNum(orig.TAX_AMOUNT_NET)),
    TOTAL_AMOUNT_GROSS:  -round2(toNum(orig.TOTAL_AMOUNT_GROSS)),
  };

  const { data: created, error: insertErr } = await supabase
    .from("INVOICE").insert([cancelRow]).select("ID").single();
  if (insertErr) throw { status: 500, message: insertErr.message };

  const newId = created.ID;

  // Copy INVOICE_STRUCTURE rows with negated amounts so bookInvoice
  // correctly decrements PROJECT_STRUCTURE.INVOICED when booked.
  const { data: structRows } = await supabase
    .from("INVOICE_STRUCTURE")
    .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET, BILLING_TYPE_ID, TENANT_ID")
    .eq("INVOICE_ID", id);

  if (structRows && structRows.length > 0) {
    const newStructRows = structRows.map(r => ({
      INVOICE_ID:       newId,
      STRUCTURE_ID:     r.STRUCTURE_ID,
      AMOUNT_NET:      -round2(toNum(r.AMOUNT_NET)),
      AMOUNT_EXTRAS_NET: -round2(toNum(r.AMOUNT_EXTRAS_NET)),
      BILLING_TYPE_ID:  r.BILLING_TYPE_ID ?? null,
      TENANT_ID:        r.TENANT_ID ?? null,
    }));
    const { error: sErr } = await supabase.from("INVOICE_STRUCTURE").insert(newStructRows);
    if (sErr && !isTableMissingErr(sErr, "invoice_structure")) {
      // Non-fatal: booking will still update PROJECT.INVOICED via TOTAL_AMOUNT_NET
      console.error("[CANCEL_INVOICE][STRUCTURE]", sErr.message);
    }
  }

  // Auto-book: immediately finalise the Stornorechnung so original is marked Storniert at once
  const cancelInv = { ...cancelRow, ID: newId };
  await bookInvoice(supabase, { id: newId, inv: cancelInv });

  return { id: newId };
}

module.exports = {
  // file helpers (also used by controllers)
  streamPdfAsset,
  streamXmlAsset,
  storeGeneratedPdfAsAsset,
  storeGeneratedXmlAsAsset,
  bestEffortDeleteAsset,
  // structure helpers
  loadProjectStructuresForContext,
  loadPreviouslyBilledByStructure,
  sumInvStructureForInvoice,
  writeInvoiceStructureRows,
  recomputeInvoiceTotals,
  applyPerformanceAmount,
  updateBt2FromTec,
  findTecIdsToAutoAssign,
  isTableMissingErr,
  isNullOrZero,
  toNum,
  round2,
  // CRUD
  listInvoices,
  initInvoice,
  patchInvoice,
  getInvoice,
  deleteInvoice,
  cancelInvoice,
  bookInvoice,
  // for einvoice routes
  generateUblInvoiceXml,
};
