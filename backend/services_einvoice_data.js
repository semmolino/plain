'use strict';

/**
 * services_einvoice_data.js
 *
 * Loads all data needed for e-invoice generation and normalises it into a
 * single InvoiceData object that both the CII (ZUGFeRD/Factur-X) and UBL
 * (XRechnung) renderers consume.
 *
 * Supports:
 *   docType = 'INVOICE'          → regular Rechnung or Schluss-/Teilschlussrechnung
 *   docType = 'PARTIAL_PAYMENT'  → Abschlagsrechnung
 */

class InvoiceDataError extends Error {
  constructor(msg) { super(msg); this.name = 'InvoiceDataError'; this.status = 422; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function asIsoDate(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function fmt2(n) {
  // Round to 2 decimal places, return as number (not string)
  return Math.round(toNum(n) * 100) / 100;
}

function isLikelyCountryCode(v) {
  return /^[A-Z]{2}$/.test(String(v ?? '').trim());
}

function normalizeVatId(raw, countryCode) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (/^[A-Za-z]{2}/.test(v)) return v.toUpperCase();
  const cc = String(countryCode ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? `${cc}${v}` : v;
}

function normalizePhone(v) {
  return String(v ?? '').trim();
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function one(supabase, table, id, tenantId) {
  if (!id) return null;
  const q = supabase.from(table).select('*').eq('ID', id);
  if (tenantId) q.eq('TENANT_ID', tenantId);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

async function lookupCountryCode(supabase, countryId) {
  if (!countryId) return 'DE';
  const { data } = await supabase.from('COUNTRY').select('NAME_SHORT').eq('ID', countryId).maybeSingle();
  return isLikelyCountryCode(data?.NAME_SHORT) ? data.NAME_SHORT : 'DE';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Load and normalise all invoice data.
 *
 * @param {object}  supabase   Supabase client
 * @param {number}  docId      Document ID
 * @param {string}  docType    'INVOICE' | 'PARTIAL_PAYMENT'
 * @param {number}  tenantId
 * @returns {InvoiceData}
 */
async function loadInvoiceData(supabase, docId, docType, tenantId) {
  const table  = docType === 'INVOICE' ? 'INVOICE' : 'PARTIAL_PAYMENT';
  const doc    = await one(supabase, table, docId, tenantId);
  if (!doc) throw new InvoiceDataError(`${table} ${docId} not found.`);

  // ── 1. Resolve document metadata ──────────────────────────────────────────

  const isInvoice = docType === 'INVOICE';
  const invoiceType = isInvoice ? (doc.INVOICE_TYPE || 'rechnung') : 'partial_payment';
  const isFinal = invoiceType === 'schlussrechnung' || invoiceType === 'teilschlussrechnung';

  const number   = isInvoice ? doc.INVOICE_NUMBER         : doc.PARTIAL_PAYMENT_NUMBER;
  const docDate  = isInvoice ? doc.INVOICE_DATE           : doc.PARTIAL_PAYMENT_DATE;
  const addressIdField = isInvoice ? 'INVOICE_ADDRESS_ID' : 'PARTIAL_PAYMENT_ADDRESS_ID';
  const contactIdField = isInvoice ? 'INVOICE_CONTACT_ID' : 'PARTIAL_PAYMENT_CONTACT_ID';

  // type code: 326 = partial invoice (Abschlagsrechnung), 380 = commercial invoice
  const typeCode = (docType === 'PARTIAL_PAYMENT') ? '326' : '380';

  // ── 2. Seller (COMPANY) ───────────────────────────────────────────────────

  const company = await one(supabase, 'COMPANY', doc.COMPANY_ID, tenantId);

  // Seller country: snapshot → live lookup
  let sellerCountry = doc.SELLER_COUNTRY_ID || null;
  if (!isLikelyCountryCode(sellerCountry) && company?.COUNTRY_ID) {
    sellerCountry = await lookupCountryCode(supabase, company.COUNTRY_ID);
  }
  if (!isLikelyCountryCode(sellerCountry)) sellerCountry = 'DE';

  // VAT ID (VA scheme, e.g. DE123456789)
  const sellerVatIdRaw = doc['COMPANY_VAT_ID'] ?? company?.VAT_ID ?? '';
  const sellerVatId    = normalizeVatId(sellerVatIdRaw, sellerCountry);

  // Tax registration number (FC scheme, e.g. 78910/12345)
  const sellerTaxId = String(doc['COMPANY_TAX-ID'] ?? company?.['TAX-ID'] ?? '').trim();

  const sellerIban = String(doc.COMPANY_IBAN ?? company?.IBAN ?? '').trim();
  const sellerBic  = String(doc.COMPANY_BIC  ?? company?.BIC  ?? '').trim();

  // ── 3. Seller contact (EMPLOYEE) ─────────────────────────────────────────

  const employee = await one(supabase, 'EMPLOYEE', doc.EMPLOYEE_ID, tenantId);

  const contactName  = String(doc.EMPLOYEE ?? '').trim()
    || [employee?.FIRST_NAME, employee?.LAST_NAME].filter(Boolean).join(' ')
    || String(employee?.SHORT_NAME ?? '').trim();
  const contactPhone = normalizePhone(doc.EMPLOYEE_PHONE ?? employee?.MOBILE ?? employee?.PHONE ?? '');
  const contactEmail = String(doc.EMPLOYEE_MAIL ?? employee?.MAIL ?? '').trim();
  const sellerEmail  = contactEmail; // used as endpoint URI

  // ── 4. Buyer (ADDRESS) ────────────────────────────────────────────────────

  const address = await one(supabase, 'ADDRESS', doc[addressIdField], tenantId);

  const buyerName = String(
    doc.ADDRESS_NAME_1 ?? address?.ADDRESS_NAME_1 ?? doc.ADDRESS_NAME_2 ?? address?.ADDRESS_NAME_2 ?? ''
  ).trim();

  if (!buyerName) {
    throw new InvoiceDataError('Käufername (BT-44) fehlt. Bitte Rechnungsadresse prüfen.');
  }

  let buyerCountry = doc.ADDRESS_COUNTRY ?? null;
  if (!isLikelyCountryCode(buyerCountry) && address?.COUNTRY_ID) {
    buyerCountry = await lookupCountryCode(supabase, address.COUNTRY_ID);
  }
  if (!isLikelyCountryCode(buyerCountry)) buyerCountry = 'DE';

  const buyerVatId = normalizeVatId(
    doc.ADDRESS_VAT_ID ?? address?.VAT_ID ?? '', buyerCountry
  );

  // ── 5. Currency ───────────────────────────────────────────────────────────

  let currency = 'EUR';
  if (doc.CURRENCY_ID) {
    const cur = await one(supabase, 'CURRENCY', doc.CURRENCY_ID, null);
    if (cur?.NAME_SHORT) currency = cur.NAME_SHORT;
  }

  // ── 6. VAT ────────────────────────────────────────────────────────────────

  const vatPercent = toNum(doc.VAT_PERCENT ?? 19);
  const vatCategory = vatPercent > 0 ? 'S' : 'Z';

  // ── 7. Line items ─────────────────────────────────────────────────────────

  let lines = [];

  if (isInvoice) {
    // Load INVOICE_STRUCTURE rows joined with PROJECT_STRUCTURE for names
    const { data: invStructures } = await supabase
      .from('INVOICE_STRUCTURE')
      .select('STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET')
      .eq('INVOICE_ID', docId)
      .eq('TENANT_ID', tenantId);

    if (invStructures && invStructures.length > 0) {
      // Load PROJECT_STRUCTURE names in one query
      const structIds = invStructures.map(r => r.STRUCTURE_ID);
      const { data: projStructures } = await supabase
        .from('PROJECT_STRUCTURE')
        .select('ID, NAME_SHORT, NAME_LONG, BILLING_TYPE_ID')
        .in('ID', structIds);

      const nameMap = Object.fromEntries((projStructures ?? []).map(r => [r.ID, r]));

      lines = invStructures.map((row, idx) => {
        const ps = nameMap[row.STRUCTURE_ID] ?? {};
        const amountNet    = fmt2(row.AMOUNT_NET ?? 0);
        const amountExtras = fmt2(row.AMOUNT_EXTRAS_NET ?? 0);
        const lineTotal    = fmt2(amountNet + amountExtras);

        const nameParts = [ps.NAME_SHORT, ps.NAME_LONG].filter(Boolean);
        const desc = nameParts.join(' – ') || `Position ${idx + 1}`;

        // For BT1 (performance) lines note % completion would be ideal but
        // isn't available here without a separate query — left to future enhancement.
        return {
          id:          idx + 1,
          description: desc,
          note:        amountExtras > 0 ? `Honorar: ${amountNet} / Nebenkosten: ${amountExtras}` : '',
          quantity:    1,
          unitCode:    'LS',   // Lump Sum (pauschal) — appropriate for service billing
          unitPrice:   lineTotal,
          lineTotal,
          vatRate:     vatPercent,
          vatCategory,
          billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
          billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
        };
      });
    }
  }

  // Fallback: if no structure lines (Abschlagsrechnung or Invoice without lines), use document totals
  if (lines.length === 0) {
    const amountNet    = fmt2(doc.AMOUNT_NET ?? doc.TOTAL_AMOUNT_NET ?? 0);
    const amountExtras = fmt2(doc.AMOUNT_EXTRAS_NET ?? 0);
    const lineTotal    = fmt2(amountNet + amountExtras);
    const label = docType === 'PARTIAL_PAYMENT' ? 'Abschlagsrechnung' : 'Rechnung';

    lines.push({
      id:          1,
      description: label,
      note:        amountExtras > 0 ? `Honorar: ${amountNet} / Nebenkosten: ${amountExtras}` : '',
      quantity:    1,
      unitCode:    'LS',
      unitPrice:   lineTotal,
      lineTotal,
      vatRate:     vatPercent,
      vatCategory,
      billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
      billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
    });
  }

  // ── 8. Deductions (Schlussrechnung only) ──────────────────────────────────

  let deductions = [];
  if (isFinal) {
    const { data: dedRows } = await supabase
      .from('INVOICE_DEDUCTION')
      .select('DEDUCTION_AMOUNT_NET, PARTIAL_PAYMENT_ID')
      .eq('INVOICE_ID', docId)
      .eq('TENANT_ID', tenantId);

    if (dedRows && dedRows.length > 0) {
      const ppIds = dedRows.map(r => r.PARTIAL_PAYMENT_ID);
      const { data: partials } = await supabase
        .from('PARTIAL_PAYMENT')
        .select('ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, TOTAL_AMOUNT_GROSS, TOTAL_AMOUNT_NET, VAT_PERCENT')
        .in('ID', ppIds);

      const ppMap = Object.fromEntries((partials ?? []).map(p => [p.ID, p]));

      deductions = dedRows.map(d => {
        const pp = ppMap[d.PARTIAL_PAYMENT_ID] ?? {};
        const gross = fmt2(pp.TOTAL_AMOUNT_GROSS ?? 0);
        const net   = fmt2(d.DEDUCTION_AMOUNT_NET ?? pp.TOTAL_AMOUNT_NET ?? 0);
        const vat   = fmt2(gross - net);
        return {
          number:      pp.PARTIAL_PAYMENT_NUMBER ?? String(d.PARTIAL_PAYMENT_ID),
          date:        asIsoDate(pp.PARTIAL_PAYMENT_DATE),
          netAmount:   net,
          vatAmount:   vat,
          grossAmount: gross,
        };
      });
    }
  }

  // ── 9. Monetary totals ────────────────────────────────────────────────────

  const lineTotal  = fmt2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const taxBasis   = lineTotal;
  const taxAmount  = fmt2(doc.TAX_AMOUNT_NET ?? (taxBasis * vatPercent / 100));
  const grandTotal = fmt2(doc.TOTAL_AMOUNT_GROSS ?? (taxBasis + taxAmount));

  // Prepaid = sum of gross deductions (for Schlussrechnung)
  const prepaidAmount = fmt2(deductions.reduce((s, d) => s + d.grossAmount, 0));
  const duePayable    = fmt2(grandTotal - prepaidAmount);

  // VAT breakdown — single rate for now
  const vatBreakdown = [{
    rate:     vatPercent,
    basis:    taxBasis,
    amount:   taxAmount,
    category: vatCategory,
  }];

  // ── 10. Assemble and return ───────────────────────────────────────────────

  return {
    // Document
    docType,
    invoiceType,
    typeCode,
    number:   number  || String(docId),
    date:     asIsoDate(docDate) || asIsoDate(new Date().toISOString()),
    dueDate:  asIsoDate(doc.DUE_DATE),
    currency,
    comment:  String(doc.COMMENT ?? '').trim(),
    billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
    billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
    buyerReference: String(doc.BUYER_REFERENCE ?? doc.ADDRESS_REFERENCE_NUMBER ?? '').trim(),

    // Seller
    seller: {
      name:         String(doc.COMPANY_NAME_1 ?? company?.COMPANY_NAME_1 ?? '').trim(),
      street:       String(doc.COMPANY_STREET ?? company?.STREET ?? '').trim(),
      city:         String(doc.COMPANY_CITY   ?? company?.CITY   ?? '').trim(),
      postCode:     String(doc.COMPANY_POST_CODE ?? company?.POST_CODE ?? '').trim(),
      countryId:    sellerCountry,
      vatId:        sellerVatId,   // VA scheme (Umsatzsteuer-ID)
      taxId:        sellerTaxId,   // FC scheme (Steuernummer)
      iban:         sellerIban,
      bic:          sellerBic,
      contactName:  contactName,
      contactPhone: contactPhone,
      contactEmail: contactEmail,
      email:        sellerEmail,
    },

    // Buyer
    buyer: {
      name:     buyerName,
      street:   String(doc.ADDRESS_STREET   ?? address?.STREET   ?? '').trim(),
      city:     String(doc.ADDRESS_CITY     ?? address?.CITY     ?? '').trim(),
      postCode: String(doc.ADDRESS_POST_CODE ?? address?.POST_CODE ?? '').trim(),
      countryId: buyerCountry,
      vatId:    buyerVatId,
      email:    String(doc.CONTACT_MAIL ?? '').trim(),
    },

    // Lines, totals, deductions
    lines,
    vatBreakdown,
    deductions,

    totals: {
      lineTotal,
      taxBasis,
      taxAmount,
      grandTotal,
      prepaidAmount,
      duePayable,
    },

    // References
    projectNumber:  String(doc.PROJECT_NUMBER  ?? '').trim(),
    contractNumber: String(doc.CONTRACT_NUMBER ?? '').trim(),
    orderNumber:    String(doc.ORDER_NUMBER    ?? '').trim(),
  };
}

module.exports = { loadInvoiceData, InvoiceDataError };