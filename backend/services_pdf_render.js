const path = require("path");
const fs = require("fs");
const nunjucks = require("nunjucks");

let _browserPromise = null;

function isTableMissingErr(err, tableName) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("relation") && msg.includes(String(tableName).toLowerCase()) && msg.includes("does not exist");
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    const bv = out[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
}

function defaultTheme() {
  return {
    brand: { primaryColor: "#111827", accentColor: "#2563eb", fontFamily: "Inter", fontScale: 1.0 },
    header: { showLogo: true, logoMaxHeightMm: 18 },
    footer: { textLeft: "Vielen Dank für Ihren Auftrag.", textRight: "Seite {page} von {pages}", showPageNumbers: true },
    blocks: {
      showProject: true,
      showContract: true,
      showAddressBlock: true,
      showContactBlock: true,
      showPaymentTerms: true,
      showBankDetails: true,
      showTaxSummary: true,
    },
    table: { showPositionNumbers: true, compactRows: false, showExtrasPercent: true },
  };
}

function formatMoneyEUR(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

async function getBrowser() {
  if (_browserPromise) return _browserPromise;
  _browserPromise = (async () => {
    const { chromium } = require("playwright-chromium");
    return chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  })();
  return _browserPromise;
}

async function renderPdf({ html, footerLeft, footerRight, showPageNumbers }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });

  const footerTemplate = `
    <div style="font-size:9px; width:100%; padding:0 12mm; color:#6b7280; display:flex; justify-content:space-between;">
      <div>${(footerLeft || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      <div>${(footerRight || "")
        .replace("{page}", '<span class="pageNumber"></span>')
        .replace("{pages}", '<span class="totalPages"></span>')}</div>
    </div>
  `;

  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "14mm", right: "12mm", bottom: "18mm", left: "12mm" },
    displayHeaderFooter: true,
    headerTemplate: `<div></div>`,
    footerTemplate: showPageNumbers
      ? footerTemplate
      : `<div style="font-size:9px; width:100%; padding:0 12mm; color:#6b7280;">${(footerLeft || "")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</div>`,
  });

  await page.close();
  return pdf;
}

/**
 * IMPORTANT:
 * - We use a singleton env (for filters)
 * - AND disable template caching so changes in .njk show immediately (no restart needed)
 */
let _nunjucksEnv = null;

function fmtDateDE(input) {
  if (!input) return "";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

function env() {
  if (_nunjucksEnv) return _nunjucksEnv;

  const templatesDir = path.join(__dirname, "templates");
  const loader = new nunjucks.FileSystemLoader(templatesDir, { noCache: true });
  const e = new nunjucks.Environment(loader, { autoescape: true });

  e.addFilter("date_de", (d) => fmtDateDE(d));

  // Usage: {{ start | date_range_de(end) }}
  e.addFilter("date_range_de", (start, end) => {
    const s = fmtDateDE(start);
    const t = fmtDateDE(end);
    if (s && t) return `${s} – ${t}`;
    if (s && !t) return `ab ${s}`;
    if (!s && t) return `bis ${t}`;
    return "";
  });

  _nunjucksEnv = e;
  return _nunjucksEnv;
}

async function loadLogoDataUri({ supabase, logoAssetId }) {
  if (!logoAssetId) return null;
  const { data, error } = await supabase.from("ASSET").select("*").eq("ID", logoAssetId).maybeSingle();
  if (error) {
    if (isTableMissingErr(error, "asset")) return null;
    throw new Error(error.message);
  }
  if (!data) return null;

  const uploadRoot = path.join(__dirname, "uploads");
  const filePath = path.join(uploadRoot, data.STORAGE_KEY);
  if (!fs.existsSync(filePath)) return null;

  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString("base64");
  return `data:${data.MIME_TYPE};base64,${b64}`;
}

async function loadTemplate({ supabase, companyId, docType, templateId }) {
  // Prefer explicit template id
  if (templateId) {
    const { data, error } = await supabase.from("DOCUMENT_TEMPLATE").select("*").eq("ID", templateId).maybeSingle();
    if (error) {
      if (isTableMissingErr(error, "document_template")) {
        throw new Error("Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql");
      }
      throw new Error(error.message);
    }
    if (data) return data;
  }

  // Else: default template
  const { data, error } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .select("*")
    .eq("COMPANY_ID", companyId)
    .eq("DOC_TYPE", docType)
    .eq("IS_DEFAULT", true)
    .maybeSingle();

  if (error) {
    if (isTableMissingErr(error, "document_template")) {
      throw new Error("Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql");
    }
    throw new Error(error.message);
  }
  if (data) return data;

  // Fallback: virtual default
  return {
    ID: null,
    COMPANY_ID: companyId,
    DOC_TYPE: docType,
    NAME: "Default",
    LAYOUT_KEY: "modern_a",
    THEME_JSON: defaultTheme(),
    LOGO_ASSET_ID: null,
  };
}

async function buildSeller({ supabase, companyId }) {
  const { data, error } = await supabase
    .from("COMPANY")
    .select('ID, COMPANY_NAME_1, COMPANY_NAME_2, STREET, POST_CODE, CITY, COUNTRY_ID, "TAX-ID"')
    .eq("ID", companyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return {
    name1: data?.COMPANY_NAME_1 || "",
    name2: data?.COMPANY_NAME_2 || "",
    street: data?.STREET || "",
    postCode: data?.POST_CODE || "",
    city: data?.CITY || "",
    taxId: data?.["TAX-ID"] || "",
  };
}

async function loadProject({ supabase, projectId }) {
  if (!projectId) return { nameShort: "", nameLong: "" };
  const { data } = await supabase.from("PROJECT").select("ID, NAME_SHORT, NAME_LONG").eq("ID", projectId).maybeSingle();
  return { nameShort: data?.NAME_SHORT || "", nameLong: data?.NAME_LONG || "" };
}

async function loadContract({ supabase, contractId }) {
  if (!contractId) return { nameShort: "", nameLong: "" };
  const { data } = await supabase.from("CONTRACT").select("ID, NAME_SHORT, NAME_LONG").eq("ID", contractId).maybeSingle();
  return { nameShort: data?.NAME_SHORT || "", nameLong: data?.NAME_LONG || "" };
}

async function loadContactFullName({ supabase, contactId }) {
  if (!contactId) return "";
  const { data, error } = await supabase.from("CONTACTS").select("ID, FIRST_NAME, LAST_NAME").eq("ID", contactId).maybeSingle();
  if (error) {
    if (isTableMissingErr(error, "contacts")) return "";
    throw new Error(error.message);
  }
  const first = data?.FIRST_NAME || "";
  const last = data?.LAST_NAME || "";
  return `${first} ${last}`.trim();
}

async function loadProjectStructureRows({ supabase, projectId, docType, thisDocNet }) {
  if (!projectId) return [];
  const { data, error } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, NAME_SHORT, NAME_LONG, REVENUE, EXTRAS, PARTIAL_PAYMENTS, INVOICED")
    .eq("PROJECT_ID", projectId)
    .order("ID", { ascending: true });

  if (error) {
    if (isTableMissingErr(error, "project_structure")) return [];
    throw new Error(error.message);
  }

  return (data || []).map((r) => {
    const revenue = Number(r.REVENUE || 0);
    const extras = Number(r.EXTRAS || 0);
    const feeTotal = revenue + extras;
    const performed = docType === "INVOICE" ? Number(r.INVOICED || 0) : Number(r.PARTIAL_PAYMENTS || 0);
    return {
      id: r.ID,
      nameShort: r.NAME_SHORT || "",
      nameLong: r.NAME_LONG || "",
      feeTotal,
      performed,
      thisDocNet: Number(thisDocNet || 0),
    };
  });
}

async function loadTecRows({ supabase, docType, docId }) {
  try {
    const base = supabase
      .from("TEC")
      .select(
        "ID, DATE_VOUCHER, EMPLOYEE_ID, QUANTITY_EXT, SP_RATE, SP_TOT, POSTING_DESCRIPTION, INVOICE_ID, PARTIAL_PAYMENT_ID"
      );

    const { data, error } = docType === "INVOICE" ? await base.eq("INVOICE_ID", docId) : await base.eq("PARTIAL_PAYMENT_ID", docId);

    if (error) {
      if (isTableMissingErr(error, "tec")) return { rows: [], sumQty: 0, sumTot: 0 };
      throw new Error(error.message);
    }

    const rows = data || [];
    const empIds = Array.from(
      new Set(rows.map((r) => r.EMPLOYEE_ID).filter(Boolean).map((x) => Number(x)).filter((n) => Number.isFinite(n)))
    );

    const empMap = new Map();
    if (empIds.length) {
      const { data: emps, error: empErr } = await supabase.from("EMPLOYEE").select("ID, FIRST_NAME, LAST_NAME").in("ID", empIds);
      if (empErr) {
        if (!isTableMissingErr(empErr, "employee")) throw new Error(empErr.message);
      } else {
        (emps || []).forEach((e) => empMap.set(String(e.ID), `${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`.trim()));
      }
    }

    rows.sort((a, b) => String(a.DATE_VOUCHER || "").localeCompare(String(b.DATE_VOUCHER || "")));

    let sumQty = 0;
    let sumTot = 0;

    const out = rows.map((r) => {
      const qty = Number(r.QUANTITY_EXT || 0);
      const tot = Number(r.SP_TOT || 0);
      sumQty += qty;
      sumTot += tot;
      return {
        dateVoucher: r.DATE_VOUCHER || "",
        employeeName: empMap.get(String(r.EMPLOYEE_ID)) || "",
        quantityExt: qty,
        spRate: Number(r.SP_RATE || 0),
        spTot: tot,
        postingDescription: r.POSTING_DESCRIPTION || "",
      };
    });

    return { rows: out, sumQty, sumTot };
  } catch (e) {
    console.error("[TEC_LOAD]", e);
    return { rows: [], sumQty: 0, sumTot: 0 };
  }
}

async function buildInvoiceViewModel({ supabase, invoiceId }) {
  const { data: inv, error: invErr } = await supabase.from("INVOICE").select("*").eq("ID", invoiceId).maybeSingle();
  if (invErr) throw new Error(invErr.message);
  if (!inv) throw new Error("Rechnung nicht gefunden");

  const seller = await buildSeller({ supabase, companyId: inv.COMPANY_ID });

  const project = await loadProject({ supabase, projectId: inv.PROJECT_ID });
  const contract = await loadContract({ supabase, contractId: inv.CONTRACT_ID });
  const buyerContactName = await loadContactFullName({ supabase, contactId: inv.INVOICE_CONTACT_ID });

  // Lines
  const { data: rows, error: rowsErr } = await supabase
    .from("INVOICE_STRUCTURE")
    .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
    .eq("INVOICE_ID", invoiceId);

  if (rowsErr && !isTableMissingErr(rowsErr, "invoice_structure")) throw new Error(rowsErr.message);

  const structureIds = (rows || []).map((r) => r.STRUCTURE_ID).filter((x) => x !== null && x !== undefined);
  let structureMap = new Map();
  if (structureIds.length) {
    const { data: ps } = await supabase.from("PROJECT_STRUCTURE").select("ID, NAME_SHORT, NAME_LONG").in("ID", structureIds);
    (ps || []).forEach((s) => structureMap.set(String(s.ID), s));
  }

  const lines = (rows || []).map((r, idx) => {
    const s = structureMap.get(String(r.STRUCTURE_ID));
    const net = Number(r.AMOUNT_NET || 0);
    const extras = Number(r.AMOUNT_EXTRAS_NET || 0);
    const total = net + extras;
    return {
      pos: idx + 1,
      title: s?.NAME_SHORT || `Pos ${idx + 1}`,
      description: s?.NAME_LONG || "",
      net,
      extras,
      total,
    };
  });

  const amountNet = lines.reduce((a, l) => a + Number(l.net || 0), 0);
  const amountExtrasNet = lines.reduce((a, l) => a + Number(l.extras || 0), 0);

  const totalNet = Number(inv.TOTAL_AMOUNT_NET || 0);
  const totalGross = Number(inv.TOTAL_AMOUNT_GROSS || 0);
  const vatAmount = totalGross - totalNet;
  const vatPct = Number(inv.VAT_PERCENT || 0);

  // Paid
  const { data: payRows } = await supabase.from("PAYMENT").select("AMOUNT_PAYED_GROSS").eq("INVOICE_ID", invoiceId);
  const paidGross = (payRows || []).reduce((acc, r) => acc + Number(r.AMOUNT_PAYED_GROSS || 0), 0);
  const openGross = totalGross - paidGross;

  return {
    doc: {
      type: "INVOICE",
      title: "Rechnung",
      number: inv.INVOICE_NUMBER || "",
      date: inv.INVOICE_DATE || "",
      dueDate: inv.DUE_DATE || "",
      billingPeriodStart: inv.BILLING_PERIOD_START || "",
      billingPeriodFinish: inv.BILLING_PERIOD_FINISH || "",
      text1: inv.TEXT_1 || "",
      text2: inv.TEXT_2 || "",
      amountNet,
      amountExtrasNet,
      totalAmountNet: totalNet,
      vatPercent: vatPct,
    },
    seller,
    buyer: {
      name1: inv.ADDRESS_NAME_1 || "",
      name2: inv.ADDRESS_NAME_2 || "",
      street: inv.STREET || "",
      postCode: inv.POST_CODE || "",
      city: inv.CITY || "",
      contactName: buyerContactName || "",
    },
    project,
    contract,
    projectStructureRows: await loadProjectStructureRows({ supabase, projectId: inv.PROJECT_ID, docType: "INVOICE", thisDocNet: totalNet }),
    tec: await loadTecRows({ supabase, docType: "INVOICE", docId: inv.ID }),
    lines,
    totals: {
      totalNet,
      vatPct,
      vatAmount,
      totalGross,
      paidGross,
      openGross,
    },
  };
}

async function buildPartialPaymentViewModel({ supabase, partialPaymentId }) {
  const { data: pp, error: ppErr } = await supabase.from("PARTIAL_PAYMENT").select("*").eq("ID", partialPaymentId).maybeSingle();
  if (ppErr) throw new Error(ppErr.message);
  if (!pp) throw new Error("Abschlagsrechnung nicht gefunden");

  const seller = await buildSeller({ supabase, companyId: pp.COMPANY_ID });

  const project = await loadProject({ supabase, projectId: pp.PROJECT_ID });
  const contract = await loadContract({ supabase, contractId: pp.CONTRACT_ID });
  const buyerContactName = await loadContactFullName({ supabase, contactId: pp.PARTIAL_PAYMENT_CONTACT_ID });

  const { data: rows, error: rowsErr } = await supabase
    .from("PARTIAL_PAYMENT_STRUCTURE")
    .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
    .eq("PARTIAL_PAYMENT_ID", partialPaymentId);

  if (rowsErr && !isTableMissingErr(rowsErr, "partial_payment_structure")) throw new Error(rowsErr.message);

  const structureIds = (rows || []).map((r) => r.STRUCTURE_ID).filter((x) => x !== null && x !== undefined);
  let structureMap = new Map();
  if (structureIds.length) {
    const { data: ps } = await supabase.from("PROJECT_STRUCTURE").select("ID, NAME_SHORT, NAME_LONG").in("ID", structureIds);
    (ps || []).forEach((s) => structureMap.set(String(s.ID), s));
  }

  const lines = (rows || []).map((r, idx) => {
    const s = structureMap.get(String(r.STRUCTURE_ID));
    const net = Number(r.AMOUNT_NET || 0);
    const extras = Number(r.AMOUNT_EXTRAS_NET || 0);
    const total = net + extras;
    return {
      pos: idx + 1,
      title: s?.NAME_SHORT || `Pos ${idx + 1}`,
      description: s?.NAME_LONG || "",
      net,
      extras,
      total,
    };
  });

  const amountNet = lines.reduce((a, l) => a + Number(l.net || 0), 0);
  const amountExtrasNet = lines.reduce((a, l) => a + Number(l.extras || 0), 0);

  const totalNet = Number(pp.TOTAL_AMOUNT_NET || 0);
  const totalGross = Number(pp.TOTAL_AMOUNT_GROSS || 0);
  const vatAmount = totalGross - totalNet;
  const vatPct = Number(pp.VAT_PERCENT || 0);

  const { data: payRows } = await supabase.from("PAYMENT").select("AMOUNT_PAYED_GROSS").eq("PARTIAL_PAYMENT_ID", partialPaymentId);
  const paidGross = (payRows || []).reduce((acc, r) => acc + Number(r.AMOUNT_PAYED_GROSS || 0), 0);
  const openGross = totalGross - paidGross;

  return {
    doc: {
      type: "PARTIAL_PAYMENT",
      title: "Abschlagsrechnung",
      number: pp.PARTIAL_PAYMENT_NUMBER || "",
      date: pp.PARTIAL_PAYMENT_DATE || "",
      dueDate: pp.DUE_DATE || "",
      billingPeriodStart: pp.BILLING_PERIOD_START || "",
      billingPeriodFinish: pp.BILLING_PERIOD_FINISH || "",
      text1: pp.TEXT_1 || "",
      text2: pp.TEXT_2 || "",
      amountNet,
      amountExtrasNet,
      totalAmountNet: totalNet,
      vatPercent: vatPct,
    },
    seller,
    buyer: {
      name1: pp.ADDRESS_NAME_1 || "",
      name2: pp.ADDRESS_NAME_2 || "",
      street: pp.STREET || "",
      postCode: pp.POST_CODE || "",
      city: pp.CITY || "",
      contactName: buyerContactName || "",
    },
    project,
    contract,
    projectStructureRows: await loadProjectStructureRows({
      supabase,
      projectId: pp.PROJECT_ID,
      docType: "PARTIAL_PAYMENT",
      thisDocNet: totalNet,
    }),
    tec: await loadTecRows({ supabase, docType: "PARTIAL_PAYMENT", docId: pp.ID }),
    lines,
    totals: {
      totalNet,
      vatPct,
      vatAmount,
      totalGross,
      paidGross,
      openGross,
    },
  };
}

async function renderDocumentPdf({ supabase, docType, docId, templateId }) {
  const companyId =
    docType === "INVOICE"
      ? (await supabase.from("INVOICE").select("COMPANY_ID").eq("ID", docId).maybeSingle()).data?.COMPANY_ID
      : (await supabase.from("PARTIAL_PAYMENT").select("COMPANY_ID").eq("ID", docId).maybeSingle()).data?.COMPANY_ID;

  if (!companyId) throw new Error("Company for document not found");

  const tpl = await loadTemplate({ supabase, companyId, docType, templateId });
  const theme = deepMerge(defaultTheme(), tpl.THEME_JSON || {});
  const logoDataUri = await loadLogoDataUri({ supabase, logoAssetId: tpl.LOGO_ASSET_ID });

  const vm =
    docType === "INVOICE"
      ? await buildInvoiceViewModel({ supabase, invoiceId: docId })
      : await buildPartialPaymentViewModel({ supabase, partialPaymentId: docId });

  vm.theme = theme;
  vm.logoDataUri = logoDataUri;
  vm.formatMoneyEUR = formatMoneyEUR;

  const templateFile = docType === "INVOICE" ? "invoice.njk" : "partial_payment.njk";
  const templatePath = path.join(tpl.LAYOUT_KEY || "modern_a", templateFile);

  const html = env().render(templatePath, vm);

  const pdf = await renderPdf({
    html,
    footerLeft: theme.footer?.textLeft || "",
    footerRight: theme.footer?.textRight || "",
    showPageNumbers: theme.footer?.showPageNumbers !== false,
  });

  return { pdf, template: tpl, theme };
}

module.exports = { renderDocumentPdf };
