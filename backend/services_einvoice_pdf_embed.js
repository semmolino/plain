'use strict';

/**
 * services_einvoice_pdf_embed.js
 *
 * Hybrid-PDF Helper: bettet eine Factur-X / ZUGFeRD XML in ein PDF ein.
 *
 * Was passiert:
 *   1. XML wird als embedded file ("factur-x.xml") angehaengt
 *   2. AF (Associated Files) Eintrag im Katalog mit AFRelationship=Alternative
 *   3. XMP Metadata Stream mit ZUGFeRD/Factur-X Namespace + ConformanceLevel
 *
 * Wichtiger Hinweis: Das Ergebnis ist KEIN strict PDF/A-3 Dokument.
 * Strict PDF/A-3 verlangt zusaetzlich: ICC OutputIntent (sRGB),
 * embedded Fonts mit Subsetting, keine externe Referenzen, etc.
 * Playwright erzeugt PDFs nicht als PDF/A-konform.
 *
 * Die meisten Empfaenger akzeptieren den hybriden PDF aber problemlos,
 * weil der ZUGFeRD-Workflow auf AF-Eintrag + Filename + XMP basiert.
 */

const { PDFDocument, AFRelationship } = require('pdf-lib');

const FILENAME_FACTURX = 'factur-x.xml';
const FILENAME_ZUGFERD = 'zugferd-invoice.xml';

// Conformance Level Mapping fuer XMP fx:ConformanceLevel
const CONFORMANCE_MAP = {
  MINIMUM:  'MINIMUM',
  BASIC_WL: 'BASIC WL',
  BASIC:    'BASIC',
  EN16931:  'EN 16931',
  EXTENDED: 'EXTENDED',
  XRECHNUNG: 'XRECHNUNG',
};

function xmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoNowZ() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Baut den XMP Metadata Stream mit Factur-X / ZUGFeRD Namespace.
 *
 * Wichtige Felder:
 *   - fx:DocumentType = INVOICE
 *   - fx:DocumentFileName = "factur-x.xml"
 *   - fx:Version = "1.0"
 *   - fx:ConformanceLevel = "EN 16931" | "EXTENDED" | "XRECHNUNG"
 */
function buildXmp({ profileKey, title, author, producer, filename }) {
  const conformance = CONFORMANCE_MAP[profileKey] || 'EN 16931';
  const now = isoNowZ();
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="PlaIn">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${xmlEscape(author)}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${xmlEscape(producer)}</xmp:CreatorTool>
      <xmp:CreateDate>${now}</xmp:CreateDate>
      <xmp:ModifyDate>${now}</xmp:ModifyDate>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${xmlEscape(producer)}</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${xmlEscape(filename)}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${conformance}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Bettet eine XRechnung/ZUGFeRD XML in einen bestehenden PDF-Buffer ein.
 *
 * @param {Object}  opts
 * @param {Buffer}  opts.pdfBuffer    - PDF aus Playwright
 * @param {string|Buffer} opts.xml    - XML als String oder Buffer
 * @param {string}  opts.profileKey   - 'EN16931' | 'EXTENDED' | 'XRECHNUNG' | ...
 * @param {string}  [opts.filename]   - Dateiname (default: 'factur-x.xml')
 * @param {string}  [opts.title]      - PDF Titel
 * @param {string}  [opts.author]     - Autor (z.B. Firma)
 * @param {string}  [opts.producer]   - Producer (z.B. 'PlaIn 1.0')
 *
 * @returns {Promise<Buffer>} Hybrid-PDF mit eingebetteter XML
 */
async function embedXmlIntoPdf({
  pdfBuffer,
  xml,
  profileKey = 'EN16931',
  filename,
  title = 'Rechnung',
  author = 'PlaIn',
  producer = 'PlaIn (Hybrid PDF/ZUGFeRD)',
}) {
  if (!pdfBuffer) throw new Error('embedXmlIntoPdf: pdfBuffer fehlt');
  if (!xml) throw new Error('embedXmlIntoPdf: xml fehlt');

  const xmlBytes = Buffer.isBuffer(xml) ? xml : Buffer.from(String(xml), 'utf8');
  const useFilename = filename || (profileKey === 'XRECHNUNG' ? 'xrechnung.xml' : FILENAME_FACTURX);

  const pdfDoc = await PDFDocument.load(pdfBuffer);

  // 1. XML als embedded file mit AFRelationship=Alternative
  await pdfDoc.attach(xmlBytes, useFilename, {
    mimeType: 'application/xml',
    description: `${profileKey} E-Invoice`,
    creationDate: new Date(),
    modificationDate: new Date(),
    afRelationship: AFRelationship.Alternative,
  });

  // 2. Info-Dict Standard-Felder
  pdfDoc.setTitle(title);
  pdfDoc.setAuthor(author);
  pdfDoc.setProducer(producer);
  pdfDoc.setCreator(producer);
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());

  // 3. XMP Metadata Stream mit Factur-X Namespace
  // pdf-lib hat keinen direkten XMP-Setter; wir setzen Metadata-Stream
  // ueber die Low-Level API.
  const xmpXml = buildXmp({ profileKey, title, author, producer, filename: useFilename });
  const { PDFName, PDFRawStream, PDFDict } = require('pdf-lib');
  const xmpBytes = Buffer.from(xmpXml, 'utf8');
  const xmpDict = pdfDoc.context.obj({
    Type: 'Metadata',
    Subtype: 'XML',
    Length: xmpBytes.length,
  });
  const xmpStream = PDFRawStream.of(xmpDict, xmpBytes);
  const xmpRef = pdfDoc.context.register(xmpStream);
  pdfDoc.catalog.set(PDFName.of('Metadata'), xmpRef);

  const out = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(out);
}

module.exports = {
  embedXmlIntoPdf,
  FILENAME_FACTURX,
  FILENAME_ZUGFERD,
};
