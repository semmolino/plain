'use strict';

const path = require('path');
const fs   = require('fs');
const nunjucks = require('nunjucks');
const { loadInvoiceData } = require('./services_einvoice_data');

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTableMissingErr(err, tableName) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('relation') && msg.includes(String(tableName).toLowerCase()) && msg.includes('does not exist');
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const k of Object.keys(patch)) {
    const pv = patch[k], bv = out[k];
    if (pv && typeof pv === 'object' && !Array.isArray(pv) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
}

function defaultTheme() {
  return {
    header: { showLogo: true, logoMaxHeightMm: 20 },
    footer: { showPageNumbers: true },
    blocks: { showProjectStructure: true, showTec: true },
  };
}

function fmtMoney(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function fmtDateDE(input) {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// ── Playwright ────────────────────────────────────────────────────────────────

let _browserPromise = null;

async function getBrowser() {
  if (_browserPromise) return _browserPromise;
  _browserPromise = (async () => {
    const { chromium } = require('playwright-chromium');
    return chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  })();
  return _browserPromise;
}

async function renderPdf({ html, footerLeft }) {
  const browser = await getBrowser();
  const page    = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });

  const footerTemplate = `
    <div style="font-size:7.5px;width:100%;padding:0 20mm 0 25mm;color:#9ca3af;display:flex;justify-content:space-between;align-items:center;">
      <div style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${(footerLeft || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div style="white-space:nowrap;margin-left:4mm;">Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>
    </div>`;

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', right: '20mm', bottom: '16mm', left: '25mm' },
    displayHeaderFooter: true,
    headerTemplate: `<div></div>`,
    footerTemplate,
  });

  await page.close();
  return pdf;
}

// ── Nunjucks ──────────────────────────────────────────────────────────────────

let _nunjucksEnv = null;

function env() {
  if (_nunjucksEnv) return _nunjucksEnv;
  const loader = new nunjucks.FileSystemLoader(path.join(__dirname, 'templates'), { noCache: true });
  const e = new nunjucks.Environment(loader, { autoescape: true });

  e.addFilter('date_de', d => fmtDateDE(d));

  e.addFilter('date_range_de', (start, end) => {
    const s = fmtDateDE(start), t = fmtDateDE(end);
    if (s && t) return `${s}\u2013${t}`;
    if (s) return `ab ${s}`;
    if (t) return `bis ${t}`;
    return '';
  });

  e.addFilter('money', v => fmtMoney(v));

  _nunjucksEnv = e;
  return _nunjucksEnv;
}

// ── Asset / template loading ──────────────────────────────────────────────────

async function loadLogoDataUri({ supabase, logoAssetId }) {
  if (!logoAssetId) return null;
  const { data } = await supabase.from('ASSET').select('*').eq('ID', logoAssetId).maybeSingle();
  if (!data) return null;
  const filePath = path.join(__dirname, 'uploads', data.STORAGE_KEY);
  if (!fs.existsSync(filePath)) return null;
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${data.MIME_TYPE};base64,${b64}`;
}

async function loadTemplate({ supabase, companyId, docType, templateId }) {
  if (templateId) {
    const { data } = await supabase.from('DOCUMENT_TEMPLATE').select('*').eq('ID', templateId).maybeSingle();
    if (data) return data;
  }
  const { data } = await supabase
    .from('DOCUMENT_TEMPLATE').select('*')
    .eq('COMPANY_ID', companyId).eq('DOC_TYPE', docType).eq('IS_DEFAULT', true)
    .maybeSingle();
  if (data) return data;
  return {
    ID: null, COMPANY_ID: companyId, DOC_TYPE: docType, NAME: 'Default',
    LAYOUT_KEY: 'modern_a', THEME_JSON: defaultTheme(), LOGO_ASSET_ID: null,
  };
}

// ── Auxiliary data loaders ────────────────────────────────────────────────────

async function loadProjectStructureRows({ supabase, projectId, docType, docId }) {
  if (!projectId) return [];

  const { data, error } = await supabase
    .from('PROJECT_STRUCTURE')
    .select('ID, NAME_SHORT, NAME_LONG, REVENUE, EXTRAS, PARTIAL_PAYMENTS, INVOICED')
    .eq('PROJECT_ID', projectId)
    .order('ID', { ascending: true });

  if (error) {
    if (isTableMissingErr(error, 'project_structure')) return [];
    throw new Error(error.message);
  }

  // Per-phase amounts from this specific document
  const structTable = docType === 'INVOICE' ? 'INVOICE_STRUCTURE' : 'PARTIAL_PAYMENT_STRUCTURE';
  const docIdField  = docType === 'INVOICE' ? 'INVOICE_ID' : 'PARTIAL_PAYMENT_ID';
  const { data: docRows } = await supabase
    .from(structTable).select('STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET').eq(docIdField, docId);
  const docMap = Object.fromEntries((docRows || []).map(r => [r.STRUCTURE_ID, r]));

  return (data || []).map(r => {
    const revenue       = Number(r.REVENUE || 0);
    const extras        = Number(r.EXTRAS  || 0);
    const feeTotal      = revenue + extras;
    const alreadyBilled = docType === 'INVOICE'
      ? Number(r.INVOICED         || 0)
      : Number(r.PARTIAL_PAYMENTS || 0);
    const dr         = docMap[r.ID];
    const thisDocNet = dr ? Number(dr.AMOUNT_NET || 0) + Number(dr.AMOUNT_EXTRAS_NET || 0) : 0;
    return {
      nameShort:    r.NAME_SHORT || '',
      nameLong:     r.NAME_LONG  || '',
      feeTotal,
      alreadyBilled,
      thisDocNet,
      performedPct: feeTotal > 0 ? Math.round((alreadyBilled / feeTotal) * 100) : 0,
    };
  });
}

async function loadProjectPayments({ supabase, projectId, currentDocType, currentDocId }) {
  if (!projectId) return [];
  const { data, error } = await supabase
    .from('PARTIAL_PAYMENT')
    .select('ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, TOTAL_AMOUNT_NET, TAX_AMOUNT_NET, TOTAL_AMOUNT_GROSS, STATUS_ID')
    .eq('PROJECT_ID', projectId)
    .order('PARTIAL_PAYMENT_DATE', { ascending: true });
  if (error) {
    if (isTableMissingErr(error, 'partial_payment')) return [];
    console.error('[LOAD_PROJECT_PAYMENTS]', error.message);
    return [];
  }
  return (data || []).map(r => ({
    id:          r.ID,
    number:      r.PARTIAL_PAYMENT_NUMBER || String(r.ID),
    date:        r.PARTIAL_PAYMENT_DATE || '',
    netAmount:   Number(r.TOTAL_AMOUNT_NET  || 0),
    vatAmount:   Number(r.TAX_AMOUNT_NET    || 0),
    grossAmount: Number(r.TOTAL_AMOUNT_GROSS || 0),
    isCurrent:   currentDocType === 'PARTIAL_PAYMENT' && r.ID === currentDocId,
    isBooked:    Number(r.STATUS_ID) === 2,
  }));
}

async function loadTecRows({ supabase, docType, docId }) {
  try {
    const field = docType === 'INVOICE' ? 'INVOICE_ID' : 'PARTIAL_PAYMENT_ID';
    const { data, error } = await supabase
      .from('TEC')
      .select('ID, DATE_VOUCHER, EMPLOYEE_ID, QUANTITY_EXT, SP_RATE, SP_TOT, POSTING_DESCRIPTION')
      .eq(field, docId);

    if (error) {
      if (isTableMissingErr(error, 'tec')) return { rows: [], sumQty: 0, sumTot: 0 };
      throw new Error(error.message);
    }

    const rows   = data || [];
    const empIds = [...new Set(rows.map(r => r.EMPLOYEE_ID).filter(Boolean).map(Number).filter(Number.isFinite))];
    const empMap = new Map();

    if (empIds.length) {
      const { data: emps } = await supabase
        .from('EMPLOYEE').select('ID, FIRST_NAME, LAST_NAME, SHORT_NAME').in('ID', empIds);
      (emps || []).forEach(e =>
        empMap.set(String(e.ID), `${e.FIRST_NAME || ''} ${e.LAST_NAME || ''}`.trim() || e.SHORT_NAME || '')
      );
    }

    rows.sort((a, b) => String(a.DATE_VOUCHER || '').localeCompare(String(b.DATE_VOUCHER || '')));

    let sumQty = 0, sumTot = 0;
    const out = rows.map(r => {
      const qty = Number(r.QUANTITY_EXT || 0);
      const tot = Number(r.SP_TOT      || 0);
      sumQty += qty; sumTot += tot;
      return {
        dateVoucher:        r.DATE_VOUCHER || '',
        employeeName:       empMap.get(String(r.EMPLOYEE_ID)) || '',
        quantityExt:        qty,
        spRate:             Number(r.SP_RATE || 0),
        spTot:              tot,
        postingDescription: r.POSTING_DESCRIPTION || '',
      };
    });

    return { rows: out, sumQty, sumTot };
  } catch (e) {
    console.error('[TEC_LOAD]', e);
    return { rows: [], sumQty: 0, sumTot: 0 };
  }
}

// ── View model ────────────────────────────────────────────────────────────────

const DOC_TITLES = {
  rechnung:           'Rechnung',
  partial_payment:    'Abschlagsrechnung',
  schlussrechnung:    'Schlussrechnung',
  teilschlussrechnung:'Teilschlussrechnung',
};

async function buildPdfViewModel({ supabase, docType, docId }) {
  const table = docType === 'INVOICE' ? 'INVOICE' : 'PARTIAL_PAYMENT';

  // Load raw doc for fields not exposed by loadInvoiceData
  const { data: rawDoc, error: rawErr } = await supabase
    .from(table)
    .select('*')
    .eq('ID', docId)
    .maybeSingle();
  if (rawErr) throw new Error(rawErr.message);
  if (!rawDoc) throw new Error(`${table} ${docId} not found`);

  const tenantId = rawDoc.TENANT_ID ?? null;

  // Core invoice data (seller, buyer, lines, totals, deductions, etc.)
  const inv = await loadInvoiceData(supabase, docId, docType, tenantId);

  // Honorar vs Nebenkosten split for the calc table
  let amountNet, amountExtrasNet;
  if (docType === 'PARTIAL_PAYMENT') {
    amountNet       = Number(rawDoc.AMOUNT_NET       ?? inv.totals.lineTotal ?? 0);
    amountExtrasNet = Number(rawDoc.AMOUNT_EXTRAS_NET ?? 0);
  } else {
    const { data: structRows } = await supabase
      .from('INVOICE_STRUCTURE').select('AMOUNT_NET, AMOUNT_EXTRAS_NET').eq('INVOICE_ID', docId);
    if (structRows && structRows.length > 0) {
      amountNet       = structRows.reduce((s, r) => s + Number(r.AMOUNT_NET       ?? 0), 0);
      amountExtrasNet = structRows.reduce((s, r) => s + Number(r.AMOUNT_EXTRAS_NET ?? 0), 0);
    } else {
      amountNet       = inv.totals.lineTotal;
      amountExtrasNet = 0;
    }
  }

  // Buyer second name line (e.g. "z.Hd. Herr Müller")
  const buyerName2 = String(rawDoc.ADDRESS_NAME_2 ?? '').trim();

  // Project and contract names
  let projectName = '', contractName = '';
  if (rawDoc.PROJECT_ID) {
    const { data: proj } = await supabase
      .from('PROJECT').select('NAME_SHORT, NAME_LONG').eq('ID', rawDoc.PROJECT_ID).maybeSingle();
    if (proj) projectName = [proj.NAME_SHORT, proj.NAME_LONG].filter(Boolean).join(' \u2013 ');
  }
  if (rawDoc.CONTRACT_ID) {
    const { data: con } = await supabase
      .from('CONTRACT').select('NAME_SHORT, NAME_LONG').eq('ID', rawDoc.CONTRACT_ID).maybeSingle();
    if (con) contractName = [con.NAME_SHORT, con.NAME_LONG].filter(Boolean).join(' \u2013 ');
  }

  // Appendix data
  const [projectStructureRows, projectPayments, tec] = await Promise.all([
    loadProjectStructureRows({ supabase, projectId: rawDoc.PROJECT_ID, docType, docId }),
    loadProjectPayments({ supabase, projectId: rawDoc.PROJECT_ID, currentDocType: docType, currentDocId: docId }),
    loadTecRows({ supabase, docType, docId }),
  ]);

  // Free-text fields
  const text1 = String(rawDoc.TEXT_1 ?? '').trim();
  const text2 = String(rawDoc.TEXT_2 ?? '').trim();

  // Pre-computed totals for template (Nunjucks can't mutate loop vars)
  const deductionTotals = {
    net:   inv.deductions.reduce((s, d) => s + d.netAmount,   0),
    vat:   inv.deductions.reduce((s, d) => s + d.vatAmount,   0),
    gross: inv.deductions.reduce((s, d) => s + d.grossAmount, 0),
  };
  const paymentTotals = {
    net:   projectPayments.reduce((s, p) => s + p.netAmount,   0),
    vat:   projectPayments.reduce((s, p) => s + p.vatAmount,   0),
    gross: projectPayments.reduce((s, p) => s + p.grossAmount, 0),
  };
  const structureTotals = {
    feeTotal:      projectStructureRows.reduce((s, r) => s + r.feeTotal,      0),
    alreadyBilled: projectStructureRows.reduce((s, r) => s + r.alreadyBilled, 0),
    thisDocNet:    projectStructureRows.reduce((s, r) => s + r.thisDocNet,    0),
  };

  return {
    inv,
    docTitle:    DOC_TITLES[inv.invoiceType] || 'Rechnung',
    amountNet,
    amountExtrasNet,
    buyerName2,
    projectName,
    contractName,
    text1,
    text2,
    projectStructureRows,
    structureTotals,
    projectPayments,
    paymentTotals,
    tec,
    deductionTotals,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

async function renderDocumentPdf({ supabase, docType, docId, templateId }) {
  const table = docType === 'INVOICE' ? 'INVOICE' : 'PARTIAL_PAYMENT';
  const { data: docMeta } = await supabase.from(table).select('COMPANY_ID').eq('ID', docId).maybeSingle();
  const companyId = docMeta?.COMPANY_ID;
  if (!companyId) throw new Error('Company for document not found');

  const tpl         = await loadTemplate({ supabase, companyId, docType, templateId });
  const theme       = deepMerge(defaultTheme(), tpl.THEME_JSON || {});
  const logoDataUri = await loadLogoDataUri({ supabase, logoAssetId: tpl.LOGO_ASSET_ID });

  const vm = await buildPdfViewModel({ supabase, docType, docId });
  vm.theme       = theme;
  vm.logoDataUri = logoDataUri;

  const layoutKey = tpl.LAYOUT_KEY || 'modern_a';
  const html = env().render(path.join(layoutKey, 'invoice.njk'), vm);

  const s = vm.inv.seller;
  const companyLine = [
    s.name, s.street, `${s.postCode} ${s.city}`.trim(),
    s.vatId ? `USt-IdNr.: ${s.vatId}` : (s.taxId ? `St.-Nr.: ${s.taxId}` : ''),
    s.iban ? `IBAN: ${s.iban}` : '',
    s.bic  ? `BIC: ${s.bic}`   : '',
  ].filter(Boolean).join(' \u00b7 ');

  const pdf = await renderPdf({ html, footerLeft: companyLine });
  return { pdf, template: tpl, theme };
}

module.exports = { renderDocumentPdf };