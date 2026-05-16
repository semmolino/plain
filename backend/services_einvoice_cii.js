'use strict';

/**
 * services_einvoice_cii.js
 *
 * Generates ZUGFeRD 2.4 / Factur-X 1.08 CII XML.
 *
 * Default profile: EXTENDED
 *   urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended
 *
 * TypeCodes used (CII-specific):
 *   875 = Abschlagsrechnung
 *   876 = Teilschlussrechnung
 *   877 = Schlussrechnung
 *   380 = Rechnung
 *   381 = Gutschrift
 *   384 = Rechnungskorrektur / Storno
 */

const PROFILES = {
  MINIMUM: {
    id: 'urn:factur-x.eu:1p0:minimum',
    hasLines: false, hasTax: false, hasPaymentTerms: false,
    hasBillingPeriod: false, hasLineNotes: false, hasLinePrices: false, hasContact: false,
  },
  BASIC_WL: {
    id: 'urn:factur-x.eu:1p0:basicwl',
    hasLines: false, hasTax: true, hasPaymentTerms: true,
    hasBillingPeriod: true, hasLineNotes: false, hasLinePrices: false, hasContact: false,
  },
  BASIC: {
    id: 'urn:factur-x.eu:1p0:basic',
    hasLines: true, hasTax: true, hasPaymentTerms: true,
    hasBillingPeriod: true, hasLineNotes: false, hasLinePrices: false, hasContact: false,
  },
  EN16931: {
    id: 'urn:cen.eu:en16931:2017',
    hasLines: true, hasTax: true, hasPaymentTerms: true,
    hasBillingPeriod: true, hasLineNotes: true, hasLinePrices: true, hasContact: true,
  },
  EXTENDED: {
    id: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
    hasLines: true, hasTax: true, hasPaymentTerms: true,
    hasBillingPeriod: true, hasLineNotes: true, hasLinePrices: true, hasContact: true,
  },
};

// ── XML helpers ───────────────────────────────────────────────────────────────

function x(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function n2(v) {
  return (Math.round(Number(v ?? 0) * 100) / 100).toFixed(2);
}

function d102(iso) {
  if (!iso) return null;
  return iso.replace(/-/g, '').slice(0, 8);
}

function dateElem(iso) {
  const v = d102(iso);
  return v ? `<udt:DateTimeString format="102">${v}</udt:DateTimeString>` : '';
}

// ── Building blocks ───────────────────────────────────────────────────────────

function buildNotes(data) {
  const notes = [];
  if (data.comment) {
    notes.push(`    <ram:IncludedNote><ram:Content>${x(data.comment)}</ram:Content></ram:IncludedNote>`);
  }
  const regContent = [
    data.seller.name,
    data.seller.street,
    [data.seller.postCode, data.seller.city].filter(Boolean).join(' '),
    data.seller.countryId,
  ].filter(Boolean).join('\n');
  notes.push(`    <ram:IncludedNote><ram:Content>${x(regContent)}</ram:Content><ram:SubjectCode>REG</ram:SubjectCode></ram:IncludedNote>`);
  return notes.join('\n');
}

function buildSeller(data, profile) {
  const s = data.seller;
  return `
      <ram:SellerTradeParty>
        <ram:Name>${x(s.name)}</ram:Name>
        ${profile.hasContact && s.contactName ? `
        <ram:DefinedTradeContact>
          <ram:PersonName>${x(s.contactName)}</ram:PersonName>
          ${s.contactPhone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${x(s.contactPhone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}
          ${s.contactEmail ? `<ram:EmailURIUniversalCommunication><ram:URIID>${x(s.contactEmail)}</ram:URIID></ram:EmailURIUniversalCommunication>` : ''}
        </ram:DefinedTradeContact>` : ''}
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${x(s.postCode)}</ram:PostcodeCode>
          <ram:LineOne>${x(s.street)}</ram:LineOne>
          <ram:CityName>${x(s.city)}</ram:CityName>
          <ram:CountryID>${x(s.countryId)}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${s.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(s.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${s.taxId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(s.taxId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
        ${s.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(s.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:SellerTradeParty>`;
}

function buildBuyer(data) {
  const b = data.buyer;
  return `
      <ram:BuyerTradeParty>
        <ram:Name>${x(b.name)}</ram:Name>
        <ram:PostalTradeAddress>
          ${b.postCode ? `<ram:PostcodeCode>${x(b.postCode)}</ram:PostcodeCode>` : ''}
          ${b.street   ? `<ram:LineOne>${x(b.street)}</ram:LineOne>` : ''}
          ${b.city     ? `<ram:CityName>${x(b.city)}</ram:CityName>` : ''}
          <ram:CountryID>${x(b.countryId || 'DE')}</ram:CountryID>
        </ram:PostalTradeAddress>
        ${b.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(b.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${b.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(b.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:BuyerTradeParty>`;
}

function buildDelivery(data) {
  // EXTENDED requires ActualDeliverySupplyChainEvent; use billing end or invoice date
  const deliveryDate = data.billingPeriodEnd || data.billingPeriodStart || data.date;
  if (!deliveryDate) return '<ram:ApplicableHeaderTradeDelivery/>';
  return `
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>${dateElem(deliveryDate)}</ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>`;
}

function buildPaymentMeans(data) {
  const s = data.seller;
  if (!s.iban) return '';
  return `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${x(s.iban)}</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>
        ${s.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${x(s.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>`;
}

function buildTaxSubtotals(data, profile) {
  if (!profile.hasTax) return '';
  return data.vatBreakdown.map(vb => `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${n2(vb.amount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${n2(vb.basis)}</ram:BasisAmount>
        <ram:CategoryCode>${x(vb.category)}</ram:CategoryCode>
        <ram:RateApplicablePercent>${n2(vb.rate)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`).join('\n');
}

function buildBillingPeriod(data, profile) {
  if (!profile.hasBillingPeriod) return '';
  const start = d102(data.billingPeriodStart);
  const end   = d102(data.billingPeriodEnd);
  if (!start && !end) return '';
  return `
      <ram:BillingSpecifiedPeriod>
        ${start ? `<ram:StartDateTime>${dateElem(data.billingPeriodStart)}</ram:StartDateTime>` : ''}
        ${end   ? `<ram:EndDateTime>${dateElem(data.billingPeriodEnd)}</ram:EndDateTime>` : ''}
      </ram:BillingSpecifiedPeriod>`;
}

function buildAllowances(data) {
  if (!data.allowances || data.allowances.length === 0) return '';
  const vatBreak = data.vatBreakdown[0] ?? { category: 'S', rate: 0 };
  return data.allowances.map(a => `
      <ram:SpecifiedTradeAllowanceCharge>
        <ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>
        ${a.percent > 0 ? `<ram:CalculationPercent>${n2(a.percent)}</ram:CalculationPercent>` : ''}
        ${a.percent > 0 ? `<ram:BasisAmount>${n2(a.percent > 0 ? a.amount / (a.percent / 100) : 0)}</ram:BasisAmount>` : ''}
        <ram:ActualAmount>${n2(a.amount)}</ram:ActualAmount>
        <ram:ReasonCode>95</ram:ReasonCode>
        <ram:Reason>${x(a.reason)}</ram:Reason>
        <ram:CategoryTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${x(vatBreak.category)}</ram:CategoryCode>
          <ram:RateApplicablePercent>${n2(vatBreak.rate)}</ram:RateApplicablePercent>
        </ram:CategoryTradeTax>
      </ram:SpecifiedTradeAllowanceCharge>`).join('\n');
}

function buildPaymentTerms(data, profile) {
  if (!profile.hasPaymentTerms) return '';
  const hasDue   = !!data.dueDate;
  const hasSkonto = !!data.cashDiscount;
  if (!hasDue && !hasSkonto) return '';

  let skontoBlock = '';
  if (hasSkonto) {
    const cd = data.cashDiscount;
    skontoBlock = `
        <ram:ApplicableTradePaymentDiscountTerms>
          <ram:BasisPeriodMeasure unitMeasureTypeCode="DAY">${Math.round(cd.days)}</ram:BasisPeriodMeasure>
          <ram:CalculationPercent>${n2(cd.percent)}</ram:CalculationPercent>
        </ram:ApplicableTradePaymentDiscountTerms>`;
  }

  return `
      <ram:SpecifiedTradePaymentTerms>
        ${hasDue ? `<ram:DueDateDateTime>${dateElem(data.dueDate)}</ram:DueDateDateTime>` : ''}${skontoBlock}
      </ram:SpecifiedTradePaymentTerms>`;
}

function buildReferencedDocuments(data) {
  const refs = [];

  // Storno: reference the canceled document
  if (data.canceledDocNumber) {
    refs.push(`
      <ram:InvoiceReferencedDocument>
        <ram:IssuerAssignedID>${x(data.canceledDocNumber)}</ram:IssuerAssignedID>
        ${data.canceledDocDate ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(data.canceledDocDate)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ''}
      </ram:InvoiceReferencedDocument>`);
  }

  // Schlussrechnung: reference each deducted Abschlagsrechnung
  for (const d of (data.deductions ?? [])) {
    refs.push(`
      <ram:InvoiceReferencedDocument>
        <ram:IssuerAssignedID>${x(d.number)}</ram:IssuerAssignedID>
        ${d.date ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(d.date)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ''}
      </ram:InvoiceReferencedDocument>`);
  }

  return refs.join('\n');
}

function buildMonetarySummation(data, profile) {
  const t   = data.totals;
  const cur = data.currency;
  return `
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${n2(t.lineTotal)}</ram:LineTotalAmount>
        <ram:ChargeTotalAmount>${n2(t.chargeTotal ?? 0)}</ram:ChargeTotalAmount>
        <ram:AllowanceTotalAmount>${n2(t.allowanceTotal ?? 0)}</ram:AllowanceTotalAmount>
        <ram:TaxBasisTotalAmount>${n2(t.taxBasis)}</ram:TaxBasisTotalAmount>
        ${profile.hasTax
          ? `<ram:TaxTotalAmount currencyID="${x(cur)}">${n2(t.taxAmount)}</ram:TaxTotalAmount>`
          : ''}
        <ram:GrandTotalAmount>${n2(t.grandTotal)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>${n2(t.prepaidGross ?? 0)}</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${n2(t.duePayable)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>`;
}

function buildLineItem(line, data, profile) {
  const cur = data.currency;
  return `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${line.id}</ram:LineID>
        ${profile.hasLineNotes && line.note
          ? `<ram:IncludedNote><ram:Content>${x(line.note)}</ram:Content></ram:IncludedNote>`
          : ''}
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${x(line.description)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      ${profile.hasLinePrices ? `
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${n2(line.unitPrice)}</ram:ChargeAmount>
          <ram:BasisQuantity unitCode="${x(line.unitCode)}">${n2(line.quantity)}</ram:BasisQuantity>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>` : ''}
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${x(line.unitCode)}">${n2(line.quantity)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${x(line.vatCategory)}</ram:CategoryCode>
          <ram:RateApplicablePercent>${n2(line.vatRate)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        ${profile.hasBillingPeriod && (line.billingPeriodStart || line.billingPeriodEnd) ? `
        <ram:BillingSpecifiedPeriod>
          ${line.billingPeriodStart ? `<ram:StartDateTime>${dateElem(line.billingPeriodStart)}</ram:StartDateTime>` : ''}
          ${line.billingPeriodEnd   ? `<ram:EndDateTime>${dateElem(line.billingPeriodEnd)}</ram:EndDateTime>` : ''}
        </ram:BillingSpecifiedPeriod>` : ''}
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${n2(line.lineTotal)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

function generateCiiXml(data, profileKey = 'EXTENDED') {
  const profile = PROFILES[profileKey.toUpperCase()];
  if (!profile) throw new Error(`Unknown CII profile: ${profileKey}`);

  const typeCode  = data.typeCodeCii ?? data.typeCode ?? '380';
  const lineItems = profile.hasLines
    ? data.lines.map(l => buildLineItem(l, data, profile)).join('\n')
    : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">

  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${x(profile.id)}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>

  <rsm:ExchangedDocument>
    <ram:ID>${x(data.number)}</ram:ID>
    <ram:TypeCode>${x(typeCode)}</ram:TypeCode>
    <ram:IssueDateTime>${dateElem(data.date)}</ram:IssueDateTime>
${buildNotes(data)}
  </rsm:ExchangedDocument>

  <rsm:SupplyChainTradeTransaction>
${lineItems}
    <ram:ApplicableHeaderTradeAgreement>
      ${data.buyerReference ? `<ram:BuyerReference>${x(data.buyerReference)}</ram:BuyerReference>` : ''}
${buildSeller(data, profile)}
${buildBuyer(data)}
      ${data.orderNumber    ? `<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${x(data.orderNumber)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>` : ''}
      ${data.contractNumber ? `<ram:ContractReferencedDocument><ram:IssuerAssignedID>${x(data.contractNumber)}</ram:IssuerAssignedID></ram:ContractReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeAgreement>

${buildDelivery(data)}

    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${x(data.currency)}</ram:InvoiceCurrencyCode>
${buildPaymentMeans(data)}
${buildTaxSubtotals(data, profile)}
${buildBillingPeriod(data, profile)}
${buildAllowances(data)}
${buildPaymentTerms(data, profile)}
${buildReferencedDocuments(data)}
${buildMonetarySummation(data, profile)}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

  return xml;
}

module.exports = { generateCiiXml, PROFILES };
