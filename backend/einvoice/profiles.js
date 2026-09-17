"use strict";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  PROFILE — welche Ausbaustufe der Norm ein Dokument bedient
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Bisher lagen die CII-Profile in `services_einvoice_cii.js` und die
 * UBL-Kennungen in `services_einvoice_ubl.js`. Wer wissen wollte, welche
 * Profile das Produkt überhaupt erzeugt, musste beide Dateien lesen — und
 * `btRegistry.js` hätte keinen Ort gehabt, auf den es sich beziehen kann.
 *
 * Die `has*`-Schalter sind keine Meinung, sondern der Umfang, den die
 * jeweilige Factur-X-Stufe zulässt: MINIMUM trägt keine Positionen, BASIC WL
 * keine, BASIC keine Positionspreise, erst EN16931 den Ansprechpartner.
 */

/** @typedef {{id:string,labelDe:string,hasLines:boolean,hasTax:boolean,hasPaymentTerms:boolean,hasBillingPeriod:boolean,hasLineNotes:boolean,hasLinePrices:boolean,hasContact:boolean}} CiiProfile */

/** @type {Record<string, CiiProfile>} */
const CII_PROFILES = {
  MINIMUM: {
    id: "urn:factur-x.eu:1p0:minimum",
    labelDe: "Factur-X MINIMUM",
    hasLines: false, hasTax: false, hasPaymentTerms: false,
    hasBillingPeriod: false, hasLineNotes: false, hasLinePrices: false, hasContact: false,
  },
  BASIC_WL: {
    id: "urn:factur-x.eu:1p0:basicwl",
    labelDe: "Factur-X BASIC WL (ohne Positionen)",
    hasLines: false, hasTax: true, hasPaymentTerms: true,
    hasBillingPeriod: true, hasLineNotes: false, hasLinePrices: false, hasContact: false,
  },
  BASIC: {
    id: "urn:factur-x.eu:1p0:basic",
    labelDe: "Factur-X BASIC",
    hasLines: true, hasTax: true, hasPaymentTerms: true,
    hasBillingPeriod: true, hasLineNotes: false, hasLinePrices: false, hasContact: false,
  },
  EN16931: {
    id: "urn:cen.eu:en16931:2017",
    labelDe: "EN 16931 (COMFORT)",
    hasLines: true, hasTax: true, hasPaymentTerms: true,
    hasBillingPeriod: true, hasLineNotes: true, hasLinePrices: true, hasContact: true,
  },
  EXTENDED: {
    id: "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended",
    labelDe: "Factur-X EXTENDED",
    hasLines: true, hasTax: true, hasPaymentTerms: true,
    hasBillingPeriod: true, hasLineNotes: true, hasLinePrices: true, hasContact: true,
  },
};

/** Vorgabe für alle CII-Belege: nur EXTENDED trägt die Bau-Typcodes 875/876/877. */
const CII_DEFAULT_PROFILE = "EXTENDED";

// ── UBL-Kennungen ────────────────────────────────────────────────────────────

const XRECHNUNG_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

const PEPPOL_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";

// S6 (Audit 25.08.2026): Die ProfileID ist für beide Varianten dieselbe — die
// XRechnung verwendet das Peppol-Billing-Profil bewusst mit. Vorher standen
// zwei Konstanten mit identischem Wert und eine Fallunterscheidung, die nichts
// unterschied. Müssen die Werte je auseinanderlaufen, gehört die Weiche zurück.
const BILLING_PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

const UBL_FLAVORS = {
  XRECHNUNG: { customizationId: XRECHNUNG_CUSTOMIZATION_ID, profileId: BILLING_PROFILE_ID, labelDe: "XRechnung 3.0 (UBL)" },
  PEPPOL:    { customizationId: PEPPOL_CUSTOMIZATION_ID,    profileId: BILLING_PROFILE_ID, labelDe: "Peppol BIS Billing 3.0" },
};

function ciiProfile(key) {
  const p = CII_PROFILES[String(key || CII_DEFAULT_PROFILE).toUpperCase()];
  if (!p) throw new Error(`Unknown CII profile: ${key}`);
  return p;
}

function ublFlavor(key) {
  return UBL_FLAVORS[String(key || "XRECHNUNG").toUpperCase()] || UBL_FLAVORS.XRECHNUNG;
}

module.exports = {
  CII_PROFILES, CII_DEFAULT_PROFILE, ciiProfile,
  UBL_FLAVORS, ublFlavor,
  XRECHNUNG_CUSTOMIZATION_ID, PEPPOL_CUSTOMIZATION_ID, BILLING_PROFILE_ID,
};
