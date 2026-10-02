'use strict';

/**
 * services_einvoice_pdf_embed.js
 *
 * Hybrid-PDF (ZUGFeRD / Factur-X) als PDF/A-3b.
 *
 * Was passiert:
 *   1. XML als eingebettete Datei ("factur-x.xml") mit AFRelationship=Alternative
 *   2. OutputIntent mit dem sRGB-Profil des ICC (assets/icc/sRGB2014.icc)
 *   3. XMP: PDF/A-Kennung (Teil 3, Stufe B), Factur-X-Felder samt dem
 *      Erweiterungsschema, das PDF/A fuer jeden fremden Namensraum verlangt
 *   4. Info-Dictionary und XMP mit denselben Werten (Titel, Autor, Producer,
 *      Zeitpunkt) und eine Datei-ID im Trailer
 *
 * Bis 10/2026 fehlten 2–4: das PDF war ein gueltiger Hybrid, aber kein
 * PDF/A-3 — veraPDF meldete sechs Regelverstoesse (1992 davon DeviceRGB ohne
 * OutputIntent). Schriften und Transparenz aus Chromium bestanden schon.
 * Geprueft wird das in CI mit veraPDF (scripts/pdfa-check.sh,
 * docs/PDFA3_MACHBARKEIT.md).
 *
 * Grenze: was IN das Chromium-PDF kommt, muss selbst PDF/A-tauglich sein.
 * Ein Briefpapier-PDF (services/pdfFinish.js) mit nicht eingebetteten
 * Schriften oder CMYK-Farben macht auch den Beleg unzulaessig.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, AFRelationship, PDFName, PDFString, PDFHexString, PDFRawStream } = require('pdf-lib');

const FILENAME_FACTURX = 'factur-x.xml';
const FILENAME_ZUGFERD = 'zugferd-invoice.xml';

const ICC_PATH = path.join(__dirname, 'assets', 'icc', 'sRGB2014.icc');
let _icc = null;
const iccBytes = () => (_icc ||= fs.readFileSync(ICC_PATH));

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

/** Zeitpunkt fuer XMP — sekundengenau, damit er zum Info-Dictionary passt. */
function isoZ(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * XMP fuer PDF/A-3b + Factur-X.
 *
 * Wichtige Felder:
 *   - pdfaid:part = 3, pdfaid:conformance = B
 *   - fx:DocumentType = INVOICE, fx:DocumentFileName, fx:Version = "1.0",
 *     fx:ConformanceLevel = "EN 16931" | "EXTENDED" | "XRECHNUNG" …
 *   - pdfaExtension:schemas beschreibt den fx-Namensraum (PDF/A 6.6.2.3)
 */
function buildXmp({ profileKey, title, author, producer, filename, date }) {
  const conformance = CONFORMANCE_MAP[profileKey] || 'EN 16931';
  const when = isoZ(date);
  const prop = (name, description) => `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${description}</pdfaProperty:description>
              </rdf:li>`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="plan&amp;simple">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${xmlEscape(author)}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${xmlEscape(producer)}</xmp:CreatorTool>
      <xmp:CreateDate>${when}</xmp:CreateDate>
      <xmp:ModifyDate>${when}</xmp:ModifyDate>
      <xmp:MetadataDate>${when}</xmp:MetadataDate>
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
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${prop('DocumentFileName', 'name of the embedded XML invoice file')}${prop('DocumentType', 'INVOICE')}${prop('Version', 'The actual version of the Factur-X XML schema')}${prop('ConformanceLevel', 'The conformance level of the embedded Factur-X data')}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** OutputIntent mit dem sRGB-Profil — erlaubt DeviceRGB unter PDF/A. */
function addOutputIntent(pdfDoc) {
  const ctx = pdfDoc.context;
  const icc = ctx.register(ctx.flateStream(iccBytes(), { N: 3 }));
  const intent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
    DestOutputProfile: icc,
  });
  pdfDoc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([intent]));
}

/**
 * Bettet eine XRechnung/ZUGFeRD XML in einen bestehenden PDF-Buffer ein und
 * macht daraus PDF/A-3b.
 *
 * @param {Object}  opts
 * @param {Buffer}  opts.pdfBuffer    - PDF aus Playwright
 * @param {string|Buffer} opts.xml    - XML als String oder Buffer
 * @param {string}  opts.profileKey   - 'EN16931' | 'EXTENDED' | 'XRECHNUNG' | ...
 * @param {string}  [opts.filename]   - Name der eingebetteten Datei
 * @param {string}  [opts.title]      - PDF Titel
 * @param {string}  [opts.author]     - Autor (z.B. Firma)
 * @param {string}  [opts.producer]   - Producer
 *
 * @returns {Promise<Buffer>} Hybrid-PDF mit eingebetteter XML
 */
async function embedXmlIntoPdf({
  pdfBuffer,
  xml,
  profileKey = 'EN16931',
  filename,
  title = 'Rechnung',
  author = 'plan&simple',
  producer = 'plan&simple',
}) {
  if (!pdfBuffer) throw new Error('embedXmlIntoPdf: pdfBuffer fehlt');
  if (!xml) throw new Error('embedXmlIntoPdf: xml fehlt');

  const xmlBytes = Buffer.isBuffer(xml) ? xml : Buffer.from(String(xml), 'utf8');
  const useFilename = filename || (profileKey === 'XRECHNUNG' ? 'xrechnung.xml' : FILENAME_FACTURX);
  // EIN Zeitpunkt fuer Info-Dictionary, XMP und Anhang — PDF/A verlangt, dass
  // beide Metadaten uebereinstimmen. Sekundengenau, wie das Info-Dictionary.
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);

  const pdfDoc = await PDFDocument.load(pdfBuffer, { updateMetadata: false });

  // 1. XML als embedded file mit AFRelationship=Alternative
  await pdfDoc.attach(xmlBytes, useFilename, {
    // N13: Factur-X/ZUGFeRD schreibt text/xml vor, nicht application/xml.
    // Strenge Validatoren beanstanden den Unterschied.
    mimeType: 'text/xml',
    description: `${profileKey} E-Invoice`,
    creationDate: now,
    modificationDate: now,
    afRelationship: AFRelationship.Alternative,
  });

  // 2. Farbraum fuer DeviceRGB
  addOutputIntent(pdfDoc);

  // 3. Info-Dictionary — dieselben Werte wie im XMP
  pdfDoc.setTitle(title);
  pdfDoc.setAuthor(author);
  pdfDoc.setProducer(producer);
  pdfDoc.setCreator(producer);
  pdfDoc.setCreationDate(now);
  pdfDoc.setModificationDate(now);

  // 4. XMP — ungefiltert (PDF/A 6.6.2.1: der Metadaten-Strom traegt kein /Filter)
  const xmpBytes = Buffer.from(buildXmp({ profileKey, title, author, producer, filename: useFilename, date: now }), 'utf8');
  const xmpStream = PDFRawStream.of(pdfDoc.context.obj({ Type: 'Metadata', Subtype: 'XML', Length: xmpBytes.length }), xmpBytes);
  pdfDoc.catalog.set(PDFName.of('Metadata'), pdfDoc.context.register(xmpStream));

  // 5. Datei-ID im Trailer (PDF/A 6.1.3)
  const id = PDFHexString.of(crypto.createHash('md5').update(xmlBytes).update(String(now.getTime())).digest('hex'));
  pdfDoc.context.trailerInfo.ID = pdfDoc.context.obj([id, id]);

  const out = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(out);
}

module.exports = {
  embedXmlIntoPdf,
  buildXmp,
  FILENAME_FACTURX,
  FILENAME_ZUGFERD,
};
