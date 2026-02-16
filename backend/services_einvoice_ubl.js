const { loadBtMapping } = require('./services_bt_mapping');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isLikelyCountryCode(v) {
  const s = String(v ?? '').trim();
  return /^[A-Z]{2}$/.test(s);
}

function toNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function asIsoDate(v) {
  // accept YYYY-MM-DD or ISO timestamp
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function mapDocFieldName(docType, field) {
  if (docType !== 'INVOICE') return field;

  // INVOICE uses different column names for some header fields compared to PARTIAL_PAYMENT.
  switch (field) {
    case 'PARTIAL_PAYMENT_NUMBER':
      return 'INVOICE_NUMBER';
    case 'PARTIAL_PAYMENT_DATE':
      return 'INVOICE_DATE';
    case 'PARTIAL_PAYMENT_ADDRESS_ID':
      return 'INVOICE_ADDRESS_ID';
    case 'PARTIAL_PAYMENT_CONTACT_ID':
      return 'INVOICE_CONTACT_ID';
    default:
      return field;
  }
}

async function buildBtDictionary({ supabase, doc, docType = 'PARTIAL_PAYMENT' }) {
  const mapping = loadBtMapping();
  const bt = {};

  // Resolve referenced tables with small cache
  const refCache = new Map(); // key: `${table}:${id}` -> row

  async function loadRef(table, id) {
    if (!id) return null;
    const key = `${table}:${id}`;
    if (refCache.has(key)) return refCache.get(key);
    const { data, error } = await supabase.from(table).select('*').eq('ID', id).maybeSingle();
    if (error) return null;
    refCache.set(key, data);
    return data;
  }

  for (const r of mapping) {
    // Mapping file is primarily based on PARTIAL_PAYMENT. We also support INVOICE by applying
    // a small field-name translation for the differing header columns.
    if (r.table !== 'PARTIAL_PAYMENT' && r.table !== docType) continue;

    let field = r.field;

    // Skip placeholder text rows
    if (!field || typeof field !== 'string') continue;

    // Apply field name translation if needed
    const translate = (f) => (r.table === 'PARTIAL_PAYMENT' ? mapDocFieldName(docType, f) : f);

    // Expression support (only the ones you currently use)
    if (field.includes('+')) {
      // Example: "AMOUNT_NET + AMOUNT_EXTRAS_NET"
      const parts = field.split('+').map((p) => p.trim()).filter(Boolean).map(translate);
      const sum = parts.reduce((acc, f) => acc + toNum(doc[f]), 0);
      bt[r.bt] = sum;
      continue;
    }

    field = translate(field);

    if (r.refTable) {
      const refId = doc[field];
      const refRow = await loadRef(r.refTable, refId);
      bt[r.bt] = refRow ? refRow[r.refField] : null;
      continue;
    }

    bt[r.bt] = doc[field];
  }

  // BT-3 (Invoice type code): UN/CEFACT UNTDID 1001.
  // - PARTIAL_PAYMENT (Abschlagsrechnung / Teilrechnung): typically 326 (Partial invoice)
  // - INVOICE (normal invoice): typically 380 (Commercial invoice)
  // Allow overrides via env vars.
  const legacy = process.env.EINVOICE_BT3;
  if (docType === 'PARTIAL_PAYMENT') {
    bt['BT-3'] = process.env.EINVOICE_BT3_PARTIAL_PAYMENT || legacy || '326';
  } else if (docType === 'INVOICE') {
    bt['BT-3'] = process.env.EINVOICE_BT3_INVOICE || legacy || '380';
  } else {
    bt['BT-3'] = legacy || '380';
  }

  // Currency code must be an ISO 4217 code (e.g., EUR). Mapping uses CURRENCY.NAME_SHORT.
  // If mapping did not resolve for any reason, try a safe fallback.
  if (!bt['BT-5'] && doc.CURRENCY_ID) {
    const ref = await loadRef('CURRENCY', doc.CURRENCY_ID);
    bt['BT-5'] = ref?.NAME_SHORT ?? null;
  }

  // Ensure seller country is a code if possible (mapping may currently store NAME_LONG in snapshot)
  // Use COMPANY_ID -> COMPANY.COUNTRY_ID -> COUNTRY.NAME_SHORT if needed.
  if (!isLikelyCountryCode(bt['BT-40']) && doc.COMPANY_ID) {
    const { data: comp } = await supabase
      .from('COMPANY')
      .select('COUNTRY_ID')
      .eq('ID', doc.COMPANY_ID)
      .maybeSingle();
    if (comp?.COUNTRY_ID) {
      const { data: ctry } = await supabase
        .from('COUNTRY')
        .select('NAME_SHORT')
        .eq('ID', comp.COUNTRY_ID)
        .maybeSingle();
      if (ctry?.NAME_SHORT) bt['BT-40'] = ctry.NAME_SHORT;
    }
  }

  return bt;
}

function money(amount, currency) {
  const n = toNum(amount);
  // Keep numeric as-is; format to string without locale.
  return `<cbc:Amount currencyID="${xmlEscape(currency)}">${xmlEscape(n)}</cbc:Amount>`;
}

function monetary(amount, currency, tagName) {
  const n = toNum(amount);
  return `<cbc:${tagName} currencyID="${xmlEscape(currency)}">${xmlEscape(n)}</cbc:${tagName}>`;
}

function normalizeVatId(vatIdRaw, countryCode) {
  const v = String(vatIdRaw ?? '').trim();
  if (!v) return '';
  // EN16931 validators expect the VAT identifier to start with the ISO 3166-1 alpha-2 prefix (e.g., DE...)
  // If the value is only digits (or otherwise missing the prefix), prefix it with the seller country code.
  if (/^[A-Za-z]{2}/.test(v)) return v.toUpperCase();
  const cc = String(countryCode ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) return `${cc}${v}`;
  return v; // fallback
}

function normalizePhone(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  // Keep only digits and leading +
  const cleaned = s.replace(/(?!^\+)\D/g, '');
  return cleaned;
}

function isValidIban(ibanRaw) {
  const iban = String(ibanRaw ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  // IBAN checksum (mod 97) check
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let expanded = '';
  for (const ch of rearranged) {
    if (ch >= 'A' && ch <= 'Z') expanded += String(ch.charCodeAt(0) - 55);
    else expanded += ch;
  }
  let remainder = 0;
  for (let i = 0; i < expanded.length; i++) {
    const digit = expanded.charCodeAt(i) - 48;
    remainder = (remainder * 10 + digit) % 97;
  }
  return remainder === 1;
}

async function generateUblInvoiceXml({ supabase, partialPayment, invoice, doc, docType }) {
  const resolvedDocType = docType || (invoice ? 'INVOICE' : 'PARTIAL_PAYMENT');
  const resolvedDoc = doc || invoice || partialPayment;

  if (!resolvedDoc) {
    throw new ValidationError('Kein Dokument übergeben (PARTIAL_PAYMENT oder INVOICE).');
  }

  const bt = await buildBtDictionary({ supabase, doc: resolvedDoc, docType: resolvedDocType });

  const docNumber =
    resolvedDocType === 'INVOICE'
      ? (resolvedDoc.INVOICE_NUMBER || resolvedDoc.PARTIAL_PAYMENT_NUMBER)
      : (resolvedDoc.PARTIAL_PAYMENT_NUMBER || resolvedDoc.INVOICE_NUMBER);

  const docDate =
    resolvedDocType === 'INVOICE'
      ? resolvedDoc.INVOICE_DATE
      : resolvedDoc.PARTIAL_PAYMENT_DATE;

  const invoiceId = bt['BT-1'] || docNumber || String(resolvedDoc.ID);
  const issueDate = asIsoDate(bt['BT-2'] || docDate) || asIsoDate(new Date().toISOString());
  const dueDate = asIsoDate(bt['BT-9'] || resolvedDoc.DUE_DATE);

  const currency = String(bt['BT-5'] || 'EUR').trim() || 'EUR';

  const net = toNum(resolvedDoc.TOTAL_AMOUNT_NET ?? bt['BT-109'] ?? 0);
  const vatPct = toNum(resolvedDoc.VAT_PERCENT ?? 0);
  const taxAmount = toNum(resolvedDoc.TAX_AMOUNT_NET ?? bt['BT-110'] ?? (net * vatPct) / 100);
  const gross = toNum(resolvedDoc.TOTAL_AMOUNT_GROSS ?? bt['BT-112'] ?? (net + taxAmount));

  // Parties
  const supplierName = bt['BT-27'] || resolvedDoc.COMPANY_NAME_1 || '';
  const supplierStreet = bt['BT-35'] || '';
  const supplierCity = bt['BT-37'] || '';
  const supplierPostCode = bt['BT-38'] || '';
  const supplierCountry = bt['BT-40'] || 'DE';

  const supplierVatIdRaw = bt['BT-31'] || resolvedDoc['COMPANY_TAX-ID'] || '';
  const supplierVatId = normalizeVatId(supplierVatIdRaw, supplierCountry);

  let customerName = bt['BT-44'] || resolvedDoc.ADDRESS_NAME_1 || resolvedDoc.ADDRESS_NAME_2 || '';

  // Robust fallback: if buyer name is still empty, re-load it from ADDRESS using the header reference.
  // This prevents BR-07 (BT-44 missing) for cases where the snapshot name fields are empty.
  if (!String(customerName || '').trim()) {
    const addrId =
      resolvedDocType === 'INVOICE'
        ? (resolvedDoc.INVOICE_ADDRESS_ID || resolvedDoc.PARTIAL_PAYMENT_ADDRESS_ID)
        : (resolvedDoc.PARTIAL_PAYMENT_ADDRESS_ID || resolvedDoc.INVOICE_ADDRESS_ID);

    if (addrId) {
      const { data: addr } = await supabase
        .from('ADDRESS')
        .select('ADDRESS_NAME_1, ADDRESS_NAME_2')
        .eq('ID', addrId)
        .maybeSingle();

      customerName = (addr?.ADDRESS_NAME_1 || addr?.ADDRESS_NAME_2 || '').trim();
    }
  }

  if (!String(customerName || '').trim()) {
    throw new ValidationError(
      'Buyer name (BT-44) fehlt. Bitte prüfe die Rechnungsadresse (ADDRESS.ADDRESS_NAME_1/2) bzw. das Snapshot-Feld ADDRESS_NAME_1 im Dokument.'
    );
  }
  const customerStreet = bt['BT-50'] || resolvedDoc.ADDRESS_STREET || '';
  const customerCity = bt['BT-52'] || resolvedDoc.ADDRESS_CITY || '';
  const customerPostCode = bt['BT-51'] || resolvedDoc.ADDRESS_POST_CODE || '';
  const customerCountry = bt['BT-55'] || resolvedDoc.ADDRESS_COUNTRY || 'DE';

  const buyerRef = String(bt['BT-10'] || resolvedDoc.BUYER_REFERENCE || resolvedDoc.ADDRESS_REFERENCE_NUMBER || '').trim();

  // Endpoints (best effort, keep existing behaviour)
  const supplierEndpoint = String(resolvedDoc.EMPLOYEE_MAIL ?? '').trim();
  const customerEndpoint = String(resolvedDoc.CONTACT_MAIL ?? '').trim();

  // Contact
  const sellerContactName = String(resolvedDoc.EMPLOYEE ?? '').trim() || supplierName;
  let sellerContactPhone = normalizePhone(resolvedDoc.EMPLOYEE_PHONE);
  const sellerContactMail = String(resolvedDoc.EMPLOYEE_MAIL ?? '').trim();

  // Payment means
  let payeeIban = String(resolvedDoc.COMPANY_IBAN ?? '').trim();
  let payeeBic = String(resolvedDoc.COMPANY_BIC ?? '').trim();

  // Fallback to EMPLOYEE/COMPANY if snapshots are empty
  if ((!sellerContactPhone || sellerContactPhone.length < 3) && resolvedDoc.EMPLOYEE_ID) {
    const { data: emp } = await supabase
      .from('EMPLOYEE')
      .select('MOBILE')
      .eq('ID', resolvedDoc.EMPLOYEE_ID)
      .maybeSingle();
    if (emp?.MOBILE) sellerContactPhone = normalizePhone(emp.MOBILE);
  }
  if (!payeeIban && resolvedDoc.COMPANY_ID) {
    const { data: comp } = await supabase
      .from('COMPANY')
      .select('IBAN, BIC')
      .eq('ID', resolvedDoc.COMPANY_ID)
      .maybeSingle();
    if (comp?.IBAN) payeeIban = String(comp.IBAN).trim();
    if (comp?.BIC) payeeBic = String(comp.BIC).trim();
  }

  // --- Hard validation for DE/Peppol profiles ---
  if (!sellerContactPhone || sellerContactPhone.length < 3) {
    throw new ValidationError(
      'Seller contact telephone number (BT-42) fehlt. Bitte hinterlege eine Telefonnummer im EMPLOYEE (Feld MOBILE) oder im Dokument im Feld EMPLOYEE_PHONE.'
    );
  }

  if (!payeeIban) {
    throw new ValidationError(
      'Payment account identifier (BT-84) fehlt. Für SEPA-Überweisung (BT-81=58) muss eine IBAN vorhanden sein. Bitte hinterlege sie im COMPANY (Feld IBAN).'
    );
  }
  if (!isValidIban(payeeIban)) {
    throw new ValidationError(
      `Die hinterlegte IBAN ist syntaktisch ungültig (BT-84). Bitte prüfe COMPANY.IBAN. (Wert: ${payeeIban})`
    );
  }

  // Contract / project refs
  const projectNo = bt['BT-11'] || '';
  const contractNo = bt['BT-12'] || '';
  const orderNo = bt['BT-13'] || '';
  const buyerOrderNo = bt['BT-14'] || '';

  const comment = bt['BT-22'] || '';

  // Notes / labels depending on doc type
  const docLabel = resolvedDocType === 'INVOICE' ? 'Rechnung' : 'Abschlagsrechnung';
  const addDocNote =
    resolvedDocType === 'PARTIAL_PAYMENT' &&
    !String(comment).toLowerCase().includes('abschlagsrechnung');

  // UBL / XRechnung identifiers
  const customizationID = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
  const profileID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

  const vatCategoryId = vatPct > 0 ? 'S' : 'Z';

  // Build XML
  const lines = [];

  // Minimal single invoice line representing the net amount
  lines.push(`
    <cac:InvoiceLine>
      <cbc:ID>1</cbc:ID>
      <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${xmlEscape(net)}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${xmlEscape(docLabel)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>${xmlEscape(vatCategoryId)}</cbc:ID>
          <cbc:Percent>${xmlEscape(vatPct)}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${xmlEscape(currency)}">${xmlEscape(net)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${xmlEscape(customizationID)}</cbc:CustomizationID>
  <cbc:ProfileID>${xmlEscape(profileID)}</cbc:ProfileID>
  <cbc:ID>${xmlEscape(invoiceId)}</cbc:ID>
  <cbc:IssueDate>${xmlEscape(issueDate)}</cbc:IssueDate>
  ${dueDate ? `<cbc:DueDate>${xmlEscape(dueDate)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>${xmlEscape(bt['BT-3'])}</cbc:InvoiceTypeCode>
  ${addDocNote ? `<cbc:Note>${xmlEscape(docLabel)}</cbc:Note>` : ''}
  ${comment ? `<cbc:Note>${xmlEscape(comment)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${xmlEscape(currency)}</cbc:DocumentCurrencyCode>
  ${buyerRef ? `<cbc:BuyerReference>${xmlEscape(buyerRef)}</cbc:BuyerReference>` : ''}



  ${orderNo ? `
  <cac:OrderReference>
    <cbc:ID>${xmlEscape(orderNo)}</cbc:ID>
  </cac:OrderReference>
  ` : ''}
  <cac:AccountingSupplierParty>
    <cac:Party>
      ${supplierEndpoint ? `<cbc:EndpointID schemeID="9930">${xmlEscape(supplierEndpoint)}</cbc:EndpointID>` : ''}
      <cac:PartyName>
        <cbc:Name>${xmlEscape(supplierName || '')}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        ${supplierStreet ? `<cbc:StreetName>${xmlEscape(supplierStreet)}</cbc:StreetName>` : ''}
        ${supplierCity ? `<cbc:CityName>${xmlEscape(supplierCity)}</cbc:CityName>` : ''}
        ${supplierPostCode ? `<cbc:PostalZone>${xmlEscape(supplierPostCode)}</cbc:PostalZone>` : ''}
        <cac:Country>
          <cbc:IdentificationCode>${xmlEscape(supplierCountry)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${supplierVatId ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xmlEscape(supplierVatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      ` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(supplierName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>${xmlEscape(sellerContactName)}</cbc:Name>
        <cbc:Telephone>${xmlEscape(sellerContactPhone)}</cbc:Telephone>
        ${sellerContactMail ? `<cbc:ElectronicMail>${xmlEscape(sellerContactMail)}</cbc:ElectronicMail>` : ''}
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      ${customerEndpoint ? `<cbc:EndpointID schemeID="0204">${xmlEscape(customerEndpoint)}</cbc:EndpointID>` : ''}
      <cac:PartyName>
        <cbc:Name>${xmlEscape(customerName)}</cbc:Name>
      </cac:PartyName>

      <cac:PostalAddress>
        ${customerStreet ? `<cbc:StreetName>${xmlEscape(customerStreet)}</cbc:StreetName>` : ''}
        ${customerCity ? `<cbc:CityName>${xmlEscape(customerCity)}</cbc:CityName>` : ''}
        ${customerPostCode ? `<cbc:PostalZone>${xmlEscape(customerPostCode)}</cbc:PostalZone>` : ''}
        <cac:Country>
          <cbc:IdentificationCode>${xmlEscape(customerCountry)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <!--
        For XRechnung/EN16931, BT-44 (Buyer name) is typically mapped to
        AccountingCustomerParty/Party/PartyLegalEntity/RegistrationName.
        Some validators do not accept PartyName/Name alone, so we provide both.
      -->
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(customerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    ${payeeIban ? `
    <cac:PayeeFinancialAccount>
      <cbc:ID>${xmlEscape(payeeIban)}</cbc:ID>
      ${payeeBic ? `<cac:FinancialInstitutionBranch><cbc:ID>${xmlEscape(payeeBic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>
    ` : ''}
  </cac:PaymentMeans>

  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${xmlEscape(currency)}">${xmlEscape(taxAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${xmlEscape(currency)}">${xmlEscape(net)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${xmlEscape(currency)}">${xmlEscape(taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${xmlEscape(vatCategoryId)}</cbc:ID>
        <cbc:Percent>${xmlEscape(vatPct)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${xmlEscape(net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${xmlEscape(currency)}">${xmlEscape(net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${xmlEscape(currency)}">${xmlEscape(gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${xmlEscape(currency)}">${xmlEscape(gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${lines.join('\n')}
</Invoice>`;

  return xml;
}

module.exports = { generateUblInvoiceXml };
