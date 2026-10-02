"use strict";

// Haelt fest, was jede Belegvorlage mit den Beispielbelegen ausgibt
// (services/documentSamples.js). Ein Umbau der Vorlagen — Bausteine,
// gemeinsames CSS — darf hier nichts aendern, solange er nichts Sichtbares
// aendern soll. Eine gewollte Aenderung aktualisiert den Schnappschuss
// bewusst (`npx jest -u tests/documentTemplates.snapshot.test.js`).
//
// Verglichen wird HTML mit zusammengefasstem Leerraum: Einrueckung und
// Zeilenumbrueche zwischen Elementen aendern am Druckbild nichts.

const path = require("path");
const { templateEnv, documentContext } = require("../services_pdf_render");
const { sampleViewModel } = require("../services/documentSamples");
const { sanitizeTheme } = require("../services_theme_schema");

const TEMPLATE = {
  invoice_rechnung: "invoice.njk", invoice_abschlags: "invoice.njk", invoice_teilschluss: "invoice.njk",
  invoice_schluss: "invoice.njk", invoice_korrektur: "invoice.njk", invoice_storno: "storno.njk",
  mahnung: "mahnung.njk", offer_angebot: "offer.njk", offer_ab: "auftragsbestaetigung.njk", nachtrag: "nachtrag.njk",
};

function normalize(html) {
  return html
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/\s+>/g, ">")
    .trim();
}

function render(category, mutate) {
  const vm = sampleViewModel(category);
  if (mutate) mutate(vm);
  const ctx = documentContext({ category, vm, theme: sanitizeTheme(undefined) });
  return normalize(templateEnv().render(path.join("modern_a", TEMPLATE[category]), ctx));
}

describe("Belegvorlagen — Ausgabe mit den Beispielbelegen", () => {
  for (const category of Object.keys(TEMPLATE)) {
    it(category, () => {
      expect(render(category)).toMatchSnapshot();
    });
  }

  it("Rechnung mit Fußtext (Zahlungshinweis entfällt)", () => {
    expect(render("invoice_rechnung", (vm) => { vm.text2 = "Zahlbar ohne Abzug innerhalb von 30 Tagen."; })).toMatchSnapshot();
  });

  it("Rechnung mit Nachlass und GiroCode", () => {
    expect(render("invoice_rechnung", (vm) => {
      vm.discounts = { ...vm.discounts, d1Percent: 3, d1Amount: -555, hasDiscounts: true, adjustedNet: 17945, adjustedVat: 3409.55, adjustedGross: 21354.55 };
      vm.epcQrDataUri = "data:image/png;base64,iVBORw0KGgo=";
    })).toMatchSnapshot();
  });

  it("Rechnung ohne Anrede, ohne Kopftext, alle Anhänge aus", () => {
    expect(render("invoice_rechnung", (vm) => {
      vm.salutationLine = ""; vm.text1 = "";
      vm.projectPayments = []; vm.projectStructureRows = []; vm.tec = { rows: [], groups: [] }; vm.honorarCalcs = [];
    })).toMatchSnapshot();
  });

  it("Angebot und Auftragsbestätigung ohne eigene Texte", () => {
    expect(render("offer_angebot", (vm) => { vm.text1 = ""; vm.text2 = ""; })).toMatchSnapshot();
    expect(render("offer_ab", (vm) => { vm.text1 = ""; vm.text2 = ""; })).toMatchSnapshot();
  });
});
