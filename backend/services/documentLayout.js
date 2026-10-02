"use strict";

/**
 * Aufbau der Belege — welche Bausteine es je Belegart gibt und in welcher
 * Reihenfolge sie erscheinen.
 *
 * Drei Ebenen, jede ueberschreibt die vorige (Konzept: Vorlagen-Plan 10/2026):
 *   1. Registry (hier): Bausteine und Standardreihenfolge je Kategorie
 *   2. Dokumentvorlage der Firma: theme.bodyByCategory[kategorie]
 *   3. Projekt bzw. Beleg: DOCUMENT_LAYOUT_JSON (Stufe 3)
 *
 * Gespeichert wird je Ebene nur die Abweichung:
 *   { order: [schluessel…], hidden: [schluessel…], pageBreaks: [schluessel…],
 *     payment: 'auto'|'always'|'never', texts: { "text:<id>": "…" } }
 * Eigene Textbloecke stehen als "text:<id>" in `order`.
 *
 * Leitplanken: `letterhead` steht immer zuerst; gesperrte Bausteine (Titel,
 * Betraege, Leistungen) lassen sich verschieben, aber nicht ausblenden — sie
 * tragen die Pflichtangaben eines Belegs. Unbekannte Schluessel fallen weg:
 * die Vorlagen binden Bausteine per Name ein, und ein Name aus der Datenbank
 * darf dort nichts adressieren, was es nicht gibt.
 */

const BLOCKS = {
  letterhead:   { label: "Briefkopf und Anschrift", locked: true, fixed: true },
  reference:    { label: "Bezugszeile (Projekt, Bauvorhaben, Leistungszeitraum)" },
  title:        { label: "Titel", locked: true },
  salutation:   { label: "Anrede" },
  intro:        { label: "Kopftext" },
  comment:      { label: "Kommentar zur Rechnung" },
  reason:       { label: "Begründung" },
  invoiceRef:   { label: "Bezug auf die Rechnung", locked: true },
  positions:    { label: "Leistungen", locked: true },
  scope:        { label: "Leistungsumfang", locked: true },
  amounts:      { label: "Beträge", locked: true },
  referenceBox: { label: "Bezugsangaben" },
  closing:      { label: "Fußtext" },
  payment:      { label: "Zahlungshinweis mit GiroCode", modes: ["auto", "always", "never"] },
  signature:    { label: "Unterschrift" },
};

const APPENDICES = {
  showPayments:         "Zahlungsübersicht",
  showProjectStructure: "Projektübersicht",
  showTec:              "Stundennachweis",
  showHonorar:          "HOAI-/Kalkulationsübersicht",
  showOrderSheet:       "Bestellblatt",
};

const INVOICE_BODY = ["letterhead", "reference", "title", "salutation", "intro", "comment", "amounts", "closing", "payment"];
const INVOICE_APPENDICES = ["showPayments", "showProjectStructure", "showTec", "showHonorar"];

const CATEGORIES = {
  invoice_rechnung:    { label: "Rechnung",            template: "invoice.njk", body: INVOICE_BODY, appendices: INVOICE_APPENDICES },
  invoice_abschlags:   { label: "Abschlagsrechnung",   template: "invoice.njk", body: INVOICE_BODY, appendices: INVOICE_APPENDICES },
  invoice_teilschluss: { label: "Teilschlussrechnung", template: "invoice.njk", body: INVOICE_BODY, appendices: INVOICE_APPENDICES, parent: "invoice_schluss" },
  invoice_schluss:     { label: "Schlussrechnung",     template: "invoice.njk", body: INVOICE_BODY, appendices: INVOICE_APPENDICES },
  invoice_korrektur:   { label: "Rechnungskorrektur",  template: "invoice.njk", body: INVOICE_BODY, appendices: INVOICE_APPENDICES, parent: "invoice_rechnung" },
  invoice_storno:      { label: "Stornorechnung",      template: "storno.njk",
                         body: ["letterhead", "reference", "title", "salutation", "intro", "amounts", "closing"], appendices: [] },
  mahnung:             { label: "Zahlungserinnerung und Mahnung", template: "mahnung.njk",
                         body: ["letterhead", "title", "intro", "invoiceRef", "amounts", "closing"], appendices: [] },
  offer_angebot:       { label: "Angebot",             template: "offer.njk",
                         body: ["letterhead", "title", "intro", "positions", "amounts", "closing", "signature"],
                         appendices: ["showHonorar", "showOrderSheet"] },
  offer_ab:            { label: "Auftragsbestätigung", template: "auftragsbestaetigung.njk",
                         body: ["letterhead", "title", "intro", "scope", "amounts", "referenceBox", "closing", "signature"], appendices: [] },
  nachtrag:            { label: "Nachtrag",            template: "nachtrag.njk",
                         body: ["letterhead", "title", "reason", "positions", "amounts", "closing"], appendices: [] },
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const TEXT_KEY = /^text:[a-z0-9]{1,24}$/;
const MAX_TEXTS = 10;
const MAX_TEXT_LEN = 4000;

function categoryOf(category) {
  return CATEGORIES[category] ? category : "invoice_rechnung";
}

/**
 * Bereinigt eine gespeicherte Abweichung fuer eine Kategorie: nur Bausteine,
 * die es dort gibt, nur eigene Texte mit gueltigem Schluessel.
 */
function sanitizeLayoutOverride(raw, category) {
  const cat = CATEGORIES[categoryOf(category)];
  const allowed = new Set(cat.body);
  const o = isObj(raw) ? raw : {};
  const out = {};

  const texts = {};
  if (isObj(o.texts)) {
    for (const [k, v] of Object.entries(o.texts)) {
      if (Object.keys(texts).length >= MAX_TEXTS) break;
      if (TEXT_KEY.test(k) && typeof v === "string") texts[k] = v.slice(0, MAX_TEXT_LEN);
    }
  }
  const known = (k) => allowed.has(k) || Object.prototype.hasOwnProperty.call(texts, k);

  if (Array.isArray(o.order)) out.order = [...new Set(o.order.filter((k) => typeof k === "string" && known(k)))];
  if (Array.isArray(o.hidden)) out.hidden = [...new Set(o.hidden.filter((k) => allowed.has(k) && !BLOCKS[k].locked))];
  if (Array.isArray(o.pageBreaks)) out.pageBreaks = [...new Set(o.pageBreaks.filter((k) => known(k) && k !== "letterhead"))];
  if (allowed.has("payment") && BLOCKS.payment.modes.includes(o.payment)) out.payment = o.payment;
  if (Object.keys(texts).length) out.texts = texts;
  for (const field of ["intro", "closing"]) {
    if (typeof o[field + "Text"] === "string") out[field + "Text"] = o[field + "Text"].slice(0, MAX_TEXT_LEN);
  }
  return out;
}

/**
 * Setzt die Ebenen zusammen und liefert den Aufbau, den die Vorlage rendert:
 *   { category, body: [{ key, kind: 'block'|'text', visible, pageBreakBefore, text?, mode? }] }
 *
 * @param category   Kategorie (siehe CATEGORIES)
 * @param overrides  Abweichungen in aufsteigender Prioritaet (Vorlage, Projekt, Beleg)
 * @param context    { hasClosingText } — fuer payment:'auto' (alte Regel: der
 *                   Zahlungshinweis entfaellt, wenn ein Fusstext da ist)
 */
function resolveLayout(category, overrides = [], context = {}) {
  const key = categoryOf(category);
  const cat = CATEGORIES[key];
  let order = [...cat.body];
  const hidden = new Set();
  const pageBreaks = new Set();
  const texts = {};
  let payment = "auto";
  let introText = null;
  let closingText = null;

  for (const raw of overrides) {
    const o = sanitizeLayoutOverride(raw, key);
    Object.assign(texts, o.texts || {});
    if (o.order) {
      // Was die Ebene nicht nennt, haengt in bisheriger Reihenfolge hinten an —
      // ein neuer Baustein geht so nie verloren.
      const rest = order.filter((k) => !o.order.includes(k));
      order = [...o.order, ...rest];
    }
    if (o.hidden) { hidden.clear(); o.hidden.forEach((k) => hidden.add(k)); }
    if (o.pageBreaks) { pageBreaks.clear(); o.pageBreaks.forEach((k) => pageBreaks.add(k)); }
    if (o.payment) payment = o.payment;
    if (o.introText !== undefined) introText = o.introText;
    if (o.closingText !== undefined) closingText = o.closingText;
  }

  // Texte ohne Platz in der Reihenfolge erscheinen nicht; Briefkopf zuerst.
  order = order.filter((k) => cat.body.includes(k) || Object.prototype.hasOwnProperty.call(texts, k));
  order = ["letterhead", ...order.filter((k) => k !== "letterhead")];

  const hasClosingText = closingText !== null ? !!closingText.trim() : !!context.hasClosingText;
  const body = order.map((k) => {
    if (k.startsWith("text:")) {
      return { key: k, kind: "text", text: texts[k], visible: !!(texts[k] || "").trim(), pageBreakBefore: pageBreaks.has(k) };
    }
    let visible = !hidden.has(k);
    let mode;
    if (k === "payment") {
      mode = payment;
      visible = payment === "always" || (payment === "auto" && !hasClosingText);
    }
    return { key: k, kind: "block", visible, pageBreakBefore: pageBreaks.has(k), ...(mode ? { mode } : {}) };
  });

  return { category: key, body, introText, closingText };
}

/** Kategorie eines Rechnungsbelegs (INVOICE_TYPE / Belegart). */
function invoiceCategory(invoiceType, docType) {
  if (docType === "ADVANCE_INVOICE" || invoiceType === "partial_payment") return "invoice_abschlags";
  if (invoiceType === "schlussrechnung") return "invoice_schluss";
  if (invoiceType === "teilschlussrechnung") return "invoice_teilschluss";
  if (invoiceType === "gutschrift") return "invoice_korrektur";
  if (invoiceType === "stornorechnung") return "invoice_storno";
  return "invoice_rechnung";
}

/** Kette fuer gespeicherte Einstellungen: Teilschluss erbt von Schluss usw. */
function categoryChain(category) {
  const chain = [];
  let c = categoryOf(category);
  while (c && !chain.includes(c)) { chain.push(c); c = CATEGORIES[c].parent; }
  return chain;
}

/** Fuer die Oberflaeche: Bausteine einer Kategorie mit Beschriftung und Sperre. */
function describeCategory(category) {
  const key = categoryOf(category);
  const cat = CATEGORIES[key];
  return {
    key, label: cat.label, parent: cat.parent || null,
    body: cat.body.map((k) => ({ key: k, label: BLOCKS[k].label, locked: !!BLOCKS[k].locked, fixed: !!BLOCKS[k].fixed, modes: BLOCKS[k].modes || null })),
    appendices: cat.appendices.map((k) => ({ key: k, label: APPENDICES[k] })),
  };
}

module.exports = {
  BLOCKS, APPENDICES, CATEGORIES,
  resolveLayout, sanitizeLayoutOverride, invoiceCategory, categoryChain, describeCategory,
};
