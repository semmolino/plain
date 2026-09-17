"use strict";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  CODELISTEN — die von der EN 16931 vorgeschriebenen Wertevorräte
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Eine E-Rechnung besteht zu einem guten Teil aus Codes, die nicht wir
 * vergeben: Belegart (UNTDID 1001), Steuerkategorie (UNTDID 5305),
 * Zahlungsart (UNTDID 4461), Notenzweck (UNTDID 4451), Mengeneinheit
 * (UN/ECE Rec. 20). Ein falscher Code ist beim Empfänger eine harte
 * Abweisung — er sieht aber im Quelltext aus wie jeder andere String.
 *
 * Deshalb stehen sie hier mit Klartext-Bedeutung, statt als '875' mitten in
 * einer Ternär-Kaskade. Wer einen Code braucht, holt ihn über eine Funktion
 * dieser Datei; wer einen neuen einführt, trägt ihn hier ein und bekommt die
 * Prüfung (`isValid…`) geschenkt.
 *
 * Gegenstück: `btRegistry.js` sagt, WELCHES Feld in welches XML-Element geht.
 * Diese Datei sagt, WELCHE WERTE darin stehen dürfen.
 */

// ── UNTDID 1001 — Belegart (BT-3) ────────────────────────────────────────────
//
// Die Syntaxen lassen unterschiedlich viel zu: die XRechnung (UBL) kennt für
// Abschläge nur 326, ZUGFeRD/Factur-X EXTENDED zusätzlich die Bau-Codes
// 875/876/877. Genau diese Asymmetrie stand bisher als zwei getrennte
// Ternär-Kaskaden in `services_einvoice_data.js` — zwei Stellen, eine Regel.

/** @typedef {{code:string,labelDe:string,syntaxes:('CII'|'UBL')[]}} DocumentTypeCode */

/** @type {Record<string, DocumentTypeCode>} */
const UNTDID_1001 = {
  "326": { code: "326", labelDe: "Abschlagsrechnung",            syntaxes: ["UBL"] },
  "380": { code: "380", labelDe: "Rechnung",                     syntaxes: ["CII", "UBL"] },
  "381": { code: "381", labelDe: "Gutschrift",                   syntaxes: ["CII", "UBL"] },
  "384": { code: "384", labelDe: "Rechnungskorrektur / Storno",  syntaxes: ["CII", "UBL"] },
  "875": { code: "875", labelDe: "Abschlagsrechnung (Bau)",      syntaxes: ["CII"] },
  "876": { code: "876", labelDe: "Teilschlussrechnung (Bau)",    syntaxes: ["CII"] },
  "877": { code: "877", labelDe: "Schlussrechnung (Bau)",        syntaxes: ["CII"] },
};

/**
 * Belegart → Typcode, je Syntax.
 *
 * Eine Funktion statt zweier Kaskaden: die fachliche Fallunterscheidung
 * (Abschlag? Storno? Schlussrechnung?) steht einmal da, der Syntaxunterschied
 * daneben. Läuft eine der beiden Seiten künftig auseinander, fällt das hier
 * auf und nicht erst beim Empfänger.
 *
 * @param {Object} p
 * @param {'INVOICE'|'ADVANCE_INVOICE'} p.docType
 * @param {string} [p.invoiceType]   INVOICE_TYPE-Spalte ('rechnung', 'schlussrechnung', …)
 * @param {boolean} [p.isCancellation] Storno (CANCELS_*_ID gesetzt)
 * @param {'CII'|'UBL'} p.syntax
 * @returns {string}
 */
function documentTypeCode({ docType, invoiceType, isCancellation, syntax }) {
  const isAdvance = docType === "ADVANCE_INVOICE";
  const type      = String(invoiceType || "").toLowerCase();
  const storno    = !!isCancellation || type === "stornorechnung";

  if (storno) return "384";
  if (isAdvance) return syntax === "CII" ? "875" : "326";
  if (type === "gutschrift") return "381";
  if (syntax === "CII" && type === "schlussrechnung")     return "877";
  if (syntax === "CII" && type === "teilschlussrechnung") return "876";
  return "380";
}

/** Ist der Code in dieser Syntax überhaupt zulässig? */
function isValidDocumentTypeCode(code, syntax) {
  const e = UNTDID_1001[String(code)];
  return !!e && (!syntax || e.syntaxes.includes(syntax));
}

// ── UNTDID 5305 — Umsatzsteuerkategorie (BT-95/BT-102/BT-118/BT-151) ─────────
//
// `requiresReason` und `zeroRate` sind keine Doku, sondern werden vom
// Validator gelesen. Vorher lag dieselbe Information dreifach: als erlaubte
// Menge in `services_einvoice_data.js`, als Standardtext ebendort und als
// Regeltabelle im Validator. Die Standardtexte weichen sonst irgendwann
// voneinander ab, und zwar still.
//
// ACHTUNG: Die Regelcodes BR-G-* und BR-IC-* sowie die Zuordnung der
// -02/-03-Varianten sind nicht gegen den KoSIT-Katalog gegengeprüft
// (Befund R7 aus dem Audit vom 25.08.2026, unverändert übernommen).

/**
 * @typedef {{
 *   code:string, labelDe:string, hintDe:string, zeroRate:boolean,
 *   requiresReason:boolean, defaultReasonDe:string|null,
 *   rateRule:string|null, reasonRule:string|null,
 *   sellerVatRule?:string, buyerVatRule?:string
 * }} VatCategory
 */

/** @type {Record<string, VatCategory>} */
const UNTDID_5305 = {
  S: {
    code: "S", labelDe: "Regelsteuersatz", hintDe: "",
    zeroRate: false, requiresReason: false, defaultReasonDe: null,
    rateRule: "BR-S-02", reasonRule: null,
  },
  Z: {
    code: "Z", labelDe: "Nullsatz", hintDe: "",
    zeroRate: true, requiresReason: false, defaultReasonDe: null,
    rateRule: "BR-Z-01", reasonRule: null,
  },
  E: {
    code: "E", labelDe: "Steuerbefreit", hintDe: "",
    zeroRate: true, requiresReason: true,
    defaultReasonDe: "Steuerbefreite Leistung",
    rateRule: "BR-E-01", reasonRule: "BR-E-10",
  },
  AE: {
    code: "AE", labelDe: "Reverse Charge", hintDe: "§13b UStG",
    zeroRate: true, requiresReason: true,
    defaultReasonDe: "Steuerschuldnerschaft des Leistungsempfängers gem. §13b UStG",
    rateRule: "BR-AE-01", reasonRule: "BR-AE-10",
    sellerVatRule: "BR-AE-02", buyerVatRule: "BR-AE-03",
  },
  K: {
    code: "K", labelDe: "Innergemeinschaftlich", hintDe: "EU-Lieferung",
    zeroRate: true, requiresReason: true,
    defaultReasonDe: "Innergemeinschaftliche Lieferung — steuerfrei nach §6a UStG",
    rateRule: "BR-IC-01", reasonRule: "BR-IC-10",
    sellerVatRule: "BR-IC-02", buyerVatRule: "BR-IC-03",
  },
  G: {
    code: "G", labelDe: "Ausfuhrlieferung", hintDe: "Drittland",
    zeroRate: true, requiresReason: true,
    defaultReasonDe: "Ausfuhrlieferung — steuerfrei nach §6 UStG",
    rateRule: "BR-G-01", reasonRule: "BR-G-10",
  },
  O: {
    code: "O", labelDe: "Nicht steuerbar", hintDe: "z.B. §19 Kleinunternehmer",
    zeroRate: true, requiresReason: true,
    defaultReasonDe: "Kein Ausweis von Umsatzsteuer gem. §19 UStG (Kleinunternehmer)",
    rateRule: "BR-O-01", reasonRule: "BR-O-10",
  },
};

const VAT_CATEGORY_CODES = Object.keys(UNTDID_5305);

function isValidVatCategory(code) {
  return Object.prototype.hasOwnProperty.call(UNTDID_5305, String(code || "").toUpperCase());
}

/**
 * Kategorie normalisieren. Unbekanntes fällt nicht durch, sondern auf die
 * Kategorie zurück, die der Steuersatz nahelegt — dieselbe Regel wie bisher
 * in `services_einvoice_data.js`, nur an einer Stelle.
 */
function normalizeVatCategory(raw, vatPercent) {
  const v = String(raw || "").trim().toUpperCase();
  if (isValidVatCategory(v)) return v;
  return Number(vatPercent) > 0 ? "S" : "Z";
}

/** Standard-Befreiungsgrund (BT-120) zur Kategorie, sofern die Norm einen verlangt. */
function defaultExemptionReason(code) {
  return UNTDID_5305[String(code || "").toUpperCase()]?.defaultReasonDe ?? null;
}

// ── UNTDID 4461 — Zahlungsart (BT-81) ────────────────────────────────────────
const UNTDID_4461 = {
  "30": { code: "30", labelDe: "Überweisung" },
  "58": { code: "58", labelDe: "SEPA-Überweisung" },
  "59": { code: "59", labelDe: "SEPA-Lastschrift" },
};
/** Rückfall, wenn ein Beleg keine Zahlungsart trägt — so war es bis 09/2026 fest verdrahtet. */
const PAYMENT_MEANS_SEPA_CREDIT_TRANSFER = "58";

/**
 * Codes, für die plan&simple einen vollständigen BG-16-Block erzeugen kann.
 *
 * 59 (SEPA-Lastschrift) fehlt hier mit Absicht: die Norm verlangt dafür BG-19
 * mit Mandatsreferenz (BT-89) und belastetem Konto (BT-91). Beides erfasst
 * plan&simple nicht. Ein Beleg mit 59 würde ein XML erzeugen, das jeder
 * Prüfdienst zurückweist — deshalb bricht die Erzeugung lieber vorher ab.
 */
const PAYMENT_MEANS_SUPPORTED = new Set(["30", "58"]);

/** Gültiger UNTDID-4461-Code oder null. */
function normalizePaymentMeansCode(code) {
  const c = String(code ?? "").trim();
  return Object.prototype.hasOwnProperty.call(UNTDID_4461, c) ? c : null;
}

// ── UNTDID 4451 — Notenzweck (BT-21) ─────────────────────────────────────────
const UNTDID_4451 = {
  REG: { code: "REG", labelDe: "Regulatorische Angaben zum Verkäufer" },
  PMT: { code: "PMT", labelDe: "Zahlungsinformationen" },
};
const NOTE_SUBJECT_SELLER_REGISTRATION = "REG";
/** Die von der XRechnung-FAQ vorgesehene Stelle für Sicherheitseinbehalte. */
const NOTE_SUBJECT_PAYMENT_INFORMATION = "PMT";

// ── UN/ECE Rec. 20 — Mengeneinheit (BT-130/BT-150) ───────────────────────────
const UNECE_REC20 = {
  HUR: { code: "HUR", labelDe: "Stunde" },
  LS:  { code: "LS",  labelDe: "Pauschale" },
  C62: { code: "C62", labelDe: "Stück (Einheit)" },
};
const UNIT_HOUR      = "HUR";
const UNIT_LUMP_SUM  = "LS";
const UNIT_PIECE     = "C62";

function isValidUnitCode(code) {
  return Object.prototype.hasOwnProperty.call(UNECE_REC20, String(code || ""));
}

// ── ISO-Formate ──────────────────────────────────────────────────────────────
// Bewusst nur Formprüfung, keine vollständige Liste: die Werte stammen aus
// den eigenen Stammdaten (COUNTRY.ABBR, CURRENCY.ABBR), nicht aus Fremdeingabe.
const isIso4217 = (v) => /^[A-Z]{3}$/.test(String(v ?? "").trim());
const isIso3166 = (v) => /^[A-Z]{2}$/.test(String(v ?? "").trim());

module.exports = {
  UNTDID_1001, documentTypeCode, isValidDocumentTypeCode,
  UNTDID_5305, VAT_CATEGORY_CODES, isValidVatCategory, normalizeVatCategory, defaultExemptionReason,
  UNTDID_4461, PAYMENT_MEANS_SEPA_CREDIT_TRANSFER, PAYMENT_MEANS_SUPPORTED, normalizePaymentMeansCode,
  UNTDID_4451, NOTE_SUBJECT_SELLER_REGISTRATION, NOTE_SUBJECT_PAYMENT_INFORMATION,
  UNECE_REC20, UNIT_HOUR, UNIT_LUMP_SUM, UNIT_PIECE, isValidUnitCode,
  isIso4217, isIso3166,
};
