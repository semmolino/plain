'use strict';

const path = require('path');
const fs   = require('fs');
const nunjucks = require('nunjucks');
const { loadInvoiceData } = require('./services_einvoice_data');
const angeboteSvc = require('./services/angebote');
const monatsabschlussSvc = require('./services/monatsabschluss');

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

// ── EPC / GiroCode QR ────────────────────────────────────────────────────────

async function buildEpcQrDataUri({ bic, iban, name, amount, reference }) {
  if (!iban || !name) return null;
  const amtStr = amount != null && Number.isFinite(amount) && amount > 0
    ? `EUR${amount.toFixed(2)}` : '';
  const lines = [
    'BCD', '002', '1', 'SCT',
    (bic || '').trim().toUpperCase(),
    name.trim().substring(0, 70),
    iban.replace(/\s/g, '').toUpperCase(),
    amtStr, '', '',
    (reference || '').trim().substring(0, 140),
  ];
  const payload = lines.join('\n');
  if (Buffer.byteLength(payload, 'utf8') > 331) return null;
  try {
    const QRCode = require('qrcode');
    return await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 150 });
  } catch (e) {
    console.error('[EPC_QR]', e.message);
    return null;
  }
}

// ── Playwright ────────────────────────────────────────────────────────────────

let _browserPromise = null;

async function getBrowser() {
  if (_browserPromise) {
    try { return await _browserPromise; } catch { _browserPromise = null; }
  }
  _browserPromise = (async () => {
    const { chromium } = require('playwright-chromium');
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    browser.on('disconnected', () => { _browserPromise = null; });
    return browser;
  })();
  return _browserPromise;
}

async function renderPdf({ html }) {
  const browser = await getBrowser();
  const page    = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });

  const footerTemplate = `
    <div style="font-size:7.5px;width:100%;padding:0 20mm 0 25mm;color:#9ca3af;display:flex;justify-content:flex-end;align-items:center;">
      <div style="white-space:nowrap;">Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>
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

async function resolveLogoDataUri({ supabase, tplLogoAssetId, tenantId, companyId }) {
  // 1. Per-company cached base64 logo (preferred)
  if (companyId && tenantId) {
    const { data: cached } = await supabase.from('TENANT_SETTINGS').select('VALUE')
      .eq('TENANT_ID', tenantId).eq('KEY', `co_${companyId}_logo_data_uri`).maybeSingle();
    if (cached?.VALUE) return cached.VALUE;
    const { data: assetRow } = await supabase.from('TENANT_SETTINGS').select('VALUE')
      .eq('TENANT_ID', tenantId).eq('KEY', `co_${companyId}_logo_asset_id`).maybeSingle();
    if (assetRow?.VALUE) return loadLogoDataUri({ supabase, logoAssetId: parseInt(assetRow.VALUE, 10) });
  }

  // 2. Tenant-level logo fallback (backward compatibility)
  if (tenantId) {
    const { data: cached } = await supabase.from('TENANT_SETTINGS').select('VALUE')
      .eq('TENANT_ID', tenantId).eq('KEY', 'logo_data_uri').maybeSingle();
    if (cached?.VALUE) return cached.VALUE;
    const { data: assetRow } = await supabase.from('TENANT_SETTINGS').select('VALUE')
      .eq('TENANT_ID', tenantId).eq('KEY', 'logo_asset_id').maybeSingle();
    if (assetRow?.VALUE) return loadLogoDataUri({ supabase, logoAssetId: parseInt(assetRow.VALUE, 10) });
  }

  // 3. Template-level asset
  if (tplLogoAssetId) return loadLogoDataUri({ supabase, logoAssetId: tplLogoAssetId });
  return null;
}

async function resolveSignatureDataUri({ supabase, tenantId, companyId }) {
  if (!companyId || !tenantId) return null;
  const { data: cached } = await supabase.from('TENANT_SETTINGS').select('VALUE')
    .eq('TENANT_ID', tenantId).eq('KEY', `co_${companyId}_sig_data_uri`).maybeSingle();
  if (cached?.VALUE) return cached.VALUE;
  const { data: assetRow } = await supabase.from('TENANT_SETTINGS').select('VALUE')
    .eq('TENANT_ID', tenantId).eq('KEY', `co_${companyId}_sig_asset_id`).maybeSingle();
  if (assetRow?.VALUE) return loadLogoDataUri({ supabase, logoAssetId: parseInt(assetRow.VALUE, 10) });
  return null;
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
  stornorechnung:     'Stornorechnung',
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

  // Discount / skonto fields
  const totalAmountNet     = Number(rawDoc.TOTAL_AMOUNT_NET ?? 0);
  const d1Pct              = Number(rawDoc.DISCOUNT_1_PERCENT ?? 0);
  const d2Pct              = Number(rawDoc.DISCOUNT_2_PERCENT ?? 0);
  const d1Reason           = rawDoc.DISCOUNT_1_REASON ?? null;
  const d2Reason           = rawDoc.DISCOUNT_2_REASON ?? null;
  const d1Amount           = Math.round(totalAmountNet * d1Pct / 100 * 100) / 100;
  const d2Amount           = Math.round((totalAmountNet - d1Amount) * d2Pct / 100 * 100) / 100;
  const totalDiscounts     = Number(rawDoc.TOTAL_DISCOUNTS ?? 0) || Math.round((d1Amount + d2Amount) * 100) / 100;
  const cashDiscPct        = Number(rawDoc.CASH_DISCOUNT_PERCENT ?? 0);
  const cashDiscDays       = rawDoc.CASH_DISCOUNT_DAYS ?? null;
  const cashDiscAmount     = Number(rawDoc.CASH_DISCOUNT ?? 0) || Math.round((totalAmountNet - totalDiscounts) * cashDiscPct / 100 * 100) / 100;
  const adjustedNet        = Math.round((totalAmountNet - totalDiscounts) * 100) / 100;
  const vatPct             = Number(rawDoc.VAT_PERCENT ?? 0);
  const adjustedVat        = Math.round(adjustedNet * vatPct / 100 * 100) / 100;
  const adjustedGross      = Math.round((adjustedNet + adjustedVat) * 100) / 100;
  const hasDiscounts       = totalDiscounts > 0;
  const hasSkonto          = cashDiscPct > 0;
  const skontoPaymentAmount = Math.round((adjustedNet - cashDiscAmount) * (1 + vatPct / 100) * 100) / 100;

  const discounts = {
    d1Percent: d1Pct, d2Percent: d2Pct,
    d1Reason, d2Reason,
    d1Amount, d2Amount, totalDiscounts,
    cashDiscountPercent: cashDiscPct, cashDiscountDays: cashDiscDays, cashDiscountAmount: cashDiscAmount,
    adjustedNet, adjustedVat, adjustedGross, hasDiscounts, hasSkonto, skontoPaymentAmount,
  };

  // HOAI Kalkulationen für das Projekt laden (soft-fail)
  let honorarCalcs = [];
  if (rawDoc.PROJECT_ID && tenantId) {
    try {
      const { data: calcMasters } = await supabase
        .from('FEE_CALCULATION_MASTER')
        .select('ID, NAME_SHORT, NAME_LONG')
        .eq('PROJECT_ID', rawDoc.PROJECT_ID)
        .eq('TENANT_ID', tenantId)
        .order('ID', { ascending: true });

      if (calcMasters && calcMasters.length > 0) {
        const ctxs = await Promise.all(calcMasters.map(cm => buildHonorarCalcContext(supabase, cm.ID, tenantId)));
        honorarCalcs = ctxs.filter(Boolean);
      }
    } catch (e) {
      console.warn('[HONORAR_CALCS_INVOICE]', e.message);
    }
  }

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
    discounts,
    honorarCalcs,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

async function renderDocumentPdf({ supabase, docType, docId, templateId }) {
  const table = docType === 'INVOICE' ? 'INVOICE' : 'PARTIAL_PAYMENT';
  const { data: docMeta } = await supabase.from(table).select('COMPANY_ID, TENANT_ID').eq('ID', docId).maybeSingle();
  const companyId = docMeta?.COMPANY_ID;
  const tenantId  = docMeta?.TENANT_ID ?? null;
  if (!companyId) throw new Error('Company for document not found');

  const tpl = await loadTemplate({ supabase, companyId, docType, templateId });
  const theme = deepMerge(defaultTheme(), tpl.THEME_JSON || {});
  const [logoDataUri, signatureDataUri] = await Promise.all([
    resolveLogoDataUri({ supabase, tplLogoAssetId: tpl.LOGO_ASSET_ID, tenantId, companyId }),
    resolveSignatureDataUri({ supabase, tenantId, companyId }),
  ]);

  const vm = await buildPdfViewModel({ supabase, docType, docId });
  vm.theme             = theme;
  vm.logoDataUri       = logoDataUri;
  vm.signatureDataUri  = signatureDataUri;

  // Inject text template (header/footer) if invoice has no manual texts
  await injectTextTemplate(supabase, vm, tenantId);

  // EPC / GiroCode QR — only for payable documents (not storno)
  const payAmount = vm.discounts.hasDiscounts ? vm.discounts.adjustedGross : vm.inv.totals.grandTotal;
  vm.epcQrDataUri = await buildEpcQrDataUri({
    bic:       vm.inv.seller.bic,
    iban:      vm.inv.seller.iban,
    name:      vm.inv.seller.name,
    amount:    payAmount,
    reference: vm.inv.number,
  });

  // For Stornorechnung: load the original invoice for the reference line
  if (vm.inv.invoiceType === 'stornorechnung') {
    // rawDoc is not in scope here — re-read CANCELS_INVOICE_ID from the booked invoice
    const { data: cancelsDoc } = await supabase
      .from('INVOICE')
      .select('CANCELS_INVOICE_ID')
      .eq('ID', docId)
      .maybeSingle();
    const cancelsId = cancelsDoc?.CANCELS_INVOICE_ID;
    if (cancelsId) {
      const { data: origInv } = await supabase
        .from('INVOICE')
        .select('INVOICE_NUMBER, INVOICE_DATE, INVOICE_TYPE')
        .eq('ID', cancelsId)
        .maybeSingle();
      vm.origInvoice = origInv ?? null;
    }
  }

  const layoutKey = tpl.LAYOUT_KEY || 'modern_a';
  const isStorno  = vm.inv.invoiceType === 'stornorechnung';
  const template  = isStorno ? 'storno.njk' : 'invoice.njk';
  const html = env().render(path.join(layoutKey, template), vm);

  const pdf = await renderPdf({ html });
  return { pdf, template: tpl, theme };
}

// ── Offer PDF ─────────────────────────────────────────────────────────────────

async function renderOfferPdf({ supabase, offerId, tenantId }) {
  const vm = await angeboteSvc.buildOfferPdfViewModel(supabase, { offerId, tenantId });

  const companyId = vm.offer.COMPANY_ID;
  const tpl = await loadTemplate({ supabase, companyId, docType: 'OFFER', templateId: null });
  const theme = deepMerge(defaultTheme(), tpl.THEME_JSON || {});
  const [logoDataUri, signatureDataUri] = await Promise.all([
    resolveLogoDataUri({ supabase, tplLogoAssetId: tpl.LOGO_ASSET_ID, tenantId, companyId }),
    resolveSignatureDataUri({ supabase, tenantId, companyId }),
  ]);

  // Load HOAI calculations linked to this offer
  let honorarCalcs = [];
  try {
    const { data: calcMasters } = await supabase
      .from('FEE_CALCULATION_MASTER')
      .select('ID, NAME_SHORT, NAME_LONG')
      .eq('OFFER_ID', offerId)
      .eq('TENANT_ID', tenantId)
      .order('ID', { ascending: true });

    if (calcMasters && calcMasters.length > 0) {
      const ctxs = await Promise.all(calcMasters.map(cm => buildHonorarCalcContext(supabase, cm.ID, tenantId)));
      honorarCalcs = ctxs.filter(Boolean);
    }
  } catch (e) {
    console.warn('[HONORAR_CALCS_OFFER]', e.message);
  }

  const honorarTotalSum = honorarCalcs.reduce((sum, hc) => sum + (hc.gesamthonorar || 0), 0);
  const context = { ...vm, theme, logoDataUri, signatureDataUri, honorarCalcs, honorarTotalSum };
  const layoutKey = tpl.LAYOUT_KEY || 'modern_a';
  const html = env().render(path.join(layoutKey, 'offer.njk'), context);

  const pdf = await renderPdf({ html });
  return { pdf, offer: vm.offer };
}

async function renderAuftragsbestaetigungPdf({ supabase, offerId, tenantId }) {
  const vm = await angeboteSvc.buildOfferPdfViewModel(supabase, { offerId, tenantId });

  const companyId = vm.offer.COMPANY_ID;
  const tpl = await loadTemplate({ supabase, companyId, docType: 'OFFER', templateId: null });
  const theme = deepMerge(defaultTheme(), tpl.THEME_JSON || {});
  const [logoDataUri, signatureDataUri] = await Promise.all([
    resolveLogoDataUri({ supabase, tplLogoAssetId: tpl.LOGO_ASSET_ID, tenantId, companyId }),
    resolveSignatureDataUri({ supabase, tenantId, companyId }),
  ]);

  const context = {
    ...vm,
    theme,
    logoDataUri,
    signatureDataUri,
    today: new Date().toISOString().slice(0, 10),
  };

  const layoutKey = tpl.LAYOUT_KEY || 'modern_a';
  const html = env().render(path.join(layoutKey, 'auftragsbestaetigung.njk'), context);

  const pdf = await renderPdf({ html });
  return { pdf, offer: vm.offer };
}

// ── Text Template injection ───────────────────────────────────────────────────

/** Map INVOICE_TYPE value → TEXT_TEMPLATE.DOCUMENT_TYPE key */
function textTemplateTypeForDoc(invoiceType) {
  switch (invoiceType) {
    case 'partial_payment':     return 'invoice_abschlags';
    case 'rechnung':            return 'invoice_rechnung';
    case 'schlussrechnung':
    case 'teilschlussrechnung': return 'invoice_schluss';
    case 'stornorechnung':      return 'invoice_storno';
    default:                    return null;
  }
}

async function injectTextTemplate(supabase, vm, tenantId) {
  const docType = textTemplateTypeForDoc(vm.inv?.invoiceType);
  if (!docType || !tenantId) return;
  try {
    const { data } = await supabase
      .from('TEXT_TEMPLATE')
      .select('HEADER_TEXT, FOOTER_TEXT')
      .eq('TENANT_ID', tenantId)
      .eq('DOCUMENT_TYPE', docType)
      .maybeSingle();
    if (!data) return;
    if (!vm.text1 && data.HEADER_TEXT) vm.text1 = data.HEADER_TEXT;
    if (!vm.text2 && data.FOOTER_TEXT) vm.text2 = data.FOOTER_TEXT;
  } catch (e) {
    // TEXT_TEMPLATE table may not exist yet (before migration) — silent fail
    if (!isTableMissingErr(e, 'text_template')) console.warn('[TEXT_TEMPLATE]', e.message);
  }
}

// ── Mahnung PDF ───────────────────────────────────────────────────────────────

async function renderMahnungPdf(supabase, { invoiceId, ppId, mahnstufe, tenantId }) {
  const docType = invoiceId ? 'INVOICE' : 'PARTIAL_PAYMENT';
  const docId   = invoiceId || ppId;

  if (!docId) throw { status: 400, message: 'invoiceId oder ppId erforderlich' };

  // Load base document data (reuses all existing seller/buyer resolvers)
  const vm = await buildPdfViewModel({ supabase, docType, docId });

  // Load company template for theme + logo
  const { data: docMeta } = await supabase
    .from(docType === 'INVOICE' ? 'INVOICE' : 'PARTIAL_PAYMENT')
    .select('COMPANY_ID')
    .eq('ID', docId)
    .maybeSingle();
  const companyId = docMeta?.COMPANY_ID;

  const [tpl, logoDataUri] = await Promise.all([
    companyId ? loadTemplate({ supabase, companyId, docType, templateId: null }) : Promise.resolve({ THEME_JSON: {}, LOGO_ASSET_ID: null, LAYOUT_KEY: 'modern_a' }),
    resolveLogoDataUri({ supabase, tplLogoAssetId: null, tenantId, companyId }),
  ]);
  const theme = deepMerge(defaultTheme(), tpl.THEME_JSON || {});

  // Load Mahnung settings for this level
  let mahnstufeLabel = ['', 'Zahlungserinnerung', '1. Mahnung', '2. Mahnung', '3. Mahnung'][mahnstufe] || 'Mahnung';
  let feeAmount = 0;
  let headerText = null;
  let footerText = null;

  try {
    const { data: settings } = await supabase
      .from('MAHNUNG_SETTINGS')
      .select('LABEL, FEE, HEADER_TEXT, FOOTER_TEXT')
      .eq('TENANT_ID', tenantId)
      .eq('MAHNSTUFE', mahnstufe)
      .maybeSingle();
    if (settings) {
      mahnstufeLabel = settings.LABEL || mahnstufeLabel;
      feeAmount      = Number(settings.FEE || 0);
      headerText     = settings.HEADER_TEXT || null;
      footerText     = settings.FOOTER_TEXT || null;
    }
  } catch (e) {
    if (!isTableMissingErr(e, 'mahnung_settings')) console.warn('[MAHNUNG_SETTINGS]', e.message);
  }

  // Invoice details for the table
  const today = new Date().toISOString().slice(0, 10);
  const dueDate    = vm.inv.dueDate || '';
  const totalGross = Number(vm.inv.totals?.grandTotal ?? 0);
  const daysOverdue = dueDate
    ? Math.max(0, Math.floor((new Date(today) - new Date(dueDate)) / 86400000))
    : 0;
  const totalDue = Math.round((totalGross + feeAmount) * 100) / 100;

  // Build mahnung-specific context
  const context = {
    seller:         vm.inv.seller,
    buyer: {
      name1:    vm.inv.buyer.name,
      name2:    '',
      street:   vm.inv.buyer.street,
      postCode: vm.inv.buyer.postCode,
      city:     vm.inv.buyer.city,
    },
    mahnstufeLabel,
    invoiceNumber: vm.inv.number,
    invoiceDate:   vm.inv.date,
    dueDate,
    daysOverdue,
    totalGross,
    feeAmount,
    totalDue,
    headerText,
    footerText,
    docDate: today,
    theme,
    logoDataUri,
  };

  const html = env().render(path.join('modern_a', 'mahnung.njk'), context);
  return renderPdf({ html });
}

async function renderMonatsabschlussPdf({ supabase, tenantId }) {
  const report = await monatsabschlussSvc.getReportData(supabase, tenantId);
  if (!report) throw { status: 404, message: 'Kein Monatsabschluss-Bericht vorhanden' };

  // Resolve seller from the first company of this tenant (or use tenant name)
  const { data: companies } = await supabase
    .from('COMPANY')
    .select('COMPANY_NAME_1, COMPANY_NAME_2')
    .eq('TENANT_ID', tenantId)
    .limit(1);
  const co = companies?.[0];
  const sellerName = co
    ? [co.COMPANY_NAME_1, co.COMPANY_NAME_2].filter(Boolean).join(' ')
    : '';

  // Resolve logo (use first company's logo if available, fall back to tenant logo)
  const { data: coRows } = await supabase
    .from('COMPANY')
    .select('ID')
    .eq('TENANT_ID', tenantId)
    .limit(1);
  const companyId = coRows?.[0]?.ID ?? null;
  const logoDataUri = await resolveLogoDataUri({ supabase, tplLogoAssetId: null, tenantId, companyId });

  const context = {
    ...report,
    seller: { name: sellerName },
    logoDataUri,
  };

  const html = env().render(path.join('modern_a', 'monatsabschluss.njk'), context);
  const pdf  = await renderPdf({ html });
  return { pdf, report };
}

// ── Honorar data helper (shared by honorar PDF and invoice PDF) ───────────────

async function buildHonorarCalcData(supabase, calcMasterId, tenantId) {
  const { loadPhaseRowsWithLabels } = require('./services/stammdaten');
  const phaseRows = await loadPhaseRowsWithLabels(supabase, calcMasterId);

  const { data: surchargeRows } = await supabase
    .from('FEE_CALCULATION_SURCHARGES')
    .select('NAME_SHORT, NAME_LONG, PERCENT, BASE_AMOUNT, AMOUNT, LPH_FILTER, BL_FILTER, CALC_MODE, INCLUDE_BL')
    .eq('FEE_CALC_MASTER_ID', calcMasterId)
    .eq('TENANT_ID', tenantId)
    .order('SORT_ORDER', { ascending: true });

  let blRows = [];
  try {
    const { data: blData } = await supabase
      .from('FEE_CALCULATION_BL')
      .select('ID, NAME_SHORT, NAME, LPH_REF, LPH_PHASE_ID, AMOUNT, SORT_ORDER')
      .eq('FEE_CALC_MASTER_ID', calcMasterId)
      .eq('TENANT_ID', tenantId)
      .order('SORT_ORDER', { ascending: true });
    blRows = blData || [];
  } catch (e) {
    if (!isTableMissingErr(e, 'FEE_CALCULATION_BL')) console.warn('[FEE_CALCULATION_BL]', e.message);
  }

  const grundhonorar = phaseRows.reduce((s, r) => s + (Number(r.PHASE_REVENUE) || 0), 0);
  const blTotal      = blRows.reduce((s, r) => s + (Number(r.AMOUNT) || 0), 0);

  const phaseIdsAll = phaseRows.map(r => r.ID);
  let runningTotal  = 0;
  const computedSurcharges = (surchargeRows || []).map(r => {
    const selectedLphIds = r.LPH_FILTER
      ? (() => { try { return JSON.parse(r.LPH_FILTER); } catch { return phaseIdsAll; } })()
      : phaseIdsAll;
    const selectedPhaseRows = phaseRows.filter(p => selectedLphIds.includes(p.ID));
    const phaseBase = selectedPhaseRows.reduce((s, p) => s + (Number(p.PHASE_REVENUE) || 0), 0);

    let blContrib = 0, selectedBlRows = [];
    if (r.BL_FILTER) {
      try {
        const selectedBlIds = JSON.parse(r.BL_FILTER);
        selectedBlRows = blRows.filter(b => selectedBlIds.includes(b.ID));
        blContrib = selectedBlRows.reduce((s, b) => s + (Number(b.AMOUNT) || 0), 0);
      } catch { /* ignore */ }
    }

    const base        = phaseBase + blContrib;
    const effectiveBase = r.CALC_MODE === 'cumulative' ? base + runningTotal : base;
    const amount      = ((Number(r.PERCENT) || 0) / 100) * effectiveBase;
    runningTotal += amount;

    // Breakdown per component: show both the base value and the proportional surcharge share
    const lphItems = selectedPhaseRows
      .filter(p => (Number(p.PHASE_REVENUE) || 0) !== 0)
      .map(p => {
        const pBase = Number(p.PHASE_REVENUE) || 0;
        return {
          label:         p.PHASE_LABEL || '',
          baseAmount:    pBase,
          surchargeAmount: base > 0 ? Math.round(amount * (pBase / base) * 100) / 100 : 0,
        };
      });
    const surchargeBls = selectedBlRows
      .filter(b => (Number(b.AMOUNT) || 0) !== 0)
      .map(b => {
        const bBase = Number(b.AMOUNT) || 0;
        return {
          name:          [b.NAME_SHORT, b.NAME].filter(Boolean).join(': ') || 'BL',
          baseAmount:    bBase,
          surchargeAmount: base > 0 ? Math.round(amount * (bBase / base) * 100) / 100 : 0,
        };
      });

    return {
      r,
      effectiveBase: Math.round(effectiveBase * 100) / 100,
      amount:        Math.round(amount * 100) / 100,
      lphItems,
      surchargeBls,
    };
  });
  const zuschlaegeSum = computedSurcharges.reduce((s, e) => s + e.amount, 0);

  return { phaseRows, blRows, blTotal, computedSurcharges, grundhonorar, zuschlaegeSum, gesamthonorar: grundhonorar + blTotal + zuschlaegeSum };
}

// ── buildHonorarCalcContext: full context object for one calc (reused in standalone + appendix) ──

async function buildHonorarCalcContext(supabase, calcMasterId, tenantId) {
  const { data: calc } = await supabase
    .from('FEE_CALCULATION_MASTER')
    .select('*')
    .eq('ID', calcMasterId)
    .eq('TENANT_ID', tenantId)
    .single();
  if (!calc) return null;

  const d = await buildHonorarCalcData(supabase, calcMasterId, tenantId);

  let zoneName = null;
  if (calc.ZONE_ID) {
    const { data: zone } = await supabase.from('FEE_ZONES').select('NAME_SHORT').eq('ID', calc.ZONE_ID).maybeSingle();
    zoneName = zone?.NAME_SHORT ?? null;
  }

  const buildSurchargeCtx = ({ r, effectiveBase, amount, lphItems, surchargeBls }) => {
    let lphDetail = null;
    if (r.LPH_FILTER) {
      try {
        const ids    = JSON.parse(r.LPH_FILTER);
        const labels = d.phaseRows
          .filter(p => ids.includes(p.ID))
          .map(p => p.PHASE_LABEL || `LPH ${p.FEE_PHASE_ID}`);
        if (labels.length && labels.length < d.phaseRows.length) lphDetail = labels.join(', ');
      } catch { /* ignore */ }
    }
    return {
      nameShort:   r.NAME_SHORT || '',
      nameLong:    r.NAME_LONG  || '',
      percent:     r.PERCENT ?? '',
      baseAmount:  effectiveBase,
      amount,
      calcMode:    r.CALC_MODE || 'parallel',
      lphDetail,
      lphItems,
      surchargeBls,
    };
  };

  return {
    nameShort: calc.NAME_SHORT || '',
    nameLong:  calc.NAME_LONG  || '',
    calc: {
      nameShort:           calc.NAME_SHORT || '',
      nameLong:            calc.NAME_LONG  || '',
      zoneName,
      zonePercent:         calc.ZONE_PERCENT ?? '',
      constructionCostsK0: calc.CONSTRUCTION_COSTS_K0 ?? null,
      constructionCostsK1: calc.CONSTRUCTION_COSTS_K1 ?? null,
      constructionCostsK2: calc.CONSTRUCTION_COSTS_K2 ?? null,
      constructionCostsK3: calc.CONSTRUCTION_COSTS_K3 ?? null,
      constructionCostsK4: calc.CONSTRUCTION_COSTS_K4 ?? null,
      revenueK0: calc.REVENUE_K0 ?? null,
      revenueK1: calc.REVENUE_K1 ?? null,
      revenueK2: calc.REVENUE_K2 ?? null,
      revenueK3: calc.REVENUE_K3 ?? null,
      revenueK4: calc.REVENUE_K4 ?? null,
    },
    phases: d.phaseRows.map(r => {
      const base    = Number(r.REVENUE_BASE) || 0;
      const pctBase = Number(r.FEE_PERCENT_BASE) || 0;
      return {
        phaseLabel:     r.PHASE_LABEL || '',
        kx:             r.KX || 'K0',
        revenueBase:    r.REVENUE_BASE ?? null,
        feePercentBase: r.FEE_PERCENT_BASE ?? '',
        basisHonorar:   Math.round((pctBase * base / 100) * 100) / 100,
        feePercent:     r.FEE_PERCENT ?? '',
        phaseRevenue:   r.PHASE_REVENUE ?? null,
      };
    }),
    blItems: d.blRows.map(r => {
      const lphPhase = r.LPH_PHASE_ID ? d.phaseRows.find(p => p.ID === r.LPH_PHASE_ID) : null;
      return {
        nameShort: r.NAME_SHORT || null,
        name:      r.NAME || '',
        lphRef:    r.LPH_REF || null,
        lphLabel:  lphPhase ? (lphPhase.PHASE_LABEL || null) : null,
        amount:    r.AMOUNT ?? null,
      };
    }),
    blTotal:      d.blTotal,
    surcharges:   d.computedSurcharges.map(buildSurchargeCtx),
    grundhonorar: d.grundhonorar,
    zuschlaegeSum: d.zuschlaegeSum,
    gesamthonorar: d.gesamthonorar,
  };
}

// ── Honorar PDF ───────────────────────────────────────────────────────────────

async function renderHonorarPdf(supabase, { calcMasterId, tenantId }) {
  const calcCtx = await buildHonorarCalcContext(supabase, calcMasterId, tenantId);
  if (!calcCtx) throw { status: 404, message: 'Honorarberechnung nicht gefunden' };

  // Load project label (standalone PDF only)
  const { data: calcMeta } = await supabase
    .from('FEE_CALCULATION_MASTER')
    .select('PROJECT_ID')
    .eq('ID', calcMasterId)
    .single();
  let projectLabel = null;
  if (calcMeta?.PROJECT_ID) {
    const { data: proj } = await supabase.from('PROJECT').select('NAME_SHORT, NAME_LONG').eq('ID', calcMeta.PROJECT_ID).maybeSingle();
    if (proj) projectLabel = [proj.NAME_SHORT, proj.NAME_LONG].filter(Boolean).join(' – ');
  }

  // Load company (seller) data + logo
  const { data: coRows } = await supabase.from('COMPANY').select('ID, COMPANY_NAME_1, STREET, POST_CODE, CITY, IBAN, BIC, TAX_NUMBER, "TAX-ID"').eq('TENANT_ID', tenantId).limit(1);
  const co = coRows?.[0] ?? {};
  const companyId = co.ID ?? null;
  const logoDataUri = await resolveLogoDataUri({ supabase, tplLogoAssetId: null, tenantId, companyId });

  const context = {
    ...calcCtx,
    projectLabel,
    docDate: new Date(),
    logoDataUri,
    seller: {
      name:      co.COMPANY_NAME_1 || '',
      street:    co.STREET || '',
      postCode:  co.POST_CODE || '',
      city:      co.CITY || '',
      iban:      co.IBAN || '',
      bic:       co.BIC || '',
      taxId:     co['TAX-ID'] || '',
      taxNumber: co.TAX_NUMBER || '',
    },
  };

  const html = env().render(path.join('modern_a', 'honorar.njk'), context);
  return renderPdf({ html });
}

module.exports = { renderDocumentPdf, renderOfferPdf, renderAuftragsbestaetigungPdf, renderMonatsabschlussPdf, renderMahnungPdf, renderHonorarPdf };