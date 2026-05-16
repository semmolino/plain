'use strict';

/**
 * services_einvoice_ubl.js
 *
 * Generates XRechnung 3.0 UBL XML from a normalised InvoiceData object.
 *
 * Profile: urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0
 *
 * TypeCodes used:
 *   326 = Abschlagsrechnung (Partial invoice)
 *   380 = Rechnung / Schlussrechnung / Teilschlussrechnung
 *   381 = Gutschrift (Credit note) — kept as Invoice for simplicity
 *   384 = Storno / Rechnungskorrektur
 */

const XRECHNUNG_CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
const XRECHNUNG_PROFILE_ID =
  'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

// ── XML helpers ───────────────────────────────────────────────────────────────

function x(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function n2(v) {
  return (Math.round(Number(v ?? 0) * 100) / 100).toFixed(2);
}

function amt(v, cur, tag) {
  return `<cbc:${tag} currencyID="${x(cur)}">${n2(v)}</cbc:${tag}>`;
}

// ── Building blocks ───────────────────────────────────────────────────────────

function buildBillingReferences(data) {
  const refs = [];

  // Storno: reference the canceled invoice
  if (data.canceledDocNumber) {
    refs.push(`
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${x(data.canceledDocNumber)}</cbc:ID>
      ${data.canceledDocDate ? `<cbc:IssueDate>${x(data.canceledDocDate)}</cbc:IssueDate>` : ''}
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`);
  }

  // Schlussrechnung: reference each deducted Abschlagsrechnung
  for (const d of (data.deductions ?? [])) {
    refs.push(`
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${x(d.number)}</cbc:ID>
      ${d.date ? `<cbc:IssueDate>${x(d.date)}</cbc:IssueDate>` : ''}
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`);
  }

  return refs.join('\n');
}

function buildAllowanceCharges(data) {
  if (!data.allowances || data.allowances.length === 0) return '';
  const cur      = data.currency;
  const vatBreak = data.vatBreakdown[0] ?? { category: 'S', rate: 0 };
  return data.allowances.map(a => `
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode>
    <cbc:AllowanceChargeReason>${x(a.reason)}</cbc:AllowanceChargeReason>
    ${a.percent > 0 ? `<cbc:MultiplierFactorNumeric>${n2(a.percent)}</cbc:MultiplierFactorNumeric>` : ''}
    ${amt(a.amount, cur, 'Amount')}
    ${a.percent > 0 ? amt(a.percent > 0 ? a.amount / (a.percent / 100) : 0, cur, 'BaseAmount') : ''}
    <cac:TaxCategory>
      <cbc:ID>${x(vatBreak.category)}</cbc:ID>
      <cbc:Percent>${n2(vatBreak.rate)}</cbc:Percent>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>`).join('\n');
}

function buildTaxTotal(data) {
  const cur = data.currency;
  return `
  <cac:TaxTotal>
    ${amt(data.totals.taxAmount, cur, 'TaxAmount')}
${data.vatBreakdown.map(vb => `
  <cac:TaxSubtotal>
    ${amt(vb.basis, cur, 'TaxableAmount')}
    ${amt(vb.amount, cur, 'TaxAmount')}
    <cac:TaxCategory>
      <cbc:ID>${x(vb.category)}</cbc:ID>
      <cbc:Percent>${n2(vb.rate)}</cbc:Percent>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:TaxCategory>
  </cac:TaxSubtotal>`).join('\n')}
  </cac:TaxTotal>`;
}

function buildLineItem(line, cur) {
  return `
  <cac:InvoiceLine>
    <cbc:ID>${line.id}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${x(line.unitCode)}">${n2(line.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${x(cur)}">${n2(line.lineTotal)}</cbc:LineExtensionAmount>
    ${line.note ? `<cbc:Note>${x(line.note)}</cbc:Note>` : ''}
    ${line.billingPeriodStart || line.billingPeriodEnd ? `
    <cac:InvoicePeriod>
      ${line.billingPeriodStart ? `<cbc:StartDate>${x(line.billingPeriodStart)}</cbc:StartDate>` : ''}
      ${line.billingPeriodEnd   ? `<cbc:EndDate>${x(line.billingPeriodEnd)}</cbc:EndDate>` : ''}
    </cac:InvoicePeriod>` : ''}
    <cac:Item>
      <cbc:Name>${x(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${x(line.vatCategory)}</cbc:ID>
        <cbc:Percent>${n2(line.vatRate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${x(cur)}">${n2(line.unitPrice)}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="${x(line.unitCode)}">${n2(line.quantity)}</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

function generateUblXml(data) {
  const cur = data.currency;
  const s   = data.seller;
  const b   = data.buyer;
  const t   = data.totals;

  const typeCode  = data.typeCodeUbl ?? data.typeCode ?? '380';
  const lineItems = data.lines.map(l => buildLineItem(l, cur)).join('\n');

  // Skonto note: XRechnung machine-readable format
  // BR-CO-25: always emit payment terms (due date note or fallback text)
  // Skonto only combined with due date (mirrors CII-SR-408 guidance)
  let paymentTermsNote = data.dueDate ? `Zahlbar bis ${x(data.dueDate)}` : 'Zahlbar sofort netto';
  if (data.cashDiscount && data.dueDate) {
    const cd = data.cashDiscount;
    paymentTermsNote = `#SKONTO#TAGE=${Math.round(cd.days)}#PROZENT=${n2(cd.percent)}#\n${paymentTermsNote}`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">

  <cbc:CustomizationID>${x(XRECHNUNG_CUSTOMIZATION_ID)}</cbc:CustomizationID>
  <cbc:ProfileID>${x(XRECHNUNG_PROFILE_ID)}</cbc:ProfileID>
  <cbc:ID>${x(data.number)}</cbc:ID>
  <cbc:IssueDate>${x(data.date)}</cbc:IssueDate>
  ${data.dueDate ? `<cbc:DueDate>${x(data.dueDate)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>${x(typeCode)}</cbc:InvoiceTypeCode>
  ${data.comment ? `<cbc:Note>${x(data.comment)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${x(cur)}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${x(data.buyerReference || '-')}</cbc:BuyerReference>

  ${data.billingPeriodStart || data.billingPeriodEnd ? `
  <cac:InvoicePeriod>
    ${data.billingPeriodStart ? `<cbc:StartDate>${x(data.billingPeriodStart)}</cbc:StartDate>` : ''}
    ${data.billingPeriodEnd   ? `<cbc:EndDate>${x(data.billingPeriodEnd)}</cbc:EndDate>` : ''}
  </cac:InvoicePeriod>` : ''}

  ${data.orderNumber    ? `<cac:OrderReference><cbc:ID>${x(data.orderNumber)}</cbc:ID></cac:OrderReference>` : ''}
${buildBillingReferences(data)}
  ${data.contractNumber ? `<cac:ContractDocumentReference><cbc:ID>${x(data.contractNumber)}</cbc:ID></cac:ContractDocumentReference>` : ''}

  <cac:AccountingSupplierParty>
    <cac:Party>
      ${s.email ? `<cbc:EndpointID schemeID="EM">${x(s.email)}</cbc:EndpointID>` : ''}
      <cac:PartyName><cbc:Name>${x(s.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        ${s.street   ? `<cbc:StreetName>${x(s.street)}</cbc:StreetName>` : ''}
        ${s.city     ? `<cbc:CityName>${x(s.city)}</cbc:CityName>` : ''}
        ${s.postCode ? `<cbc:PostalZone>${x(s.postCode)}</cbc:PostalZone>` : ''}
        <cac:Country><cbc:IdentificationCode>${x(s.countryId)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${s.taxId ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${x(s.taxId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      ${s.vatId ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${x(s.vatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(s.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      ${s.contactName ? `
      <cac:Contact>
        <cbc:Name>${x(s.contactName)}</cbc:Name>
        ${s.contactPhone ? `<cbc:Telephone>${x(s.contactPhone)}</cbc:Telephone>` : ''}
        ${s.contactEmail ? `<cbc:ElectronicMail>${x(s.contactEmail)}</cbc:ElectronicMail>` : ''}
      </cac:Contact>` : ''}
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      ${b.email ? `<cbc:EndpointID schemeID="EM">${x(b.email)}</cbc:EndpointID>` : ''}
      <cac:PartyName><cbc:Name>${x(b.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        ${b.street   ? `<cbc:StreetName>${x(b.street)}</cbc:StreetName>` : ''}
        ${b.city     ? `<cbc:CityName>${x(b.city)}</cbc:CityName>` : ''}
        ${b.postCode ? `<cbc:PostalZone>${x(b.postCode)}</cbc:PostalZone>` : ''}
        <cac:Country><cbc:IdentificationCode>${x(b.countryId || 'DE')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${b.vatId ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${x(b.vatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(b.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>

  ${s.iban ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${x(s.iban)}</cbc:ID>
      ${s.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${x(s.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : ''}

  <cac:PaymentTerms>
    <cbc:Note>${x(paymentTermsNote)}</cbc:Note>
  </cac:PaymentTerms>

${buildAllowanceCharges(data)}

${buildTaxTotal(data)}

  <cac:LegalMonetaryTotal>
    ${amt(t.lineTotal,      cur, 'LineExtensionAmount')}
    ${amt(t.taxBasis,       cur, 'TaxExclusiveAmount')}
    ${amt(t.grandTotal,     cur, 'TaxInclusiveAmount')}
    ${amt(t.allowanceTotal ?? 0, cur, 'AllowanceTotalAmount')}
    ${amt(t.chargeTotal ?? 0,    cur, 'ChargeTotalAmount')}
    ${amt(t.prepaidGross ?? 0,   cur, 'PrepaidAmount')}
    ${amt(t.duePayable,    cur, 'PayableAmount')}
  </cac:LegalMonetaryTotal>

${lineItems}
</Invoice>`;

  return xml;
}

// ── Back-compat shim ──────────────────────────────────────────────────────────

const { loadInvoiceData } = require('./services_einvoice_data');

async function generateUblInvoiceXml({ supabase, doc, invoice, partialPayment, docType, tenantId }) {
  const resolvedDocType = docType || (invoice ? 'INVOICE' : 'PARTIAL_PAYMENT');
  const resolvedDoc     = doc || invoice || partialPayment;
  if (!resolvedDoc) throw new Error('No document provided.');
  const tid  = tenantId || resolvedDoc.TENANT_ID;
  const data = await loadInvoiceData(supabase, resolvedDoc.ID, resolvedDocType, tid);
  return generateUblXml(data);
}

module.exports = { generateUblXml, generateUblInvoiceXml };
