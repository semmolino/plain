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

// Invoice routes
// Base path: /api/invoices
//
// This file supports:
// - list/search (used in payment entry autocomplete)
// - wizard draft lifecycle for "Rechnungen" (step 1+2 for now)
module.exports = (supabase) => {
  const router = express.Router();

  // ----------------------------
  // Stage A: PDF Rendering
  // ----------------------------

  // GET /api/invoices/:id/pdf?template_id=...&preview=1
  router.get("/:id/pdf", async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.id, 10);
      if (!invoiceId || Number.isNaN(invoiceId)) return res.status(400).json({ error: "invalid id" });

      const preview = String(req.query.preview || "") === "1";
      const download = String(req.query.download || "") === "1";
      const templateId = req.query.template_id ? parseInt(String(req.query.template_id), 10) : null;

      // If booked and a snapshot PDF exists, serve it (unless preview requested)
      if (!preview) {
        const { data: invRow, error: invRowErr } = await supabase
          .from("INVOICE")
          .select("ID, STATUS_ID, DOCUMENT_PDF_ASSET_ID, INVOICE_NUMBER")
          .eq("ID", invoiceId)
          .maybeSingle();

        if (!invRowErr && invRow && String(invRow.STATUS_ID) === "2" && invRow.DOCUMENT_PDF_ASSET_ID) {
          const fname = `Rechnung_${invRow.INVOICE_NUMBER || invRow.ID}.pdf`;
          return streamPdfAsset({ supabase, res, assetId: invRow.DOCUMENT_PDF_ASSET_ID, dispositionName: fname, download });
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
  });

  // ----------------------------
  // Helpers
  // ----------------------------

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

  function isTableMissingErr(err, tableName) {
    const msg = String(err?.message || "").toLowerCase();
    return msg.includes("relation") && msg.includes(String(tableName).toLowerCase()) && msg.includes("does not exist");
  }

  // ----------------------------
  // Helpers for Wizard Step 3 (Abrechnung)
  // ----------------------------

  const toNum = (v) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : 0;
  };

  const round2 = (v) => Math.round(toNum(v) * 100) / 100;

  const isNullOrZero = (v) => v === null || v === undefined || String(v) === "0";

  async function loadProjectStructuresForContext({ contractId, projectId }) {
    // Prefer CONTRACT_ID if present; fall back to PROJECT_ID for older schemas.
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

  async function loadPreviouslyBilledByStructure({ contractId, projectId, structureIds, excludeInvoiceId, bookedStatusId = 2 }) {
    const ids = Array.isArray(structureIds) ? structureIds : [];
    if (ids.length === 0) return new Map();

    // 1) Load booked invoices for the same context
    let invQ = supabase.from("INVOICE").select("ID").eq("STATUS_ID", bookedStatusId);
    if (contractId) invQ = invQ.eq("CONTRACT_ID", contractId);
    else invQ = invQ.eq("PROJECT_ID", projectId);
    if (excludeInvoiceId) invQ = invQ.neq("ID", excludeInvoiceId);

    const { data: invRows, error: invErr } = await invQ;
    if (invErr) throw new Error(invErr.message);

    const invoiceIds = (invRows || []).map((r) => r.ID).filter((x) => x !== null && x !== undefined);
    if (invoiceIds.length === 0) return new Map();

    // 2) Sum billed amount_net per structure from INVOICE_STRUCTURE
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

  async function sumInvStructureForInvoice({ invoiceId, structureIds }) {
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

  async function writeInvoiceStructureRows({ invoiceId, rows }) {
    const arr = Array.isArray(rows) ? rows : [];
    const structureIds = Array.from(new Set(arr.map((r) => r.STRUCTURE_ID))).filter((x) => x !== null && x !== undefined);

    // Delete existing rows for these structures (so BT=1 and BT=2 can be updated independently)
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

  async function recomputeInvoiceTotals(invoiceId) {
    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, VAT_PERCENT")
      .eq("ID", invoiceId)
      .maybeSingle();
    if (invErr || !inv) throw new Error("INVOICE konnte nicht geladen werden");

    const sums = await sumInvStructureForInvoice({ invoiceId });
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

  async function applyPerformanceAmount({ invoiceId, contractId, projectId, amount }) {
    const structures = await loadProjectStructuresForContext({ contractId, projectId });
    const bt1 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1);
    const bt1Ids = bt1.map((s) => s.ID);

    const prev = await loadPreviouslyBilledByStructure({
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
        };
      })
      .filter(Boolean);

    await writeInvoiceStructureRows({ invoiceId, rows });
    const sum = round2(rows.reduce((acc, r) => acc + toNum(r.AMOUNT_NET), 0));
    return { performance_amount: sum };
  }

  async function updateBt2FromTec({ invoiceId, contractId, projectId }) {
    const structures = await loadProjectStructuresForContext({ contractId, projectId });
    const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
    if (bt2Ids.length === 0) {
      // Remove BT=2 allocations if any
      try {
        await supabase.from("INVOICE_STRUCTURE").delete().eq("INVOICE_ID", invoiceId).in("STRUCTURE_ID", []);
      } catch (_) {
        // ignore
      }
      return { bookings_sum: 0 };
    }

    const { data: tecRows, error: tecErr } = await supabase
      .from("TEC")
      .select("ID, STRUCTURE_ID, SP_TOT, PARTIAL_PAYMENT_ID, INVOICE_ID")
      .in("STRUCTURE_ID", bt2Ids)
      .eq("INVOICE_ID", invoiceId);

    if (tecErr) throw new Error(tecErr.message);

    const sumByStructure = new Map();
    (tecRows || []).forEach((t) => {
      // Safety: only count bookings not assigned to partial payments
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
        return { INVOICE_ID: invoiceId, STRUCTURE_ID: parseInt(String(sid), 10), AMOUNT_NET: aNet, AMOUNT_EXTRAS_NET: aExtras };
      })
      .filter((r) => Number.isFinite(r.STRUCTURE_ID));

    await writeInvoiceStructureRows({ invoiceId, rows });
    const bookingsSum = round2(rows.reduce((acc, r) => acc + toNum(r.AMOUNT_NET), 0));
    return { bookings_sum: bookingsSum };
  }

  async function findTecIdsToAutoAssign({ invoiceId, structureIds }) {
    const ids = Array.isArray(structureIds) ? structureIds : [];
    if (ids.length === 0) return { toAssignIds: [] };

    const { data: tecRows, error } = await supabase
      .from("TEC")
      .select("ID, PARTIAL_PAYMENT_ID, INVOICE_ID")
      .in("STRUCTURE_ID", ids);
    if (error) throw new Error(error.message);

    const toAssignIds = (tecRows || [])
      .filter((t) => isNullOrZero(t.PARTIAL_PAYMENT_ID) && isNullOrZero(t.INVOICE_ID))
      .map((t) => t.ID);

    return { toAssignIds };
  }

  // GET /api/invoices?limit=200&q=...
  // Used for payment entry autocomplete.
  router.get("/", async (req, res) => {
    const limit = (() => {
      const n = parseInt(String(req.query.limit ?? "50"), 10);
      if (!Number.isFinite(n) || n <= 0) return 50;
      return Math.min(n, 500);
    })();

    const q = String(req.query.q ?? "").trim();

    // List endpoint used by the unified "Rechnungsliste".
    // Keep fields aligned with /api/partial-payments list for the same UI.
    let query = supabase
      .from("INVOICE")
      .select(
        "ID, INVOICE_NUMBER, INVOICE_DATE, DUE_DATE, TOTAL_AMOUNT_NET, TAX_AMOUNT_NET, TOTAL_AMOUNT_GROSS, STATUS_ID, PROJECT_ID, CONTRACT_ID, CONTACT, ADDRESS_NAME_1, COMMENT, VAT_ID, VAT_PERCENT"
      )
      .order("INVOICE_DATE", { ascending: false })
      .limit(limit);

    if (q) {
      const esc = q.replace(/%/g, "\\%" ).replace(/_/g, "\\_");
      query = query.or(`INVOICE_NUMBER.ilike.%${esc}%`);
    }

    const { data: rows, error } = await query;
    if (error) {
      // Common case: INVOICE table not yet present in early development.
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("relation") && msg.includes("invoice") && msg.includes("does not exist")) {
        return res.status(501).json({ error: "INVOICE Tabelle ist in der Datenbank nicht vorhanden." });
      }
      return res.status(500).json({ error: error.message });
    }

    const invRows = Array.isArray(rows) ? rows : [];

    // Bulk fetch payment sums (gross) per invoice
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

    const data = invRows.map(r => {
      return {
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
        COMMENT: r.COMMENT ?? ""
      };
    });

    return res.json({ data });
  });

  // ----------------------------
  // Wizard: Step 1 (Rahmendaten) -> create draft
  // POST /api/invoices/init
  // ----------------------------
  router.post("/init", async (req, res) => {
    const b = req.body || {};

    const companyId = b.company_id;
    const employeeId = b.employee_id;
    const projectId = b.project_id;
    const contractId = b.contract_id;

    if (!companyId || !employeeId || !projectId || !contractId) {
      return res.status(400).json({
        error: "Pflichtfelder fehlen (Firma/Mitarbeiter/Projekt/Vertrag)",
      });
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
    // Some schemas may not yet include SALUTATION_ID -> fallback.
    const empId = (() => {
      const n = parseInt(String(employeeId), 10);
      return Number.isFinite(n) ? n : employeeId;
    })();

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
      if (empErr2 || !emp2) {
        const msg = empErr2?.message || empErr1.message || "unbekannter Fehler";
        return res
          .status(500)
          .json({ error: `Mitarbeiter konnte nicht geladen werden: ${msg}` });
      }
      employee = emp2;
    } else {
      employee = emp1;
      employeeSalutation = await getSalutationText(employee?.SALUTATION_ID);
    }
    if (!employee) {
      return res.status(500).json({ error: "Mitarbeiter konnte nicht geladen werden" });
    }

    // --- PROJECT ---
    const { data: project, error: projectErr } = await supabase
      .from("PROJECT")
      .select("ID, NAME_SHORT, NAME_LONG")
      .eq("ID", projectId)
      .maybeSingle();
    if (projectErr || !project) {
      return res.status(500).json({ error: "Projekt konnte nicht geladen werden" });
    }

    // --- CONTRACT --- (CONTRACT or CONTRACTS)
    let contractRow = null;
    {
      const { data: c1, error: c1Err } = await supabase
        .from("CONTRACT")
        .select(
          "ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID"
        )
        .eq("ID", contractId)
        .maybeSingle();
      if (!c1Err && c1) contractRow = c1;
    }
    if (!contractRow) {
      const { data: c2, error: c2Err } = await supabase
        .from("CONTRACTS")
        .select(
          "ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID"
        )
        .eq("ID", contractId)
        .maybeSingle();
      if (c2Err || !c2) {
        return res.status(500).json({ error: "Vertrag konnte nicht geladen werden" });
      }
      contractRow = c2;
    }

    if (String(contractRow.PROJECT_ID) !== String(projectId)) {
      return res
        .status(400)
        .json({ error: "Der gewählte Vertrag gehört nicht zum gewählten Projekt" });
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
      return res
        .status(500)
        .json({ error: "Rechnungsadresse konnte nicht geladen werden" });
    }
    const addressCountryShort = await getCountryNameShort(invoiceAddress.COUNTRY_ID);

    // --- INVOICE CONTACT ---
    const invoiceContactId = contractRow.INVOICE_CONTACT_ID;
    const { data: invoiceContact, error: contactErr } = await supabase
      .from("CONTACTS")
      .select("ID, FIRST_NAME, LAST_NAME, SALUTATION_ID, EMAIL, MOBILE")
      .eq("ID", invoiceContactId)
      .maybeSingle();
    if (contactErr || !invoiceContact) {
      return res
        .status(500)
        .json({ error: "Rechnungskontakt konnte nicht geladen werden" });
    }

    const contactSalutation = await getSalutationText(invoiceContact.SALUTATION_ID);

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
      EMPLOYEE_SALUTATION: employeeSalutation,
      EMPLOYEE_MAIL: employee.MAIL ?? null,
      EMPLOYEE_PHONE: employee.MOBILE ?? null,

      // Invoice address/contact references
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
    };

    const { data: created, error: insertErr } = await supabase
      .from("INVOICE")
      .insert([insertRow])
      .select("ID")
      .single();

    if (insertErr) {
      if (isTableMissingErr(insertErr, "invoice")) {
        return res
          .status(501)
          .json({ error: "INVOICE Tabelle ist in der Datenbank nicht vorhanden." });
      }
      return res.status(500).json({ error: insertErr.message });
    }

    return res.json({ id: created.ID });
  });


  // ----------------------------
  // Wizard: Step 2 (Rechnungsinformationen) + Step 4 (Erweitert) -> update draft
  // PATCH /api/invoices/:id
  // ----------------------------
  router.patch("/:id", async (req, res) => {
    const { id } = req.params;
    const b = req.body || {};

    // Only allow updating drafts
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

    const payload = {};

    // --- Step 2: invoice meta ---
    if (b.invoice_number !== undefined) {
      const num = String(b.invoice_number || "").trim();
      if (!num) return res.status(400).json({ error: "Rechnungsnummer ist erforderlich" });

      const { data: existing, error: existErr } = await supabase
        .from("INVOICE")
        .select("ID")
        .eq("INVOICE_NUMBER", num)
        .neq("ID", id)
        .limit(1);
      if (existErr) return res.status(500).json({ error: existErr.message });
      if (Array.isArray(existing) && existing.length > 0) {
        return res.status(409).json({ error: "Rechnungsnummer ist bereits vergeben" });
      }

      payload.INVOICE_NUMBER = num;
    }

    if (b.invoice_date !== undefined) payload.INVOICE_DATE = b.invoice_date || null;
    if (b.due_date !== undefined) payload.DUE_DATE = b.due_date || null;
    if (b.billing_period_start !== undefined) payload.BILLING_PERIOD_START = b.billing_period_start || null;
    if (b.billing_period_finish !== undefined) payload.BILLING_PERIOD_FINISH = b.billing_period_finish || null;

    // --- Step 4: advanced fields ---
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

    if (b.payment_means_id !== undefined) {
      const pm = b.payment_means_id;
      if (!pm) return res.status(400).json({ error: "Zahlungsart ist erforderlich" });
      payload.PAYMENT_MEANS_ID = pm;
    }

    // Keep TAX_AMOUNT_NET and TOTAL_AMOUNT_GROSS in sync whenever VAT_PERCENT changes
    if (payload.VAT_PERCENT !== undefined) {
      const totalNet = toNum(inv.TOTAL_AMOUNT_NET);
      const vatPercent = toNum(payload.VAT_PERCENT);
      payload.TAX_AMOUNT_NET = round2(totalNet * vatPercent / 100);
      payload.TOTAL_AMOUNT_GROSS = round2(totalNet + payload.TAX_AMOUNT_NET);
    }

    if (Object.keys(payload).length === 0) {
      return res.json({ ok: true });
    }

    const { error: upErr } = await supabase.from("INVOICE").update(payload).eq("ID", id);
    if (upErr) return res.status(500).json({ error: upErr.message });

    return res.json({ ok: true });
  });


  // ----------------------------
  // Wizard: Step 3 (Abrechnung)
  // ----------------------------

  // GET /api/invoices/:id/billing-proposal
  // Returns:
  // - performance_suggested: BT=1 suggestion based on remaining REVENUE_COMPLETION
  // - performance_amount: current BT=1 net sum from INVOICE_STRUCTURE
  // - bookings_sum: current BT=2 net sum (from TEC assigned to this invoice)
  // - computed totals from INVOICE_STRUCTURE
  router.get("/:id/billing-proposal", async (req, res) => {
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

      const structures = await loadProjectStructuresForContext({ contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
      const bt1 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1);
      const bt2 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2);
      const bt1Ids = bt1.map((s) => s.ID);
      const bt2Ids = bt2.map((s) => s.ID);

      // Suggested BT=1 amount = sum remaining over BT=1 structures
      const prev = await loadPreviouslyBilledByStructure({
        contractId: inv.CONTRACT_ID,
        projectId: inv.PROJECT_ID,
        structureIds: bt1Ids,
        excludeInvoiceId: id,
        bookedStatusId: 2,
      });

      const perfSuggested = round2(
        bt1.reduce((acc, s) => {
          const billed = prev.get(String(s.ID)) || 0;
          const rem = round2(toNum(s.REVENUE_COMPLETION) - billed);
          return acc + (rem > 0 ? rem : 0);
        }, 0)
      );

      // If there is no BT=1 allocation yet, create it using the suggestion.
      const bt1Sums = await sumInvStructureForInvoice({ invoiceId: id, structureIds: bt1Ids });
      if (bt1Sums.net <= 0 && perfSuggested > 0) {
        await applyPerformanceAmount({
          invoiceId: id,
          contractId: inv.CONTRACT_ID,
          projectId: inv.PROJECT_ID,
          amount: perfSuggested,
        });
      }

      // Auto-assign TEC rows (BT=2) on first entry into page 3
      if (bt2Ids.length > 0) {
        const { data: hasAny, error: hasAnyErr } = await supabase
          .from("TEC")
          .select("ID")
          .eq("INVOICE_ID", id)
          .limit(1);
        if (hasAnyErr) throw new Error(hasAnyErr.message);

        if (!Array.isArray(hasAny) || hasAny.length === 0) {
          const { toAssignIds } = await findTecIdsToAutoAssign({ invoiceId: id, structureIds: bt2Ids });
          if (toAssignIds.length > 0) {
            const { error: asErr } = await supabase
              .from("TEC")
              .update({ INVOICE_ID: id })
              .in("ID", toAssignIds);
            if (asErr) throw new Error(asErr.message);
          }
        }

        await updateBt2FromTec({ invoiceId: id, contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
      }

      const totals = await recomputeInvoiceTotals(id);
      const bt1Now = await sumInvStructureForInvoice({ invoiceId: id, structureIds: bt1Ids });
      const bt2Now = await sumInvStructureForInvoice({ invoiceId: id, structureIds: bt2Ids });

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
  });

  // PUT /api/invoices/:id/performance
  // Body: { amount }
  router.put("/:id/performance", async (req, res) => {
    const { id } = req.params;
    const amount = toNum(req.body?.amount);

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

      const perf = await applyPerformanceAmount({
        invoiceId: id,
        contractId: inv.CONTRACT_ID,
        projectId: inv.PROJECT_ID,
        amount,
      });

      const structures = await loadProjectStructuresForContext({ contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
      const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
      if (bt2Ids.length > 0) await updateBt2FromTec({ invoiceId: id, contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });

      const totals = await recomputeInvoiceTotals(id);
      const bt2Now = await sumInvStructureForInvoice({ invoiceId: id, structureIds: bt2Ids });

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
  });

  // GET /api/invoices/:id/tec
  // Returns billable bookings (BT=2) + assignment state for this invoice.
  router.get("/:id/tec", async (req, res) => {
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

      const structures = await loadProjectStructuresForContext({ contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
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
          if (!isNullOrZero(t.PARTIAL_PAYMENT_ID)) return false;
          // show unassigned or assigned to this invoice
          return isNullOrZero(t.INVOICE_ID) || String(t.INVOICE_ID) === String(id);
        })
        .map((t) => ({
          ID: t.ID,
          DATE_VOUCHER: t.DATE_VOUCHER,
          EMPLOYEE_SHORT_NAME: t.EMPLOYEE?.SHORT_NAME ?? "",
          POSTING_DESCRIPTION: t.POSTING_DESCRIPTION ?? "",
          SP_TOT: round2(t.SP_TOT),
          ASSIGNED: String(t.INVOICE_ID) === String(id),
        }));

      return res.json({ data: out });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // POST /api/invoices/:id/tec
  // Body: { ids_assign: [], ids_unassign: [], performance_amount }
  router.post("/:id/tec", async (req, res) => {
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

      // Persist BT=1 performance amount if provided
      if (perfAmount !== undefined) {
        await applyPerformanceAmount({
          invoiceId: id,
          contractId: inv.CONTRACT_ID,
          projectId: inv.PROJECT_ID,
          amount: toNum(perfAmount),
        });
      }

      // Unassign
      if (idsUnassign.length > 0) {
        const { error: unErr } = await supabase
          .from("TEC")
          .update({ INVOICE_ID: null })
          .in("ID", idsUnassign)
          .eq("INVOICE_ID", id);
        if (unErr) throw new Error(unErr.message);
      }

      // Assign (only if both PARTIAL_PAYMENT_ID and INVOICE_ID are 0/null)
      if (idsAssign.length > 0) {
        const { data: rows, error: selErr } = await supabase
          .from("TEC")
          .select("ID, PARTIAL_PAYMENT_ID, INVOICE_ID")
          .in("ID", idsAssign);
        if (selErr) throw new Error(selErr.message);

        const allow = (rows || [])
          .filter((t) => isNullOrZero(t.PARTIAL_PAYMENT_ID) && isNullOrZero(t.INVOICE_ID))
          .map((t) => t.ID);

        if (allow.length > 0) {
          const { error: asErr } = await supabase.from("TEC").update({ INVOICE_ID: id }).in("ID", allow);
          if (asErr) throw new Error(asErr.message);
        }
      }

      // Recompute BT=2 from assigned TEC
      const bt2 = await updateBt2FromTec({ invoiceId: id, contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });

      // Return current BT=1 and totals
      const structures = await loadProjectStructuresForContext({ contractId: inv.CONTRACT_ID, projectId: inv.PROJECT_ID });
      const bt1Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1).map((s) => s.ID);
      const bt1Now = await sumInvStructureForInvoice({ invoiceId: id, structureIds: bt1Ids });
      const totals = await recomputeInvoiceTotals(id);

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
  });

  

  // ----------------------------
  
  // Generate E-Invoice (XRechnung UBL XML)
  // GET /api/invoices/:id/einvoice/ubl?preview=1&download=1
router.get("/:id/einvoice/ubl", async (req, res) => {
  const invoiceId = parseInt(String(req.params.id || ""), 10);
  if (!invoiceId || Number.isNaN(invoiceId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const preview = String(req.query.preview || "") === "1";
  const download = String(req.query.download || "") === "1";

  const logCtx = (extra = {}) => ({
    tag: "EINVOICE_XRECHNUNG",
    invoice_id: invoiceId,
    preview,
    download,
    ...extra,
  });

  const logError = (extra, err) => {
    const msg = err?.message || String(err);
    console.error("[EINVOICE_XRECHNUNG]", { ...logCtx(extra), error: msg, stack: err?.stack });
  };

  // Always load the invoice header (minimal fields first)
  const { data: invRow, error: invRowErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, DOCUMENT_XML_ASSET_ID, INVOICE_NUMBER, COMPANY_ID")
    .eq("ID", invoiceId)
    .maybeSingle();

  if (invRowErr) {
    logError({ step: "load_invoice_min" }, invRowErr);
    return res.status(500).json({ error: invRowErr.message });
  }
  if (!invRow) {
    return res.status(404).json({ error: "INVOICE nicht gefunden" });
  }

  const isBooked = String(invRow.STATUS_ID) === "2";
  const fname = `XRechnung_${invRow.INVOICE_NUMBER || invRow.ID}.xml`;

  // 1A STRICT: booked + not preview => snapshot only, no regeneration/backfill
  if (isBooked && !preview) {
    if (!invRow.DOCUMENT_XML_ASSET_ID) {
      console.warn("[EINVOICE_XRECHNUNG]", logCtx({ step: "booked_snapshot_missing" }));
      return res.status(409).json({
        error: "BOOKED_XML_SNAPSHOT_MISSING",
        message:
          "Invoice is booked, but the XRechnung XML snapshot is missing. Regeneration is blocked to preserve immutability.",
        invoice_id: invRow.ID,
      });
    }

    return streamXmlAsset({
      supabase,
      res,
      assetId: invRow.DOCUMENT_XML_ASSET_ID,
      dispositionName: fname,
      download,
    });
  }

  // Live generation path (unbooked, OR preview=1)
  try {
    // Load full invoice row (required for address, etc.)
    const { data: invFull, error: invFullErr } = await supabase
      .from("INVOICE")
      .select("*")
      .eq("ID", invoiceId)
      .maybeSingle();

    if (invFullErr || !invFull) {
      throw new Error(invFullErr?.message || "INVOICE nicht gefunden");
    }

    const xml = await generateUblInvoiceXml({ supabase, invoice: invFull, docType: "INVOICE" });

    // send inline or download
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${fname}"`
    );
    return res.send(xml);
  } catch (err) {
    logError(
      {
        step: "generate_xml_live",
        status_id: invRow.STATUS_ID,
        company_id: invRow.COMPANY_ID,
      },
      err
    );
    return res.status(500).json({
      error: "EINVOICE_GENERATION_FAILED",
      message: `E-Rechnung konnte nicht erzeugt werden: ${err?.message || err}`,
      invoice_id: invRow.ID,
    });
  }
});


// Admin: explicitly create immutable XRechnung XML snapshot (strict mode has no auto-backfill)
router.post("/:id/einvoice/ubl/snapshot", async (req, res) => {
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
    return res.json({
      success: true,
      number: inv.INVOICE_NUMBER || null,
      invoice_id: invRow.ID,
      xml_asset_id: invRow.DOCUMENT_XML_ASSET_ID,
      already_existed: true,
    });
  }

  const fname = `XRechnung_${invRow.INVOICE_NUMBER || invRow.ID}.xml`;

  try {
    const { data: invFull, error: invFullErr } = await supabase
      .from("INVOICE")
      .select("*")
      .eq("ID", invoiceId)
      .maybeSingle();

    if (invFullErr || !invFull) throw new Error(invFullErr?.message || "INVOICE nicht gefunden");

    const xml = await generateUblInvoiceXml({ supabase, invoice: invFull, docType: "INVOICE" });

    const xmlAsset = await storeGeneratedXmlAsAsset({
      supabase,
      companyId: invRow.COMPANY_ID,
      fileName: fname,
      xmlString: xml,
      assetType: "XML_XRECHNUNG_INVOICE",
    });

    const { error: upErr } = await supabase
      .from("INVOICE")
      .update({
        DOCUMENT_XML_ASSET_ID: xmlAsset?.ID ?? null,
        DOCUMENT_XML_PROFILE: "xrechnung-ubl",
        DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
      })
      .eq("ID", invoiceId);

    if (upErr) {
      await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      throw new Error(upErr.message);
    }

    return res.json({ success: true, invoice_id: invRow.ID, xml_asset_id: xmlAsset.ID, already_existed: false });
  } catch (e) {
    console.error("[EINVOICE_SNAPSHOT]", { invoice_id: invoiceId, error: e?.message || String(e), stack: e?.stack });
    return res.status(500).json({ error: `Snapshot konnte nicht erzeugt werden: ${e?.message || e}` });
  }
});



// Admin: create immutable XRechnung XML snapshot explicitly (no auto-backfill on GET)
// POST /api/invoices/:id/einvoice/ubl/snapshot
router.post("/:id/einvoice/ubl/snapshot", async (req, res) => {
  const invoiceId = parseInt(String(req.params.id || ""), 10);
  if (!invoiceId || Number.isNaN(invoiceId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  // Optional: protect this endpoint (dev default: allow)
  // If you have auth middleware, enforce it here.

  // Load header
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

  const isBooked = String(invRow.STATUS_ID) === "2";
  if (!isBooked) {
    return res.status(400).json({ error: "Snapshot ist nur fuer gebuchte Rechnungen (STATUS_ID=2) erlaubt" });
  }

  // Idempotent: if snapshot exists, return it
  if (invRow.DOCUMENT_XML_ASSET_ID) {
    return res.json({ success: true, invoice_id: invRow.ID, xml_asset_id: invRow.DOCUMENT_XML_ASSET_ID, already_existed: true });
  }

  const fname = `XRechnung_${invRow.INVOICE_NUMBER || invRow.ID}.xml`;

  try {
    // Load full invoice row
    const { data: invFull, error: invFullErr } = await supabase
      .from("INVOICE")
      .select("*")
      .eq("ID", invoiceId)
      .maybeSingle();

    if (invFullErr || !invFull) throw new Error(invFullErr?.message || "INVOICE nicht gefunden");

    const xml = await generateUblInvoiceXml({ supabase, invoice: invFull, docType: "INVOICE" });

    const xmlAsset = await storeGeneratedXmlAsAsset({
      supabase,
      companyId: invRow.COMPANY_ID,
      fileName: fname,
      xmlString: xml,
      assetType: "XML_XRECHNUNG_INVOICE",
    });

    const { error: upErr } = await supabase
      .from("INVOICE")
      .update({
        DOCUMENT_XML_ASSET_ID: xmlAsset?.ID ?? null,
        DOCUMENT_XML_PROFILE: "xrechnung-ubl",
        DOCUMENT_XML_RENDERED_AT: new Date().toISOString(),
      })
      .eq("ID", invoiceId);

    if (upErr) {
      // best effort cleanup
      await bestEffortDeleteAsset({ supabase, asset: xmlAsset });
      throw new Error(upErr.message);
    }

    return res.json({ success: true, invoice_id: invRow.ID, xml_asset_id: xmlAsset.ID, already_existed: false });
  } catch (e) {
    console.error("[EINVOICE_SNAPSHOT]", { invoice_id: invoiceId, error: e?.message || String(e), stack: e?.stack });
    return res.status(500).json({ error: `Snapshot konnte nicht erzeugt werden: ${e?.message || e}` });
  }
});






// Wizard: Final booking (same behaviour as Abschlagsrechnung)
  // POST /api/invoices/:id/book
  // ----------------------------
  router.post("/:id/book", async (req, res) => {
    const { id } = req.params;

    const { data: inv, error: invErr } = await supabase
      .from("INVOICE")
      .select("ID, COMPANY_ID, PROJECT_ID, CONTRACT_ID, TOTAL_AMOUNT_NET, VAT_PERCENT, STATUS_ID, INVOICE_NUMBER, DOCUMENT_TEMPLATE_ID")
      .eq("ID", id)
      .maybeSingle();
    if (invErr || !inv) return res.status(500).json({ error: "INVOICE konnte nicht geladen werden" });

    // Prevent double-booking (would otherwise double-add totals to PROJECT/PROJECT_STRUCTURE)
    if (String(inv.STATUS_ID) === "2") {
      return res.status(400).json({ error: "Rechnung ist bereits gebucht" });
    }

    // Ensure TAX_AMOUNT_NET and TOTAL_AMOUNT_GROSS are filled on booking
    const vatPercent = toNum(inv.VAT_PERCENT);
    const totalNet = toNum(inv.TOTAL_AMOUNT_NET);
    const taxAmountNet = round2(totalNet * vatPercent / 100);
    const totalGross = round2(totalNet + taxAmountNet);


    // Assign number on booking if missing (Nummernkreis)
    if (!inv.INVOICE_NUMBER || !String(inv.INVOICE_NUMBER).trim()) {
      const { data: num, error: numErr } = await supabase.rpc("next_document_number", {
        p_company_id: inv.COMPANY_ID,
        p_doc_type: "INVOICE",
      });
      if (numErr || !num) {
        return res.status(500).json({ error: `Nummernkreis konnte nicht verwendet werden: ${numErr?.message || "unknown error"}` });
      }

      const { error: upNumErr } = await supabase
        .from("INVOICE")
        .update({ INVOICE_NUMBER: num })
        .eq("ID", id);

      if (upNumErr) return res.status(500).json({ error: upNumErr.message });
      inv.INVOICE_NUMBER = num;
    }

	// Stage A: render and snapshot PDF/template on booking
	let pdfAsset = null;
	let tpl = null;
	let theme = null;
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
	  pdfAsset = await storeGeneratedPdfAsAsset({
		supabase,
		companyId: inv.COMPANY_ID,
		fileName,
		pdfBuffer: r.pdf,
		assetType: "PDF_INVOICE",
	  });
	} catch (e) {
	  console.error("[BOOK_INVOICE][PDF]", {
		invoice_id: id,
		company_id: inv?.COMPANY_ID,
		invoice_number: inv?.INVOICE_NUMBER,
		error: e?.message || String(e),
		stack: e?.stack,
	  });
	  return res.status(500).json({ error: `PDF konnte nicht erzeugt werden: ${e?.message || e}` });
	}




    // Stage C1: generate and snapshot XRechnung XML on booking
    let xmlAsset = null;
    try {
      // Re-load full invoice row (the booking header query selects only a subset of columns)
      const { data: invFull, error: invFullErr } = await supabase
        .from("INVOICE")
        .select("*")
        .eq("ID", id)
        .maybeSingle();

      if (invFullErr || !invFull) {
        throw new Error(invFullErr?.message || "INVOICE konnte nicht vollstaendig geladen werden");
      }

      const xml = await generateUblInvoiceXml({ supabase, invoice: invFull, docType: "INVOICE" });
      const fileNameXml = `XRechnung_${invFull.INVOICE_NUMBER || invFull.ID || inv.ID}.xml`;
      xmlAsset = await storeGeneratedXmlAsAsset({
        supabase,
        companyId: inv.COMPANY_ID,
        fileName: fileNameXml,
        xmlString: xml,
        assetType: "XML_XRECHNUNG_INVOICE",
      });
	} catch (e) {
	  console.error("[BOOK_INVOICE][XRECHNUNG_XML]", {
		invoice_id: id,
		company_id: inv?.COMPANY_ID,
		invoice_number: inv?.INVOICE_NUMBER,
		error: e?.message || String(e),
		stack: e?.stack,
	  });

	  await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
	  return res.status(500).json({ error: `E-Rechnung konnte nicht erzeugt werden: ${e?.message || e}` });
	}

    // Update status + snapshot fields
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
      return res.status(500).json({ error: upErr.message });
    }

    // Update PROJECT.INVOICED += TOTAL_AMOUNT_NET
    const { data: project, error: projErr } = await supabase
      .from("PROJECT")
      .select("ID, INVOICED")
      .eq("ID", inv.PROJECT_ID)
      .maybeSingle();
    if (projErr || !project) {
      // best-effort revert booking + cleanup
      await supabase.from("INVOICE").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null }).eq("ID", id);
      await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
      return res.status(500).json({ error: "Projekt konnte nicht geladen werden" });
    }

    const current = toNum(project.INVOICED);
    const add = toNum(inv.TOTAL_AMOUNT_NET);

    const { error: projUpErr } = await supabase
      .from("PROJECT")
      .update({ INVOICED: round2(current + add) })
      .eq("ID", inv.PROJECT_ID);
    if (projUpErr) {
      await supabase.from("INVOICE").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null }).eq("ID", id);
      await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
      return res.status(500).json({ error: projUpErr.message });
    }

    // Update PROJECT_STRUCTURE.INVOICED per structure element of this invoice
    try {
      const sums = await sumInvStructureForInvoice({ invoiceId: id });
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
            .select("ID, INVOICED")
            .in("ID", structureIds);
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
      // best-effort revert booking + cleanup
      await supabase.from("INVOICE").update({ STATUS_ID: 1, DOCUMENT_PDF_ASSET_ID: null }).eq("ID", id);
      await bestEffortDeleteAsset({ supabase, asset: pdfAsset });
      return res.status(500).json({ error: `PROJECT_STRUCTURE konnte nicht aktualisiert werden: ${e?.message || e}` });
    }

    return res.json({ success: true, number: inv.INVOICE_NUMBER || null, pdf_asset_id: pdfAsset?.ID ?? null });
  });

  // ----------------------------
  // Wizard: Abort -> delete draft
  // DELETE /api/invoices/:id
  // ----------------------------
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;

    try {
      const { data: inv, error: invErr } = await supabase
        .from("INVOICE")
        .select("ID, STATUS_ID")
        .eq("ID", id)
        .maybeSingle();
      if (invErr || !inv) return res.status(404).json({ error: "INVOICE nicht gefunden" });
      if (String(inv.STATUS_ID) === "2") {
        return res.status(400).json({ error: "Gebuchte Rechnungen können nicht gelöscht werden" });
      }

      // Unassign TEC rows linked to this draft (best-effort)
      {
        const { error: tecErr } = await supabase
          .from("TEC")
          .update({ INVOICE_ID: null })
          .eq("INVOICE_ID", id);
        if (tecErr) {
          // ignore missing table/column in early dev
          const msg = String(tecErr.message || "").toLowerCase();
          if (!msg.includes("does not exist") && !msg.includes("column")) {
            throw new Error(tecErr.message);
          }
        }
      }

      // Delete INVOICE_STRUCTURE rows if table exists
      {
        const { error: sErr } = await supabase
          .from("INVOICE_STRUCTURE")
          .delete()
          .eq("INVOICE_ID", id);
        if (sErr && !isTableMissingErr(sErr, "invoice_structure")) {
          throw new Error(sErr.message);
        }
      }

      const { error: delErr } = await supabase.from("INVOICE").delete().eq("ID", id);
      if (delErr) throw new Error(delErr.message);

      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });


  // GET /api/invoices/:id
  router.get("/:id", async (req, res) => {
    const { id } = req.params;

    const { data: inv, error } = await supabase
      .from("INVOICE")
      .select("*")
      .eq("ID", id)
      .maybeSingle();
    if (error || !inv) return res.status(500).json({ error: "INVOICE konnte nicht geladen werden" });

    // Fetch project/contract names for display
    const { data: project } = await supabase
      .from("PROJECT")
      .select("NAME_SHORT, NAME_LONG")
      .eq("ID", inv.PROJECT_ID)
      .maybeSingle();

    // Contract can be CONTRACT or CONTRACTS
    let contract = null;
    const { data: c1 } = await supabase
      .from("CONTRACT")
      .select("NAME_SHORT, NAME_LONG")
      .eq("ID", inv.CONTRACT_ID)
      .maybeSingle();
    contract = c1;
    if (!contract) {
      const { data: c2 } = await supabase
        .from("CONTRACTS")
        .select("NAME_SHORT, NAME_LONG")
        .eq("ID", inv.CONTRACT_ID)
        .maybeSingle();
      contract = c2;
    }

    return res.json({ data: { inv, project, contract } });
  });

  return router;
};
