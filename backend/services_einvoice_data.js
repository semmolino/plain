'use strict';

/**
 * services_einvoice_data.js
 *
 * Loads and normalises all invoice data into a single InvoiceData object
 * consumed by both the CII (ZUGFeRD/Factur-X) and UBL (XRechnung) renderers.
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
  return Math.round(toNum(n) * 100) / 100;
}

function isCountryCode(v) {
  return /^[A-Z]{2}$/.test(String(v ?? '').trim());
}

function normalizeVatId(raw, countryCode) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (/^[A-Za-z]{2}/.test(v)) return v.toUpperCase();
  const cc = String(countryCode ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? `${cc}${v}` : v;
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
  return isCountryCode(data?.NAME_SHORT) ? data.NAME_SHORT : 'DE';
}

// ── Main export ───────────────────────────────────────────────────────────────

async function loadInvoiceData(supabase, docId, docType, tenantId) {
  const table = docType === 'INVOICE' ? 'INVOICE' : 'PARTIAL_PAYMENT';
  const doc   = await one(supabase, table, docId, tenantId);
  if (!doc) throw new InvoiceDataError(`${table} ${docId} not found.`);

  // ── 1. Document type & TypeCodes ──────────────────────────────────────────

  const isInvoice  = docType === 'INVOICE';
  const isStornoPP = docType === 'PARTIAL_PAYMENT' && !!doc.CANCELS_PARTIAL_PAYMENT_ID;
  const invoiceType = isInvoice
    ? (doc.INVOICE_TYPE || 'rechnung')
    : (isStornoPP ? 'stornorechnung' : 'partial_payment');

  const isFinal  = invoiceType === 'schlussrechnung' || invoiceType === 'teilschlussrechnung';
  const isStorno = invoiceType === 'stornorechnung';
  const isGutschrift = invoiceType === 'gutschrift';

  const number  = isInvoice ? doc.INVOICE_NUMBER        : doc.PARTIAL_PAYMENT_NUMBER;
  const docDate = isInvoice ? doc.INVOICE_DATE          : doc.PARTIAL_PAYMENT_DATE;
  const addressIdField = isInvoice ? 'INVOICE_ADDRESS_ID'      : 'PARTIAL_PAYMENT_ADDRESS_ID';

  // CII type codes: EXTENDED allows 875/876/877; all profiles allow 380/381/384
  const typeCodeCii =
    docType === 'PARTIAL_PAYMENT'
      ? (isStornoPP    ? '384' : '875')
    : invoiceType === 'schlussrechnung'     ? '877'
    : invoiceType === 'teilschlussrechnung' ? '876'
    : isStorno                              ? '384'
    : isGutschrift                          ? '381'
    : '380';

  // UBL type codes: 326=Abschlag, 380=Invoice/Schluss, 381=Gutschrift, 384=Storno
  const typeCodeUbl =
    docType === 'PARTIAL_PAYMENT'
      ? (isStornoPP ? '384' : '326')
    : isStorno    ? '384'
    : isGutschrift ? '381'
    : '380';

  // ── 2. Seller (COMPANY) ───────────────────────────────────────────────────

  const company = await one(supabase, 'COMPANY', doc.COMPANY_ID, tenantId);

  let sellerCountry = null;
  if (company?.COUNTRY_ID) {
    sellerCountry = await lookupCountryCode(supabase, company.COUNTRY_ID);
  }
  if (!isCountryCode(sellerCountry)) sellerCountry = 'DE';

  // COMPANY_TAX-ID = Umsatzsteuer-ID (VA scheme, e.g. DE123456789)
  const sellerVatId = normalizeVatId(doc['COMPANY_TAX-ID'] ?? '', sellerCountry);
  // COMPANY_TAX_NUMBER = Steuernummer (FC scheme, e.g. 78910/12345)
  const sellerTaxId = String(doc.COMPANY_TAX_NUMBER ?? '').trim();

  const sellerIban        = String(doc.COMPANY_IBAN         ?? company?.IBAN        ?? '').trim();
  const sellerBic         = String(doc.COMPANY_BIC          ?? company?.BIC         ?? '').trim();
  const sellerCreditorId  = String(doc['COMPANY_CREDITOR-ID']                        ?? '').trim();
  const sellerPostOffBox  = String(doc.COMPANY_POST_OFFICE_BOX                       ?? '').trim();

  // ── 3. Seller contact (EMPLOYEE) ─────────────────────────────────────────

  const employee = await one(supabase, 'EMPLOYEE', doc.EMPLOYEE_ID, tenantId);
  const contactName  = String(doc.EMPLOYEE ?? '').trim()
    || [employee?.FIRST_NAME, employee?.LAST_NAME].filter(Boolean).join(' ')
    || String(employee?.SHORT_NAME ?? '').trim();
  const contactPhone = String(doc.EMPLOYEE_PHONE ?? employee?.MOBILE ?? employee?.PHONE ?? '').trim();
  const contactEmail = String(doc.EMPLOYEE_MAIL  ?? employee?.MAIL   ?? '').trim();

  // ── 4. Buyer (ADDRESS) ────────────────────────────────────────────────────

  const address = await one(supabase, 'ADDRESS', doc[addressIdField], tenantId);

  const buyerName = String(
    doc.ADDRESS_NAME_1 ?? address?.ADDRESS_NAME_1 ?? doc.ADDRESS_NAME_2 ?? address?.ADDRESS_NAME_2 ?? ''
  ).trim();
  if (!buyerName) throw new InvoiceDataError('Käufername (BT-44) fehlt. Bitte Rechnungsadresse prüfen.');

  let buyerCountry = doc.ADDRESS_COUNTRY ?? null;
  if (!isCountryCode(buyerCountry) && address?.COUNTRY_ID) {
    buyerCountry = await lookupCountryCode(supabase, address.COUNTRY_ID);
  }
  if (!isCountryCode(buyerCountry)) buyerCountry = 'DE';

  const buyerVatId         = normalizeVatId(doc.ADDRESS_VAT_ID ?? address?.VAT_ID ?? '', buyerCountry);
  const buyerDebitorNumber = String(doc.ADDRESS_DEBITOR_NUMBER ?? address?.DEBITOR_NUMBER ?? '').trim();

  // ── 5. Currency ───────────────────────────────────────────────────────────

  let currency = 'EUR';
  if (doc.CURRENCY_ID) {
    const cur = await one(supabase, 'CURRENCY', doc.CURRENCY_ID, null);
    if (cur?.NAME_SHORT) currency = cur.NAME_SHORT;
  }

  // ── 6. VAT ────────────────────────────────────────────────────────────────

  const vatPercent  = toNum(doc.VAT_PERCENT ?? 0);
  const vatCategory = vatPercent > 0 ? 'S' : 'Z';

  // ── 7. Document-level allowances (Skonto-unabhängige Nachlässe) ───────────

  const allowances = [];
  if (toNum(doc.DISCOUNT_1) > 0) {
    allowances.push({
      reason:  String(doc.DISCOUNT_1_REASON ?? 'Nachlass').trim() || 'Nachlass',
      percent: toNum(doc.DISCOUNT_1_PERCENT),
      amount:  fmt2(doc.DISCOUNT_1),
    });
  }
  if (toNum(doc.DISCOUNT_2) > 0) {
    allowances.push({
      reason:  String(doc.DISCOUNT_2_REASON ?? 'Nachlass').trim() || 'Nachlass',
      percent: toNum(doc.DISCOUNT_2_PERCENT),
      amount:  fmt2(doc.DISCOUNT_2),
    });
  }

  // ── 8. Cash discount (Skonto) ─────────────────────────────────────────────

  const cashDiscount = toNum(doc.CASH_DISCOUNT_PERCENT) > 0 ? {
    percent: toNum(doc.CASH_DISCOUNT_PERCENT),
    days:    toNum(doc.CASH_DISCOUNT_DAYS),
    amount:  fmt2(doc.CASH_DISCOUNT),
  } : null;

  // ── 9. Canceled document reference (Storno) ───────────────────────────────

  let canceledDocNumber = null;
  let canceledDocDate   = null;
  if (isStorno && isInvoice && doc.CANCELS_INVOICE_ID) {
    const orig = await one(supabase, 'INVOICE', doc.CANCELS_INVOICE_ID, tenantId);
    canceledDocNumber = orig?.INVOICE_NUMBER ?? String(doc.CANCELS_INVOICE_ID);
    canceledDocDate   = asIsoDate(orig?.INVOICE_DATE);
  } else if (isStornoPP) {
    const orig = await one(supabase, 'PARTIAL_PAYMENT', doc.CANCELS_PARTIAL_PAYMENT_ID, tenantId);
    canceledDocNumber = orig?.PARTIAL_PAYMENT_NUMBER ?? String(doc.CANCELS_PARTIAL_PAYMENT_ID);
    canceledDocDate   = asIsoDate(orig?.PARTIAL_PAYMENT_DATE);
  }

  // ── 10. Line items ────────────────────────────────────────────────────────

  let lines = [];

  if (isInvoice) {
    const { data: invStructures } = await supabase
      .from('INVOICE_STRUCTURE')
      .select('STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET')
      .eq('INVOICE_ID', docId)
      .eq('TENANT_ID', tenantId);

    if (invStructures && invStructures.length > 0) {
      const structIds = invStructures.map(r => r.STRUCTURE_ID);
      const { data: projStructures } = await supabase
        .from('PROJECT_STRUCTURE')
        .select('ID, NAME_SHORT, NAME_LONG')
        .in('ID', structIds);

      const nameMap = Object.fromEntries((projStructures ?? []).map(r => [r.ID, r]));

      lines = invStructures.map((row, idx) => {
        const ps           = nameMap[row.STRUCTURE_ID] ?? {};
        const amountNet    = fmt2(row.AMOUNT_NET ?? 0);
        const amountExtras = fmt2(row.AMOUNT_EXTRAS_NET ?? 0);
        const lineTotal    = fmt2(amountNet + amountExtras);
        const desc = [ps.NAME_SHORT, ps.NAME_LONG].filter(Boolean).join(' – ') || `Position ${idx + 1}`;
        return {
          id:          idx + 1,
          description: desc,
          note:        amountExtras > 0 ? `Honorar: ${amountNet} / Nebenkosten: ${amountExtras}` : '',
          quantity:    1,
          unitCode:    'LS',
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

  if (lines.length === 0) {
    const amountNet    = fmt2(doc.AMOUNT_NET ?? 0);
    const amountExtras = fmt2(doc.AMOUNT_EXTRAS_NET ?? 0);
    const lineTotal    = fmt2(amountNet + amountExtras);
    const label = docType === 'PARTIAL_PAYMENT' ? 'Abschlagsrechnung' : 'Rechnung';
    lines.push({
      id: 1, description: label,
      note:     amountExtras > 0 ? `Honorar: ${amountNet} / Nebenkosten: ${amountExtras}` : '',
      quantity: 1, unitCode: 'LS', unitPrice: lineTotal, lineTotal,
      vatRate: vatPercent, vatCategory,
      billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
      billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
    });
  }

  // ── 11. Deductions (Schlussrechnung only) ─────────────────────────────────

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
        .select('ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, TOTAL_AMOUNT_GROSS, TOTAL_AMOUNT_NET')
        .in('ID', ppIds);

      const ppMap = Object.fromEntries((partials ?? []).map(p => [p.ID, p]));
      deductions = dedRows.map(d => {
        const pp    = ppMap[d.PARTIAL_PAYMENT_ID] ?? {};
        const gross = fmt2(pp.TOTAL_AMOUNT_GROSS ?? 0);
        const net   = fmt2(d.DEDUCTION_AMOUNT_NET ?? pp.TOTAL_AMOUNT_NET ?? 0);
        return {
          number:      pp.PARTIAL_PAYMENT_NUMBER ?? String(d.PARTIAL_PAYMENT_ID),
          date:        asIsoDate(pp.PARTIAL_PAYMENT_DATE),
          netAmount:   net,
          vatAmount:   fmt2(gross - net),
          grossAmount: gross,
        };
      });
    }
  }

  // ── 12. Monetary totals ───────────────────────────────────────────────────

  const lineTotal      = fmt2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const allowanceTotal = fmt2(allowances.reduce((s, a) => s + a.amount, 0));
  const chargeTotal    = 0;

  // Use stored totals from the document (authoritative, handles all edge cases)
  const taxBasis   = fmt2(toNum(doc.TOTAL_AMOUNT_NET) || fmt2(lineTotal - allowanceTotal));
  const taxAmount  = fmt2(toNum(doc.TAX_AMOUNT_NET)   || fmt2(taxBasis * vatPercent / 100));
  const grandTotal = fmt2(toNum(doc.TOTAL_AMOUNT_GROSS) || fmt2(taxBasis + taxAmount));

  // Prepaid = gross already invoiced via prior ARs (Schlussrechnung only)
  const prepaidGross = fmt2(deductions.reduce((s, d) => s + d.grossAmount, 0));

  // ── Sicherheitseinbehalt (Phase 4) ────────────────────────────────────────
  // SE held in THIS doc → reduces payable (customer pays less).
  // SE released by THIS doc → increases payable (customer pays more, gets prior SE back).
  // VAT is NOT affected — kept in PayableAmount only.
  const seHeldAmount    = toNum(doc.SE_AMOUNT ?? 0);
  const seHeldPercent   = toNum(doc.SE_PERCENT ?? 0);
  const seHeldBasis     = String(doc.SE_BASIS ?? '').trim() || null;   // 'BRUTTO' | 'NETTO'
  const seReleaseTotal  = toNum(doc.SE_RELEASE_TOTAL ?? 0);

  // Load released PARTIAL_PAYMENTs (Phase 2 link) for SE-release reason text
  let seReleaseRows = [];
  if (docType === 'INVOICE' && doc.ID) {
    try {
      const { data: rels } = await supabase
        .from('PARTIAL_PAYMENT')
        .select('ID, PARTIAL_PAYMENT_NUMBER, SE_AMOUNT')
        .eq('SE_RELEASED_BY_INVOICE_ID', doc.ID);
      seReleaseRows = (rels || []).map(r => ({
        number: r.PARTIAL_PAYMENT_NUMBER || String(r.ID),
        amount: fmt2(toNum(r.SE_AMOUNT ?? 0)),
      }));
    } catch (_) { /* schema may lack column */ }
  }

  // Legal reference text from CONTRACT
  let seLegalReference = null;
  if ((seHeldAmount > 0 || seReleaseTotal > 0) && doc.CONTRACT_ID) {
    try {
      const { data: c } = await supabase
        .from('CONTRACT').select('SE_LEGAL_REFERENCE').eq('ID', doc.CONTRACT_ID).maybeSingle();
      seLegalReference = c?.SE_LEGAL_REFERENCE ?? null;
    } catch (_) { /* ignore */ }
  }

  const securityRetention = {
    held: {
      amount:  fmt2(seHeldAmount),
      percent: seHeldPercent,
      basis:   seHeldBasis,
    },
    release: {
      total:   fmt2(seReleaseTotal),
      rows:    seReleaseRows,
    },
    legalReference: seLegalReference,
    hasHeld:    seHeldAmount > 0,
    hasRelease: seReleaseTotal > 0,
  };

  // DuePayable = what remains to be paid now (with SE adjustments)
  const duePayable   = fmt2(grandTotal - prepaidGross - seHeldAmount + seReleaseTotal);

  const vatBreakdown = [{
    rate: vatPercent, basis: taxBasis, amount: taxAmount, category: vatCategory,
  }];

  // ── 13. Project / Contract references ────────────────────────────────────

  let projectNumber  = '';
  let contractNumber = '';
  if (doc.PROJECT_ID) {
    const proj = await one(supabase, 'PROJECT', doc.PROJECT_ID, tenantId);
    projectNumber = String(proj?.PROJECT_NUMBER ?? proj?.NAME_SHORT ?? '').trim();
  }
  if (doc.CONTRACT_ID) {
    const contract = await one(supabase, 'CONTRACT', doc.CONTRACT_ID, tenantId);
    contractNumber = String(contract?.CONTRACT_NUMBER ?? '').trim();
  }

  // ── 14. Assemble ─────────────────────────────────────────────────────────

  return {
    docType,
    invoiceType,
    typeCodeCii,
    typeCodeUbl,
    typeCode: typeCodeUbl,  // legacy compat
    number:   number || String(docId),
    date:     asIsoDate(docDate) || asIsoDate(new Date().toISOString()),
    dueDate:  asIsoDate(doc.DUE_DATE),
    currency,
    comment:  String(doc.COMMENT ?? '').trim(),
    billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
    billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
    buyerReference: String(doc.BUYER_REFERENCE ?? doc.ADDRESS_REFERENCE_NUMBER ?? '').trim(),

    seller: {
      name:          String(doc.COMPANY_NAME_1 ?? company?.COMPANY_NAME_1 ?? '').trim(),
      street:        String(doc.COMPANY_STREET     ?? company?.STREET    ?? '').trim(),
      city:          String(doc.COMPANY_CITY       ?? company?.CITY      ?? '').trim(),
      postCode:      String(doc.COMPANY_POST_CODE  ?? company?.POST_CODE ?? '').trim(),
      countryId:     sellerCountry,
      vatId:         sellerVatId,
      taxId:         sellerTaxId,
      iban:          sellerIban,
      bic:           sellerBic,
      creditorId:    sellerCreditorId,
      postOfficeBox: sellerPostOffBox,
      contactName:   contactName,
      contactPhone:  contactPhone,
      contactEmail:  contactEmail,
      email:         contactEmail,
    },

    buyer: {
      name:          buyerName,
      street:        String(doc.ADDRESS_STREET    ?? address?.STREET    ?? '').trim(),
      city:          String(doc.ADDRESS_CITY      ?? address?.CITY      ?? '').trim(),
      postCode:      String(doc.ADDRESS_POST_CODE ?? address?.POST_CODE ?? '').trim(),
      countryId:     buyerCountry,
      vatId:         buyerVatId,
      debitorNumber: buyerDebitorNumber,
      email:         String(doc.CONTACT_MAIL ?? '').trim(),
      // BT-56/57/58 Buyer Contact (Ansprechpartner beim Kaeufer)
      contactName:   String(doc.CONTACT       ?? '').trim(),
      contactPhone:  String(doc.CONTACT_PHONE ?? '').trim(),
      contactEmail:  String(doc.CONTACT_MAIL  ?? '').trim(),
    },

    lines,
    vatBreakdown,
    deductions,
    allowances,
    cashDiscount,
    securityRetention,

    totals: {
      lineTotal,
      allowanceTotal,
      chargeTotal,
      taxBasis,
      taxAmount,
      grandTotal,
      prepaidGross,
      duePayable,
      prepaidAmount: prepaidGross,  // legacy compat
    },

    canceledDocNumber,
    canceledDocDate,
    projectNumber,                                          // BT-11
    contractNumber,                                         // BT-12
    orderNumber:           String(doc.BUYER_ORDER_REFERENCE      ?? '').trim(), // BT-13
    buyerAccountingRef:    String(doc.BUYER_ACCOUNTING_REFERENCE ?? '').trim(), // BT-19
    remittanceInformation: String(doc.REMITTANCE_INFORMATION     ?? '').trim(), // BT-83
  };
}

module.exports = { loadInvoiceData, InvoiceDataError };
