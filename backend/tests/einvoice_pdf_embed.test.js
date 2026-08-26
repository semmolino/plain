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
