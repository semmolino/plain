'use strict';

/**
 * services_einvoice_ubl.js  (rewrite)
 *
 * Generates XRechnung UBL 3.0 XML from a normalised InvoiceData object.
 *
 * Profile: urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0
 *
 * Always generates EN16931-level content (line items, tax subtotals, full
 * party data) as required by XRechnung.
 */

const XRECHNUNG_CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
const XRECHNUNG_PROFILE_ID =
  'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

// ── XML helpers ───────────────────────────────────────────────────────────────

function x(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function n2(v) {
  return (Math.round(Number(v ?? 0) * 100) / 100).toFixed(2);
}

function amt(v, cur, tag) {
  return `<cbc:${tag} currencyID="${x(cur)}">${n2(v)}</cbc:${tag}>`;
}

// ── Building blocks ───────────────────────────────────────────────────────────

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

function buildTaxSubtotals(data) {
  const cur = data.currency;
  return data.vatBreakdown.map(vb => `
  <cac:TaxSubtotal>
    <cbc:TaxableAmount currencyID="${x(cur)}">${n2(vb.basis)}</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="${x(cur)}">${n2(vb.amount)}</cbc:TaxAmount>
    <cac:TaxCategory>
      <cbc:ID>${x(vb.category)}</cbc:ID>
      <cbc:Percent>${n2(vb.rate)}</cbc:Percent>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:TaxCategory>
  </cac:TaxSubtotal>`).join('\n');
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate XRechnung UBL XML from InvoiceData.
 *
 * @param {object} data  InvoiceData from loadInvoiceData()
 * @returns {string} XML
 */
function generateUblXml(data) {
  const cur = data.currency;
  const s   = data.seller;
  const b   = data.buyer;
  const t   = data.totals;

  const lineItems = data.lines.map(l => buildLineItem(l, cur)).join('\n');

  // For Schlussrechnung: prepaid references as PrepaidPayment
  const prepaidBlocks = data.deductions.map(d => `
  <cac:PrepaidPayment>
    <cbc:PaidAmount currencyID="${x(cur)}">${n2(d.grossAmount)}</cbc:PaidAmount>
    <cbc:InstructionNote>${x(d.number)}</cbc:InstructionNote>
    ${d.date ? `<cbc:PaidDate>${x(d.date)}</cbc:PaidDate>` : ''}
  </cac:PrepaidPayment>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">

  <cbc:CustomizationID>${x(XRECHNUNG_CUSTOMIZATION_ID)}</cbc:CustomizationID>
  <cbc:ProfileID>${x(XRECHNUNG_PROFILE_ID)}</cbc:ProfileID>
  <cbc:ID>${x(data.number)}</cbc:ID>
  <cbc:IssueDate>${x(data.date)}</cbc:IssueDate>
  ${data.dueDate ? `<cbc:DueDate>${x(data.dueDate)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>${x(data.typeCode)}</cbc:InvoiceTypeCode>
  ${data.comment ? `<cbc:Note>${x(data.comment)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${x(cur)}</cbc:DocumentCurrencyCode>
  ${data.buyerReference ? `<cbc:BuyerReference>${x(data.buyerReference)}</cbc:BuyerReference>` : ''}

  ${data.billingPeriodStart || data.billingPeriodEnd ? `
  <cac:InvoicePeriod>
    ${data.billingPeriodStart ? `<cbc:StartDate>${x(data.billingPeriodStart)}</cbc:StartDate>` : ''}
    ${data.billingPeriodEnd   ? `<cbc:EndDate>${x(data.billingPeriodEnd)}</cbc:EndDate>` : ''}
  </cac:InvoicePeriod>` : ''}

  ${data.orderNumber    ? `<cac:OrderReference><cbc:ID>${x(data.orderNumber)}</cbc:ID></cac:OrderReference>` : ''}
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
      <cac:Contact>
        <cbc:Name>${x(s.contactName)}</cbc:Name>
        ${s.contactPhone ? `<cbc:Telephone>${x(s.contactPhone)}</cbc:Telephone>` : ''}
        ${s.contactEmail ? `<cbc:ElectronicMail>${x(s.contactEmail)}</cbc:ElectronicMail>` : ''}
      </cac:Contact>
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

  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    ${s.iban ? `
    <cac:PayeeFinancialAccount>
      <cbc:ID>${x(s.iban)}</cbc:ID>
      ${s.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${x(s.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>` : ''}
  </cac:PaymentMeans>

  ${data.dueDate ? `
  <cac:PaymentTerms>
    <cbc:Note>Zahlbar bis ${x(data.dueDate)}</cbc:Note>
  </cac:PaymentTerms>` : ''}

  ${prepaidBlocks}

  <cac:TaxTotal>
    ${amt(t.taxAmount, cur, 'TaxAmount')}
${buildTaxSubtotals(data)}
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    ${amt(t.lineTotal,    cur, 'LineExtensionAmount')}
    ${amt(t.taxBasis,     cur, 'TaxExclusiveAmount')}
    ${amt(t.grandTotal,   cur, 'TaxInclusiveAmount')}
    ${t.prepaidAmount > 0 ? amt(t.prepaidAmount, cur, 'PrepaidAmount') : ''}
    ${amt(t.duePayable,   cur, 'PayableAmount')}
  </cac:LegalMonetaryTotal>

${lineItems}
</Invoice>`;

  return xml;
}

// ── Back-compat shim ──────────────────────────────────────────────────────────
// Old route code still calls generateUblInvoiceXml({ supabase, doc, docType, tenantId }).
// This shim bridges it until routes are updated.

const { loadInvoiceData } = require('./services_einvoice_data');

async function generateUblInvoiceXml({ supabase, doc, invoice, partialPayment, docType, tenantId }) {
  const resolvedDocType = docType || (invoice ? 'INVOICE' : 'PARTIAL_PAYMENT');
  const resolvedDoc     = doc || invoice || partialPayment;
  if (!resolvedDoc) throw new Error('No document provided.');
  const tid = tenantId || resolvedDoc.TENANT_ID;
  const data = await loadInvoiceData(supabase, resolvedDoc.ID, resolvedDocType, tid);
  return generateUblXml(data);
}

module.exports = { generateUblXml, generateUblInvoiceXml };