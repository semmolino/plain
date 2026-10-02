"use strict";

/**
 * Musterbelege als ZUGFeRD-Hybrid-PDF — fuer die PDF/A-3b-Pruefung mit veraPDF
 * (scripts/pdfa-check.sh, CI-Job „pdfa").
 *
 * Gerendert wird wie im Betrieb: echte Vorlage mit Beispieldaten
 * (renderPreviewDoc → renderLetterPdf, also samt Briefpapier-/Falzmarken-/
 * Folgeseiten-Nachbearbeitung), dazu das CII des Musterbelegs
 * (einvoice/referenceDocument.js), eingebettet ueber embedXmlIntoPdf.
 *
 *   node backend/scripts/pdfa-sample.js <zielordner>
 */

const fs = require("fs");
const path = require("path");
const { makeFakeSupabase } = require("../tests/helpers/fakeSupabase");
const { renderPreviewDoc } = require("../services_pdf_render");
const { embedXmlIntoPdf } = require("../services_einvoice_pdf_embed");
const { generateCiiXml } = require("../services_einvoice_cii");
const { referenceInvoiceData } = require("../einvoice/referenceDocument");
const profiles = require("../einvoice/profiles");

// Standard: das bisherige Aussehen. Voll: alles, was Stufe 4 ins PDF bringt —
// Webfont, Stil, DIN-Anschriftfeld, Falzmarken, Folgeseitenkopf.
const SAMPLES = [
  { name: "rechnung-standard", category: "invoice_rechnung", profile: "EN16931", theme: {} },
  { name: "rechnung-voll", category: "invoice_rechnung", profile: "EN16931", theme: {
    brand: { accentColor: "#1e3a5f", primaryColor: "#1e3a5f", fontFamily: "inter" },
    layout: { style: "klar", din: "B", foldMarks: true, followHeader: true },
  } },
  { name: "schluss-architektur-xrechnung", category: "invoice_schluss", profile: "XRECHNUNG", theme: {
    brand: { accentColor: "#3f3f46", primaryColor: "#3f3f46", fontFamily: "source-serif" },
    layout: { style: "architektur", din: "A", foldMarks: true, followHeader: true },
  } },
];

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error("Zielordner fehlt: node scripts/pdfa-sample.js <ordner>");
  fs.mkdirSync(out, { recursive: true });
  const xml = generateCiiXml(referenceInvoiceData(), profiles.CII_DEFAULT_PROFILE);
  for (const s of SAMPLES) {
    const { pdf } = await renderPreviewDoc({ supabase: makeFakeSupabase({}), tenantId: 1, theme: s.theme, category: s.category, asPdf: true });
    const hybrid = await embedXmlIntoPdf({
      pdfBuffer: Buffer.from(pdf), xml, profileKey: s.profile,
      title: `Muster ${s.name}`, author: "Musterplanung GmbH", producer: "plan&simple",
    });
    const file = path.join(out, `${s.name}.pdf`);
    fs.writeFileSync(file, hybrid);
    console.log(file);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
