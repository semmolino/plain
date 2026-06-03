"use strict";

const { generateUblInvoiceXml } = require("../services_einvoice_ubl");
const { renderDocumentPdf } = require("../services_pdf_render");
const { insertProgressSnapshot } = require("./projectProgress");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uploadRoot() {
  return path.join(__dirname, "..", "uploads");
}

function safeFileName(name, fallback) {
  const base = String(name || fallback || "document").replace(/[\/:*?"<>|]+/g, "_").trim();
  return base.length ? base : "document";
}

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(toNum(v) * 100) / 100;
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

async function recomputeTotal(supabase, invoiceId) {
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

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

async function getPhases(supabase, { id, tenantId }) {
  const { data: inv, error: invErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, PROJECT_ID, CONTRACT_ID, INVOICE_TYPE")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (invErr || !inv) throw { status: 404, message: "INVOICE nicht gefunden" };

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
    if (psErr) throw psErr;
    psRows = byProject || [];
  }

  const { data: isRows } = await supabase
    .from("INVOICE_STRUCTURE")
    .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
    .eq("INVOICE_ID", id);
  const selectedMap = new Map((isRows || []).map((r) => [String(r.STRUCTURE_ID), r]));

  return psRows.map((ps) => {
    const revenue = toNum(ps.REVENUE_COMPLETION);
    const extrasAmount = round2((revenue * toNum(ps.EXTRAS_PERCENT)) / 100);
    const totalEarned = round2(revenue + extrasAmount);
    // BILLED_FINAL = amount already invoiced via previous final invoices (not Abschlagsrechnungen)
    const billedFinal = round2(toNum(ps.INVOICED));
    // ALREADY_BILLED = informational total (partial payments + final invoices)
    const alreadyBilled = round2(toNum(ps.PARTIAL_PAYMENTS) + billedFinal);
    const sel = selectedMap.get(String(ps.ID));
    const closedByOther = ps.CLOSED_BY_INVOICE_ID && String(ps.CLOSED_BY_INVOICE_ID) !== String(id);
    const defaultAmount = round2(Math.max(0, totalEarned - billedFinal));
    return {
      ID: ps.ID,
      FATHER_ID: ps.FATHER_ID ?? null,
      NAME_SHORT: ps.NAME_SHORT ?? "",
      NAME_LONG: ps.NAME_LONG ?? "",
      BILLING_TYPE_ID: ps.BILLING_TYPE_ID,
      REVENUE_COMPLETION: revenue,
      EXTRAS_AMOUNT: extrasAmount,
      TOTAL_EARNED: totalEarned,
      BILLED_FINAL: billedFinal,
      ALREADY_BILLED: alreadyBilled,
      AMOUNT_NET: sel ? toNum(sel.AMOUNT_NET) : round2(Math.max(0, revenue - billedFinal * (totalEarned > 0 ? revenue / totalEarned : 1))),
      AMOUNT_EXTRAS_NET: sel ? toNum(sel.AMOUNT_EXTRAS_NET) : round2(Math.max(0, defaultAmount - Math.max(0, revenue - billedFinal * (totalEarned > 0 ? revenue / totalEarned : 1)))),
      SELECTED: !!sel,
      CLOSED_BY_INVOICE_ID: ps.CLOSED_BY_INVOICE_ID ?? null,
      CLOSED: !!closedByOther,
    };
  });
}

async function savePhases(supabase, { id, tenantId, structureIds }) {
  const { data: inv, error: invErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, TENANT_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (invErr || !inv) throw { status: 404, message: "INVOICE nicht gefunden" };
  if (String(inv.STATUS_ID) === "2") throw { status: 400, message: "Gebuchte Rechnungen können nicht geändert werden" };

  const { error: delErr } = await supabase.from("INVOICE_STRUCTURE").delete().eq("INVOICE_ID", id);
  if (delErr) throw new Error(delErr.message);

  if (structureIds.length > 0) {
    const { data: psRows, error: psErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, REVENUE_COMPLETION, EXTRAS_PERCENT, PARTIAL_PAYMENTS, INVOICED")
      .in("ID", structureIds);
    if (psErr) throw new Error(psErr.message);

    const rows = (psRows || []).map((ps) => {
      const revenue = toNum(ps.REVENUE_COMPLETION);
      const extras = round2((revenue * toNum(ps.EXTRAS_PERCENT)) / 100);
      const totalEarned = round2(revenue + extras);
      // Only subtract amounts already invoiced via previous FINAL invoices (not Abschlagsrechnungen)
      const billedFinal = round2(toNum(ps.INVOICED));
      const remaining = Math.max(0, round2(totalEarned - billedFinal));
      const remainingRevenue = totalEarned > 0 ? round2(remaining * revenue / totalEarned) : remaining;
      const remainingExtras = round2(remaining - remainingRevenue);
      return {
        INVOICE_ID: parseInt(id, 10),
        STRUCTURE_ID: ps.ID,
        AMOUNT_NET: remainingRevenue,
        AMOUNT_EXTRAS_NET: remainingExtras,
        TENANT_ID: inv.TENANT_ID,
      };
    });

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("INVOICE_STRUCTURE").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
  }

  return recomputeTotal(supabase, id);
}

async function getDeductions(supabase, { id, tenantId }) {
  const { data: inv, error: invErr } = await supabase
    .from("INVOICE")
    .select("ID, PROJECT_ID, STATUS_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (invErr || !inv) throw { status: 404, message: "INVOICE nicht gefunden" };

  const { data: ppRows, error: ppErr } = await supabase
    .from("PARTIAL_PAYMENT")
    .select("ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, TOTAL_AMOUNT_NET")
    .eq("PROJECT_ID", inv.PROJECT_ID)
    .eq("STATUS_ID", 2)
    .eq("TENANT_ID", tenantId)
    .order("PARTIAL_PAYMENT_DATE", { ascending: true });
  if (ppErr) throw new Error(ppErr.message);

  // Find PPs already claimed by other booked final invoices
  const { data: usedRows } = await supabase
    .from("INVOICE_DEDUCTION")
    .select("PARTIAL_PAYMENT_ID, INVOICE_ID")
    .eq("TENANT_ID", tenantId)
    .neq("INVOICE_ID", id);

  let alreadyUsedPpIds = new Set();
  if ((usedRows || []).length > 0) {
    const usedInvoiceIds = [...new Set((usedRows || []).map((r) => r.INVOICE_ID))];
    const { data: bookedInvRows } = await supabase
      .from("INVOICE")
      .select("ID")
      .in("ID", usedInvoiceIds)
      .eq("STATUS_ID", 2)
      .in("INVOICE_TYPE", ["schlussrechnung", "teilschlussrechnung"]);
    const bookedFinalIds = new Set((bookedInvRows || []).map((r) => String(r.ID)));
    alreadyUsedPpIds = new Set(
      (usedRows || [])
        .filter((r) => bookedFinalIds.has(String(r.INVOICE_ID)))
        .map((r) => String(r.PARTIAL_PAYMENT_ID))
    );
  }

  const filteredPpRows = (ppRows || []).filter((pp) => !alreadyUsedPpIds.has(String(pp.ID)));

  // Saved deduction amounts for this draft invoice
  const { data: idRows } = await supabase
    .from("INVOICE_DEDUCTION")
    .select("PARTIAL_PAYMENT_ID, DEDUCTION_AMOUNT_NET")
    .eq("INVOICE_ID", id);
  const selectedMap = new Map(
    (idRows || []).map((r) => [String(r.PARTIAL_PAYMENT_ID), toNum(r.DEDUCTION_AMOUNT_NET)])
  );

  // Structure IDs linked to each PP (for warning feature in frontend)
  const ppIds = filteredPpRows.map((pp) => pp.ID);
  const ppStructureMap = new Map();
  if (ppIds.length > 0) {
    const { data: ppsRows } = await supabase
      .from("PARTIAL_PAYMENT_STRUCTURE")
      .select("PARTIAL_PAYMENT_ID, STRUCTURE_ID")
      .in("PARTIAL_PAYMENT_ID", ppIds);
    for (const pps of (ppsRows || [])) {
      const key = String(pps.PARTIAL_PAYMENT_ID);
      if (!ppStructureMap.has(key)) ppStructureMap.set(key, []);
      ppStructureMap.get(key).push(pps.STRUCTURE_ID);
    }
  }

  return filteredPpRows.map((pp) => ({
    ID: pp.ID,
    PARTIAL_PAYMENT_NUMBER: pp.PARTIAL_PAYMENT_NUMBER ?? "",
    PARTIAL_PAYMENT_DATE: pp.PARTIAL_PAYMENT_DATE ?? null,
    AMOUNT_NET: toNum(pp.TOTAL_AMOUNT_NET),
    TOTAL_AMOUNT_NET: toNum(pp.TOTAL_AMOUNT_NET),
    SELECTED: selectedMap.has(String(pp.ID)),
    DEDUCTION_AMOUNT_NET: selectedMap.has(String(pp.ID))
      ? selectedMap.get(String(pp.ID))
      : toNum(pp.TOTAL_AMOUNT_NET),
    STRUCTURE_IDS: ppStructureMap.get(String(pp.ID)) ?? [],
  }));
}

async function saveDeductions(supabase, { id, tenantId, items }) {
  const { data: inv, error: invErr } = await supabase
    .from("INVOICE")
    .select("ID, STATUS_ID, TENANT_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (invErr || !inv) throw { status: 404, message: "INVOICE nicht gefunden" };
  if (String(inv.STATUS_ID) === "2") throw { status: 400, message: "Gebuchte Rechnungen können nicht geändert werden" };

  const { error: delErr } = await supabase.from("INVOICE_DEDUCTION").delete().eq("INVOICE_ID", id);
  if (delErr) throw new Error(delErr.message);

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
      if (insErr) throw new Error(insErr.message);
    }
  }

  return recomputeTotal(supabase, id);
}

async function getFinalInvoice(supabase, { id, tenantId }) {
  const { data: inv, error: invErr } = await supabase
    .from("INVOICE")
    .select("*")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (invErr || !inv) throw { status: 404, message: "INVOICE nicht gefunden" };

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

  return { ...inv, PHASE_TOTAL: phaseTotal, DEDUCTIONS_TOTAL: deductionsTotal };
}

async function bookFinalInvoice(supabase, { id, tenantId, releasePpIds = [] }) {
  const { data: inv, error: invErr } = await supabase
    .from("INVOICE")
    .select("ID, COMPANY_ID, PROJECT_ID, TOTAL_AMOUNT_NET, VAT_PERCENT, STATUS_ID, INVOICE_NUMBER, DOCUMENT_TEMPLATE_ID, INVOICE_TYPE, TENANT_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (invErr || !inv) throw { status: 500, message: "INVOICE konnte nicht geladen werden" };
  if (String(inv.STATUS_ID) === "2") throw { status: 400, message: "Rechnung ist bereits gebucht" };

  const validTypes = ["schlussrechnung", "teilschlussrechnung"];
  if (!validTypes.includes(inv.INVOICE_TYPE)) {
    throw { status: 400, message: "Nur Schluss- und Teilschlussrechnungen können über diesen Endpunkt gebucht werden" };
  }

  // ── Sicherheitseinbehalt-Auflösung (Phase 2) ──────────────────────────────
  // BEFORE PDF render so PDF reflects the SE release rows.
  let seReleaseTotal = 0;
  if (Array.isArray(releasePpIds) && releasePpIds.length > 0) {
    try {
      const { data: pps, error: ppsErr } = await supabase
        .from("PARTIAL_PAYMENT")
        .select("ID, SE_AMOUNT, SE_RELEASED_BY_INVOICE_ID, PROJECT_ID, TENANT_ID")
        .in("ID", releasePpIds);
      if (ppsErr) throw new Error(ppsErr.message);

      const validPps = (pps || []).filter(p =>
        Number(p.SE_AMOUNT || 0) > 0 &&
        p.SE_RELEASED_BY_INVOICE_ID == null &&
        p.TENANT_ID == tenantId &&
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

        try {
          await supabase.from("SE_RELEASE").insert({
            TENANT_ID:          tenantId || pp.TENANT_ID,
            PARTIAL_PAYMENT_ID: pp.ID,
            INVOICE_ID:         parseInt(id, 10),
            SE_AMOUNT_RELEASED: amt,
          });
        } catch (_) { /* SE_RELEASE table may not exist yet */ }
      }

      if (seReleaseTotal > 0) {
        const { error: invUpErr } = await supabase.from("INVOICE")
          .update({ SE_RELEASE_TOTAL: seReleaseTotal })
          .eq("ID", id);
        if (invUpErr && !String(invUpErr.message || "").includes("SE_")) {
          throw new Error(invUpErr.message);
        }
      }
    } catch (e) {
      throw { status: 500, message: `Sicherheitseinbehalt-Auflösung fehlgeschlagen: ${e?.message || e}` };
    }
  }

  const vatPercent = toNum(inv.VAT_PERCENT);
  const totalNet = toNum(inv.TOTAL_AMOUNT_NET);
  const taxAmountNet = round2((totalNet * vatPercent) / 100);
  const totalGross = round2(totalNet + taxAmountNet);

  if (!inv.INVOICE_NUMBER || !String(inv.INVOICE_NUMBER).trim()) {
    const { data: num, error: numErr } = await supabase.rpc("next_document_number", {
      p_company_id: inv.COMPANY_ID,
      p_doc_type: "INVOICE",
    });
    if (numErr || !num) throw { status: 500, message: `Nummernkreis: ${numErr?.message || "unknown"}` };
    await supabase.from("INVOICE").update({ INVOICE_NUMBER: num }).eq("ID", id);
    inv.INVOICE_NUMBER = num;
  }

  const prefix = inv.INVOICE_TYPE === "schlussrechnung" ? "Schlussrechnung" : "Teilschlussrechnung";

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
    throw { status: 500, message: `PDF konnte nicht erzeugt werden: ${e?.message || e}` };
  }

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
    throw { status: 500, message: `E-Rechnung konnte nicht erzeugt werden: ${e?.message || e}` };
  }

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
    throw new Error(upErr.message);
  }

  const { data: project } = await supabase
    .from("PROJECT")
    .select("ID, INVOICED")
    .eq("ID", inv.PROJECT_ID)
    .maybeSingle();
  if (project) {
    await supabase
      .from("PROJECT")
      .update({ INVOICED: round2(toNum(project.INVOICED) + totalNet) })
      .eq("ID", inv.PROJECT_ID);
  }

  try {
    const { data: isRows } = await supabase
      .from("INVOICE_STRUCTURE")
      .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
      .eq("INVOICE_ID", id);
    const structureIds = (isRows || [])
      .map((r) => parseInt(r.STRUCTURE_ID, 10))
      .filter((n) => Number.isFinite(n));
    if (structureIds.length > 0) {
      await supabase.from("PROJECT_STRUCTURE")
        .update({ CLOSED_BY_INVOICE_ID: parseInt(id, 10) })
        .in("ID", structureIds);
    }

    // PROJECT_PROGRESS: one row per structure with the INVOICED delta
    if ((isRows || []).length > 0) {
      const addByStructure = new Map();
      (isRows || []).forEach((r) => {
        const sid = String(r.STRUCTURE_ID);
        addByStructure.set(sid, round2((addByStructure.get(sid) || 0) + toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET)));
      });
      const finalProgressRows = Array.from(addByStructure.entries()).map(([sid, invoiced]) => ({
        TENANT_ID:    inv.TENANT_ID ?? tenantId ?? null,
        STRUCTURE_ID: parseInt(sid, 10),
        INVOICED:     invoiced,
      }));
      if (finalProgressRows.length > 0) {
        const { error: fpErr } = await insertProgressSnapshot(supabase, finalProgressRows);
        if (fpErr) console.error("[BOOK_FINAL][PROGRESS]", fpErr.message);
      }
    }
  } catch (e) {
    console.error("[BOOK_FINAL][CLOSE_PHASES]", e);
  }

  return { number: inv.INVOICE_NUMBER, pdf_asset_id: pdfAsset?.ID ?? null };
}

module.exports = {
  getPhases,
  savePhases,
  getDeductions,
  saveDeductions,
  getFinalInvoice,
  bookFinalInvoice,
};
