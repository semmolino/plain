"use strict";

const { generateUblInvoiceXml } = require("../services_einvoice_ubl");
const { renderDocumentPdf } = require("../services_pdf_render");
const { insertProgressSnapshot } = require("./projectProgress");
const { loadInvoiceData } = require("../services_einvoice_data");
const { validateEInvoiceData } = require("../services_einvoice_validator");
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
  if (!asset) throw new Error("XML asset not found");

  const root = uploadRoot();
  const filePath = path.join(root, asset.STORAGE_KEY);
  if (!fs.existsSync(filePath)) throw new Error("XML file missing on disk");

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

function leafOnly(rows) {
  const parentIds = new Set((rows || []).filter(r => r.FATHER_ID != null).map(r => Number(r.FATHER_ID)));
  return (rows || []).filter(r => !parentIds.has(Number(r.ID)));
}

async function loadProjectStructuresForContext(supabase, { contractId, projectId }) {
  if (contractId) {
    const { data: byContract, error: byContractErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, FATHER_ID, BILLING_TYPE_ID, REVENUE_COMPLETION, EXTRAS_PERCENT")
      .eq("CONTRACT_ID", contractId)
      .eq("IS_INTERNAL", false);

    if (!byContractErr && Array.isArray(byContract) && byContract.length > 0) return leafOnly(byContract);
  }

  const { data: byProject, error: byProjectErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, FATHER_ID, BILLING_TYPE_ID, REVENUE_COMPLETION, EXTRAS_PERCENT")
    .eq("PROJECT_ID", projectId)
    .eq("IS_INTERNAL", false);

  if (byProjectErr) throw new Error(byProjectErr.message);
  return leafOnly(byProject);
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

  const m = new Map();

  // --- Amounts from booked INVOICE rows ---
  // STATUS_ID=2 = gebucht; STATUS_ID=3 = stornoiertes Original (durch eine
  // Stornorechnung neutralisiert). Beide einbeziehen, damit Storno-Paare
  // (Original=3 mit +X, Storno-Rechnung=2 mit -X) auf 0 saldieren. Sonst
  // wirkt nur die negative Storno und der Vorschlag wird viel zu hoch.
  const invStatusIds = bookedStatusId === 2 ? [2, 3] : [bookedStatusId];
  let invQ = supabase.from("INVOICE").select("ID").in("STATUS_ID", invStatusIds);
  if (contractId) invQ = invQ.eq("CONTRACT_ID", contractId);
  else invQ = invQ.eq("PROJECT_ID", projectId);
  if (excludeInvoiceId) invQ = invQ.neq("ID", excludeInvoiceId);

  const { data: invRows, error: invErr } = await invQ;
  if (invErr) throw new Error(invErr.message);

  const invoiceIds = (invRows || []).map((r) => r.ID).filter((x) => x !== null && x !== undefined);
  if (invoiceIds.length > 0) {
    const { data: rows, error } = await supabase
      .from("INVOICE_STRUCTURE")
      .select("STRUCTURE_ID, AMOUNT_NET")
      .in("INVOICE_ID", invoiceIds)
      .in("STRUCTURE_ID", ids);

    if (error && !isTableMissingErr(error, "invoice_structure")) throw new Error(error.message);
    (rows || []).forEach((r) => {
      const sid = String(r.STRUCTURE_ID);
      m.set(sid, round2((m.get(sid) || 0) + toNum(r.AMOUNT_NET)));
    });
  }

  // --- Amounts from booked PARTIAL_PAYMENT rows (must also be subtracted) ---
  // Storno-Paare: Original wird STATUS_ID=3 + Storno hat STATUS_ID=2 mit
  // negierten Beträgen. Beide einbeziehen, damit sie auf 0 saldieren.
  const ppStatusIds = bookedStatusId === 2 ? [2, 3] : [bookedStatusId];
  let ppQ = supabase.from("PARTIAL_PAYMENT").select("ID").in("STATUS_ID", ppStatusIds);
  if (contractId) ppQ = ppQ.eq("CONTRACT_ID", contractId);
  else ppQ = ppQ.eq("PROJECT_ID", projectId);

  const { data: ppRows, error: ppErr } = await ppQ;
  if (!ppErr && ppRows && ppRows.length > 0) {
    const ppIds = ppRows.map((r) => r.ID);
    for (const table of ["PARTIAL_PAYMENT_STRUCTURE", "PARTIAL_PAYMENTS_STRUCTURE"]) {
      const { data: ppsRows, error: ppsErr } = await supabase
        .from(table)
        .select("STRUCTURE_ID, AMOUNT_NET")
        .in("PARTIAL_PAYMENT_ID", ppIds)
        .in("STRUCTURE_ID", ids);
      if (!ppsErr) {
        (ppsRows || []).forEach((r) => {
          const sid = String(r.STRUCTURE_ID);
          m.set(sid, round2((m.get(sid) || 0) + toNum(r.AMOUNT_NET)));
        });
        break;
      }
      const msg = String(ppsErr?.message || "");
      if (!/relation.*does\s+not\s+exist/i.test(msg)) break;
    }
  }

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

async function writeInvoiceStructureRows(supabase, { invoiceId, rows, deleteStructureIds }) {
  const arr = Array.isArray(rows) ? rows : [];
  const toDelete = Array.isArray(deleteStructureIds) && deleteStructureIds.length > 0
    ? deleteStructureIds
    : Array.from(new Set(arr.map((r) => r.STRUCTURE_ID))).filter((x) => x !== null && x !== undefined);

  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("INVOICE_STRUCTURE")
      .delete()
      .eq("INVOICE_ID", invoiceId)
      .in("STRUCTURE_ID", toDelete);
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
    .select("ID, VAT_PERCENT, VAT_ID, CONTRACT_ID, TENANT_ID")
    .eq("ID", invoiceId)
    .maybeSingle();
  if (invErr || !inv) throw new Error("INVOICE konnte nicht geladen werden");

  // Self-Heal VAT_PERCENT: Vertrag → Tenant-Default → höchster VAT-Eintrag
  let vatPct = toNum(inv.VAT_PERCENT);
  let resolvedVatId = inv.VAT_ID ?? null;
  if (vatPct === 0) {
    try {
      if (!resolvedVatId && inv.CONTRACT_ID) {
        const { data: cRow } = await supabase
          .from("CONTRACT").select("VAT_ID").eq("ID", inv.CONTRACT_ID).maybeSingle();
        resolvedVatId = cRow?.VAT_ID ?? null;
      }
      if (!resolvedVatId && inv.TENANT_ID) {
        const { data: settingsRows } = await supabase
          .from("TENANT_SETTINGS").select("VALUE")
          .eq("TENANT_ID", inv.TENANT_ID).eq("KEY", "default_vat_id");
        const defVatId = settingsRows?.[0]?.VALUE;
        if (defVatId) resolvedVatId = Number(defVatId);
      }
      if (!resolvedVatId) {
        const { data: anyVat } = await supabase
          .from("VAT").select("ID").order("VAT_PERCENT", { ascending: false }).limit(1);
        if (anyVat && anyVat.length > 0) resolvedVatId = anyVat[0].ID;
      }
      if (resolvedVatId) {
        const { data: vat } = await supabase
          .from("VAT").select("VAT_PERCENT").eq("ID", resolvedVatId).maybeSingle();
        if (vat?.VAT_PERCENT != null) vatPct = toNum(vat.VAT_PERCENT);
      }
    } catch (_) { /* soft-fail */ }
  }

  const sums = await sumInvStructureForInvoice(supabase, { invoiceId });
  const amountNet = round2(sums.net);
  const amountExtras = round2(sums.extras);
  const totalNet = round2(amountNet + amountExtras);
  const taxAmountNet = round2(totalNet * vatPct / 100);
  const totalGross = round2(totalNet + taxAmountNet);

  const updatePayload = {
    AMOUNT_NET: amountNet,
    AMOUNT_EXTRAS_NET: amountExtras,
    TOTAL_AMOUNT_NET: totalNet,
    TAX_AMOUNT_NET: taxAmountNet,
    TOTAL_AMOUNT_GROSS: totalGross,
  };
  if (vatPct !== 0)     updatePayload.VAT_PERCENT = vatPct;
  if (resolvedVatId)    updatePayload.VAT_ID      = resolvedVatId;

  const { error: upErr } = await supabase
    .from("INVOICE").update(updatePayload).eq("ID", invoiceId);
  if (upErr) throw new Error(upErr.message);

  return {
    amount_net: amountNet, amount_extras_net: amountExtras,
    total_amount_net: totalNet, tax_amount_net: taxAmountNet,
    total_amount_gross: totalGross, vat_percent: vatPct,
  };
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

  await writeInvoiceStructureRows(supabase, { invoiceId, rows, deleteStructureIds: bt1Ids });
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
  const BASE_COLS = "ID, INVOICE_NUMBER, INVOICE_DATE, DUE_DATE, BILLING_PERIOD_START, BILLING_PERIOD_FINISH, TOTAL_AMOUNT_NET, TAX_AMOUNT_NET, TOTAL_AMOUNT_GROSS, TOTAL_DISCOUNTS, DISCOUNT_1_PERCENT, DISCOUNT_2_PERCENT, DISCOUNT_1_REASON, DISCOUNT_2_REASON, CASH_DISCOUNT_PERCENT, CASH_DISCOUNT_DAYS, CASH_DISCOUNT, STATUS_ID, PROJECT_ID, CONTRACT_ID, CONTACT, CONTACT_MAIL, ADDRESS_NAME_1, COMMENT, VAT_ID, VAT_PERCENT, INVOICE_TYPE, CANCELS_INVOICE_ID";
  const SE_COLS = ", SE_AMOUNT, SE_PERCENT, SE_BASIS, SE_RELEASE_TOTAL";
  const buildQuery = (cols) => {
    let q1 = supabase
      .from("INVOICE")
      .select(cols)
      .eq("TENANT_ID", tenantId)
      .order("INVOICE_DATE", { ascending: false })
      .limit(limit);
    if (q) {
      const esc = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
      q1 = q1.or(`INVOICE_NUMBER.ilike.%${esc}%`);
    }
    return q1;
  };
  let { data: rows, error } = await buildQuery(BASE_COLS + SE_COLS);
  if (error && /SE_/.test(error.message || "")) {
    // Migration 0047 nicht gelaufen — Fallback ohne SE-Spalten.
    const r = await buildQuery(BASE_COLS);
    rows = r.data; error = r.error;
  }
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
    BILLING_PERIOD_START: r.BILLING_PERIOD_START ?? null,
    BILLING_PERIOD_FINISH: r.BILLING_PERIOD_FINISH ?? null,
    TOTAL_AMOUNT_NET: r.TOTAL_AMOUNT_NET ?? 0,
    TAX_AMOUNT_NET: r.TAX_AMOUNT_NET ?? 0,
    TOTAL_AMOUNT_GROSS: r.TOTAL_AMOUNT_GROSS ?? 0,
    TOTAL_DISCOUNTS: r.TOTAL_DISCOUNTS ?? null,
    DISCOUNT_1_PERCENT: r.DISCOUNT_1_PERCENT ?? null,
    DISCOUNT_2_PERCENT: r.DISCOUNT_2_PERCENT ?? null,
    DISCOUNT_1_REASON: r.DISCOUNT_1_REASON ?? null,
    DISCOUNT_2_REASON: r.DISCOUNT_2_REASON ?? null,
    CASH_DISCOUNT_PERCENT: r.CASH_DISCOUNT_PERCENT ?? null,
    CASH_DISCOUNT_DAYS: r.CASH_DISCOUNT_DAYS ?? null,
    CASH_DISCOUNT: r.CASH_DISCOUNT ?? null,
    STATUS_ID: r.STATUS_ID ?? null,
    INVOICE_TYPE: r.INVOICE_TYPE ?? null,
    CANCELS_INVOICE_ID: r.CANCELS_INVOICE_ID ?? null,
    PROJECT_ID: r.PROJECT_ID ?? null,
    CONTRACT_ID: r.CONTRACT_ID ?? null,
    VAT_PERCENT: r.VAT_PERCENT ?? null,
    PROJECT: projectMap[r.PROJECT_ID] ?? String(r.PROJECT_ID ?? ""),
    CONTRACT: contractMap[r.CONTRACT_ID] ?? String(r.CONTRACT_ID ?? ""),
    CONTACT: r.CONTACT ?? "",
    CONTACT_MAIL: r.CONTACT_MAIL ?? null,
    ADDRESS_NAME_1: r.ADDRESS_NAME_1 ?? "",
    AMOUNT_PAYED_GROSS: payedGrossMap[r.ID] ?? 0,
    COMMENT: r.COMMENT ?? "",
    SE_AMOUNT:         r.SE_AMOUNT ?? null,
    SE_PERCENT:        r.SE_PERCENT ?? null,
    SE_BASIS:          r.SE_BASIS ?? null,
    SE_RELEASE_TOTAL:  r.SE_RELEASE_TOTAL ?? null,
  }));
}

async function initInvoice(supabase, { companyId, employeeId, projectId, contractId, invoiceType }) {
  const { data: project, error: projectErr } = await supabase
    .from("PROJECT")
    .select("ID, NAME_SHORT, NAME_LONG, TENANT_ID, COMPANY_ID")
    .eq("ID", projectId)
    .maybeSingle();
  if (projectErr || !project) throw { status: 500, message: "Projekt konnte nicht geladen werden" };

  let resolvedCompanyId = companyId || project.COMPANY_ID;
  if (!resolvedCompanyId) {
    const { data: cos } = await supabase.from("COMPANY").select("ID").eq("TENANT_ID", project.TENANT_ID).limit(1);
    resolvedCompanyId = cos?.[0]?.ID ?? null;
  }
  if (!resolvedCompanyId) throw { status: 500, message: "Firma konnte nicht ermittelt werden" };

  const company_q = await supabase
    .from("COMPANY")
    .select(`ID, COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID, POST_OFFICE_BOX, BIC, TAX_NUMBER, IBAN, "TAX-ID", "CREDITOR-ID"`)
    .eq("ID", resolvedCompanyId)
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

  let contractRow = null;
  {
    const { data: c1, error: c1Err } = await supabase
      .from("CONTRACT")
      .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, VAT_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID, VAT_CATEGORY, VAT_EXEMPTION_REASON_CODE, VAT_EXEMPTION_REASON_TEXT")
      .eq("ID", contractId)
      .maybeSingle();
    if (!c1Err && c1) contractRow = c1;
  }
  if (!contractRow) {
    const { data: c2, error: c2Err } = await supabase
      .from("CONTRACTS")
      .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, VAT_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID, VAT_CATEGORY, VAT_EXEMPTION_REASON_CODE, VAT_EXEMPTION_REASON_TEXT")
      .eq("ID", contractId)
      .maybeSingle();
    if (c2Err || !c2) throw { status: 500, message: "Vertrag konnte nicht geladen werden" };
    contractRow = c2;
  }

  // VAT resolution: contract.VAT_ID > TENANT_SETTINGS.default_vat_id
  let effectiveVatId = contractRow.VAT_ID ?? null;
  if (!effectiveVatId) {
    try {
      const { data: projT } = await supabase.from("PROJECT").select("TENANT_ID").eq("ID", projectId).maybeSingle();
      const tenantId = projT?.TENANT_ID ?? null;
      if (tenantId) {
        const { data: settingsRows } = await supabase
          .from("TENANT_SETTINGS").select("KEY, VALUE")
          .eq("TENANT_ID", tenantId).eq("KEY", "default_vat_id");
        const defVatId = settingsRows?.[0]?.VALUE;
        if (defVatId) effectiveVatId = Number(defVatId);
      }
    } catch (_) { /* settings missing — fall through */ }
  }
  let contractVatPercent = null;
  if (effectiveVatId) {
    const { data: vat } = await supabase.from("VAT").select("VAT_PERCENT").eq("ID", effectiveVatId).maybeSingle();
    contractVatPercent = vat?.VAT_PERCENT ?? null;
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
    COMPANY_ID: resolvedCompanyId,
    EMPLOYEE_ID: employeeId,
    PROJECT_ID: projectId,
    CONTRACT_ID: contractId,
    CURRENCY_ID: contractRow.CURRENCY_ID ?? null,
    VAT_ID: effectiveVatId,
    VAT_PERCENT: contractVatPercent,
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
    // E-Rechnung Branch 2 — VAT-Category vom Vertrag uebernehmen
    VAT_CATEGORY:              contractRow.VAT_CATEGORY              ?? 'S',
    VAT_EXEMPTION_REASON_CODE: contractRow.VAT_EXEMPTION_REASON_CODE ?? null,
    VAT_EXEMPTION_REASON_TEXT: contractRow.VAT_EXEMPTION_REASON_TEXT ?? null,
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

  if (body.discount_1_percent  !== undefined) payload.DISCOUNT_1_PERCENT  = body.discount_1_percent  != null ? toNum(body.discount_1_percent)  : null;
  if (body.discount_2_percent  !== undefined) payload.DISCOUNT_2_PERCENT  = body.discount_2_percent  != null ? toNum(body.discount_2_percent)  : null;
  if (body.discount_1_reason   !== undefined) payload.DISCOUNT_1_REASON   = body.discount_1_reason   != null ? String(body.discount_1_reason).trim() || null : null;
  if (body.discount_2_reason   !== undefined) payload.DISCOUNT_2_REASON   = body.discount_2_reason   != null ? String(body.discount_2_reason).trim() || null : null;
  if (body.total_discounts     !== undefined) payload.TOTAL_DISCOUNTS     = body.total_discounts     != null ? toNum(body.total_discounts)     : null;
  if (body.cash_discount_percent !== undefined) payload.CASH_DISCOUNT_PERCENT = body.cash_discount_percent != null ? toNum(body.cash_discount_percent) : null;
  if (body.cash_discount_days    !== undefined) payload.CASH_DISCOUNT_DAYS    = body.cash_discount_days    != null ? parseInt(String(body.cash_discount_days), 10) : null;
  if (body.cash_discount_amount  !== undefined) payload.CASH_DISCOUNT  = body.cash_discount_amount  != null ? toNum(body.cash_discount_amount)  : null;

  // Sicherheitseinbehalt (Phase 1)
  if (body.se_percent       !== undefined) payload.SE_PERCENT       = body.se_percent       != null && body.se_percent !== "" ? toNum(body.se_percent)       : null;
  if (body.se_basis         !== undefined) {
    const v = String(body.se_basis || "").toUpperCase();
    payload.SE_BASIS = v === "NETTO" ? "NETTO" : v === "BRUTTO" ? "BRUTTO" : null;
  }
  if (body.se_basis_amt     !== undefined) payload.SE_BASIS_AMT     = body.se_basis_amt     != null && body.se_basis_amt !== "" ? toNum(body.se_basis_amt)     : null;
  if (body.se_amount        !== undefined) payload.SE_AMOUNT        = body.se_amount        != null && body.se_amount !== "" ? toNum(body.se_amount)        : null;
  if (body.se_release_total !== undefined) payload.SE_RELEASE_TOTAL = body.se_release_total != null && body.se_release_total !== "" ? toNum(body.se_release_total) : null;

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

  // E-Rechnung Branch 1 — Quick-Win-BT-Felder (BT-10/13/19/83)
  if (body.buyer_reference          !== undefined) payload.BUYER_REFERENCE             = String(body.buyer_reference          || "").trim() || null;
  if (body.buyer_order_reference    !== undefined) payload.BUYER_ORDER_REFERENCE       = String(body.buyer_order_reference    || "").trim() || null;
  if (body.buyer_accounting_reference !== undefined) payload.BUYER_ACCOUNTING_REFERENCE = String(body.buyer_accounting_reference || "").trim() || null;
  if (body.remittance_information   !== undefined) payload.REMITTANCE_INFORMATION      = String(body.remittance_information   || "").trim() || null;

  // E-Rechnung Branch 2 — VAT-Category + Exemption (BT-118 / BT-120-123)
  if (body.vat_category !== undefined) {
    const cat = String(body.vat_category || "S").toUpperCase();
    if (!['S','AE','E','Z','O','G','K'].includes(cat)) {
      throw { status: 400, message: `Ungueltige Umsatzsteuer-Kategorie: ${cat}` };
    }
    payload.VAT_CATEGORY = cat;
  }
  if (body.vat_exemption_reason_code !== undefined) payload.VAT_EXEMPTION_REASON_CODE = String(body.vat_exemption_reason_code || "").trim() || null;
  if (body.vat_exemption_reason_text !== undefined) payload.VAT_EXEMPTION_REASON_TEXT = String(body.vat_exemption_reason_text || "").trim() || null;

  // Steuer + Brutto neu berechnen wenn VAT_PERCENT oder VAT_CATEGORY geaendert wurde.
  const effectiveCategory = payload.VAT_CATEGORY ?? currentInv.VAT_CATEGORY ?? 'S';
  if (payload.VAT_PERCENT !== undefined || payload.VAT_CATEGORY !== undefined) {
    const totalNet = toNum(currentInv.TOTAL_AMOUNT_NET);
    if (effectiveCategory === 'S') {
      const vatPercent = toNum(payload.VAT_PERCENT ?? currentInv.VAT_PERCENT);
      payload.TAX_AMOUNT_NET     = round2(totalNet * vatPercent / 100);
      payload.TOTAL_AMOUNT_GROSS = round2(totalNet + payload.TAX_AMOUNT_NET);
    } else {
      // Reverse-Charge / steuerfrei: kein Steuerbetrag im Rechnungstotal
      payload.TAX_AMOUNT_NET     = 0;
      payload.TOTAL_AMOUNT_GROSS = totalNet;
    }
  }

  if (Object.keys(payload).length === 0) return { ok: true };

  let { error: upErr } = await supabase.from("INVOICE").update(payload).eq("ID", id);
  if (upErr && String(upErr.message || "").includes("SE_")) {
    // Migration 0047 not yet run — retry without SE fields
    const stripped = { ...payload };
    delete stripped.SE_PERCENT; delete stripped.SE_BASIS; delete stripped.SE_BASIS_AMT; delete stripped.SE_AMOUNT; delete stripped.SE_RELEASE_TOTAL;
    const r = await supabase.from("INVOICE").update(stripped).eq("ID", id);
    upErr = r.error;
  }
  if (upErr) throw { status: 500, message: upErr.message };

  return { ok: true };
}

async function getInvoice(supabase, { id, tenantId }) {
  const { data: inv, error } = await supabase.from("INVOICE").select("*").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
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

async function deleteInvoice(supabase, { id, tenantId }) {
  const { data: inv, error: invErr } = await supabase.from("INVOICE").select("ID, STATUS_ID").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
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

  const { error: delErr } = await supabase.from("INVOICE").delete().eq("ID", id).eq("TENANT_ID", tenantId);
  if (delErr) throw new Error(delErr.message);
}

async function bookInvoice(supabase, { id, inv, releasePpIds = [], tenantId = null, force = false }) {
  // ── E-Rechnung Vorpruefung (Branch 6) ─────────────────────────────────────
  // Validiert gegen die EN16931 Business-Rules BEVOR irgendetwas persistiert
  // wird (SE-Auflosung, PDF, XML, Status-Update). Bei Fehlern wirft die
  // Funktion mit status 422 + Validierungs-Details; Frontend kann mit
  // force=true uebersteuern (z.B. Notbuchung).
  try {
    const data = await loadInvoiceData(supabase, parseInt(id, 10), "INVOICE", tenantId);
    const v = validateEInvoiceData(data);
    if (!v.ok && !force) {
      const err = new Error(`E-Rechnung Validierung fehlgeschlagen: ${v.errors.length} Fehler`);
      err.status = 422;
      err.validation = v;
      throw err;
    }
  } catch (e) {
    if (e?.status === 422 && e?.validation) throw e;
    // Falls loadInvoiceData scheitert (z.B. Beleg unvollstaendig),
    // brechen wir mit klarer Meldung ab statt durchzulaufen.
    console.warn("[BOOK_INVOICE][VALIDATE]", { invoice_id: id, error: e?.message });
    if (!force) {
      const err = new Error(`Vorpruefung konnte nicht abgeschlossen werden: ${e?.message || e}`);
      err.status = 422;
      err.validation = { ok: false, errors: [{ code: 'BR-LOAD', severity: 'error', message: err.message, btField: null }], warnings: [] };
      throw err;
    }
  }

  const vatPercent = toNum(inv.VAT_PERCENT);
  const totalNet = toNum(inv.TOTAL_AMOUNT_NET);
  const taxAmountNet = round2(totalNet * vatPercent / 100);
  const totalGross = round2(totalNet + taxAmountNet);

  // ── Sicherheitseinbehalt-Auflösung (Phase 2) ──────────────────────────────
  // For Schluss-/Teilschlussrechnungen, release the selected open SE from
  // prior Abschlagsrechnungen BEFORE rendering the PDF so the PDF can
  // reflect SE_RELEASE_TOTAL.
  let seReleaseTotal = 0;
  if (Array.isArray(releasePpIds) && releasePpIds.length > 0) {
    try {
      // Load each PP's SE_AMOUNT (and double-check it's still open + same project)
      const { data: pps, error: ppsErr } = await supabase
        .from("PARTIAL_PAYMENT")
        .select("ID, SE_AMOUNT, SE_RELEASED_BY_INVOICE_ID, PROJECT_ID, TENANT_ID")
        .in("ID", releasePpIds);
      if (ppsErr) throw new Error(ppsErr.message);

      const validPps = (pps || []).filter(p =>
        Number(p.SE_AMOUNT || 0) > 0 &&
        p.SE_RELEASED_BY_INVOICE_ID == null &&
        (tenantId == null || p.TENANT_ID == tenantId) &&
        (inv.PROJECT_ID == null || p.PROJECT_ID == inv.PROJECT_ID)
      );

      for (const pp of validPps) {
        const amt = round2(Number(pp.SE_AMOUNT || 0));
        seReleaseTotal = round2(seReleaseTotal + amt);
        const { error: upPpErr } = await supabase
          .from("PARTIAL_PAYMENT")
          .update({ SE_RELEASED_BY_INVOICE_ID: parseInt(id, 10) })
          .eq("ID", pp.ID);
        if (upPpErr) throw new Error(upPpErr.message);

        // Audit trail (soft-fail if migration 0048 not yet run)
        try {
          await supabase.from("SE_RELEASE").insert({
            TENANT_ID:           tenantId || pp.TENANT_ID,
            PARTIAL_PAYMENT_ID:  pp.ID,
            INVOICE_ID:          parseInt(id, 10),
            SE_AMOUNT_RELEASED:  amt,
          });
        } catch (_) { /* ignore — audit table may not exist yet */ }
      }

      if (seReleaseTotal > 0) {
        // Persist on INVOICE (soft-fail if SE_RELEASE_TOTAL column missing)
        const { error: invUpErr } = await supabase.from("INVOICE")
          .update({ SE_RELEASE_TOTAL: seReleaseTotal })
          .eq("ID", id);
        if (invUpErr && String(invUpErr.message || "").includes("SE_")) {
          // schema lacks column — keep going, just no persisted total
        } else if (invUpErr) {
          throw new Error(invUpErr.message);
        }
      }
    } catch (e) {
      throw { status: 500, message: `Sicherheitseinbehalt-Auflösung fehlgeschlagen: ${e?.message || e}` };
    }
  }

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

        // PROJECT_PROGRESS: carry-forward snapshot + INVOICED delta
        const invProgressRows = structureIds.map((sid) => ({
          TENANT_ID:    inv.TENANT_ID ?? null,
          STRUCTURE_ID: sid,
          INVOICED:     round2(addByStructure.get(String(sid)) || 0),
        }));
        if (invProgressRows.length > 0) {
          const { error: invProgErr } = await insertProgressSnapshot(supabase, invProgressRows);
          if (invProgErr) console.error("[BOOK_INVOICE][PROGRESS]", invProgErr.message);
        }
      }
    }
  } catch (e) {
    await supabase.from("INVOICE").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null }).eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    throw { status: 500, message: `PROJECT_STRUCTURE konnte nicht aktualisiert werden: ${e?.message || e}` };
  }

  // If this is a Stornorechnung, mark the original invoice as cancelled
  if (inv.CANCELS_INVOICE_ID) {
    await supabase.from("INVOICE").update({
      STATUS_ID: 3,
      CANCELLATION_DATE: new Date().toISOString().slice(0, 10),
    }).eq("ID", inv.CANCELS_INVOICE_ID);
  }

  return { success: true, number: inv.INVOICE_NUMBER || null, pdf_asset_id: pdfAsset?.ID ?? null };
}

// ---------------------------------------------------------------------------
// cancelInvoice – create a draft Stornorechnung for a booked invoice
// The original is marked STATUS_ID=3 only when the Stornorechnung is booked.
// ---------------------------------------------------------------------------
async function cancelInvoice(supabase, { id, tenantId, deletePayments = false }) {
  const { data: orig, error: origErr } = await supabase
    .from("INVOICE").select("*").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
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

  const isFinalInvoice = orig.INVOICE_TYPE === "schlussrechnung" || orig.INVOICE_TYPE === "teilschlussrechnung";

  // ── Phase 5: Sicherheitseinbehalt-Reversal ───────────────────────────────
  // If this is a Schluss-/Teilschluss invoice that released SE from prior ARs,
  // reverse the release: set SE_RELEASED_BY_INVOICE_ID = NULL on those ARs.
  // SE_RELEASE audit rows stay for history.
  if (isFinalInvoice) {
    try {
      const { data: linkedPps } = await supabase
        .from("PARTIAL_PAYMENT")
        .select("ID, SE_AMOUNT")
        .eq("SE_RELEASED_BY_INVOICE_ID", parseInt(id, 10));
      const ppCount = (linkedPps || []).length;
      if (ppCount > 0) {
        const totalReversed = (linkedPps || []).reduce((s, p) => s + Number(p.SE_AMOUNT || 0), 0);
        console.log(`[CANCEL_INVOICE] Reversing SE release: ${ppCount} PP(s), total ${totalReversed.toFixed(2)} EUR (invoice ${id})`);
        await supabase
          .from("PARTIAL_PAYMENT")
          .update({ SE_RELEASED_BY_INVOICE_ID: null })
          .eq("SE_RELEASED_BY_INVOICE_ID", parseInt(id, 10));
      }
    } catch (e) {
      // Schema may not have SE columns yet — log but don't fail the storno
      console.warn(`[CANCEL_INVOICE] SE reversal skipped (schema missing?): ${e?.message || e}`);
    }
  }

  // ── Optional: delete existing payments for this invoice ──────────────────
  if (deletePayments) {
    const { data: payments } = await supabase
      .from("PAYMENT")
      .select("ID, AMOUNT_PAYED_NET, PROJECT_ID")
      .eq("INVOICE_ID", id)
      .eq("TENANT_ID", tenantId);

    for (const payment of payments || []) {
      const { data: psRows } = await supabase
        .from("PAYMENT_STRUCTURE")
        .select("STRUCTURE_ID, AMOUNT_PAYED_NET")
        .eq("PAYMENT_ID", payment.ID);

      await supabase.from("PAYMENT_STRUCTURE").delete().eq("PAYMENT_ID", payment.ID);
      await supabase.from("PAYMENT").delete().eq("ID", payment.ID);

      // Insert PROJECT_PROGRESS reversal rows with carry-forward
      if (psRows && psRows.length > 0) {
        await insertProgressSnapshot(supabase, psRows.map(r => ({
          TENANT_ID:    tenantId ?? null,
          STRUCTURE_ID: r.STRUCTURE_ID,
          PAYED:        -round2(toNum(r.AMOUNT_PAYED_NET)),
        })));
      }
    }

    // Re-sum PROJECT.PAYED from remaining payments
    const { data: remainingPay } = await supabase
      .from("PAYMENT").select("AMOUNT_PAYED_NET").eq("PROJECT_ID", orig.PROJECT_ID).eq("TENANT_ID", tenantId);
    const newPayed = round2((remainingPay || []).reduce((s, r) => s + toNum(r.AMOUNT_PAYED_NET), 0));
    await supabase.from("PROJECT").update({ PAYED: newPayed }).eq("ID", orig.PROJECT_ID);

    // Re-sum PROJECT_STRUCTURE.PAYED per affected leaf
    const affectedSids = [...new Set((payments || []).flatMap(p => {
      // We need structure IDs — they were already deleted above, so we rely on PAYMENT_STRUCTURE
      // being already gone. Use the psRows captured before deletion.
      return [];
    }))];
    // Re-aggregate all structure PAYED values for this project from remaining PAYMENT_STRUCTURE
    const { data: remainingPS } = await supabase
      .from("PAYMENT_STRUCTURE").select("STRUCTURE_ID, AMOUNT_PAYED_NET").eq("TENANT_ID", tenantId);
    const payedByStructure = new Map();
    for (const r of remainingPS || []) {
      const sid = String(r.STRUCTURE_ID);
      payedByStructure.set(sid, round2((payedByStructure.get(sid) ?? 0) + toNum(r.AMOUNT_PAYED_NET)));
    }
    if (payedByStructure.size > 0) {
      const upserts = [...payedByStructure.entries()].map(([sid, payed]) => ({
        ID: parseInt(sid, 10), PAYED: payed,
      }));
      await supabase.from("PROJECT_STRUCTURE").upsert(upserts);
    }
  }

  // Clone the row, negate monetary amounts, set S- prefix, clear document assets
  const {
    ID: _id, INVOICE_NUMBER: _num, STATUS_ID: _st,
    DOCUMENT_PDF_ASSET_ID: _pdf, DOCUMENT_XML_ASSET_ID: _xml,
    DOCUMENT_XML_PROFILE: _xp, DOCUMENT_XML_RENDERED_AT: _xr,
    DOCUMENT_RENDERED_AT: _dr, DOCUMENT_TEMPLATE_ID: _tpl,
    DOCUMENT_LAYOUT_KEY_SNAPSHOT: _lk, DOCUMENT_THEME_SNAPSHOT_JSON: _th,
    DOCUMENT_LOGO_ASSET_ID_SNAPSHOT: _lo,
    CANCELLATION_DATE: _cd,
    ...rest
  } = orig;

  const cancelRow = {
    ...rest,
    INVOICE_NUMBER:       `S-${orig.INVOICE_NUMBER || ""}`,
    INVOICE_TYPE:         "stornorechnung",
    CANCELS_INVOICE_ID:   parseInt(id, 10),
    STATUS_ID:            1,
    TOTAL_AMOUNT_NET:    -round2(toNum(orig.TOTAL_AMOUNT_NET)),
    TAX_AMOUNT_NET:      -round2(toNum(orig.TAX_AMOUNT_NET)),
    TOTAL_AMOUNT_GROSS:  -round2(toNum(orig.TOTAL_AMOUNT_GROSS)),
  };

  // SE-Beträge negieren (nur wenn die Spalten existieren — Pre-0047 schickt
  // sie schlicht nicht mit), damit die Storno-Zeile in Rechnungsliste +
  // Reporting korrekt spiegelt (Original 18011.53 → Storno -18011.53).
  if ("SE_AMOUNT" in orig)        cancelRow.SE_AMOUNT        = orig.SE_AMOUNT        != null ? -round2(toNum(orig.SE_AMOUNT))        : null;
  if ("SE_BASIS_AMT" in orig)     cancelRow.SE_BASIS_AMT     = orig.SE_BASIS_AMT     != null ? -round2(toNum(orig.SE_BASIS_AMT))     : null;
  if ("SE_RELEASE_TOTAL" in orig) cancelRow.SE_RELEASE_TOTAL = orig.SE_RELEASE_TOTAL != null ? -round2(toNum(orig.SE_RELEASE_TOTAL)) : null;

  const { data: created, error: insertErr } = await supabase
    .from("INVOICE").insert([cancelRow]).select("ID").single();
  if (insertErr) throw { status: 500, message: insertErr.message };

  const newId = created.ID;

  // Copy INVOICE_STRUCTURE rows with negated amounts
  const { data: structRows, error: structSelErr } = await supabase
    .from("INVOICE_STRUCTURE")
    .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET, TENANT_ID")
    .eq("INVOICE_ID", id);
  if (structSelErr && !isTableMissingErr(structSelErr, "invoice_structure")) {
    throw { status: 500, message: `INVOICE_STRUCTURE lesen fehlgeschlagen: ${structSelErr.message}` };
  }

  if (structRows && structRows.length > 0) {
    const newStructRows = structRows.map(r => ({
      INVOICE_ID:        newId,
      STRUCTURE_ID:      r.STRUCTURE_ID,
      AMOUNT_NET:       -round2(toNum(r.AMOUNT_NET)),
      AMOUNT_EXTRAS_NET: -round2(toNum(r.AMOUNT_EXTRAS_NET)),
      TENANT_ID:         r.TENANT_ID ?? null,
    }));
    const { error: sErr } = await supabase.from("INVOICE_STRUCTURE").insert(newStructRows);
    if (sErr && !isTableMissingErr(sErr, "invoice_structure")) {
      throw { status: 500, message: `INVOICE_STRUCTURE copy failed: ${sErr.message}` };
    }
  }

  // Auto-book: immediately finalise the Stornorechnung
  const cancelInv = { ...cancelRow, ID: newId };
  await bookInvoice(supabase, { id: newId, inv: cancelInv });

  // ── Post-booking cleanup ──────────────────────────────────────────────────

  // Reopen PROJECT_STRUCTURE entries that were closed by this invoice
  await supabase.from("PROJECT_STRUCTURE")
    .update({ CLOSED_BY_INVOICE_ID: null })
    .eq("CLOSED_BY_INVOICE_ID", id);

  // For Schlussrechnung/Teilschlussrechnung: unlink PARTIAL_PAYMENTs that were
  // closed by this invoice (they should become "open" again for a new Schlussrechnung)
  if (isFinalInvoice) {
    await supabase.from("PARTIAL_PAYMENT")
      .update({ INVOICE_ID: null })
      .eq("INVOICE_ID", id);
  }

  // Unlink TEC bookings so they can be re-invoiced
  await supabase.from("TEC").update({ INVOICE_ID: null }).eq("INVOICE_ID", id);

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
