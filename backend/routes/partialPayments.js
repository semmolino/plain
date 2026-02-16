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

async function streamXmlAsset({ supabase, res, assetId, dispositionName, download }) {
  const asset = await loadAssetRow({ supabase, assetId });
  if (!asset) return res.status(404).json({ error: "XML asset not found" });

  const root = uploadRoot();
  const filePath = path.join(root, asset.STORAGE_KEY);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "XML file missing on disk" });

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  const disp = download ? "attachment" : "inline";
  res.setHeader(
    "Content-Disposition",
    `${disp}; filename="${encodeURIComponent(dispositionName || asset.FILE_NAME || "document.xml")}"`
  );
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function storeGeneratedXmlAsAsset({ supabase, companyId, fileName, xmlString, assetType }) {
  const root = uploadRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

  const uuid = crypto.randomUUID();
  const dir = path.join(root, String(companyId), "generated");
  fs.mkdirSync(dir, { recursive: true });

  const outName = `${uuid}.xml`;
  const absPath = path.join(dir, outName);
  fs.writeFileSync(absPath, String(xmlString ?? ""), "utf8");

  const storageKey = path.relative(root, absPath).replace(/\\/g, "/");
  const buf = Buffer.from(String(xmlString ?? ""), "utf8");
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  const row = {
    COMPANY_ID: companyId,
    ASSET_TYPE: assetType || "XML",
    FILE_NAME: safeFileName(fileName, "document.xml"),
    MIME_TYPE: "application/xml",
    FILE_SIZE: buf.length,
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

// Partial payment wizard backend
// Base path: /api/partial-payments
module.exports = (supabase) => {
  const router = express.Router();

  // ----------------------------
  // Stage A: PDF Rendering
  // ----------------------------
  // GET /api/partial-payments/:id/pdf?template_id=...&preview=1
  router.get("/:id/pdf", async (req, res) => {
    try {
      const ppId = parseInt(req.params.id, 10);
      if (!ppId || Number.isNaN(ppId)) return res.status(400).json({ error: "invalid id" });

      const preview = String(req.query.preview || "") === "1";
      const download = String(req.query.download || "") === "1";
      const templateId = req.query.template_id ? parseInt(String(req.query.template_id), 10) : null;

      // If booked and a snapshot PDF exists, serve it (unless preview requested)
      if (!preview) {
        const { data: ppRow, error: ppRowErr } = await supabase
          .from("PARTIAL_PAYMENT")
          .select("ID, STATUS_ID, DOCUMENT_PDF_ASSET_ID, PARTIAL_PAYMENT_NUMBER")
          .eq("ID", ppId)
          .maybeSingle();

        if (!ppRowErr && ppRow && String(ppRow.STATUS_ID) === "2" && ppRow.DOCUMENT_PDF_ASSET_ID) {
          const fname = `Abschlagsrechnung_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.pdf`;
          return streamPdfAsset({ supabase, res, assetId: ppRow.DOCUMENT_PDF_ASSET_ID, dispositionName: fname, download });
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
  });

  // Helper: safe numeric
  const toNum = (v) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : 0;
  };

  // Helper: round to 2 decimals (money)
  const round2 = (v) => {
    const n = toNum(v);
    return Math.round(n * 100) / 100;
  };

  // Helper: treat null/undefined/0/"0" as unassigned
  const isNullOrZero = (v) => v === null || v === undefined || String(v) === "0";

  const isUninvoiced = (invoiceId) => invoiceId === null || invoiceId === undefined || String(invoiceId) === "0" || String(invoiceId) === "2";

  async function loadProjectStructuresForContext({ contractId, projectId }) {
    // Prefer CONTRACT_ID if the schema supports it; fall back to PROJECT_ID.
    // Some installations do not have CONTRACT_ID on PROJECT_STRUCTURE.
    if (contractId) {
      const { data: byContract, error: byContractErr } = await supabase
        .from("PROJECT_STRUCTURE")
        .select("ID, BILLING_TYPE_ID, REVENUE_COMPLETION, EXTRAS_PERCENT")
        .eq("CONTRACT_ID", contractId);

      if (!byContractErr && Array.isArray(byContract) && byContract.length > 0) {
        return byContract;
      }
    }

    const { data: byProject, error: byProjectErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, BILLING_TYPE_ID, REVENUE_COMPLETION, EXTRAS_PERCENT")
      .eq("PROJECT_ID", projectId);

    if (byProjectErr) throw new Error(byProjectErr.message);
    return byProject || [];
  }

  async function sumTecForStructures({ structureIds, partialPaymentId }) {
    if (!Array.isArray(structureIds) || structureIds.length === 0) {
      return { tecRows: [], eligible: [], assignedSum: 0, toAssignIds: [] };
    }

    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("ID, SP_TOT, PARTIAL_PAYMENT_ID, INVOICE_ID, STRUCTURE_ID")
      .in("STRUCTURE_ID", structureIds);

    if (tecErr) throw new Error(tecErr.message);

    const eligible = (tecRows || []).filter((t) => {
      // allow only uninvoiced
      if (!isUninvoiced(t.INVOICE_ID)) return false;

      // allow unassigned or already assigned to this partial payment
      const ppId = t.PARTIAL_PAYMENT_ID;
      return isNullOrZero(ppId) || String(ppId) === String(partialPaymentId);
    });

    const toAssignIds = eligible.filter((t) => isNullOrZero(t.PARTIAL_PAYMENT_ID)).map((t) => t.ID);

    // Sum of rows that are (or will be) assigned to this PP
    const assignedSum = round2(
      eligible.reduce((acc, t) => {
        const isAssigned = String(t.PARTIAL_PAYMENT_ID) === String(partialPaymentId) || toAssignIds.includes(t.ID);
        return acc + (isAssigned ? toNum(t.SP_TOT) : 0);
      }, 0)
    );

    return { tecRows: tecRows || [], eligible, assignedSum, toAssignIds };
  }

  // --- PARTIAL_PAYMENT_STRUCTURE helpers ---

  // IMPORTANT: Your DB objects are UPPERCASE.
  // In PostgreSQL, quoted identifiers are case-sensitive. Supabase/PostgREST can still access them,
  // but you must reference the resource name EXACTLY as it exists (without embedding quotes in the string).
  //
  // Your table is named: PARTIAL_PAYMENT_STRUCTURE
  // Earlier iterations mistakenly used: PARTIAL_PAYMENT_STRUCTURE (missing underscore)
  // We therefore try both, in this order, to keep older installs working.
  const PPS_TABLE_CANDIDATES = ["PARTIAL_PAYMENT_STRUCTURE", "PARTIAL_PAYMENT_STRUCTURE"];

  const isMissingPpsRelation = (err) => {
    const msg = String(err?.message || "");
    // Match common variations (lowercased by PostgreSQL when unquoted, or exact UPPERCASE)
    return (
      /relation\s+\"public\.(partial_payment_structure|partial_payment_structure|PARTIAL_PAYMENT_STRUCTURE|PARTIAL_PAYMENT_STRUCTURE)\"/i.test(msg) &&
      /does\s+not\s+exist/i.test(msg)
    );
  };

  const execWithPpsTableFallback = async (makeQuery) => {
    let lastError = null;
    for (const table of PPS_TABLE_CANDIDATES) {
      // makeQuery must return a PostgREST query builder; awaiting executes it
      const resp = await makeQuery(table);
      if (!resp?.error) return resp;
      lastError = resp.error;
      if (!isMissingPpsRelation(resp.error)) break; // only retry for the specific missing-relation case
    }
    return { data: null, error: lastError };
  };

  async function loadPreviouslyBilledByStructure({ contractId, projectId, structureIds, excludePartialPaymentId, bookedStatusId = 2 }) {
    if (!Array.isArray(structureIds) || structureIds.length === 0) return new Map();

    // IMPORTANT:
    // Do NOT rely on PostgREST relationship joins here.
    // Many installations create PARTIAL_PAYMENT_STRUCTURE without FK constraints,
    // which would make relationship-based selects fail.
    // We therefore resolve eligible PARTIAL_PAYMENT IDs first, then sum PPS rows.

    let ppQ = supabase.from("PARTIAL_PAYMENT").select("ID");
    if (contractId !== null && contractId !== undefined) {
      ppQ = ppQ.eq("CONTRACT_ID", contractId);
    } else if (projectId !== null && projectId !== undefined) {
      ppQ = ppQ.eq("PROJECT_ID", projectId);
    }
    if (bookedStatusId !== null && bookedStatusId !== undefined) {
      ppQ = ppQ.eq("STATUS_ID", bookedStatusId);
    }
    if (excludePartialPaymentId) {
      ppQ = ppQ.neq("ID", excludePartialPaymentId);
    }

    const { data: ppRows, error: ppErr } = await ppQ;
    if (ppErr) throw new Error(ppErr.message);
    const ppIds = (ppRows || []).map((r) => r.ID);
    if (ppIds.length === 0) return new Map();

    const { data, error } = await execWithPpsTableFallback((table) =>
      supabase.from(table).select("STRUCTURE_ID, AMOUNT_NET").in("STRUCTURE_ID", structureIds).in("PARTIAL_PAYMENT_ID", ppIds)
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

  async function sumPpsForPartialPayment({ partialPaymentId, structureIds }) {
    const { data, error } = await execWithPpsTableFallback((table) => {
      let q = supabase
        .from(table)
        .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
        .eq("PARTIAL_PAYMENT_ID", partialPaymentId);
      if (Array.isArray(structureIds) && structureIds.length > 0) q = q.in("STRUCTURE_ID", structureIds);
      return q;
    });
    if (error) throw new Error(error.message);
    const sum = (data || []).reduce(
      (acc, r) => {
        acc.net += toNum(r.AMOUNT_NET);
        acc.extras += toNum(r.AMOUNT_EXTRAS_NET);
        return acc;
      },
      { net: 0, extras: 0 }
    );
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
        // Put remainder into last line
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

  async function writePpsRows({ partialPaymentId, structureIds, rows }) {
    // Delete existing rows for these structures (within this PP), then insert new ones
    if (Array.isArray(structureIds) && structureIds.length > 0) {
      const { error: delErr } = await execWithPpsTableFallback((table) =>
        supabase.from(table).delete().eq("PARTIAL_PAYMENT_ID", partialPaymentId).in("STRUCTURE_ID", structureIds)
      );
      if (delErr) throw new Error(delErr.message);
    }

    const toInsert = (rows || []).filter((r) => toNum(r.AMOUNT_NET) !== 0 || toNum(r.AMOUNT_EXTRAS_NET) !== 0);
    if (toInsert.length > 0) {
      const { error: insErr } = await execWithPpsTableFallback((table) => supabase.from(table).insert(toInsert));
      if (insErr) throw new Error(insErr.message);
    }
  }

  async function recomputePartialPaymentTotals(partialPaymentId) {
    const { data: pp, error: ppErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("ID, VAT_PERCENT")
      .eq("ID", partialPaymentId)
      .maybeSingle();
    if (ppErr || !pp) throw new Error("PARTIAL_PAYMENT konnte nicht geladen werden");

    const sums = await sumPpsForPartialPayment({ partialPaymentId });
    const amountNet = sums.net;
    const amountExtras = sums.extras;
    const totalNet = round2(amountNet + amountExtras);
    const vatPercent = toNum(pp.VAT_PERCENT);
    const taxAmountNet = round2(totalNet * vatPercent / 100);
    const totalGross = round2(totalNet + taxAmountNet);

    const { error: upErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .update({
        AMOUNT_NET: amountNet,
        AMOUNT_EXTRAS_NET: amountExtras,
        TOTAL_AMOUNT_NET: totalNet,
        TAX_AMOUNT_NET: taxAmountNet,
        TOTAL_AMOUNT_GROSS: totalGross,
      })
      .eq("ID", partialPaymentId);

    if (upErr) throw new Error(upErr.message);
    return {
      amount_net: amountNet,
      amount_extras_net: amountExtras,
      total_amount_net: totalNet,
      tax_amount_net: taxAmountNet,
      total_amount_gross: totalGross,
    };
  }

  async function applyPerformanceAmount({ partialPaymentId, contractId, projectId, amount }) {
    const structures = await loadProjectStructuresForContext({ contractId, projectId });
    const bt1 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1);
    const bt1Ids = bt1.map((s) => s.ID);

    if (bt1Ids.length === 0) {
      // No BT=1 structures -> amount must be 0
      if (round2(amount) !== 0) throw new Error("Keine abrechenbaren Elemente nach Leistungsstand (BT=1)");
      return { performance_amount: 0, bt1Ids: [] };
    }

    const prev = await loadPreviouslyBilledByStructure({
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
      };
    });

    await writePpsRows({ partialPaymentId, structureIds: idList, rows });

    const perfSum = round2(rows.reduce((acc, r) => acc + toNum(r.AMOUNT_NET), 0));
    return { performance_amount: perfSum, bt1Ids: idList };
  }

  async function updateBt2FromTec({ partialPaymentId, contractId, projectId }) {
    const structures = await loadProjectStructuresForContext({ contractId, projectId });
    const bt2 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2);
    const bt2Ids = bt2.map((s) => s.ID);
    const idList = bt2Ids.map((x) => String(x));
    if (bt2Ids.length === 0) {
      return { bookings_sum: 0, bt2Ids: [] };
    }

    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("STRUCTURE_ID, SP_TOT")
      .eq("PARTIAL_PAYMENT_ID", partialPaymentId)
      .in("STRUCTURE_ID", bt2Ids);
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
      };
    });

    await writePpsRows({ partialPaymentId, structureIds: idList, rows });

    const bookingsSum = round2(Array.from(bySid.values()).reduce((acc, v) => acc + toNum(v), 0));
    return { bookings_sum: bookingsSum, bt2Ids: idList };
  }


  // Helper: resolve COUNTRY name
  async function getCountryNameLong(countryId) {
    if (!countryId) return null;
    const { data, error } = await supabase
      .from("COUNTRY")
      .select("NAME_LONG")
      .eq("ID", countryId)
      .maybeSingle();
    if (error) return null;
    return data?.NAME_LONG ?? null;
  }

  async function getCountryNameShort(countryId) {
    if (!countryId) return null;
    const { data, error } = await supabase
      .from("COUNTRY")
      .select("NAME_SHORT")
      .eq("ID", countryId)
      .maybeSingle();
    if (error) return null;
    return data?.NAME_SHORT ?? null;
  }

// Helper: resolve SALUTATION text by ID (EMPLOYEE.SALUTATION_ID -> SALUTATION.SALUTATION)
async function getSalutationText(salutationId) {
  if (!salutationId) return null;
  const { data, error } = await supabase
    .from("SALUTATION")
    .select("SALUTATION")
    .eq("ID", salutationId)
    .maybeSingle();
  if (error) return null;
  return data?.SALUTATION ?? null;
}



  // Create draft row after page 1
  // POST /api/partial-payments/init
  router.post("/init", async (req, res) => {
    const b = req.body || {};

    const companyId = b.company_id;
    const employeeId = b.employee_id;
    const projectId = b.project_id;
    const contractId = b.contract_id;

    if (!companyId || !employeeId || !projectId || !contractId) {
      return res.status(400).json({ error: "Pflichtfelder fehlen (Firma/Mitarbeiter/Projekt/Vertrag)" });
    }

    // --- COMPANY ---
    const { data: company, error: companyErr } = await supabase
      .from("COMPANY")
      .select(
        `ID, COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID, POST_OFFICE_BOX, BIC, TAX_NUMBER, IBAN, "TAX-ID", "CREDITOR-ID"`
      )
      .eq("ID", companyId)
      .maybeSingle();
    if (companyErr || !company) {
      return res.status(500).json({ error: "Firma konnte nicht geladen werden" });
    }

    const companyCountryLong = await getCountryNameLong(company.COUNTRY_ID);

    // --- EMPLOYEE ---
    // IMPORTANT: In some environments the EMPLOYEE table may not yet include SALUTATION_ID.
    // We therefore try with SALUTATION_ID first, and fall back to a minimal select if the column is missing.
    const empId = (() => {
      const n = parseInt(String(employeeId), 10);
      return Number.isFinite(n) ? n : employeeId;
    })();

    let employee = null;
    let employeeSalutation = null;

    const { data: emp1, error: empErr1 } = await supabase
      .from("EMPLOYEE")
      // EMPLOYEE schema uses MAIL (not EMAIL)
      .select("ID, FIRST_NAME, LAST_NAME, SHORT_NAME, MAIL, MOBILE, SALUTATION_ID")
      .eq("ID", empId)
      .maybeSingle();

    if (empErr1) {
      // Fallback: retry without SALUTATION_ID (prevents wizard from breaking on schema mismatch)
      const { data: emp2, error: empErr2 } = await supabase
        .from("EMPLOYEE")
        // EMPLOYEE schema uses MAIL (not EMAIL)
        .select("ID, FIRST_NAME, LAST_NAME, SHORT_NAME, MAIL, MOBILE")
        .eq("ID", empId)
        .maybeSingle();

      if (empErr2 || !emp2) {
        const msg = empErr2?.message || empErr1.message || "unbekannter Fehler";
        return res.status(500).json({ error: `Mitarbeiter konnte nicht geladen werden: ${msg}` });
      }
      employee = emp2;
    } else {
      employee = emp1;
      employeeSalutation = await getSalutationText(employee?.SALUTATION_ID);
    }

    if (!employee) {
      return res.status(500).json({ error: "Mitarbeiter konnte nicht geladen werden" });
    }

    // --- PROJECT --- (for summary display)
    const { data: project, error: projectErr } = await supabase
      .from("PROJECT")
      .select("ID, NAME_SHORT, NAME_LONG")
      .eq("ID", projectId)
      .maybeSingle();
    if (projectErr || !project) {
      return res.status(500).json({ error: "Projekt konnte nicht geladen werden" });
    }

    // --- CONTRACT ---
    const { data: contract, error: contractErr } = await supabase
      .from("CONTRACT")
      .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID")
      .eq("ID", contractId)
      .maybeSingle();
    if (contractErr || !contract) {
      // Fallback: some schemas use CONTRACTS
      const { data: contract2, error: contractErr2 } = await supabase
        .from("CONTRACTS")
        .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID")
        .eq("ID", contractId)
        .maybeSingle();
      if (contractErr2 || !contract2) {
        return res.status(500).json({ error: "Vertrag konnte nicht geladen werden" });
      }
      // Use fallback
      contractErr2;
      contract2;
      // eslint-disable-next-line no-unused-vars
    }

    // Re-read contract from either table for use below
    let contractRow = contract;
    if (!contractRow) {
      const { data: c2 } = await supabase
        .from("CONTRACTS")
        .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID")
        .eq("ID", contractId)
        .maybeSingle();
      contractRow = c2;
    }

    if (String(contractRow.PROJECT_ID) !== String(projectId)) {
      return res.status(400).json({ error: "Der gewählte Vertrag gehört nicht zum gewählten Projekt" });
    }

    // --- INVOICE ADDRESS ---
    const invoiceAddressId = contractRow.INVOICE_ADDRESS_ID;
    const { data: invoiceAddress, error: addrErr } = await supabase
      .from("ADDRESS")
      .select(
        "ID, ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID, POST_OFFICE_BOX, CUSTOMER_NUMBER, BUYER_REFERENCE"
      )
      .eq("ID", invoiceAddressId)
      .maybeSingle();
    if (addrErr || !invoiceAddress) {
      return res.status(500).json({ error: "Rechnungsadresse konnte nicht geladen werden" });
    }
    const addressCountryShort = await getCountryNameShort(invoiceAddress.COUNTRY_ID);

    // --- INVOICE CONTACT ---
    const invoiceContactId = contractRow.INVOICE_CONTACT_ID;
    // CONTACTS table uses EMAIL/MOBILE (no MAIL/PHONE columns).
    const { data: invoiceContact, error: contactErr } = await supabase
      .from("CONTACTS")
      .select("ID, FIRST_NAME, LAST_NAME, SALUTATION_ID, EMAIL, MOBILE")
      .eq("ID", invoiceContactId)
      .maybeSingle();
    if (contactErr || !invoiceContact) {
      return res.status(500).json({ error: "Rechnungskontakt konnte nicht geladen werden" });
    }

    // Resolve contact salutation text
    let contactSalutation = null;
    if (invoiceContact.SALUTATION_ID) {
      const { data: s, error: sErr } = await supabase
        .from("SALUTATION")
        .select("SALUTATION")
        .eq("ID", invoiceContact.SALUTATION_ID)
        .maybeSingle();
      if (!sErr) contactSalutation = s?.SALUTATION ?? null;
    }

    // Prepare draft row (STATUS_ID = 1)
    const insertRow = {
      COMPANY_ID: companyId,
      EMPLOYEE_ID: employeeId,
      PROJECT_ID: projectId,
      CONTRACT_ID: contractId,

      CURRENCY_ID: contractRow.CURRENCY_ID ?? null,
      STATUS_ID: 1,

      // Company snapshot
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

      // Employee snapshot
      EMPLOYEE: `${employee.SHORT_NAME ?? ""}: ${(employee.FIRST_NAME ?? "").trim()} ${(employee.LAST_NAME ?? "").trim()}`.trim(),
      // No dedicated salutation fields in EMPLOYEE schema.
      EMPLOYEE_SALUTATION: employeeSalutation,
      EMPLOYEE_MAIL: employee.MAIL ?? null,
      EMPLOYEE_PHONE: employee.MOBILE ?? null,

      // Invoice address/contact references
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
    };

    const { data: created, error: insertErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .insert([insertRow])
      .select("ID")
      .single();
    if (insertErr) {
      return res.status(500).json({ error: insertErr.message });
    }

    res.json({ id: created.ID });
  });

  // List partial payments (for invoice lists)
  // GET /api/partial-payments?limit=500&status_id=1&q=...
  router.get("/", async (req, res) => {
    const limit = (() => {
      const n = parseInt(String(req.query.limit ?? "200"), 10);
      if (!Number.isFinite(n) || n <= 0) return 200;
      return Math.min(n, 1000);
    })();

    const statusId = req.query.status_id ? String(req.query.status_id) : "";
    const q = String(req.query.q ?? "").trim();

    // List endpoint used by the unified "Rechnungsliste".
    // Keep fields aligned with /api/invoices list for the same UI.
    let query = supabase
      .from("PARTIAL_PAYMENT")
      .select(
        "ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, DUE_DATE, TOTAL_AMOUNT_NET, TAX_AMOUNT_NET, TOTAL_AMOUNT_GROSS, STATUS_ID, PROJECT_ID, CONTRACT_ID, CONTACT, ADDRESS_NAME_1, COMMENT, VAT_ID, VAT_PERCENT"
      )
      .order("PARTIAL_PAYMENT_DATE", { ascending: false })
      .limit(limit);

    if (statusId) {
      query = query.eq("STATUS_ID", statusId);
    }

    if (q) {
      const esc = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
      query = query.or(`PARTIAL_PAYMENT_NUMBER.ilike.%${esc}%,CONTACT.ilike.%${esc}%`);
    }

    const { data: rows, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const ppRows = Array.isArray(rows) ? rows : [];

    // Bulk fetch payment sums (gross) per partial payment
    const ppIds = Array.from(new Set(ppRows.map(r => r.ID).filter(Boolean)));
    const payedGrossMap = {};
    if (ppIds.length > 0) {
      const { data: pays, error: payErr } = await supabase
        .from("PAYMENT")
        .select("PARTIAL_PAYMENT_ID, AMOUNT_PAYED_GROSS")
        .in("PARTIAL_PAYMENT_ID", ppIds);
      if (!payErr) {
        (pays || []).forEach(p => {
          const k = p.PARTIAL_PAYMENT_ID;
          const v = typeof p.AMOUNT_PAYED_GROSS === "number" ? p.AMOUNT_PAYED_GROSS : parseFloat(String(p.AMOUNT_PAYED_GROSS ?? "0"));
          if (!Number.isFinite(v)) return;
          payedGrossMap[k] = (payedGrossMap[k] || 0) + v;
        });
      }
    }

    // Bulk fetch project names
    const projectIds = Array.from(new Set(ppRows.map(r => r.PROJECT_ID).filter(Boolean)));
    const contractIds = Array.from(new Set(ppRows.map(r => r.CONTRACT_ID).filter(Boolean)));

    const projectMap = {};
    if (projectIds.length > 0) {
      const { data: projects } = await supabase
        .from("PROJECT")
        .select("ID, NAME_SHORT, NAME_LONG")
        .in("ID", projectIds);
      (projects || []).forEach(p => {
        projectMap[p.ID] = `${p.NAME_SHORT ?? ""}: ${p.NAME_LONG ?? ""}`.trim();
      });
    }

    const contractMap = {};
    if (contractIds.length > 0) {
      // Contracts can be in CONTRACT or CONTRACTS depending on schema
      let contracts = null;
      const { data: c1, error: c1Err } = await supabase
        .from("CONTRACT")
        .select("ID, NAME_SHORT, NAME_LONG")
        .in("ID", contractIds);
      if (!c1Err) contracts = c1;
      if (!Array.isArray(contracts) || contracts.length === 0) {
        const { data: c2 } = await supabase
          .from("CONTRACTS")
          .select("ID, NAME_SHORT, NAME_LONG")
          .in("ID", contractIds);
        contracts = c2;
      }
      (contracts || []).forEach(c => {
        contractMap[c.ID] = `${c.NAME_SHORT ?? ""}: ${c.NAME_LONG ?? ""}`.trim();
      });
    }

    const data = ppRows.map(r => {
      return {
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
      };
    });

    return res.json({ data });
  });

  // Update draft row for steps 2-4
  router.patch("/:id", async (req, res) => {
    const { id } = req.params;
    const b = req.body || {};

    const payload = {};

    if (b.partial_payment_number !== undefined) {
      const num = String(b.partial_payment_number || "").trim();
      if (!num) return res.status(400).json({ error: "Abschlagsrechnung Nr. ist erforderlich" });

      // uniqueness check
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

      const { data: vat, error: vatErr } = await supabase
        .from("VAT")
        .select("ID, VAT_PERCENT")
        .eq("ID", vatId)
        .maybeSingle();
      if (vatErr || !vat) return res.status(500).json({ error: "VAT konnte nicht geladen werden" });
      payload.VAT_ID = vatId;
      payload.VAT_PERCENT = vat.VAT_PERCENT ?? null;
    }

    // Keep TAX_AMOUNT_NET and TOTAL_AMOUNT_GROSS in sync whenever TOTAL_AMOUNT_NET or VAT_PERCENT changes
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

      // If TOTAL_AMOUNT_NET is still missing, leave TAX/GROSS untouched
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

    res.json({ success: true });
  });


  // Billing proposal (page 3)
  // GET /api/partial-payments/:id/billing-proposal
  // - calculates suggested "nach Leistungsstand" (BILLING_TYPE_ID = 1)
  //   NEW formula: PROJECT_STRUCTURE.REVENUE_COMPLETION - SUM(PARTIAL_PAYMENT_STRUCTURE.AMOUNT_NET)
  //   (summed per structure, for BT=1, for booked partial payments)
  // - updates PARTIAL_PAYMENT_STRUCTURE for BT=1 and BT=2
  // - (optional) auto-assigns currently billable TEC bookings (BT=2) only on first entry
  router.get("/:id/billing-proposal", async (req, res) => {
    const { id } = req.params;

    const { data: pp, error: ppErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("ID, PROJECT_ID, CONTRACT_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET, VAT_PERCENT")
      .eq("ID", id)
      .maybeSingle();

    if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

    let structures = [];
    try {
      structures = await loadProjectStructuresForContext({ contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
    } catch (e) {
      return res.status(500).json({ error: "Projektstruktur konnte nicht geladen werden: " + e.message });
    }

    const bt1 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1);
    const bt1Ids = bt1.map((s) => s.ID);

    // NEW formula per structure:
    // billable_i = REVENUE_COMPLETION_i - SUM(PPS.AMOUNT_NET) for booked partial payments
    let performanceSuggested = 0;
    try {
      const prev = await loadPreviouslyBilledByStructure({
        contractId: pp.CONTRACT_ID,
        projectId: pp.PROJECT_ID,
        structureIds: bt1Ids,
        excludePartialPaymentId: id,
        bookedStatusId: 2,
      });

      performanceSuggested = round2(
        bt1.reduce((acc, s) => {
          const sid = String(s.ID);
          const billed = prev.get(sid) || 0;
          const billable = round2(toNum(s.REVENUE_COMPLETION) - billed);
          return acc + (billable > 0 ? billable : 0);
        }, 0)
      );
    } catch (e) {
      return res.status(500).json({ error: "Vorschlag (Leistungsstand) konnte nicht berechnet werden: " + e.message });
    }

    const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);

    // 1) Ensure BT=1 allocations exist for this draft
    let performanceAmount = 0;
    try {
      const bt1Existing = await sumPpsForPartialPayment({ partialPaymentId: id, structureIds: bt1Ids });
      performanceAmount = bt1Existing.net;

      if (performanceAmount <= 0 && performanceSuggested > 0) {
        const r = await applyPerformanceAmount({
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

    // 2) BT=2 auto-assignment (only if nothing is assigned yet)
    let bookingsSum = 0;
    try {
      const { data: already, error: alreadyErr } = await supabase
        .from("TEC")
        .select("ID")
        .eq("PARTIAL_PAYMENT_ID", id)
        .limit(1);
      if (alreadyErr) throw new Error(alreadyErr.message);
      const hasAssigned = Array.isArray(already) && already.length > 0;

      if (!hasAssigned) {
        const { toAssignIds } = await sumTecForStructures({ structureIds: bt2Ids, partialPaymentId: id });
        if (Array.isArray(toAssignIds) && toAssignIds.length > 0) {
          const { error: upErr } = await supabase
            .from("TEC")
            .update({ PARTIAL_PAYMENT_ID: id })
            .in("ID", toAssignIds);
          if (upErr) throw new Error(upErr.message);
        }
      }

      // Always recompute BT=2 totals from current TEC assignment
      const bt2Res = await updateBt2FromTec({ partialPaymentId: id, contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
      bookingsSum = bt2Res.bookings_sum;
    } catch (e) {
      return res.status(500).json({ error: "Buchungen konnten nicht geladen/zugeordnet werden: " + e.message });
    }

    // 3) Recompute PP totals from PARTIAL_PAYMENT_STRUCTURE
    let totals = null;
    try {
      totals = await recomputePartialPaymentTotals(id);
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
  });

  // Update "nach Leistungsstand" amount (BT=1) and persist allocations into PARTIAL_PAYMENT_STRUCTURE
  // PUT /api/partial-payments/:id/performance
  // Body: { amount: number }
  router.put("/:id/performance", async (req, res) => {
    const { id } = req.params;
    const amount = round2(toNum(req.body?.amount));

    const { data: pp, error: ppErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("ID, PROJECT_ID, CONTRACT_ID")
      .eq("ID", id)
      .maybeSingle();
    if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

    try {
      const r = await applyPerformanceAmount({ partialPaymentId: id, contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID, amount });
      const bt2Res = await updateBt2FromTec({ partialPaymentId: id, contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
      const totals = await recomputePartialPaymentTotals(id);
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
  });

  // List billable bookings for the "Buchungen bearbeiten" modal
  // GET /api/partial-payments/:id/tec
  router.get("/:id/tec", async (req, res) => {
    const { id } = req.params;

    const { data: pp, error: ppErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("ID, PROJECT_ID, CONTRACT_ID")
      .eq("ID", id)
      .maybeSingle();

    if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

    let structures = [];
    try {
      structures = await loadProjectStructuresForContext({ contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
    } catch (e) {
      return res.status(500).json({ error: "Projektstruktur konnte nicht geladen werden: " + e.message });
    }

    const bt2Ids = (structures || [])
      .filter((s) => Number(s.BILLING_TYPE_ID) === 2)
      .map((s) => s.ID);

    if (!Array.isArray(bt2Ids) || bt2Ids.length === 0) return res.json({ data: [] });

    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("ID, DATE_VOUCHER, POSTING_DESCRIPTION, SP_TOT, PARTIAL_PAYMENT_ID, INVOICE_ID, STRUCTURE_ID, EMPLOYEE:EMPLOYEE_ID(SHORT_NAME)")
      .in("STRUCTURE_ID", bt2Ids)
      .order("DATE_VOUCHER", { ascending: true });

    if (tecErr) return res.status(500).json({ error: tecErr.message });

    const rows = (tecRows || [])
      .filter((t) => {
        // Only show rows that are uninvoiced and either unassigned or already assigned to this PP
        if (!isUninvoiced(t.INVOICE_ID)) return false;
        const ppId = t.PARTIAL_PAYMENT_ID;
        return isNullOrZero(ppId) || String(ppId) === String(id);
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
  });

  // Update booking assignments for a partial payment
  // POST /api/partial-payments/:id/tec
  // Body: { ids_assign: [id], ids_unassign: [id], performance_amount: number }
  router.post("/:id/tec", async (req, res) => {
    const { id } = req.params;
    const b = req.body || {};

    const idsAssign = Array.isArray(b.ids_assign) ? b.ids_assign.map((x) => String(x)) : [];
    const idsUnassign = Array.isArray(b.ids_unassign) ? b.ids_unassign.map((x) => String(x)) : [];
    const performanceAmountProvided = b.performance_amount !== undefined ? round2(toNum(b.performance_amount)) : null;

    const { data: pp, error: ppErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("ID, PROJECT_ID, CONTRACT_ID")
      .eq("ID", id)
      .maybeSingle();

    if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

    // Optional: user changed performance amount (BT=1) while in the modal
    try {
      if (performanceAmountProvided !== null) {
        await applyPerformanceAmount({
          partialPaymentId: id,
          contractId: pp.CONTRACT_ID,
          projectId: pp.PROJECT_ID,
          amount: performanceAmountProvided,
        });
      }
    } catch (e) {
      return res.status(400).json({ error: e.message || String(e) });
    }

    // Unassign
    if (idsUnassign.length > 0) {
      const { error: unErr } = await supabase
        .from("TEC")
        .update({ PARTIAL_PAYMENT_ID: null })
        .in("ID", idsUnassign)
        .eq("PARTIAL_PAYMENT_ID", id);

      if (unErr) return res.status(500).json({ error: unErr.message });
    }

    // Assign
    if (idsAssign.length > 0) {
      // Only assign rows that are still unassigned and not invoiced.
      const { data: cand, error: candErr } = await supabase
        .from("TEC")
        .select("ID, PARTIAL_PAYMENT_ID, INVOICE_ID")
        .in("ID", idsAssign);

      if (candErr) return res.status(500).json({ error: candErr.message });

      const assignableIds = (cand || [])
        .filter((t) => isNullOrZero(t.PARTIAL_PAYMENT_ID) && isUninvoiced(t.INVOICE_ID))
        .map((t) => t.ID);

      if (assignableIds.length > 0) {
        const { error: asErr } = await supabase
          .from("TEC")
          .update({ PARTIAL_PAYMENT_ID: id })
          .in("ID", assignableIds);

        if (asErr) return res.status(500).json({ error: asErr.message });
      }
    }

    // Persist BT=2 allocation into PARTIAL_PAYMENT_STRUCTURE and recompute totals
    try {
      const bt2Res = await updateBt2FromTec({ partialPaymentId: id, contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });

      // Performance amount (BT=1) from PPS
      const structures = await loadProjectStructuresForContext({ contractId: pp.CONTRACT_ID, projectId: pp.PROJECT_ID });
      const bt1Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1).map((s) => s.ID);
      const bt1Sum = await sumPpsForPartialPayment({ partialPaymentId: id, structureIds: bt1Ids });

      const totals = await recomputePartialPaymentTotals(id);
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
  });


  // Read for summary (page 5)
  router.get("/:id", async (req, res) => {
    const { id } = req.params;

    const { data: pp, error } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("*")
      .eq("ID", id)
      .maybeSingle();
    if (error || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

    // Fetch project/contract names for display
    const { data: project } = await supabase
      .from("PROJECT")
      .select("NAME_SHORT, NAME_LONG")
      .eq("ID", pp.PROJECT_ID)
      .maybeSingle();

    // Contract can be CONTRACT or CONTRACTS
    let contract = null;
    const { data: c1 } = await supabase
      .from("CONTRACT")
      .select("NAME_SHORT, NAME_LONG")
      .eq("ID", pp.CONTRACT_ID)
      .maybeSingle();
    contract = c1;
    if (!contract) {
      const { data: c2 } = await supabase
        .from("CONTRACTS")
        .select("NAME_SHORT, NAME_LONG")
        .eq("ID", pp.CONTRACT_ID)
        .maybeSingle();
      contract = c2;
    }

    res.json({ data: { pp, project, contract } });
  });

  // Delete draft partial payment (used when user aborts the wizard)
  // DELETE /api/partial-payments/:id
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;

    try {
      // Only allow deleting drafts
      const { data: pp, error: ppErr } = await supabase
        .from("PARTIAL_PAYMENT")
        .select("ID, STATUS_ID")
        .eq("ID", id)
        .maybeSingle();
      if (ppErr || !pp) return res.status(404).json({ error: "PARTIAL_PAYMENT nicht gefunden" });
      if (String(pp.STATUS_ID) === "2") {
        return res.status(400).json({ error: "Gebuchte Abschlagsrechnungen können nicht gelöscht werden" });
      }

      // Unassign TEC rows linked to this draft
      const { error: tecErr } = await supabase
        .from("TEC")
        .update({ PARTIAL_PAYMENT_ID: null })
        .eq("PARTIAL_PAYMENT_ID", id);
      if (tecErr) throw new Error(tecErr.message);

      // Delete PARTIAL_PAYMENT_STRUCTURE rows
      const { error: ppsErr } = await execWithPpsTableFallback((table) =>
        supabase.from(table).delete().eq("PARTIAL_PAYMENT_ID", id)
      );
      if (ppsErr) throw new Error(ppsErr.message);

      // Delete the header
      const { error: delErr } = await supabase.from("PARTIAL_PAYMENT").delete().eq("ID", id);
      if (delErr) throw new Error(delErr.message);

      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });



// ----------------------------
// E-Invoice (XRechnung UBL XML) – Strict Snapshot Policy (1A)
// ----------------------------
// GET  /api/partial-payments/:id/einvoice/ubl?preview=1&download=1
// POST /api/partial-payments/:id/einvoice/ubl/snapshot
//
// Rules:
// - If STATUS_ID=2 (booked) and preview!=1: serve immutable snapshot only.
// - If booked and snapshot missing: return 409 (no auto-backfill).
// - If unbooked OR preview=1: generate live XML.
//
router.get("/:id/einvoice/ubl", async (req, res) => {
  const ppId = parseInt(String(req.params.id || ""), 10);
  if (!ppId || Number.isNaN(ppId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const preview = String(req.query.preview || "") === "1";
  const download = String(req.query.download || "") === "1";

  const logCtx = (extra = {}) => ({
    tag: "EINVOICE_XRECHNUNG_PP",
    partial_payment_id: ppId,
    preview,
    download,
    ...extra,
  });

  const logError = (extra, err) => {
    const msg = err?.message || String(err);
    console.error("[EINVOICE_XRECHNUNG_PP]", { ...logCtx(extra), error: msg, stack: err?.stack });
  };

  // Always load minimal header first
  const { data: ppRow, error: ppRowErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, PARTIAL_PAYMENT_NUMBER, COMPANY_ID")
    .eq("ID", ppId)
    .maybeSingle();

  if (ppRowErr) {
    logError({ step: "load_pp_min" }, ppRowErr);
    return res.status(500).json({ error: ppRowErr.message });
  }
  if (!ppRow) {
    return res.status(404).json({ error: "PARTIAL_PAYMENT nicht gefunden" });
  }

  const isBooked = String(ppRow.STATUS_ID) === "2";
  const fname = `XRechnung_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.xml`;

  // 1A STRICT: booked + not preview => snapshot only, no regeneration/backfill
  if (isBooked && !preview) {
    if (!ppRow.DOCUMENT_XML_ASSET_ID) {
      console.warn("[EINVOICE_XRECHNUNG_PP]", logCtx({ step: "booked_snapshot_missing" }));
      return res.status(409).json({
        error: "BOOKED_XML_SNAPSHOT_MISSING",
        message:
          "Partial payment is booked, but the XRechnung XML snapshot is missing. Regeneration is blocked to preserve immutability.",
        partial_payment_id: ppRow.ID,
      });
    }

    return streamXmlAsset({
      supabase,
      res,
      assetId: ppRow.DOCUMENT_XML_ASSET_ID,
      dispositionName: fname,
      download,
    });
  }

  // Live generation (unbooked OR preview=1)
  try {
    const { data: ppFull, error: ppFullErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("*")
      .eq("ID", ppId)
      .maybeSingle();

    if (ppFullErr || !ppFull) {
      throw new Error(ppFullErr?.message || "PARTIAL_PAYMENT nicht gefunden");
    }

    const xml = await generateUblInvoiceXml({ supabase, partialPayment: ppFull });

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
});

// Admin: create immutable XRechnung XML snapshot explicitly (no auto-backfill on GET)
// POST /api/partial-payments/:id/einvoice/ubl/snapshot
router.post("/:id/einvoice/ubl/snapshot", async (req, res) => {
  const ppId = parseInt(String(req.params.id || ""), 10);
  if (!ppId || Number.isNaN(ppId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  // Load header
  const { data: ppRow, error: ppRowErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, PARTIAL_PAYMENT_NUMBER, COMPANY_ID")
    .eq("ID", ppId)
    .maybeSingle();

  if (ppRowErr) {
    console.error("[EINVOICE_SNAPSHOT_PP]", {
      step: "load_pp_min",
      partial_payment_id: ppId,
      error: ppRowErr.message,
    });
    return res.status(500).json({ error: ppRowErr.message });
  }
  if (!ppRow) return res.status(404).json({ error: "PARTIAL_PAYMENT nicht gefunden" });

  const isBooked = String(ppRow.STATUS_ID) === "2";
  if (!isBooked) {
    return res.status(400).json({ error: "Snapshot ist nur fuer gebuchte Abschlagsrechnungen (STATUS_ID=2) erlaubt" });
  }

  // Idempotent
  if (ppRow.DOCUMENT_XML_ASSET_ID) {
    return res.json({
      success: true,
    number: pp.PARTIAL_PAYMENT_NUMBER || null,
    number: pp.PARTIAL_PAYMENT_NUMBER || null,
      partial_payment_id: ppRow.ID,
      xml_asset_id: ppRow.DOCUMENT_XML_ASSET_ID,
      already_existed: true,
    });
  }

  const fname = `XRechnung_${ppRow.PARTIAL_PAYMENT_NUMBER || ppRow.ID}.xml`;

  try {
    // Load full row
    const { data: ppFull, error: ppFullErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("*")
      .eq("ID", ppId)
      .maybeSingle();

    if (ppFullErr || !ppFull) throw new Error(ppFullErr?.message || "PARTIAL_PAYMENT nicht gefunden");

    const xml = await generateUblInvoiceXml({ supabase, partialPayment: ppFull });

    const xmlAsset = await storeGeneratedXmlAsAsset({
      supabase,
      companyId: ppRow.COMPANY_ID,
      fileName: fname,
      xmlString: xml,
      assetType: "XML_XRECHNUNG_PARTIAL_PAYMENT",
    });

    const { error: upErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .update({
        DOCUMENT_XML_ASSET_ID: xmlAsset?.ID ?? null,
        DOCUMENT_XML_PROFILE: "xrechnung-ubl",
        DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
      })
      .eq("ID", ppId);

    if (upErr) {
      await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      throw new Error(upErr.message);
    }

    return res.json({
      success: true,
      partial_payment_id: ppRow.ID,
      xml_asset_id: xmlAsset.ID,
      already_existed: false,
    });
  } catch (e) {
    console.error("[EINVOICE_SNAPSHOT_PP]", { partial_payment_id: ppId, error: e?.message || String(e), stack: e?.stack });
    return res.status(500).json({ error: `Snapshot konnte nicht erzeugt werden: ${e?.message || e}` });
  }
});


// Final booking
router.post("/:id/book", async (req, res) => {
  const { id } = req.params;

  const { data: pp, error: ppErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, COMPANY_ID, PROJECT_ID, CONTRACT_ID, TOTAL_AMOUNT_NET, VAT_PERCENT, STATUS_ID, PARTIAL_PAYMENT_NUMBER, DOCUMENT_TEMPLATE_ID")
    .eq("ID", id)
    .maybeSingle();
  if (ppErr || !pp) return res.status(500).json({ error: "PARTIAL_PAYMENT konnte nicht geladen werden" });

  // Prevent double-booking (would otherwise double-add totals to PROJECT/PROJECT_STRUCTURE)
  if (String(pp.STATUS_ID) === "2") {
    return res.status(400).json({ error: "PARTIAL_PAYMENT ist bereits gebucht" });
  }


  // Assign number on booking if missing (Nummernkreis)
  if (!pp.PARTIAL_PAYMENT_NUMBER || !String(pp.PARTIAL_PAYMENT_NUMBER).trim()) {
    const { data: num, error: numErr } = await supabase.rpc("next_document_number", {
      p_company_id: pp.COMPANY_ID,
      p_doc_type: "PARTIAL_PAYMENT",
    });
    if (numErr || !num) {
      return res.status(500).json({ error: `Nummernkreis konnte nicht verwendet werden: ${numErr?.message || "unknown error"}` });
    }

    const { error: upNumErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .update({ PARTIAL_PAYMENT_NUMBER: num })
      .eq("ID", id);

    if (upNumErr) return res.status(500).json({ error: upNumErr.message });
    pp.PARTIAL_PAYMENT_NUMBER = num;
  }

  // Ensure TAX_AMOUNT_NET and TOTAL_AMOUNT_GROSS are filled on booking
  const vatPercent = toNum(pp.VAT_PERCENT);
  const totalNet = toNum(pp.TOTAL_AMOUNT_NET);
  const taxAmountNet = round2(totalNet * vatPercent / 100);
  const totalGross = round2(totalNet + taxAmountNet);

  // Stage A: render and snapshot PDF/template on booking
  let pdfAsset = null;
  let tpl = null;
  let theme = null;
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
    pdfAsset = await storeGeneratedPdfAsAsset({
      supabase,
      companyId: pp.COMPANY_ID,
      fileName,
      pdfBuffer: r.pdf,
      assetType: "PDF_PARTIAL_PAYMENT",
    });
  } catch (e) {
    console.error("[BOOK_PP][PDF]", {
      partial_payment_id: id,
      company_id: pp?.COMPANY_ID,
      partial_payment_number: pp?.PARTIAL_PAYMENT_NUMBER,
      error: e?.message || String(e),
      stack: e?.stack,
    });
    return res.status(500).json({ error: `PDF konnte nicht erzeugt werden: ${e?.message || e}` });
  }

  // Stage C: generate and snapshot XRechnung XML on booking (immutable)
  let xmlAsset = null;
  try {
    const { data: ppFull, error: ppFullErr } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("*")
      .eq("ID", id)
      .maybeSingle();
    if (ppFullErr || !ppFull) throw new Error(ppFullErr?.message || "PARTIAL_PAYMENT nicht gefunden");

    const xml = await generateUblInvoiceXml({ supabase, partialPayment: ppFull });
    const xmlName = `XRechnung_${pp.PARTIAL_PAYMENT_NUMBER || pp.ID}.xml`;

    xmlAsset = await storeGeneratedXmlAsAsset({
      supabase,
      companyId: pp.COMPANY_ID,
      fileName: xmlName,
      xmlString: xml,
      assetType: "XML_XRECHNUNG_PARTIAL_PAYMENT",
    });
  } catch (e) {
    console.error("[BOOK_PP][XRECHNUNG_XML]", {
      partial_payment_id: id,
      company_id: pp?.COMPANY_ID,
      partial_payment_number: pp?.PARTIAL_PAYMENT_NUMBER,
      error: e?.message || String(e),
      stack: e?.stack,
    });
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    return res.status(500).json({ error: `E-Rechnung konnte nicht erzeugt werden: ${e?.message || e}` });
  }

  // Update status + snapshot fields
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
    return res.status(500).json({ error: upErr.message });
  }

  // Update PROJECT.PARTIAL_PAYMENTS += TOTAL_AMOUNT_NET
  const { data: project, error: projErr } = await supabase
    .from("PROJECT")
    .select("ID, PARTIAL_PAYMENTS")
    .eq("ID", pp.PROJECT_ID)
    .maybeSingle();
  if (projErr || !project) {
    await supabase
      .from("PARTIAL_PAYMENT")
      .update({
        STATUS_ID: 1,
        DOCUMENT_PDF_ASSET_ID: null,
        DOCUMENT_XML_ASSET_ID: null,
      })
      .eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
    return res.status(500).json({ error: "Projekt konnte nicht geladen werden" });
  }

  const current = toNum(project.PARTIAL_PAYMENTS);
  const add = toNum(pp.TOTAL_AMOUNT_NET);

  const { error: projUpErr } = await supabase
    .from("PROJECT")
    .update({ PARTIAL_PAYMENTS: round2(current + add) })
    .eq("ID", pp.PROJECT_ID);
  if (projUpErr) {
    await supabase
      .from("PARTIAL_PAYMENT")
      .update({
        STATUS_ID: 1,
        DOCUMENT_PDF_ASSET_ID: null,
        DOCUMENT_XML_ASSET_ID: null,
      })
      .eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
    return res.status(500).json({ error: projUpErr.message });
  }

  // Update PROJECT_STRUCTURE.PARTIAL_PAYMENTS per structure element of this partial payment
  try {
    // Load allocations from PARTIAL_PAYMENT_STRUCTURE (BT=1 and BT=2 are both stored here)
    const sums = await sumPpsForPartialPayment({ partialPaymentId: id });
    const rows = sums.rows || [];

    if (rows.length > 0) {
      const addByStructure = new Map();
      rows.forEach((r) => {
        const sid = String(r.STRUCTURE_ID);
        const cur = addByStructure.get(sid) || 0;
        addByStructure.set(sid, round2(cur + toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET)));
      });

      const structureIds = Array.from(addByStructure.keys())
        .map((x) => parseInt(x, 10))
        .filter((n) => Number.isFinite(n));

      if (structureIds.length > 0) {
        const { data: psRows, error: psErr } = await supabase
          .from("PROJECT_STRUCTURE")
          .select("ID, PARTIAL_PAYMENTS")
          .in("ID", structureIds);
        if (psErr) throw new Error(psErr.message);

        const currentById = new Map();
        (psRows || []).forEach((s) => currentById.set(String(s.ID), toNum(s.PARTIAL_PAYMENTS)));

        const updates = structureIds.map((sid) => {
          const key = String(sid);
          const base = currentById.get(key) || 0;
          const inc = addByStructure.get(key) || 0;
          return { ID: sid, PARTIAL_PAYMENTS: round2(base + inc) };
        });

        // Use upsert to batch updates (ID must be PK/unique)
        const { error: psUpErr } = await supabase.from("PROJECT_STRUCTURE").upsert(updates, { onConflict: "ID" });
        if (psUpErr) throw new Error(psUpErr.message);
      }
    }
  } catch (e) {
    await supabase
      .from("PARTIAL_PAYMENT")
      .update({
        STATUS_ID: 1,
        DOCUMENT_PDF_ASSET_ID: null,
        DOCUMENT_XML_ASSET_ID: null,
      })
      .eq("ID", id);
    await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
    await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
    return res.status(500).json({ error: `PROJECT_STRUCTURE konnte nicht aktualisiert werden: ${e?.message || e}` });
  }

  return res.json({
    success: true,
    pdf_asset_id: pdfAsset?.ID ?? null,
    xml_asset_id: xmlAsset?.ID ?? null,
  });
});



  return router;
};
