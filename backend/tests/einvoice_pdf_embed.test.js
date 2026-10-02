"use strict";

const { PDFDocument } = require("pdf-lib");
const { embedXmlIntoPdf } = require("../services_einvoice_pdf_embed");

const XML = '<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice/>';

async function blankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

// Der Filespec liegt als PDF-Objekt vor; pdf-lib kodiert den Schraegstrich im
// MIME-Typ als #2F. Deshalb wird auf der Rohdarstellung gesucht statt auf
// "text/xml".
async function embedAndDump(opts = {}) {
  const hybrid = await embedXmlIntoPdf({
    pdfBuffer: await blankPdf(),
    xml: XML,
    profileKey: "EN16931",
    title: "Rechnung 1",
    ...opts,
  });
  return { hybrid, raw: hybrid.toString("latin1") };
}

describe("embedXmlIntoPdf", () => {
  it("deklariert die eingebettete XML als text/xml (N13)", async () => {
    const { raw } = await embedAndDump();
    expect(raw).toContain("text#2Fxml");
    expect(raw).not.toContain("application#2Fxml");
  });

  it("legt die Datei unter factur-x.xml ab und traegt sie ins /AF-Array ein", async () => {
    const { raw } = await embedAndDump();
    expect(raw).toContain("factur-x.xml");
    expect(raw).toContain("/AF");
    expect(raw).toContain("/Alternative");
  });

  it("deklariert Factur-X im XMP", async () => {
    const { raw } = await embedAndDump();
    expect(raw).toContain("fx:DocumentType");
    expect(raw).toContain("urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#");
  });

  it("erzeugt ein ladbares PDF mit der XML als Anhang", async () => {
    const { hybrid } = await embedAndDump();
    const reloaded = await PDFDocument.load(hybrid);
    expect(reloaded.getPageCount()).toBe(1);
    expect(reloaded.getTitle()).toBe("Rechnung 1");
  });
});

// PDF/A-3b (10/2026): die Bausteine, die veraPDF beim Chromium-PDF vermisste.
// Die volle Pruefung laeuft in CI mit veraPDF (scripts/pdfa-check.sh) — hier
// nur die Struktur, damit ein Rueckbau sofort auffaellt.
describe("embedXmlIntoPdf — PDF/A-3b", () => {
  const fs = require("fs");
  const path = require("path");
  const zlib = require("zlib");
  const { PDFName, PDFRawStream, PDFArray } = require("pdf-lib");

  async function load() {
    const { hybrid } = await embedAndDump({ author: "Musterplanung GmbH", producer: "plan&simple" });
    return PDFDocument.load(hybrid, { updateMetadata: false });
  }
  const xmpOf = (doc) => {
    const st = doc.context.lookup(doc.catalog.get(PDFName.of("Metadata")));
    return { st, xml: Buffer.from(st.getContents()).toString("utf8") };
  };

  it("OutputIntent GTS_PDFA1 mit dem unveränderten sRGB-Profil des ICC", async () => {
    const doc = await load();
    const intents = doc.catalog.lookup(PDFName.of("OutputIntents"), PDFArray);
    const oi = intents.lookup(0);
    expect(String(oi.get(PDFName.of("S")))).toBe("/GTS_PDFA1");
    const icc = doc.context.lookup(oi.get(PDFName.of("DestOutputProfile")));
    expect(icc).toBeInstanceOf(PDFRawStream);
    expect(String(icc.dict.get(PDFName.of("N")))).toBe("3");
    const bytes = zlib.inflateSync(Buffer.from(icc.getContents()));
    expect(bytes.equals(fs.readFileSync(path.join(__dirname, "..", "assets", "icc", "sRGB2014.icc")))).toBe(true);
  });

  it("XMP: PDF/A-Kennung 3B, Erweiterungsschema für fx, ungefiltert", async () => {
    const { st, xml } = xmpOf(await load());
    expect(st.dict.get(PDFName.of("Filter"))).toBeUndefined();
    expect(xml).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(xml).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
    expect(xml).toContain("<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>");
    for (const p of ["DocumentFileName", "DocumentType", "Version", "ConformanceLevel"]) {
      expect(xml).toContain(`<pdfaProperty:name>${p}</pdfaProperty:name>`);
    }
  });

  it("Info und XMP stimmen überein; Datei-ID im Trailer", async () => {
    const doc = await load();
    const { xml } = xmpOf(doc);
    expect(doc.getProducer()).toBe("plan&simple");
    expect(xml).toContain("<pdf:Producer>plan&amp;simple</pdf:Producer>");
    expect(doc.getAuthor()).toBe("Musterplanung GmbH");
    const created = doc.getCreationDate().toISOString().replace(/\.\d{3}Z$/, "Z");
    expect(xml).toContain(`<xmp:CreateDate>${created}</xmp:CreateDate>`);
    const id = doc.context.trailerInfo.ID;
    expect(id).toBeDefined();
    expect(id.size()).toBe(2);
  });
});
