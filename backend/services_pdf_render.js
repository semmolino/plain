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

// Kanonische Theme-Defaults (v2) — gemeinsam mit services/documentTemplates.js.
const { defaultTheme } = require('./services_theme_defaults');
const { resolveFont, fontFaceCss } = require('./services_theme_fonts');

// CSS-Farbe absichern (verhindert CSS-Injection ueber gespeicherte Themes).
function safeColor(c) {
  return (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.trim())) ? c.trim() : '#111827';
}

// Zentrales Branding-<style> (Schrift-Einbettung + Akzent + Logo-Position).
// Wird als vm.themeHead an die Templates uebergeben; _theme_head.njk gibt es aus.
function buildThemeHead(theme) {
  const t = theme || {};
  const brand = t.brand || {};
  const header = t.header || {};
  const font = resolveFont(brand.fontFamily);
  const accent = safeColor(brand.accentColor);
  const justify = header.logoPosition === 'left' ? 'flex-start'
                : header.logoPosition === 'center' ? 'center'
                : 'flex-end';
  return `<style>
${fontFaceCss(brand.fontFamily)}
:root{ --brand-accent:${accent}; --brand-font:${font.stack}; }
body{ font-family: var(--brand-font) !important; }
.doc-title, .metaBlock .title{ color: var(--brand-accent) !important; }
.logo-area{ justify-content: ${justify} !important; }
</style>`;
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

// ── Salutation (Anrede) ───────────────────────────────────────────────────────
// Geschlechtsgerechte Briefanrede aus der hinterlegten Anrede (Herr/Frau) +
// Name der Kontaktperson. Ohne eindeutige Geschlechtsangabe → neutrale Anrede.
function buildSalutationLine({ salutation, namePart }) {
  const sal  = String(salutation ?? '').trim();
  const name = String(namePart ?? '').trim();
  if (name && /herr/i.test(sal)) return `Sehr geehrter Herr ${name},`;
  if (name && /frau/i.test(sal)) return `Sehr geehrte Frau ${name},`;
  return 'Sehr geehrte Damen und Herren,';
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

function buildFooterTemplate(footerCols) {
  if (!footerCols || !Array.isArray(footerCols) || footerCols.length === 0) {
    return {
      template: `
        <div style="font-size:7.5px;width:100%;padding:0 20mm 0 25mm;color:#9ca3af;display:flex;justify-content:flex-end;align-items:center;">
          <div style="white-space:nowrap;">Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>
        </div>`,
      marginBottom: '16mm',
    };
  }
  const colsHtml = footerCols.map(col => {
    const rowsHtml = (col.rows || []).map(r => {
      const text = String(r.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return r.bold
        ? `<strong style="display:block;font-size:7.5px;font-weight:700;color:#374151;">${text}</strong>`
        : `<span style="color:#6b7280;">${text}</span><br>`;
    }).join('');
    return `<div style="flex:1;min-width:0;">${rowsHtml}</div>`;
  }).join('');
  return {
    template: `
      <div style="width:100%;padding:2mm 20mm 0 25mm;border-top:0.5pt solid #d1d5db;display:flex;gap:5mm;font-size:7px;line-height:1.55;box-sizing:border-box;">
        ${colsHtml}
        <div style="white-space:nowrap;color:#9ca3af;font-size:7px;text-align:right;flex-shrink:0;padding-top:0.5mm;">
          Seite <span class="pageNumber"></span>&nbsp;/&nbsp;<span class="totalPages"></span>
        </div>
      </div>`,
    marginBottom: '22mm',
  };
}

function buildSellerFooterCols(seller) {
  const s = seller || {};
  return [
    { rows: [
      { bold: true, text: s.name || '' },
      ...(s.street        ? [{ text: s.street }] : []),
      ...(s.postOfficeBox ? [{ text: 'Postfach ' + s.postOfficeBox }] : []),
      ...((s.postCode || s.city) ? [{ text: (s.postCode || '') + ' ' + (s.city || '') }] : []),
    ]},
    { rows: [
      { bold: true, text: 'Bankverbindung' },
      ...(s.iban ? [{ text: 'IBAN: ' + s.iban }] : []),
      ...(s.bic  ? [{ text: 'BIC: '  + s.bic  }] : []),
    ]},
    { rows: [
      { bold: true, text: 'Steuer' },
      ...(s.taxId ? [{ text: 'Steuernummer: ' + s.taxId }] : []),
      ...(s.vatId ? [{ text: 'USt-IdNr.: '   + s.vatId }] : []),
    ]},
    ...(s.creditorId ? [{ rows: [
      { bold: true, text: 'Sonstiges' },
      { text: 'Gläubiger-ID: ' + s.creditorId },
    ]}] : []),
  ];
}

async function renderPdf({ html, footerCols }) {
  const browser = await getBrowser();
  const page    = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });

  const { template: footerTemplate, marginBottom } = buildFooterTemplate(footerCols);

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', right: '20mm', bottom: marginBottom, left: '25mm' },
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

  // Fläche in ha — deutsche Zahlformatierung mit "ha" Suffix
  e.addFilter('area_ha', v => {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('de-DE', { maximumFractionDigits: 4 }) + ' ha';
  });

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
    .select('ID, FATHER_ID, BILLING_TYPE_ID, NAME_SHORT, NAME_LONG, REVENUE, REVENUE_BASIS, EXTRAS, PARTIAL_PAYMENTS, INVOICED, SURCHARGES_TOTAL, SURCHARGE_1_LABEL, SURCHARGE_1_PCT, SURCHARGE_1_EUR, SURCHARGE_2_LABEL, SURCHARGE_2_PCT, SURCHARGE_2_EUR, SURCHARGE_3_LABEL, SURCHARGE_3_PCT, SURCHARGE_3_EUR')
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

  const rows = data || [];
  // Build child lookup so we can compute depth + leaf-descendant sums for parents
  const childrenOf = new Map();
  for (const r of rows) {
    const pid = r.FATHER_ID != null ? String(r.FATHER_ID) : null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(r);
  }
  const fatherIds = new Set(rows.filter(r => r.FATHER_ID != null).map(r => String(r.FATHER_ID)));

  // depth: 0 for roots, +1 per ancestor
  const depthOf = new Map();
  function computeDepth(id) {
    if (depthOf.has(id)) return depthOf.get(id);
    const r = rows.find(x => String(x.ID) === String(id));
    if (!r) return 0;
    const d = r.FATHER_ID == null ? 0 : (computeDepth(String(r.FATHER_ID)) + 1);
    depthOf.set(id, d);
    return d;
  }
  for (const r of rows) computeDepth(String(r.ID));

  // For parents, the displayed Auftragswert / Abgerechnet / Diese Rechnung should
  // be the SUM over leaf descendants — so parent value = visual subtotal that
  // matches what the leaves underneath add up to. Parent's own surcharges
  // appear separately in the Zuschlagsübersicht below.
  function leafDescendants(id) {
    const out = [];
    const stack = [String(id)];
    while (stack.length) {
      const cur = stack.pop();
      const kids = childrenOf.get(cur) || [];
      if (kids.length === 0) {
        const node = rows.find(x => String(x.ID) === cur);
        if (node) out.push(node);
      } else {
        for (const k of kids) stack.push(String(k.ID));
      }
    }
    return out;
  }

  // "% erbracht" per leaf: Nachweis-Elemente (BILLING_TYPE_ID = 2) werden nach
  // tatsächlichem Aufwand abgerechnet — der ausgewiesene Auftragswert IST die
  // erbrachte Leistung, also immer 100 %. Pauschal-Elemente (BT 1) bemessen den
  // Fortschritt am bereits abgerechneten Anteil des Festhonorars.
  const leafPerformed = (l) => {
    const lFee = Math.round((Number(l.REVENUE || 0) + Number(l.EXTRAS || 0)) * 100) / 100;
    if (Number(l.BILLING_TYPE_ID) === 2) return lFee;
    return docType === 'INVOICE' ? Number(l.INVOICED || 0) : Number(l.PARTIAL_PAYMENTS || 0);
  };

  return rows.map(r => {
    const isLeaf = !fatherIds.has(String(r.ID));
    let revenue, extras, alreadyBilled, thisDocNet, performedAmount;
    if (isLeaf) {
      revenue       = Number(r.REVENUE  || 0);
      extras        = Number(r.EXTRAS   || 0);
      alreadyBilled = docType === 'INVOICE' ? Number(r.INVOICED || 0) : Number(r.PARTIAL_PAYMENTS || 0);
      performedAmount = leafPerformed(r);
      const dr = docMap[r.ID];
      thisDocNet = dr ? Number(dr.AMOUNT_NET || 0) + Number(dr.AMOUNT_EXTRAS_NET || 0) : 0;
    } else {
      // Parent — aggregate from leaf descendants so the displayed value matches
      // the sum of the visible child rows below it.
      const leaves = leafDescendants(r.ID);
      revenue = leaves.reduce((s, l) => s + Number(l.REVENUE || 0), 0);
      extras  = leaves.reduce((s, l) => s + Number(l.EXTRAS  || 0), 0);
      alreadyBilled = leaves.reduce((s, l) => {
        return s + (docType === 'INVOICE' ? Number(l.INVOICED || 0) : Number(l.PARTIAL_PAYMENTS || 0));
      }, 0);
      thisDocNet = leaves.reduce((s, l) => {
        const dr = docMap[l.ID];
        return s + (dr ? Number(dr.AMOUNT_NET || 0) + Number(dr.AMOUNT_EXTRAS_NET || 0) : 0);
      }, 0);
      performedAmount = leaves.reduce((s, l) => s + leafPerformed(l), 0);
    }
    const feeTotal        = Math.round((revenue + extras) * 100) / 100;
    const revenueBasis    = Number(r.REVENUE_BASIS ?? r.REVENUE ?? 0);
    const surchargesTotal = Number(r.SURCHARGES_TOTAL || 0);
    const depth           = depthOf.get(String(r.ID)) ?? 0;
    return {
      id:             r.ID,
      isLeaf,
      depth,
      nameShort:      r.NAME_SHORT || '',
      nameLong:       r.NAME_LONG  || '',
      feeTotal,
      alreadyBilled,
      thisDocNet,
      performedPct:   feeTotal > 0 ? Math.round((performedAmount / feeTotal) * 100) : 0,
      revenueBasis,
      surchargesTotal,
      s1Label: r.SURCHARGE_1_LABEL || null,
      s1Pct:   Number(r.SURCHARGE_1_PCT || 0),
      s1Eur:   Number(r.SURCHARGE_1_EUR || 0),
      s2Label: r.SURCHARGE_2_LABEL || null,
      s2Pct:   Number(r.SURCHARGE_2_PCT || 0),
      s2Eur:   Number(r.SURCHARGE_2_EUR || 0),
      s3Label: r.SURCHARGE_3_LABEL || null,
      s3Pct:   Number(r.SURCHARGE_3_PCT || 0),
      s3Eur:   Number(r.SURCHARGE_3_EUR || 0),
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
      .select('ID, DATE_VOUCHER, EMPLOYEE_ID, STRUCTURE_ID, QUANTITY_EXT, SP_RATE, SP_TOT, POSTING_DESCRIPTION')
      .eq(field, docId);

    if (error) {
      if (isTableMissingErr(error, 'tec')) return { rows: [], groups: [], sumQty: 0, sumTot: 0 };
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

    // Projektelement-Stammdaten (Kuerzel + Bezeichnung) fuer die Gruppierung
    const structIds = [...new Set(rows.map(r => r.STRUCTURE_ID).filter(Boolean).map(Number).filter(Number.isFinite))];
    const structMap = new Map();
    if (structIds.length) {
      const { data: structs } = await supabase
        .from('PROJECT_STRUCTURE').select('ID, NAME_SHORT, NAME_LONG').in('ID', structIds);
      (structs || []).forEach(s =>
        structMap.set(String(s.ID), { kuerzel: s.NAME_SHORT || '', bezeichnung: s.NAME_LONG || '' })
      );
    }

    rows.sort((a, b) => String(a.DATE_VOUCHER || '').localeCompare(String(b.DATE_VOUCHER || '')));

    const round2 = n => Math.round(n * 100) / 100;
    let sumQty = 0, sumTot = 0;
    const out = rows.map(r => {
      const qty = Number(r.QUANTITY_EXT || 0);
      const tot = Number(r.SP_TOT      || 0);
      sumQty += qty; sumTot += tot;
      return {
        structureId:        r.STRUCTURE_ID != null ? Number(r.STRUCTURE_ID) : null,
        dateVoucher:        r.DATE_VOUCHER || '',
        employeeName:       empMap.get(String(r.EMPLOYEE_ID)) || '',
        quantityExt:        qty,
        spRate:             Number(r.SP_RATE || 0),
        spTot:              tot,
        postingDescription: r.POSTING_DESCRIPTION || '',
      };
    });

    // Nach Projektelement gruppieren; Gruppen alphabetisch nach Kuerzel,
    // Buchungen ohne Element ans Ende. Pro Gruppe Zwischensumme.
    const groupMap = new Map();
    for (const r of out) {
      const key = r.structureId == null ? '__none__' : String(r.structureId);
      if (!groupMap.has(key)) {
        const meta = r.structureId == null ? null : structMap.get(key);
        groupMap.set(key, {
          structureId: r.structureId,
          kuerzel:     meta ? meta.kuerzel : '',
          bezeichnung: meta ? meta.bezeichnung : '',
          rows:        [],
          sumQty:      0,
          sumTot:      0,
        });
      }
      const g = groupMap.get(key);
      g.rows.push(r);
      g.sumQty += r.quantityExt;
      g.sumTot += r.spTot;
    }
    const groups = [...groupMap.values()]
      .map(g => ({ ...g, sumQty: round2(g.sumQty), sumTot: round2(g.sumTot) }))
      .sort((a, b) => {
        if (a.structureId == null) return 1;
        if (b.structureId == null) return -1;
        return String(a.kuerzel).localeCompare(String(b.kuerzel), 'de', { numeric: true });
      });

    return { rows: out, groups, sumQty: round2(sumQty), sumTot: round2(sumTot) };
  } catch (e) {
    console.error('[TEC_LOAD]', e);
    return { rows: [], groups: [], sumQty: 0, sumTot: 0 };
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

async function buildPdfViewModel({ supabase, docType, docId, previewReleasePpIds = [] }) {
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
  // Cumulative-AR view for Abschlagsrechnung PDFs (#9):
  //   "Erbrachtes Honorar"           = sum of AMOUNT_NET of all PPs in this contract (incl. this)
  //   "abzgl. bisheriger Abschlags." = sum of AMOUNT_NET of all prior PPs
  //   "In dieser Rechnung"           = AMOUNT_NET of this PP
  let arProgress = null;
  if (docType === 'PARTIAL_PAYMENT') {
    amountNet       = Number(rawDoc.AMOUNT_NET       ?? inv.totals.lineTotal ?? 0);
    amountExtrasNet = Number(rawDoc.AMOUNT_EXTRAS_NET ?? 0);
    if (rawDoc.CONTRACT_ID) {
      try {
        const { data: contractPps } = await supabase
          .from('PARTIAL_PAYMENT')
          .select('ID, AMOUNT_NET, STATUS_ID, CANCELS_PARTIAL_PAYMENT_ID, PARTIAL_PAYMENT_DATE')
          .eq('CONTRACT_ID', rawDoc.CONTRACT_ID);
        const all = (contractPps || []).filter(p =>
          // exclude this very PP from "prior"
          parseInt(p.ID, 10) !== parseInt(rawDoc.ID, 10) &&
          // exclude storno rows (CANCELS_PARTIAL_PAYMENT_ID is set on the reversal entry)
          p.CANCELS_PARTIAL_PAYMENT_ID == null &&
          // include only booked or open (status != 3 = stornoed/cancelled, depending on schema)
          String(p.STATUS_ID) !== '3' &&
          // only PPs dated up to this one's date so older are summed
          (!rawDoc.PARTIAL_PAYMENT_DATE || !p.PARTIAL_PAYMENT_DATE ||
           p.PARTIAL_PAYMENT_DATE <= rawDoc.PARTIAL_PAYMENT_DATE)
        );
        // also exclude PPs that are storno'd by another PP
        const cancelledIds = new Set(
          (contractPps || [])
            .map(p => p.CANCELS_PARTIAL_PAYMENT_ID)
            .filter(Boolean)
            .map(x => parseInt(x, 10))
        );
        const priorPps = all.filter(p => !cancelledIds.has(parseInt(p.ID, 10)));
        const priorNet = Math.round(priorPps.reduce((s, p) => s + Number(p.AMOUNT_NET || 0), 0) * 100) / 100;
        const thisNet  = Math.round(amountNet * 100) / 100;
        if (priorNet > 0) {
          arProgress = {
            priorNet,
            thisNet,
            cumulativeNet: Math.round((priorNet + thisNet) * 100) / 100,
            hasPrior: true,
          };
        }
      } catch (_) { /* soft-fail */ }
    }
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

  // Salutation line above TEXT_1 — gender-correct greeting for the invoice contact.
  // Prefer the precise LAST_NAME (+ TITLE) from CONTACTS; fall back to the frozen
  // denormalised CONTACT name on the document if the contact is unavailable.
  let salutationLine;
  {
    const contactId = docType === 'INVOICE'
      ? rawDoc.INVOICE_CONTACT_ID
      : rawDoc.PARTIAL_PAYMENT_CONTACT_ID;
    let lastName = '', title = '';
    if (contactId) {
      try {
        const { data: ct } = await supabase
          .from('CONTACTS').select('LAST_NAME, TITLE').eq('ID', contactId).maybeSingle();
        if (ct) {
          lastName = String(ct.LAST_NAME ?? '').trim();
          title    = String(ct.TITLE     ?? '').trim();
        }
      } catch (_) { /* CONTACTS row missing — fall back to denormalised name */ }
    }
    if (!lastName) {
      const parts = String(rawDoc.CONTACT ?? '').trim().split(/\s+/).filter(Boolean);
      lastName = parts.length ? parts[parts.length - 1] : '';
    }
    const namePart = [title, lastName].filter(Boolean).join(' ');
    salutationLine = buildSalutationLine({ salutation: rawDoc.CONTACT_SALUTATION, namePart });
  }

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
  // Only LEAF rows count in the Summe — parents are aggregated displays of
  // their children's values, so including them would double-count.
  const leafProjectStructureRows = projectStructureRows.filter(r => r.isLeaf);
  const structureTotals = {
    feeTotal:      leafProjectStructureRows.reduce((s, r) => s + r.feeTotal,      0),
    alreadyBilled: leafProjectStructureRows.reduce((s, r) => s + r.alreadyBilled, 0),
    thisDocNet:    leafProjectStructureRows.reduce((s, r) => s + r.thisDocNet,    0),
  };
  const surchargeSummaryRows    = projectStructureRows.filter(r => r.surchargesTotal > 0);
  // Each row's surchargesTotal is its OWN surcharges (not aggregated from
  // children), so summing all rows with surcharges is correct — no double-count.
  let structureSurchargesTotal = Math.round(surchargeSummaryRows.reduce((s, r) => s + r.surchargesTotal, 0) * 100) / 100;

  // Project-level (root) surcharges — Option A
  if (rawDoc.PROJECT_ID) {
    try {
      const { data: projRow } = await supabase
        .from('PROJECT')
        .select('SURCHARGE_1_LABEL, SURCHARGE_1_PCT, SURCHARGE_1_EUR, SURCHARGE_2_LABEL, SURCHARGE_2_PCT, SURCHARGE_2_EUR, SURCHARGE_3_LABEL, SURCHARGE_3_PCT, SURCHARGE_3_EUR, SURCHARGES_TOTAL')
        .eq('ID', rawDoc.PROJECT_ID)
        .maybeSingle();
      const projectSurchargesTotal = Number(projRow?.SURCHARGES_TOTAL || 0);
      if (projRow && projectSurchargesTotal > 0) {
        // The summary basis for the project-level row = sum of root-node REVENUE
        const rootBasis = projectStructureRows.reduce((s, r) => s + (r.feeTotal - (r.surchargesTotal || 0)), 0);
        surchargeSummaryRows.push({
          nameShort: 'Projekt',
          nameLong:  'Projektweite Zuschläge',
          revenueBasis:    rootBasis,
          surchargesTotal: projectSurchargesTotal,
          s1Label: projRow.SURCHARGE_1_LABEL || null, s1Pct: Number(projRow.SURCHARGE_1_PCT || 0), s1Eur: Number(projRow.SURCHARGE_1_EUR || 0),
          s2Label: projRow.SURCHARGE_2_LABEL || null, s2Pct: Number(projRow.SURCHARGE_2_PCT || 0), s2Eur: Number(projRow.SURCHARGE_2_EUR || 0),
          s3Label: projRow.SURCHARGE_3_LABEL || null, s3Pct: Number(projRow.SURCHARGE_3_PCT || 0), s3Eur: Number(projRow.SURCHARGE_3_EUR || 0),
          // Fields needed by templates
          feeTotal: rootBasis + projectSurchargesTotal,
          alreadyBilled: 0, thisDocNet: 0, performedPct: 0,
        });
        structureSurchargesTotal = Math.round((structureSurchargesTotal + projectSurchargesTotal) * 100) / 100;
      }
    } catch (_) { /* surcharge columns may not exist yet — soft-fail */ }
  }

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

  // Sicherheitseinbehalt (Phase 1)
  const sePct       = Number(rawDoc.SE_PERCENT ?? 0);
  const seBasis     = rawDoc.SE_BASIS || null;   // 'BRUTTO' | 'NETTO' | null
  const seBasisAmt  = Number(rawDoc.SE_BASIS_AMT ?? 0);
  const seAmount    = Number(rawDoc.SE_AMOUNT ?? 0);
  const hasSe       = sePct > 0 && seAmount > 0;
  let seLegalReference = null;
  if ((hasSe || Number(rawDoc.SE_RELEASE_TOTAL ?? 0) > 0) && rawDoc.CONTRACT_ID) {
    try {
      const { data: c } = await supabase
        .from('CONTRACT').select('SE_LEGAL_REFERENCE').eq('ID', rawDoc.CONTRACT_ID).maybeSingle();
      seLegalReference = c?.SE_LEGAL_REFERENCE ?? null;
    } catch (_) { /* schema may lack column */ }
  }

  // SE-Auflösung (Phase 2) — only for INVOICE docs (Schluss/Teilschluss)
  let seReleaseRows = [];
  let seReleaseTotal = Number(rawDoc.SE_RELEASE_TOTAL ?? 0);
  if (docType === 'INVOICE') {
    try {
      const { data: rels } = await supabase
        .from('PARTIAL_PAYMENT')
        .select('ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, SE_AMOUNT')
        .eq('SE_RELEASED_BY_INVOICE_ID', parseInt(rawDoc.ID, 10))
        .order('PARTIAL_PAYMENT_DATE', { ascending: true });
      seReleaseRows = (rels || []).map(r => ({
        number: r.PARTIAL_PAYMENT_NUMBER || String(r.ID),
        date:   r.PARTIAL_PAYMENT_DATE,
        amount: Number(r.SE_AMOUNT || 0),
      }));
      if (seReleaseTotal === 0 && seReleaseRows.length > 0) {
        seReleaseTotal = Math.round(seReleaseRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
      }
      // Preview-Pfad: vor dem Buchen ist SE_RELEASED_BY_INVOICE_ID auf den
      // PPs noch nicht gesetzt. Wenn der Wizard die geplante Auswahl mitschickt,
      // synthetisieren wir die Auflösung daraus, damit Preview = Buchung.
      if (seReleaseRows.length === 0 && Array.isArray(previewReleasePpIds) && previewReleasePpIds.length > 0) {
        const { data: previewPps } = await supabase
          .from('PARTIAL_PAYMENT')
          .select('ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, SE_AMOUNT, SE_RELEASED_BY_INVOICE_ID')
          .in('ID', previewReleasePpIds)
          .order('PARTIAL_PAYMENT_DATE', { ascending: true });
        const openPreview = (previewPps || []).filter(p =>
          Number(p.SE_AMOUNT || 0) > 0 && p.SE_RELEASED_BY_INVOICE_ID == null
        );
        seReleaseRows = openPreview.map(r => ({
          number: r.PARTIAL_PAYMENT_NUMBER || String(r.ID),
          date:   r.PARTIAL_PAYMENT_DATE,
          amount: Number(r.SE_AMOUNT || 0),
        }));
        seReleaseTotal = Math.round(seReleaseRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
      }
    } catch (_) { /* schema may lack SE_RELEASED_BY_INVOICE_ID */ }
  }
  const hasSeRelease = seReleaseRows.length > 0 && seReleaseTotal > 0;

  // Final "sofort fällig" considers BOTH withheld AND released SE
  const sePayable = Math.round((adjustedGross - (hasSe ? seAmount : 0) + (hasSeRelease ? seReleaseTotal : 0)) * 100) / 100;

  const securityRetention = {
    pct: sePct, basis: seBasis, basisAmount: seBasisAmt, amount: seAmount,
    legalReference: seLegalReference, hasSe, payable: sePayable,
    releaseRows: seReleaseRows, releaseTotal: seReleaseTotal, hasSeRelease,
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
    salutationLine,
    text1,
    text2,
    projectStructureRows,
    structureTotals,
    surchargeSummaryRows,
    structureSurchargesTotal,
    projectPayments,
    paymentTotals,
    tec,
    deductionTotals,
    discounts,
    securityRetention,
    arProgress,
    honorarCalcs,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

async function renderDocumentPdf({ supabase, docType, docId, templateId, previewReleasePpIds = [] }) {
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

  const vm = await buildPdfViewModel({ supabase, docType, docId, previewReleasePpIds });
  applyCategoryBlocks(theme, invoiceTypeToCategory(vm.inv && vm.inv.invoiceType, docType));
  vm.theme             = theme;
  vm.themeHead         = buildThemeHead(theme);
  vm.logoDataUri       = logoDataUri;
  vm.signatureDataUri  = signatureDataUri;

  // Inject text template (header/footer) if invoice has no manual texts
  await injectTextTemplate(supabase, vm, tenantId);
  applyPlaceholders(vm, {
    belegnummer: vm.inv?.number ?? '',
    belegdatum:  fmtDateDE(vm.inv?.date),
    projekt:     vm.projectName ?? '',
    kunde:       vm.inv?.buyer?.name ?? '',
    firma:       vm.inv?.seller?.name ?? '',
  });

  // EPC / GiroCode QR — only for payable documents (not storno)
  // When SE is in play (withheld or released), use securityRetention.payable so the
  // QR code + payment instruction match the actual amount the customer should pay.
  const baseGross = vm.discounts.hasDiscounts ? vm.discounts.adjustedGross : vm.inv.totals.grandTotal;
  const seInPlay  = vm.securityRetention && (vm.securityRetention.hasSe || vm.securityRetention.hasSeRelease);
  const payAmount = seInPlay ? vm.securityRetention.payable : baseGross;
  vm.payAmount = payAmount;
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

  const footerCols = buildSellerFooterCols(vm.inv.seller);
  const pdf = await renderPdf({ html, footerCols });
  return { pdf, template: tpl, theme };
}

// ── Offer PDF ─────────────────────────────────────────────────────────────────

async function renderOfferPdf({ supabase, offerId, tenantId }) {
  const vm = await angeboteSvc.buildOfferPdfViewModel(supabase, { offerId, tenantId });
  await injectOfferTextTemplate(supabase, vm, tenantId, 'offer_angebot');
  applyPlaceholders(vm, {
    belegnummer: vm.offer?.NAME_SHORT ?? '',
    belegdatum:  fmtDateDE(vm.offer?.OFFER_DATE),
    projekt:     vm.offer?.NAME_LONG ?? '',
    kunde:       vm.buyer?.name ?? '',
    firma:       vm.seller?.name ?? '',
  });

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
  applyCategoryBlocks(theme, 'offer_angebot');
  const context = { ...vm, theme, themeHead: buildThemeHead(theme), logoDataUri, signatureDataUri, honorarCalcs, honorarTotalSum };
  const layoutKey = tpl.LAYOUT_KEY || 'modern_a';
  const html = env().render(path.join(layoutKey, 'offer.njk'), context);

  const pdf = await renderPdf({ html });
  return { pdf, offer: vm.offer };
}

async function renderAuftragsbestaetigungPdf({ supabase, offerId, tenantId }) {
  const vm = await angeboteSvc.buildOfferPdfViewModel(supabase, { offerId, tenantId });
  await injectOfferTextTemplate(supabase, vm, tenantId, 'offer_auftragsbestaetigung');
  applyPlaceholders(vm, {
    belegnummer: vm.offer?.NAME_SHORT ?? '',
    belegdatum:  fmtDateDE(vm.offer?.OFFER_DATE),
    projekt:     vm.offer?.NAME_LONG ?? '',
    kunde:       vm.buyer?.name ?? '',
    firma:       vm.seller?.name ?? '',
  });

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
    themeHead: buildThemeHead(theme),
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

// Angebot/Auftragsbestaetigung: Standard-Kopf-/Fusstext aus TEXT_TEMPLATE, wenn
// am Angebot selbst kein eigener Text (OFFER_TEXT_1/2) hinterlegt ist.
async function injectOfferTextTemplate(supabase, vm, tenantId, documentType) {
  if (!documentType || !tenantId) return;
  try {
    const { data } = await supabase
      .from('TEXT_TEMPLATE')
      .select('HEADER_TEXT, FOOTER_TEXT')
      .eq('TENANT_ID', tenantId)
      .eq('DOCUMENT_TYPE', documentType)
      .maybeSingle();
    if (!data) return;
    if (!vm.text1 && data.HEADER_TEXT) vm.text1 = data.HEADER_TEXT;
    if (!vm.text2 && data.FOOTER_TEXT) vm.text2 = data.FOOTER_TEXT;
  } catch (e) {
    if (!isTableMissingErr(e, 'text_template')) console.warn('[OFFER_TEXT_TEMPLATE]', e.message);
  }
}

// ── Platzhalter in Kopf-/Fusstexten ───────────────────────────────────────────
// Ersetzt {{token}} im Kopf-/Fusstext durch konkrete Belegwerte. Unbekannte
// Tokens bleiben unveraendert stehen (kein versehentliches Loeschen). Additiv:
// Texte ohne Platzhalter bleiben exakt gleich -> keine Regression.
function resolvePlaceholders(text, values) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\{\{\s*([\wäöüÄÖÜ]+)\s*\}\}/g, (m, key) => {
    const k = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, k) ? (values[k] == null ? '' : String(values[k])) : m;
  });
}

function applyPlaceholders(vm, values) {
  if (vm.text1) vm.text1 = resolvePlaceholders(vm.text1, values);
  if (vm.text2) vm.text2 = resolvePlaceholders(vm.text2, values);
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
  return renderPdf({ html, footerCols: buildSellerFooterCols(context.seller) });
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

  // Bemessungsgrundlage des Leistungsbilds (cost_eur | area_ha)
  let baseType = 'cost_eur';
  if (calc.FEE_MASTER_ID) {
    try {
      const { data: fm } = await supabase
        .from('FEE_MASTERS').select('BASE_TYPE').eq('ID', calc.FEE_MASTER_ID).maybeSingle();
      if (fm?.BASE_TYPE) baseType = fm.BASE_TYPE;
    } catch (_) { /* Migration noch nicht gelaufen -> Default */ }
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
      baseType,
      isAreaHa:            baseType === 'area_ha',
      baseLabel:           baseType === 'area_ha' ? 'Plangebiet (ha)' : 'Baukosten (€)',
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

// ── Vorlagen-Vorschau (Branding-Tab) ──────────────────────────────────────────
// Rendert einen synthetischen Beispiel-Beleg gegen das uebergebene Theme. Keine
// DB-Belegdaten noetig — so funktioniert die Live-Vorschau ueberall (auch in den
// Einstellungen ohne offenen Beleg) und zeigt alle Branding-Elemente.

const PREVIEW_SAMPLE = {
  docTitle: 'Rechnung',
  number:   'RE-2026-0042',
  date:     '2026-06-24',
  seller:   { name: 'Musterplanung GmbH', street: 'Beispielstraße 1', postCode: '10115', city: 'Berlin',
              contactName: 'Dipl.-Ing. A. Muster', contactEmail: 'info@musterplanung.de', contactPhone: '030 1234567' },
  buyer:    { name: 'Bauherr Beispiel AG', street: 'Musterallee 7', postCode: '80331', city: 'München' },
  project:  'P-2026-014 – Neubau Verwaltungsgebäude',
  lines: [
    { pos: '1', desc: 'Leistungsphase 2 – Vorplanung',  qty: '1', price: '8.500,00', total: '8.500,00' },
    { pos: '2', desc: 'Leistungsphase 3 – Entwurfsplanung', qty: '1', price: '12.750,00', total: '12.750,00' },
    { pos: '3', desc: 'Nebenkosten (pauschal)',          qty: '1', price: '950,00',    total: '950,00' },
  ],
  net: '22.200,00', vatPct: '19', vat: '4.218,00', gross: '26.418,00',
};

// Welche Anhänge gibt es je Belegtyp (steuert Vorschau-Chips + UI-Toggles).
const APPENDIX_LABELS = {
  showProjectStructure: 'Projektübersicht',
  showTec:              'Stundennachweis',
  showHonorar:          'HOAI-/Kalkulationsübersicht',
  showPayments:         'Zahlungsübersicht',
};
// Anhänge werden je BELEG-KATEGORIE konfiguriert (nicht je DOC_TYPE), weil der
// DOC_TYPE INVOICE sowohl Rechnung als auch Schluss-/Teilschlussrechnung umfasst,
// die bewusst getrennte Inhalte haben (analog zu den Textvorlagen).
const APPENDIX_BY_CATEGORY = {
  invoice_rechnung:  ['showPayments', 'showProjectStructure', 'showTec', 'showHonorar'],
  invoice_schluss:   ['showPayments', 'showProjectStructure', 'showTec', 'showHonorar'],
  invoice_abschlags: ['showPayments', 'showProjectStructure', 'showTec', 'showHonorar'],
  offer_angebot:     ['showHonorar'],
};
const CATEGORY_TITLE = {
  invoice_rechnung: 'Rechnung', invoice_schluss: 'Schlussrechnung',
  invoice_abschlags: 'Abschlagsrechnung', offer_angebot: 'Angebot',
};

// Beleg-Kategorie aus invoiceType/docType ableiten (steuert die Anhang-Auswahl).
function invoiceTypeToCategory(invoiceType, docType) {
  if (docType === 'PARTIAL_PAYMENT' || invoiceType === 'partial_payment') return 'invoice_abschlags';
  if (invoiceType === 'schlussrechnung' || invoiceType === 'teilschlussrechnung') return 'invoice_schluss';
  return 'invoice_rechnung'; // rechnung + stornorechnung (Storno hat ohnehin keine Anhänge)
}

// Kategorie-spezifische Anhang-Flags ins theme.blocks ziehen (Template liest theme.blocks.*).
function applyCategoryBlocks(theme, category) {
  const def = defaultTheme().blocks;
  const cat = theme.blocksByCategory && theme.blocksByCategory[category];
  theme.blocks = { ...def, ...(cat || theme.blocks || {}) };
  return theme;
}

async function renderPreviewDoc({ supabase, tenantId, theme, category = 'invoice_rechnung', asPdf = false }) {
  const mergedTheme = deepMerge(defaultTheme(), theme && typeof theme === 'object' ? theme : {});
  const cat = APPENDIX_BY_CATEGORY[category] ? category : 'invoice_rechnung';
  const blocks = mergedTheme.blocks || {};
  const order = Array.isArray(blocks.order) ? blocks.order : [];
  const orderedKeys = APPENDIX_BY_CATEGORY[cat].slice().sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  const appendicesOn = orderedKeys.filter(k => blocks[k] !== false).map(k => APPENDIX_LABELS[k]);

  let logoDataUri = null;
  try {
    const { data: co } = await supabase
      .from('COMPANY').select('ID').eq('TENANT_ID', tenantId).limit(1).maybeSingle();
    logoDataUri = await resolveLogoDataUri({ supabase, tplLogoAssetId: null, tenantId, companyId: co?.ID ?? null });
  } catch (_) { /* Logo optional — Vorschau funktioniert auch ohne */ }

  const context = {
    theme: mergedTheme, themeHead: buildThemeHead(mergedTheme), logoDataUri,
    sample: PREVIEW_SAMPLE, appendicesOn, docTitle: CATEGORY_TITLE[cat],
  };
  const html = env().render(path.join('modern_a', 'preview.njk'), context);
  if (!asPdf) return { html };
  const pdf = await renderPdf({ html });
  return { pdf, html };
}

module.exports = { renderDocumentPdf, renderOfferPdf, renderAuftragsbestaetigungPdf, renderMonatsabschlussPdf, renderMahnungPdf, renderHonorarPdf, renderPreviewDoc };