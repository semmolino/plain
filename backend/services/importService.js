"use strict";

/**
 * importService — Geführter Datenimport (Phase 0 Fundament + Domäne 'address').
 *
 * Ablauf je Domäne (siehe docs/DATA_IMPORT_CONCEPT.md):
 *   parseBuffer → buildAutoMapping → buildPreview (Trockenlauf, kein Schreiben)
 *   → commit (legt IMPORT_BATCH an, schreibt nur gültige Zeilen)
 *   → rollback (löscht Zeilen eines Stapels, blockiert wenn Live-Daten anhängen)
 *
 * Reine (supabase-freie) Funktionen sind exportiert und per Jest testbar:
 *   parseBuffer, buildAutoMapping, buildPreview, normHeader, norm.
 */

const ExcelJS = require("exceljs");
const { readTable } = require("./spreadsheet");
// Honorartafel-Interpolation — dieselbe Rechnung wie im Kalkulations-Wizard.
const stammdatenSvc = require("./stammdaten");
// Rollenwechsel beendet laufende Sitzungen — siehe Sicherheitsmodell.
const { revokeSessions } = require("../middleware/sessionGuard");
const { contractDefaults } = require("./contractDefaults");
// Phase 3: Anfangsbestände werden über die bewährten Beleg-Services gebucht
// (init → Struktur → book(skipDocuments)) statt von Hand geschrieben.
const ppSvc = require("./partialPayments");
const invSvc = require("./invoices");
const { insertProgressSnapshot } = require("./projectProgress");
const { recomputeStructure } = require("./buchungen");
// recalcParent: Elternwerte aus den Kindern — dieselbe Rechnung wie im Wizard.
const projekteSvc = require("./projekte");
const { belegSummen } = require("./belegRechnung");
const { bumpNumberRanges } = require("./numberRangeBump");

// ── Helpers ──────────────────────────────────────────────────────────────────
/** String-Wert sicher trimmen (null/undefined → ""). */
function s(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
/**
 * Platzhalter fuer "kein Wert" aus einem Datenbank-Export → leer.
 *
 * SQL Server schreibt eine leere Zelle beim CSV-Export als das WORT "NULL".
 * Im wiko-Projektexport waren das 78.086 Zellen. Ohne diese Stelle hiesse jede
 * zweite Bezeichnung "NULL", jeder fehlende Status waere ein unbekannter
 * Status, und eine Projektzeile ohne Gliederung waere ein Strukturknoten
 * namens "NULL" — also genau kein Projekt.
 *
 * Bewusst hier und nicht im CSV-Leser: derselbe Export kommt auch als XLSX,
 * und dort steht das Wort genauso in der Zelle.
 *
 * "NULL" als echten Wert zu verlieren ist der Preis. In den Feldern, um die es
 * geht (Namen, Kuerzel, Betraege, Datumsangaben), ist das kein Verlust.
 */
function leerwert(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return (t === "NULL" || t === "(null)") ? "" : v;
}
/** Vergleichs-Normalisierung von Werten (Dubletten-Schlüssel). */
function norm(v) {
  return s(v).toLowerCase().replace(/\s+/g, " ").trim();
}
/**
 * Schlüssel für den Abgleich eines Katalog-NAMENS (Abteilung,
 * Arbeitszeitmodell, Berechtigungsrolle) zwischen Datei und Bestand.
 *
 * Bewusst unempfindlich gegen Satzzeichen und Leerraum: gepflegt ist
 * "40h-Woche", in der Datei steht "40 h Woche" — fachlich dasselbe, und ein
 * "gibt es nicht" wäre hier nur formale Strenge. Für Dubletten-Schlüssel gilt
 * das NICHT, dort bleibt es bei norm(): zwei Adressen dürfen sich in einem
 * Bindestrich unterscheiden.
 */
function katalogKey(v) {
  return s(v).toLowerCase().replace(/[^a-z0-9äöüß]/gi, "");
}
/** Spaltenüberschrift normalisieren (nur Buchstaben/Ziffern) für Auto-Mapping. */
function normHeader(h) {
  return s(h).toLowerCase().replace(/[^a-z0-9]/gi, "");
}
/** Datum aus DE-/ISO-Schreibweise → 'YYYY-MM-DD'. {invalid:true} wenn nicht parsebar. */
function parseDateISO(v) {
  let t = s(v);
  if (!t) return { value: null };
  // Exporte aus Altsystemen liefern Datumswerte oft als TEXT mit Uhrzeit
  // ("2000-01-01 00:00:00.000", "01.02.2020 00:00", "2020-02-01T00:00:00Z").
  // Die Uhrzeit ist dabei ohne Aussage — sie steht auf Mitternacht, weil die
  // Quelle einen Zeitstempel-Typ benutzt. Echte Excel-Datumszellen kommen
  // bereits als reiner ISO-Text an (spreadsheet.js), Textzellen nicht.
  //
  // Ohne diesen Schnitt fiel jede solche Zelle als "nicht erkannt" durch: der
  // Import legte Mitarbeiter ohne Eintrittsdatum an und sagte es nur als
  // Warnung, die in 999 Zeilen niemand liest (wiko-Uebernahme 09/2026).
  t = t.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i, "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { value: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` };
  m = t.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (m) return { value: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` };
  return { value: null, invalid: true };
}
// Eine Datumszelle kommt als ISO-Text an (spreadsheet.js wandelt sie so um).
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hinweistext fuer eine Zahl, die als Datum ankam — mit dem Weg hinaus.
 * Der Wert selbst laesst sich nicht zurueckrechnen: "10.03" und "10.3"
 * ergeben beide den 10. Maerz, sind als Prozentwert aber verschieden. Raten
 * waere hier schlimmer als die Luecke, deshalb sagt der Import nur, was
 * passiert ist.
 */
function datumStattZahlHinweis(feld, rohwert) {
  return `${feld}: „${rohwert}" ist ein Datum. Vermutlich wurde die CSV in Excel geöffnet — dort wird z. B. 10.03 zum 10. März. Lade die CSV direkt hoch (der Import liest sie) oder formatiere die Spalte vor dem Öffnen als Text.`;
}

/** Währungsbetrag (DE/EN) → Zahl. Komma = Dezimaltrenner; reine 1.234.567-Gruppen = Tausender. */
function parseAmountDE(v) {
  // Echte Zahlenzelle: unverändert übernehmen. Der Umweg über den Text würde
  // aus 1.234 (ein Komma-Wert) eine Tausendergruppe machen → 1234.
  if (typeof v === "number") return Number.isFinite(v) ? { value: fmt2(v) } : { value: null, invalid: true };
  let t = s(v).replace(/[€\s]/g, "");
  if (!t) return { value: null };
  // Ein Datum in einem Zahlenfeld ist fast immer dieselbe Geschichte: die CSV
  // wurde in Excel geoeffnet, und dort liest die deutsche Einstellung "10.03"
  // als 10. Maerz. Gespeichert als .xlsx kommt bei uns eine Datumszelle an.
  // Ohne diesen Zweig meldet der Import nur "keine Zahl" — richtig, aber
  // unbrauchbar: niemand kommt von da auf Excel.
  if (ISO_DATUM.test(t)) return { value: null, invalid: true, warDatum: true };
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  if (!Number.isFinite(n)) return { value: null, invalid: true };
  return { value: Math.round(n * 100) / 100 };
}
/** kaufmännisch auf 2 Nachkommastellen runden. */
function fmt2(n) { return Math.round(n * 100) / 100; }
/** Zahl sicher coercen (NaN/null → 0). */
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
/** „Ja/Wahr“-artige Werte → true (für Flags wie Hauptkontakt). Leer/unklar → false. */
function parseBool(v) {
  const t = norm(v);
  if (!t) return false;
  return ["1", "ja", "j", "x", "true", "wahr", "yes", "y", "primär", "primar", "haupt", "hauptkontakt", "standard"].includes(t);
}

// Fester Katalog der Adress-Kategorien (spiegelt Migration 0099 / ADDRESS_TYPE
// bzw. ADDRESS_TYPES in stammdaten.ts). Text/Zahl → Code, tolerant gegenüber
// Schreibweisen; unbekannt → null (Feld bleibt leer, Zeile bleibt importierbar).
const ADDRESS_TYPE_ALIASES = [
  { code: 1, label: "Kunde / Bauherr", aliases: ["kunde / bauherr", "kunde/bauherr", "kunde", "bauherr", "auftraggeber", "client", "1"] },
  { code: 2, label: "Fachplaner",      aliases: ["fachplaner", "planer", "2"] },
  { code: 3, label: "Behörde",         aliases: ["behörde", "behoerde", "amt", "authority", "3"] },
  { code: 4, label: "Nachunternehmer", aliases: ["nachunternehmer", "subunternehmer", "nachunternehmen", "nu", "sub", "4"] },
  { code: 5, label: "Lieferant",       aliases: ["lieferant", "supplier", "5"] },
  { code: 6, label: "Sonstige",        aliases: ["sonstige", "sonstiges", "andere", "other", "6"] },
];
const addressTypeByText = new Map();
for (const t of ADDRESS_TYPE_ALIASES) for (const a of t.aliases) addressTypeByText.set(norm(a), t.code);

// ── Domänen-Registry ─────────────────────────────────────────────────────────
// Jede Domäne: table, fields (key/header/required/example/aliases), dependents
// (Tabellen, die Zeilen referenzieren → blockieren Rollback), loadContext (lädt
// Lookups + Bestand für Dubletten), buildEntry (mapped-Row → {ok,messages,dbRow,
// matchKey,display}).

const ADDRESS_FIELDS = [
  { key: "address_name_1",   header: "Name 1 (Firma/Nachname)", required: true,  example: "Mustermann Architekten GmbH", aliases: ["name", "name1", "firma", "company", "adressname", "nachname"] },
  { key: "address_name_2",   header: "Name 2 (Zusatz)",         required: false, example: "z. Hd. Herr Muster",          aliases: ["name2", "zusatz", "namenszusatz", "adresszusatz"] },
  { key: "address_type",     header: "Kategorie",                required: false, example: "Kunde / Bauherr",            aliases: ["kategorie", "typ", "art", "adresstyp", "adressart", "addresstype", "category", "gruppe"] , list: "addressType" },
  { key: "street",           header: "Straße",                   required: false, example: "Musterstraße 12",            aliases: ["strasse", "street", "adresse"] },
  { key: "post_code",        header: "PLZ",                      required: false, example: "10115",                      aliases: ["plz", "postleitzahl", "postcode", "zip"] , type: "text" },
  { key: "city",             header: "Ort",                      required: false, example: "Berlin",                     aliases: ["ort", "stadt", "city"] },
  { key: "post_office_box",  header: "Postfach",                 required: false, example: "",                           aliases: ["postfach", "pob", "postbox"] },
  { key: "country",          header: "Land",                     required: false, example: "Deutschland",                aliases: ["land", "country", "staat"] , list: "country" },
  { key: "customer_number",  header: "Kundennummer",             required: false, example: "K-1001",                     aliases: ["kundennummer", "kundennr", "kundenr", "customer", "customernumber"] , type: "text" },
  { key: "tax_id",           header: "USt-IdNr.",                required: false, example: "DE123456789",                aliases: ["ustid", "ustidnr", "umsatzsteuer", "vat", "vatid", "taxid"] , type: "text" },
  { key: "tax_number",       header: "Steuernummer",             required: false, example: "12/345/67890",               aliases: ["steuernummer", "steuernr", "stnr", "taxnumber"] , type: "text" },
  { key: "buyer_reference",  header: "Leitweg-ID",               required: false, example: "",                           aliases: ["leitweg", "leitwegid", "buyerreference", "kaeuferreferenz"] , type: "text" },
  { key: "phone",            header: "Telefon",                  required: false, example: "+49 30 1234567",             aliases: ["telefon", "tel", "phone", "festnetz", "telefonnummer"] , type: "text" },
  { key: "email",            header: "E-Mail",                   required: false, example: "info@buero.de",              aliases: ["email", "mail", "emailadresse", "mailadresse"] },
  { key: "website",          header: "Webseite",                 required: false, example: "www.buero.de",               aliases: ["website", "webseite", "web", "homepage", "url", "internet"] },
  { key: "notes",            header: "Notizen",                  required: false, example: "",                           aliases: ["notizen", "notiz", "bemerkung", "bemerkungen", "anmerkung", "kommentar", "notes"] },
];

async function loadAddressContext(supabase, tenantId) {
  // Länder (global, kein TENANT_ID) → Name/Kürzel → ID; Default = Deutschland.
  const { data: countries } = await supabase.from("COUNTRY").select("ID, NAME, ABBR");
  const byName = new Map();
  let def = null;
  for (const c of countries || []) {
    const nl = norm(c.NAME), ns = norm(c.ABBR);
    if (nl) byName.set(nl, c.ID);
    if (ns) byName.set(ns, c.ID);
    if (nl === "deutschland" || nl === "germany" || ns === "de" || ns === "ger") def = c.ID;
  }

  // Bestand für Dubletten-Erkennung: Name 1 + PLZ.
  const existingKeys = new Set();
  const existingIds = new Map();          // Schlüssel → ID, für „zusammenführen"
  const { data: addrs } = await supabase
    .from("ADDRESS").select("ID, ADDRESS_NAME_1, POST_CODE").eq("TENANT_ID", tenantId).limit(100000);
  for (const a of addrs || []) {
    const key = norm(a.ADDRESS_NAME_1) + "|" + norm(a.POST_CODE);
    existingKeys.add(key);
    if (!existingIds.has(key)) existingIds.set(key, a.ID);
  }

  return { countries: { byName, default: def }, existingKeys, existingIds };
}

function buildAddressEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const name1 = s(mapped.address_name_1);
  if (!name1) { messages.push({ level: "error", text: "Name 1 fehlt (Pflichtfeld)" }); ok = false; }

  // Land auflösen: leer → Standardland; gesetzt → exakter Treffer, sonst Fehler.
  let countryId = null;
  const cin = s(mapped.country);
  if (!cin) {
    if (ctx.countries.default != null) countryId = ctx.countries.default;
    else { messages.push({ level: "error", text: "Land fehlt und kein Standardland verfügbar" }); ok = false; }
  } else {
    const found = ctx.countries.byName.get(norm(cin));
    if (found != null) countryId = found;
    else { messages.push({ level: "error", text: `Land „${cin}“ nicht gefunden` }); ok = false; }
  }

  // Kategorie (optional, fester Katalog): unbekannt → Warnung, Feld bleibt leer.
  let addressType = null;
  const atin = s(mapped.address_type);
  if (atin) {
    const hit = addressTypeByText.get(norm(atin));
    if (hit != null) addressType = hit;
    else messages.push({ level: "warn", text: `Kategorie „${atin}“ nicht erkannt — bleibt leer (z. B. Kunde/Bauherr, Fachplaner, Behörde, Nachunternehmer, Lieferant, Sonstige)` });
  }

  const email = s(mapped.email);
  if (email && !email.includes("@")) messages.push({ level: "warn", text: "E-Mail sieht ungültig aus (kein @)" });

  const dbRow = {
    ADDRESS_NAME_1:  name1 || null,
    ADDRESS_NAME_2:  s(mapped.address_name_2) || null,
    ADDRESS_TYPE:    addressType,
    STREET:          s(mapped.street) || null,
    POST_CODE:       s(mapped.post_code) || null,
    CITY:            s(mapped.city) || null,
    POST_OFFICE_BOX: s(mapped.post_office_box) || null,
    COUNTRY_ID:      countryId,
    CUSTOMER_NUMBER: s(mapped.customer_number) || null,
    "TAX-ID":        s(mapped.tax_id) || null,
    TAX_NUMBER:      s(mapped.tax_number) || null,
    BUYER_REFERENCE: s(mapped.buyer_reference) || null,
    PHONE:           s(mapped.phone) || null,
    EMAIL:           email || null,
    WEBSITE:         s(mapped.website) || null,
    NOTES:           s(mapped.notes) || null,
  };

  const matchKey = norm(name1) + "|" + norm(mapped.post_code);
  const catLabel = addressType != null ? (ADDRESS_TYPE_ALIASES.find((t) => t.code === addressType)?.label || "") : "";
  const display = {
    name_1: name1, name_2: dbRow.ADDRESS_NAME_2, category: catLabel, street: dbRow.STREET,
    post_code: dbRow.POST_CODE, city: dbRow.CITY, country: cin || "Deutschland",
  };
  return { ok, messages, dbRow, matchKey, display };
}

// ── Domäne: Mitarbeiter ──────────────────────────────────────────────────────
// Reihenfolge = Spaltenreihenfolge der Vorlage. Telefon steht VOR Mobil: in
// einer Altdatei mit der alten Sammelspalte „Telefon/Mobil" greift deren Alias
// auf dem Mobil-Feld, eine reine „Telefon"-Spalte landet dagegen im Festnetz.
const EMPLOYEE_FIELDS = [
  { key: "abbr",             header: "Kürzel",                required: true,  example: "MMu",               aliases: ["kuerzel", "kurzzeichen", "shortname", "initialen", "krzl"] },
  { key: "first_name",       header: "Vorname",               required: true,  example: "Maria",             aliases: ["vorname", "firstname"] },
  { key: "last_name",        header: "Nachname",              required: true,  example: "Muster",            aliases: ["nachname", "name", "lastname", "familienname", "surname"] },
  { key: "gender",           header: "Geschlecht",            required: true,  example: "weiblich",          aliases: ["geschlecht", "gender"] , list: "gender" },
  { key: "title",            header: "Titel",                 required: false, example: "Dipl.-Ing.",        aliases: ["titel", "title"] },
  { key: "email",            header: "E-Mail",                required: false, example: "m.muster@buero.de", aliases: ["email", "mail", "emailadresse", "mailadresse"] },
  { key: "phone",            header: "Telefon",               required: false, example: "+49 30 1234567",    aliases: ["telefon", "festnetz", "festnetznummer", "telefonnummer", "tel", "landline"] , type: "text" },
  { key: "mobile",           header: "Mobil",                 required: false, example: "+49 170 1234567",   aliases: ["mobil", "mobile", "handy", "mobilnummer", "mobiltelefon", "telefonmobil"] , type: "text" },
  { key: "personnel_number", header: "Personalnummer",        required: false, example: "P-001",             aliases: ["personalnummer", "persnr", "personalnr", "personnelnumber", "mitarbeiternummer", "pnr"] , type: "text" },
  { key: "supervisor",       header: "Vorgesetzter (Kürzel)", required: false, example: "SF",                aliases: ["vorgesetzter", "vorgesetzte", "vorgesetztekuerzel", "chef", "supervisor", "manager", "leitung", "teamleiter"] , list: "employeeShort" },
  { key: "entry_date",       header: "Eintrittsdatum",        required: false, example: "2022-03-01",        aliases: ["eintritt", "eintrittsdatum", "entrydate", "startdatum", "eingestelltam"] , type: "date" },
  { key: "exit_date",        header: "Austrittsdatum",        required: false, example: "",                  aliases: ["austritt", "austrittsdatum", "exitdate"] , type: "date" },
  { key: "birth_date",       header: "Geburtstag",            required: false, example: "1985-04-23",        aliases: ["geburtstag", "geburtsdatum", "gebdatum", "geburt", "birthday", "birthdate"] , type: "date" },
  { key: "status",           header: "Status (Aktiv/Inaktiv)", required: true, example: "Aktiv",             aliases: ["status", "aktiv", "aktivinaktiv", "active", "zustand", "beschaeftigungsstatus"] , list: "employeeStatus" },
  { key: "department",       header: "Abteilung",             required: false, example: "Hochbau",           aliases: ["abteilung", "department", "bereich", "team"] , list: "department" },
  { key: "cost_rate_valid_from", header: "Gültigkeitsdatum Kostensatz", required: false, example: "2023-01-01", aliases: ["gueltigkeitsdatumkostensatz", "kostensatzgueltigab", "gueltigabkostensatz", "kostensatzdatum", "kostensatzab"] , type: "date" },
  { key: "cost_rate",        header: "Kostensatz",            required: false, example: "62,50",             aliases: ["kostensatz", "kosten", "cprate", "costrate", "stundenkosten", "kostenstundensatz"] , type: "money" },
  { key: "work_model_valid_from", header: "Gültigkeitsdatum Arbeitszeitmodell", required: false, example: "2023-01-01", aliases: ["gueltigkeitsdatumarbeitszeitmodell", "arbeitszeitmodellgueltigab", "gueltigabarbeitszeitmodell", "arbeitszeitmodelldatum", "arbeitszeitab"] , type: "date" },
  { key: "work_model",       header: "Arbeitszeitmodell",     required: false, example: "40h-Woche",         aliases: ["arbeitszeitmodell", "arbeitszeit", "zeitmodell", "workmodel", "wochenmodell"] , list: "workModel" },
  { key: "role",             header: "Berechtigungsrolle",    required: false, example: "Projektleiter",     aliases: ["berechtigungsrolle", "rolle", "role", "berechtigung", "benutzerrolle", "userrole", "zugriffsrolle"] , list: "userRole" },
  { key: "notes",            header: "Notiz",                 required: false, example: "",                  aliases: ["notiz", "notizen", "bemerkung", "bemerkungen", "anmerkung", "kommentar", "notes"] },
];

/**
 * „Aktiv"/„Inaktiv" → EMPLOYEE.ACTIVE. Unbekanntes bleibt null → Fehlerzeile.
 *
 * ACHTUNG, 2 IST DAS INAKTIV — NICHT 0.
 *   Das ganze Produkt prüft auf `ACTIVE === 2` bzw. `neq("ACTIVE", 2)`:
 *   Login (routes/auth.js), Sitzungswächter (middleware/sessionGuard.js),
 *   Lizenzplätze (middleware/limits.js) und die Oberfläche. Alles andere —
 *   auch die 0 und auch NULL — gilt als aktiv, denn Altdaten ohne gesetztes
 *   ACTIVE sollen benutzbar bleiben.
 *
 *   Die erste Fassung dieses Imports schrieb 0 für „Inaktiv". Das sah in der
 *   Liste nur nach einem hässlichen Dropdown aus, war aber mehr: die
 *   Ausgeschiedenen hätten sich weiter anmelden können und Lizenzplätze
 *   belegt (wiko-Übernahme 09/2026).
 */
const EMP_AKTIV = 1;
const EMP_INAKTIV = 2;

function parseEmployeeStatus(v) {
  const t = norm(v);
  if (!t) return null;
  if (["aktiv", "active", "ja", "j", "1", "wahr", "true", "x", "beschaeftigt", "angestellt"].includes(t)) return EMP_AKTIV;
  if (["inaktiv", "nichtaktiv", "inactive", "nein", "n", "0", "2", "falsch", "false", "ausgeschieden", "gesperrt"].includes(t)) return EMP_INAKTIV;
  return null;
}
async function loadEmployeeContext(supabase, tenantId) {
  // Geschlecht (global, kein TENANT_ID): Name/Kurzform → ID. Default = neutrales
  // Geschlecht (divers/keine Angabe), falls vorhanden.
  const { data: genders } = await supabase.from("GENDER").select("ID, GENDER");
  const byName = new Map();
  const byId = new Map();
  let def = null;
  for (const g of genders || []) {
    const t = norm(g.GENDER);
    byId.set(g.ID, g.GENDER);
    if (t) byName.set(t, g.ID);
    if (t.startsWith("männ") || t.startsWith("maen") || t === "m") {
      byName.set("m", g.ID); byName.set("männlich", g.ID); byName.set("maennlich", g.ID); byName.set("herr", g.ID);
    }
    if (t.startsWith("weib") || t === "w") {
      byName.set("w", g.ID); byName.set("weiblich", g.ID); byName.set("frau", g.ID);
    }
    if (t.startsWith("div") || t === "d") {
      byName.set("d", g.ID); byName.set("divers", g.ID); def = g.ID;
    }
    if (t.includes("keine") || t.includes("unbekannt") || t.includes("angabe")) def = g.ID;
  }

  // Bestand für Dubletten: pro Mitarbeiter mehrere Schlüssel (Mail/Kürzel/Pers.-Nr.)
  const existingKeys = new Set();
  const existingIds = new Map();
  const empIdByAbbr = new Map();          // für den Vorgesetzten aus dem Bestand

  // Abteilungen, Arbeitszeitmodelle und Berechtigungsrollen. Alle drei werden
  // über ihren NAMEN aus der Datei aufgelöst — deshalb hier einmal laden statt
  // je Zeile zu fragen (999 Zeilen = 999 Abfragen).
  const [empsRes, deptRes, wtmRes, roleRes, empRoleRes] = await Promise.all([
    supabase.from("EMPLOYEE").select("ID, ABBR, MAIL, PERSONNEL_NUMBER").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("DEPARTMENT").select("ID, ABBR, NAME").eq("TENANT_ID", tenantId).limit(10000),
    supabase.from("WORKING_TIME_MODEL").select("ID, NAME").eq("TENANT_ID", tenantId).limit(10000),
    supabase.from("USER_ROLE").select("ID, ABBR, NAME").eq("TENANT_ID", tenantId).limit(10000),
    // Bestehende Zuordnungen. EMPLOYEE_ROLE hat einen zusammengesetzten
    // Primärschlüssel (EMPLOYEE_ID, ROLE_ID) — beim Zusammenführen würde ein
    // erneutes Einfügen derselben Paarung den ganzen Import abbrechen lassen.
    supabase.from("EMPLOYEE_ROLE").select("EMPLOYEE_ID, ROLE_ID").limit(100000),
  ]);

  for (const e of empsRes.data || []) {
    const keys = [];
    if (e.MAIL) keys.push("mail:" + norm(e.MAIL));
    if (e.ABBR) keys.push("short:" + norm(e.ABBR));
    if (e.PERSONNEL_NUMBER) keys.push("pnr:" + norm(e.PERSONNEL_NUMBER));
    for (const k of keys) { existingKeys.add(k); if (!existingIds.has(k)) existingIds.set(k, e.ID); }
    if (e.ABBR && !empIdByAbbr.has(norm(e.ABBR))) empIdByAbbr.set(norm(e.ABBR), e.ID);
  }

  // Kürzel UND Name als Schlüssel: welche Spalte der Kunde in seine Datei
  // schreibt, ist nicht vorhersagbar — „HB" und „Hochbau" meinen dasselbe.
  const nachNamen = (rows, spalten) => {
    const m = new Map();
    for (const r of rows || []) {
      for (const sp of spalten) {
        const k = katalogKey(r[sp]);
        if (k && !m.has(k)) m.set(k, r.ID);
      }
    }
    return m;
  };

  const vorhandeneRollen = new Set((empRoleRes.data || []).map((r) => r.EMPLOYEE_ID + ":" + r.ROLE_ID));

  return {
    genders: { byName, byId, default: def },
    vorhandeneRollen,
    departments: nachNamen(deptRes.data, ["NAME", "ABBR"]),
    workModels:  nachNamen(wtmRes.data,  ["NAME"]),
    userRoles:   nachNamen(roleRes.data, ["ABBR", "NAME"]),
    empIdByAbbr,
    existingKeys, existingIds,
  };
}

function buildEmployeeEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const short = s(mapped.abbr);
  const first = s(mapped.first_name);
  const last  = s(mapped.last_name);
  if (!short) { messages.push({ level: "error", text: "Kürzel fehlt (Pflichtfeld)" }); ok = false; }
  if (!first) { messages.push({ level: "error", text: "Vorname fehlt (Pflichtfeld)" }); ok = false; }
  if (!last)  { messages.push({ level: "error", text: "Nachname fehlt (Pflichtfeld)" }); ok = false; }

  // Geschlecht (Pflicht, FK auf GENDER). Nur die drei gepflegten Werte samt
  // ihrer Kurzformen — KEINE Zahlencodes. Ein Export, der 0/1 liefert, meint
  // damit seine eigene Nummerierung: in plan&simple ist die 1 "männlich", in
  // wiko "weiblich". Eine stillschweigende Zuordnung säße danach in jeder
  // Anrede auf Briefen und Rechnungen, ohne dass es jemand bemerkt.
  let genderId = null;
  const gin = s(mapped.gender);
  if (!gin) {
    if (ctx.genders.default != null) genderId = ctx.genders.default;
    else { messages.push({ level: "error", text: "Geschlecht fehlt (Pflichtfeld)" }); ok = false; }
  } else {
    const found = ctx.genders.byName.get(norm(gin));
    if (found != null) genderId = found;
    else {
      const zahl = /^[0-9]+$/.test(norm(gin));
      messages.push({ level: "error", text: zahl
        ? `Geschlecht „${gin}“ ist ein Zahlencode — erlaubt sind nur: männlich, weiblich, divers`
        : `Geschlecht „${gin}“ nicht erkannt — erlaubt sind: männlich, weiblich, divers` });
      ok = false;
    }
  }

  // Status (Pflicht): steuert EMPLOYEE.ACTIVE. Ein Ausgeschiedener soll sich
  // nicht mehr anmelden können — deshalb kein stiller Vorgabewert.
  const statusIn = s(mapped.status);
  const active = parseEmployeeStatus(statusIn);
  if (active === null) {
    messages.push({ level: "error", text: statusIn
      ? `Status „${statusIn}“ nicht erkannt — erlaubt sind: Aktiv, Inaktiv`
      : "Status fehlt (Pflichtfeld: Aktiv oder Inaktiv)" });
    ok = false;
  }

  const email = s(mapped.email);
  if (email && !email.includes("@")) messages.push({ level: "warn", text: "E-Mail sieht ungültig aus (kein @)" });

  const entry = parseDateISO(mapped.entry_date);
  if (entry.invalid) messages.push({ level: "warn", text: "Eintrittsdatum nicht erkannt — übersprungen (Format JJJJ-MM-TT oder TT.MM.JJJJ)" });
  const exit = parseDateISO(mapped.exit_date);
  if (exit.invalid) messages.push({ level: "warn", text: "Austrittsdatum nicht erkannt — übersprungen" });
  const birth = parseDateISO(mapped.birth_date);
  if (birth.invalid) messages.push({ level: "warn", text: "Geburtstag nicht erkannt — übersprungen" });

  // ── Abteilung: unbekannte werden beim Import angelegt ─────────────────────
  // Eine Abteilung ist nur eine Bezeichnung. Arbeitszeitmodell und Rolle sind
  // es nicht — die tragen Regeln bzw. Rechte und entstehen deshalb nicht
  // nebenbei aus einer Tabellenzelle.
  const deptIn = s(mapped.department);
  let departmentId = null, departmentNew = null;
  if (deptIn) {
    const hit = ctx.departments.get(katalogKey(deptIn));
    if (hit != null) departmentId = hit;
    else { departmentNew = deptIn; messages.push({ level: "warn", text: `Abteilung „${deptIn}“ gibt es noch nicht — wird angelegt` }); }
  }

  // ── Kostensatz: Betrag UND Stichtag, sonst gar nicht ──────────────────────
  // Der Kostensatz ist eine Historie (EMPLOYEE_COST_RATE, gültig ab). Ohne
  // Datum ließe er sich nur an einem erfundenen Stichtag einhängen — und ein
  // erfundener Stichtag rechnet später still falsche Projektkosten.
  const rate = parseAmountDE(mapped.cost_rate);
  const rateFrom = parseDateISO(mapped.cost_rate_valid_from);
  let costRate = null;
  if (rate.invalid) messages.push({ level: "warn", text: "Kostensatz ist keine Zahl — wird nicht übernommen" });
  else if (rate.value != null && rateFrom.value) costRate = { value: rate.value, from: rateFrom.value };
  else if (rate.value != null && !rateFrom.value) messages.push({ level: "warn", text: "Kostensatz ohne Gültigkeitsdatum — wird nicht übernommen" });
  else if (rateFrom.value && rate.value == null) messages.push({ level: "warn", text: "Gültigkeitsdatum ohne Kostensatz — wird nicht übernommen" });

  // ── Arbeitszeitmodell: muss es geben, wird nicht angelegt ─────────────────
  const wmIn = s(mapped.work_model);
  const wmFrom = parseDateISO(mapped.work_model_valid_from);
  let workModel = null;
  if (wmIn) {
    const hit = ctx.workModels.get(katalogKey(wmIn));
    if (hit == null) messages.push({ level: "warn", text: `Arbeitszeitmodell „${wmIn}“ gibt es nicht — keine Zuordnung (anzulegen unter Einstellungen → Arbeitszeit)` });
    else if (!wmFrom.value) messages.push({ level: "warn", text: "Arbeitszeitmodell ohne Gültigkeitsdatum — keine Zuordnung" });
    else workModel = { modelId: hit, from: wmFrom.value };
  } else if (wmFrom.value) {
    messages.push({ level: "warn", text: "Gültigkeitsdatum ohne Arbeitszeitmodell — keine Zuordnung" });
  }

  // ── Berechtigungsrolle: muss es geben, wird nicht angelegt ────────────────
  // Eine Rolle aus dem Nichts hätte keine Rechte und sähe in der Verwaltung
  // aus wie eine gepflegte — wer sie vergibt, glaubt, er habe etwas erlaubt.
  const roleIn = s(mapped.role);
  let roleId = null;
  if (roleIn) {
    const hit = ctx.userRoles.get(katalogKey(roleIn));
    if (hit != null) roleId = hit;
    else messages.push({ level: "warn", text: `Berechtigungsrolle „${roleIn}“ gibt es nicht — nicht zugeordnet (anzulegen unter Einstellungen → Rollen)` });
  }

  // Vorgesetzter: hier nur merken. Ob das Kürzel trägt, entscheidet sich erst
  // über die ganze Datei — er darf weiter unten in derselben Liste stehen.
  const supervisorAbbr = s(mapped.supervisor) || null;

  const dbRow = {
    ABBR:             short || null,
    TITLE:            s(mapped.title) || null,
    FIRST_NAME:       first || null,
    LAST_NAME:        last || null,
    MAIL:             email || null,
    PHONE:            s(mapped.phone) || null,
    MOBILE:           s(mapped.mobile) || null,
    PERSONNEL_NUMBER: s(mapped.personnel_number) || null,
    GENDER_ID:        genderId,
    ENTRY_DATE:       entry.value,
    EXIT_DATE:        exit.value,
    BIRTH_DATE:       birth.value,
    NOTES:            s(mapped.notes) || null,
    DEPARTMENT_ID:    departmentId,
    ACTIVE:           active === null ? EMP_AKTIV : active,
  };

  const matchKey = [];
  if (email) matchKey.push("mail:" + norm(email));
  if (short) matchKey.push("short:" + norm(short));
  if (s(mapped.personnel_number)) matchKey.push("pnr:" + norm(mapped.personnel_number));

  const display = {
    abbr: short, first_name: first, last_name: last,
    gender: genderId != null ? (ctx.genders.byId.get(genderId) || gin) : gin, mail: email,
    status: active === null ? statusIn : (active === EMP_INAKTIV ? "Inaktiv" : "Aktiv"),
    department: deptIn || null,
    supervisor: supervisorAbbr,
    cost_rate: costRate ? `${costRate.value} € ab ${costRate.from}` : null,
    work_model: workModel ? `${wmIn} ab ${workModel.from}` : (wmIn || null),
    role: roleIn || null,
  };

  return {
    ok, messages, dbRow, matchKey, display,
    extra: { supervisorAbbr, departmentNew, costRate, workModel, roleId },
  };
}

/**
 * Vorgesetzte lassen sich erst beurteilen, wenn die ganze Datei gelesen ist:
 * das Kürzel darf auf einen Mitarbeiter WEITER UNTEN in derselben Liste zeigen
 * (ausdrücklicher Wunsch — sonst müsste die Datei nach Hierarchie sortiert
 * sein). Geschrieben wird die Verknüpfung deshalb erst im zweiten Durchgang
 * des Commits, wenn alle IDs feststehen — dasselbe Muster wie FATHER_ID beim
 * Projektbaum.
 */
function finalizeEmployeeRows(rows, ctx) {
  const inDatei = new Set();
  for (const r of rows) {
    const a = norm(r._dbRow?.ABBR);
    if (a) inDatei.add(a);
  }
  for (const r of rows) {
    const ex = r._extra;
    if (!ex?.supervisorAbbr) continue;
    const ziel = norm(ex.supervisorAbbr);
    if (ziel === norm(r._dbRow?.ABBR)) {
      r.messages.push({ level: "warn", text: "Vorgesetzter ist der Mitarbeiter selbst — bleibt leer" });
      ex.supervisorAbbr = null;
    } else if (!inDatei.has(ziel) && !ctx.empIdByAbbr.has(ziel)) {
      r.messages.push({ level: "warn", text: `Vorgesetzter „${ex.supervisorAbbr}“ nicht gefunden — weder im Bestand noch in dieser Datei; bleibt leer` });
      ex.supervisorAbbr = null;
    }
  }
}
/**
 * Mitarbeiter schreiben — eine Zeile der Datei wird zu bis zu fünf Zeilen in
 * der Datenbank: der Mitarbeiter selbst, sein Kostensatz, seine
 * Arbeitszeitmodell-Zuordnung, seine Berechtigungsrolle und ggf. eine neu
 * angelegte Abteilung.
 *
 * Reihenfolge ist nicht beliebig:
 *   1. Abteilungen — EMPLOYEE.DEPARTMENT_ID zeigt darauf
 *   2. Mitarbeiter  — anlegen oder (bei "zusammenführen") aktualisieren
 *   3. Vorgesetzte  — zweiter Durchgang, erst jetzt sind alle IDs bekannt
 *   4. Nebentabellen
 *
 * Alles Angelegte trägt die Stapel-Kennung (Migration 0165). Ohne sie würde
 * ein Zurücksetzen beim Zusammenführen die ALTE Kostensatz-Historie eines
 * bestehenden Mitarbeiters mitreißen.
 */
async function commitEmployeeRows(rows, { supabase, tenantId, batchId, ctx, options }) {
  const mode = options?.duplicateMode || "skip";

  // ── 1. Neue Abteilungen ───────────────────────────────────────────────────
  const abteilungen = new Map(ctx.departments);          // norm(Name) → ID
  const anzulegen = new Map();                           // norm(Name) → Name
  for (const r of rows) {
    const name = r._extra?.departmentNew;
    if (name && !abteilungen.has(katalogKey(name))) anzulegen.set(katalogKey(name), name);
  }
  for (const [key, name] of anzulegen) {
    const { data, error } = await supabase.from("DEPARTMENT")
      .insert([{ TENANT_ID: tenantId, NAME: name, ABBR: name.slice(0, 20), IMPORT_BATCH_ID: batchId }])
      .select("ID").single();
    if (error) throw { status: 500, message: `Abteilung „${name}“ konnte nicht angelegt werden: ${error.message}` };
    abteilungen.set(key, data.ID);
  }

  // ── 2. Mitarbeiter ────────────────────────────────────────────────────────
  // Dubletten: bei "zusammenführen" den Bestand aktualisieren, sonst anlegen.
  // Beides liefert am Ende eine ID je Kürzel — die braucht Schritt 3 und 4.
  const idNachAbbr = new Map(ctx.empIdByAbbr);
  const zeilenMitId = [];                                // [{ row, id }]

  const zusammen = mode === "merge" ? rows.filter((r) => r.status === "duplicate" && findExistingId(ctx, r) != null) : [];
  const zusammenSet = new Set(zusammen);
  const anzulegende = rows.filter((r) => !zusammenSet.has(r));

  // Abteilung nachtragen, bevor geschrieben wird.
  for (const r of rows) {
    const neu = r._extra?.departmentNew;
    if (neu) r._dbRow.DEPARTMENT_ID = abteilungen.get(katalogKey(neu)) ?? null;
  }

  let inserted = 0;
  for (let i = 0; i < anzulegende.length; i += 500) {
    const teil = anzulegende.slice(i, i + 500);
    const nutzlast = teil.map((r) => ({ ...r._dbRow, TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId }));
    const { data, error } = await supabase.from("EMPLOYEE").insert(nutzlast).select("ID, ABBR");
    if (error) throw { status: 500, message: `Mitarbeiter konnten nicht angelegt werden (${inserted} von ${anzulegende.length} geschrieben): ${error.message}` };
    // PostgREST liefert die Zeilen in der Reihenfolge der Nutzlast zurück.
    (data || []).forEach((neu, k) => {
      inserted++;
      zeilenMitId.push({ row: teil[k], id: neu.ID });
      const a = norm(neu.ABBR);
      if (a) idNachAbbr.set(a, neu.ID);
    });
  }

  let merged = 0, undo = [];
  const zusammengefuehrteIds = new Set();
  if (zusammen.length) {
    const r = await mergeExistingRows(zusammen, { supabase, tenantId, def: DOMAINS.employee, ctx });
    merged = r.merged; undo = r.undo;
    for (const z of zusammen) {
      const id = findExistingId(ctx, z);
      if (id != null) {
        zeilenMitId.push({ row: z, id });
        zusammengefuehrteIds.add(id);
        const a = norm(z._dbRow?.ABBR);
        if (a) idNachAbbr.set(a, id);
      }
    }
  }

  // ── 3. Vorgesetzte (zweiter Durchgang) ────────────────────────────────────
  for (const { row, id } of zeilenMitId) {
    const abbr = row._extra?.supervisorAbbr;
    if (!abbr) continue;
    const chefId = idNachAbbr.get(norm(abbr));
    if (chefId == null || chefId === id) continue;
    const { error } = await supabase.from("EMPLOYEE")
      .update({ SUPERVISOR_ID: chefId }).eq("ID", id).eq("TENANT_ID", tenantId);
    if (error) throw { status: 500, message: `Vorgesetzter konnte nicht gesetzt werden: ${error.message}` };
  }

  // ── 4. Kostensatz, Arbeitszeitmodell, Berechtigungsrolle ──────────────────
  const kostensaetze = [], modelle = [], rollen = [];
  // Wer beim Zusammenführen eine neue Rolle bekommt, hat womöglich eine
  // laufende Sitzung mit den alten Rechten. Die muss enden — dieselbe Regel
  // wie bei der Rollenvergabe in der Oberfläche (controllers/roles.js).
  // Neu angelegte Mitarbeiter haben noch keine Sitzung.
  const rollenWechsel = new Set();
  for (const { row, id } of zeilenMitId) {
    const ex = row._extra;
    if (!ex) continue;
    if (ex.costRate) kostensaetze.push({ TENANT_ID: tenantId, EMPLOYEE_ID: id, COST_RATE: ex.costRate.value, VALID_FROM: ex.costRate.from, IMPORT_BATCH_ID: batchId });
    if (ex.workModel) modelle.push({ TENANT_ID: tenantId, EMPLOYEE_ID: id, MODEL_ID: ex.workModel.modelId, VALID_FROM: ex.workModel.from, IMPORT_BATCH_ID: batchId });
    // Hat der Mitarbeiter die Rolle schon, wird nichts geschrieben: der
    // zusammengesetzte Primärschlüssel würde sonst den ganzen Lauf abbrechen.
    if (ex.roleId != null && !ctx.vorhandeneRollen.has(id + ":" + ex.roleId)) {
      rollen.push({ EMPLOYEE_ID: id, ROLE_ID: ex.roleId, IMPORT_BATCH_ID: batchId });
      if (zusammengefuehrteIds.has(id)) rollenWechsel.add(id);
    }
  }

  const schreibe = async (tabelle, zeilen, was) => {
    for (let i = 0; i < zeilen.length; i += 500) {
      const { error } = await supabase.from(tabelle).insert(zeilen.slice(i, i + 500));
      if (error) throw { status: 500, message: `${was} konnte nicht geschrieben werden: ${error.message}. Die Mitarbeiter sind angelegt — Stapel #${batchId} zurücksetzen und erneut versuchen.` };
    }
  };
  await schreibe("EMPLOYEE_COST_RATE",  kostensaetze, "Kostensatz");
  await schreibe("EMPLOYEE_WORK_MODEL", modelle,      "Arbeitszeitmodell-Zuordnung");
  await schreibe("EMPLOYEE_ROLE",       rollen,       "Berechtigungsrolle");

  for (const id of rollenWechsel) await revokeSessions(supabase, id);

  return { inserted, merged, undo };
}

/**
 * Zurücksetzen: erst die Nebenzeilen dieses Stapels, dann die Mitarbeiter,
 * zuletzt die vom Stapel angelegten Abteilungen (auf die zeigt EMPLOYEE).
 *
 * Der Schutz gegen Live-Daten muss hier selbst stehen — der allgemeine Weg in
 * rollback() prüft `dependents` nur, wenn die Domäne KEIN rollbackExecute hat.
 */
async function rollbackEmployee({ supabase, tenantId, batchId }) {
  const def = DOMAINS.employee;
  const { data: idRows, error: idErr } = await supabase
    .from("EMPLOYEE").select("ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  if (idErr) throw { status: 500, message: idErr.message };
  const ids = (idRows || []).map((r) => r.ID);

  const blocker = [];
  for (const dep of (ids.length ? def.dependents || [] : [])) {
    const { count, error } = await supabase
      .from(dep.table).select("ID", { count: "exact", head: true })
      .eq("TENANT_ID", tenantId).in(dep.column, ids);
    if (error) {
      if (/relation .* does not exist|column .* does not exist/i.test(error.message)) continue;
      throw { status: 500, message: error.message };
    }
    if (count > 0) blocker.push(`${count}× ${dep.label}`);
  }
  if (blocker.length) {
    throw { status: 409, message: `Rollback nicht möglich: An importierten Mitarbeitern hängen bereits ${blocker.join(", ")}. Bitte diese zuerst entfernen.` };
  }

  // EMPLOYEE_ROLE trägt keinen Mandanten — es hängt über EMPLOYEE_ID am
  // Elternsatz (RLS-Policy aus Migration 0160). Ein .eq("TENANT_ID", …) darauf
  // wäre ein Spaltenfehler, kein Filter.
  await supabase.from("EMPLOYEE_ROLE").delete().eq("IMPORT_BATCH_ID", batchId);
  await supabase.from("EMPLOYEE_COST_RATE").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  await supabase.from("EMPLOYEE_WORK_MODEL").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);

  // Vorgesetzten-Verweise aus dem Bestand auf die gleich gelöschten Zeilen
  // lösen: der Fremdschlüssel steht auf SET NULL, aber nur die Datenbank weiß
  // das — ohne diesen Schritt bliebe es der Zufall, ob PostgREST zuerst die
  // Kinder oder die Eltern anfasst.
  if (ids.length) {
    await supabase.from("EMPLOYEE").update({ SUPERVISOR_ID: null })
      .eq("TENANT_ID", tenantId).in("SUPERVISOR_ID", ids);
  }

  const { data: del, error: delErr } = await supabase
    .from("EMPLOYEE").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId).select("ID");
  if (delErr) throw { status: 500, message: delErr.message };

  // Zuletzt die Abteilungen, die dieser Lauf angelegt hat. Hängt inzwischen
  // ein anderer Mitarbeiter daran, bleibt sie stehen — eine Abteilung zu
  // entfernen, die jemand benutzt, wäre ein Schaden statt einer Rücknahme.
  const { data: depts } = await supabase
    .from("DEPARTMENT").select("ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  for (const d of depts || []) {
    const { count } = await supabase.from("EMPLOYEE")
      .select("ID", { count: "exact", head: true }).eq("TENANT_ID", tenantId).eq("DEPARTMENT_ID", d.ID);
    if (!count) await supabase.from("DEPARTMENT").delete().eq("ID", d.ID).eq("TENANT_ID", tenantId);
  }

  return { deleted: (del || []).length };
}

// ── Domäne: Kontakte (Ansprechpartner) ───────────────────────────────────────
const CONTACT_FIELDS = [
  { key: "address",    header: "Firma/Adresse (Zugehörigkeit)", required: true,  example: "Stadt Musterhausen", aliases: ["firma", "adresse", "unternehmen", "kunde", "bauherr", "company", "addressname"] , list: "addressName" },
  { key: "salutation", header: "Anrede",                        required: true,  example: "Herr",               aliases: ["anrede", "salutation"] , list: "salutation" },
  { key: "first_name", header: "Vorname",                       required: true,  example: "Thomas",             aliases: ["vorname", "firstname"] },
  { key: "last_name",  header: "Nachname",                      required: true,  example: "Beispiel",           aliases: ["nachname", "name", "lastname", "familienname", "surname"] },
  { key: "gender",     header: "Geschlecht",                    required: false, example: "männlich",           aliases: ["geschlecht", "gender"] , list: "gender" },
  { key: "title",      header: "Titel",                         required: false, example: "Dr.",                aliases: ["titel", "title"] },
  { key: "position",   header: "Funktion/Position",             required: false, example: "Bauleiter",          aliases: ["funktion", "position", "rolle", "jobtitle", "role", "taetigkeit"] },
  { key: "department", header: "Abteilung",                     required: false, example: "Hochbau",            aliases: ["abteilung", "department", "bereich", "team"] },
  { key: "email",      header: "E-Mail",                        required: false, example: "t.beispiel@muster.de", aliases: ["email", "mail", "emailadresse", "mailadresse"] },
  { key: "mobile",     header: "Telefon/Mobil",                 required: false, example: "+49 170 1234567",    aliases: ["mobil", "telefon", "mobile", "phone", "tel", "handy", "telefonnummer"] , type: "text" },
  { key: "phone",      header: "Festnetz",                      required: false, example: "+49 30 1234567",     aliases: ["festnetz", "festnetznummer", "landline", "telefonfestnetz"] , type: "text" },
  { key: "is_primary", header: "Hauptkontakt (ja/nein)",        required: false, example: "ja",                 aliases: ["hauptkontakt", "primär", "primar", "primary", "isprimary", "haupt", "standardkontakt"] , list: "yesNo" },
  { key: "notes",      header: "Notizen",                       required: false, example: "",                   aliases: ["notizen", "notiz", "bemerkung", "bemerkungen", "anmerkung", "kommentar", "notes"] },
];

function deriveGenderFromSalutation(salText, genders) {
  const t = norm(salText);
  if (t.includes("herr")) return genders.byName.get("männlich") ?? genders.byName.get("maennlich") ?? null;
  if (t.includes("frau")) return genders.byName.get("weiblich") ?? null;
  return null;
}

async function loadContactContext(supabase, tenantId) {
  const [addrRes, salRes, genderRes, contactRes] = await Promise.all([
    supabase.from("ADDRESS").select("ID, ADDRESS_NAME_1").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("SALUTATION").select("ID, SALUTATION"),   // global
    supabase.from("GENDER").select("ID, GENDER"),            // global
    supabase.from("CONTACTS").select("ID, ADDRESS_ID, FIRST_NAME, LAST_NAME").eq("TENANT_ID", tenantId).limit(100000),
  ]);

  const addrByName = new Map();
  for (const a of addrRes.data || []) if (a.ADDRESS_NAME_1) addrByName.set(norm(a.ADDRESS_NAME_1), a.ID);

  const salByName = new Map();
  for (const sa of salRes.data || []) if (sa.SALUTATION) salByName.set(norm(sa.SALUTATION), sa.ID);

  const gByName = new Map();
  let gDefault = null;
  for (const g of genderRes.data || []) {
    const t = norm(g.GENDER);
    if (t) gByName.set(t, g.ID);
    if (t.startsWith("männ") || t.startsWith("maen")) { gByName.set("männlich", g.ID); gByName.set("maennlich", g.ID); gByName.set("m", g.ID); }
    if (t.startsWith("weib")) { gByName.set("weiblich", g.ID); gByName.set("w", g.ID); }
    if (t.startsWith("div")) { gByName.set("divers", g.ID); gDefault = g.ID; }
    if (t.includes("keine") || t.includes("unbekannt") || t.includes("angabe")) gDefault = g.ID;
  }

  const existingKeys = new Set();
  const existingIds = new Map();
  for (const c of contactRes.data || []) {
    const key = `${c.ADDRESS_ID}|` + norm(`${c.FIRST_NAME || ""} ${c.LAST_NAME || ""}`);
    existingKeys.add(key);
    if (c.ID != null && !existingIds.has(key)) existingIds.set(key, c.ID);
  }
  return { addrByName, salByName, genders: { byName: gByName, default: gDefault }, existingKeys, existingIds };
}

function buildContactEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const first = s(mapped.first_name);
  const last  = s(mapped.last_name);
  if (!first) { messages.push({ level: "error", text: "Vorname fehlt (Pflichtfeld)" }); ok = false; }
  if (!last)  { messages.push({ level: "error", text: "Nachname fehlt (Pflichtfeld)" }); ok = false; }

  // Adresse (Pflicht): Kontakt gehört zu einer Firma/Adresse.
  let addressId = null;
  const ain = s(mapped.address);
  if (!ain) { messages.push({ level: "error", text: "Firma/Adresse fehlt (Pflichtfeld)" }); ok = false; }
  else {
    addressId = ctx.addrByName.get(norm(ain)) ?? null;
    if (addressId == null) { messages.push({ level: "error", text: `Firma/Adresse „${ain}“ nicht gefunden — zuerst Adressen importieren` }); ok = false; }
  }

  // Anrede (Pflicht).
  let salutationId = null;
  const sin = s(mapped.salutation);
  if (!sin) { messages.push({ level: "error", text: "Anrede fehlt (Pflichtfeld, z. B. Herr/Frau)" }); ok = false; }
  else {
    salutationId = ctx.salByName.get(norm(sin)) ?? null;
    if (salutationId == null) { messages.push({ level: "error", text: `Anrede „${sin}“ nicht gefunden (z. B. Herr/Frau)` }); ok = false; }
  }

  // Geschlecht (Pflicht in der App): aus Spalte, sonst aus Anrede ableiten, sonst Default.
  let genderId = null;
  const gin = s(mapped.gender);
  if (gin) {
    genderId = ctx.genders.byName.get(norm(gin)) ?? null;
    if (genderId == null) messages.push({ level: "warn", text: `Geschlecht „${gin}“ nicht erkannt — aus Anrede abgeleitet` });
  }
  if (genderId == null) genderId = deriveGenderFromSalutation(sin, ctx.genders);
  if (genderId == null) genderId = ctx.genders.default;
  if (genderId == null) { messages.push({ level: "error", text: "Geschlecht nicht ermittelbar (Spalte Geschlecht oder Anrede Herr/Frau angeben)" }); ok = false; }

  const email = s(mapped.email);
  if (email && !email.includes("@")) messages.push({ level: "warn", text: "E-Mail sieht ungültig aus (kein @)" });

  const position = s(mapped.position);
  const dbRow = {
    TITLE:         s(mapped.title) || null,
    FIRST_NAME:    first || null,
    LAST_NAME:     last || null,
    EMAIL:         email || null,
    MOBILE:        s(mapped.mobile) || null,
    SALUTATION_ID: salutationId,
    GENDER_ID:     genderId,
    ADDRESS_ID:    addressId,
    POSITION:      position || null,
    DEPARTMENT:    s(mapped.department) || null,
    PHONE:         s(mapped.phone) || null,
    IS_PRIMARY:    parseBool(mapped.is_primary) ? 1 : 0,
    NOTES:         s(mapped.notes) || null,
  };

  const matchKey = addressId != null ? `${addressId}|` + norm(`${first} ${last}`) : norm(`${first} ${last}`);
  const display = { address: ain, salutation: sin, name: `${first} ${last}`.trim(), position, email };
  return { ok, messages, dbRow, matchKey, display };
}

// ── Domäne: Projekte (Stammdaten/Kopf) ───────────────────────────────────────
const PROJECT_FIELDS = [
  { key: "project_number", header: "Projektnummer",            required: true,  example: "P-2024-012",                aliases: ["projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "name",      header: "Projektname",              required: true,  example: "Neubau Kita Sonnenschein",  aliases: ["projektname", "name", "namelong", "bezeichnung", "projectname"] },
  { key: "status",         header: "Status",                   required: true,  example: "in Bearbeitung",            aliases: ["status", "projektstatus", "projectstatus"] , list: "projectStatus" },
  { key: "project_type",   header: "Projekttyp",               required: false, example: "Neubau",                    aliases: ["projekttyp", "typ", "type", "projecttype", "art"] , list: "projectType" },
  { key: "manager",        header: "Projektleiter (Kürzel)",   required: true,  example: "MMu",                       aliases: ["projektleiter", "pl", "manager", "leiter", "verantwortlich", "projektverantwortlicher"] , list: "employeeShort" },
  { key: "client",         header: "Bauherr/Auftraggeber",     required: true,  example: "Stadt Musterhausen",        aliases: ["bauherr", "auftraggeber", "kunde", "adresse", "client"] , list: "addressName" },
];

async function loadProjectContext(supabase, tenantId) {
  const [companyRes, statusRes, typeRes, empRes, addrRes, projRes] = await Promise.all([
    supabase.from("COMPANY").select("ID").eq("TENANT_ID", tenantId).order("ID", { ascending: true }).limit(1),
    supabase.from("PROJECT_STATUS").select("ID, ABBR"),                          // global
    supabase.from("PROJECT_TYPE").select("ID, ABBR").eq("TENANT_ID", tenantId),
    supabase.from("EMPLOYEE").select("ID, ABBR, FIRST_NAME, LAST_NAME").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("ADDRESS").select("ID, ADDRESS_NAME_1").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT").select("ID, ABBR").eq("TENANT_ID", tenantId).limit(100000),
  ]);

  const companyId = companyRes.data?.[0]?.ID ?? null;
  const statusByName = new Map();
  for (const r of statusRes.data || []) if (r.ABBR) statusByName.set(norm(r.ABBR), r.ID);
  const typeByName = new Map();
  for (const r of typeRes.data || []) if (r.ABBR) typeByName.set(norm(r.ABBR), r.ID);
  const empByName = new Map();
  for (const e of empRes.data || []) {
    if (e.ABBR) empByName.set(norm(e.ABBR), e.ID);
    const full = norm(`${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`);
    if (full) empByName.set(full, e.ID);
  }
  const addrByName = new Map();
  for (const a of addrRes.data || []) if (a.ADDRESS_NAME_1) addrByName.set(norm(a.ADDRESS_NAME_1), a.ID);
  const existingKeys = new Set();
  const existingIds = new Map();
  for (const p of projRes.data || []) {
    if (!p.ABBR) continue;
    existingKeys.add(norm(p.ABBR));
    if (p.ID != null && !existingIds.has(norm(p.ABBR))) existingIds.set(norm(p.ABBR), p.ID);
  }

  return { companyId, statusByName, typeByName, empByName, addrByName, existingKeys, existingIds };
}

function buildProjectEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const number = s(mapped.project_number);
  const name   = s(mapped.name);
  if (!number) { messages.push({ level: "error", text: "Projektnummer fehlt (Pflichtfeld)" }); ok = false; }
  if (!name)   { messages.push({ level: "error", text: "Projektname fehlt (Pflichtfeld)" }); ok = false; }

  // Pflicht-FKs: müssen gesetzt UND auflösbar sein, sonst Fehler (nicht importierbar).
  const resolveReq = (val, map, label, hint) => {
    const v = s(val);
    if (!v) { messages.push({ level: "error", text: `${label} fehlt (Pflichtfeld)` }); ok = false; return null; }
    const hit = map.get(norm(v));
    if (hit == null) { messages.push({ level: "error", text: `${label} „${v}“ nicht gefunden${hint ? ` — ${hint}` : ""}` }); ok = false; return null; }
    return hit;
  };
  // Optionale FKs: gesetzt-aber-unbekannt → Warnung (Feld bleibt leer, Zeile bleibt importierbar).
  const resolveOpt = (val, map, label) => {
    const v = s(val);
    if (!v) return null;
    const hit = map.get(norm(v));
    if (hit == null) { messages.push({ level: "warn", text: `${label} „${v}“ nicht gefunden — bleibt leer` }); return null; }
    return hit;
  };
  const statusId  = resolveReq(mapped.status,  ctx.statusByName, "Status",        "Status-Bezeichnung prüfen (Einstellungen → Stammdaten)");
  const typeId    = resolveOpt(mapped.project_type, ctx.typeByName, "Projekttyp");
  const managerId = resolveReq(mapped.manager, ctx.empByName,    "Projektleiter", "zuerst Mitarbeiter importieren (Kürzel)");
  const addressId = resolveReq(mapped.client,  ctx.addrByName,   "Bauherr/Adresse", "zuerst Adressen importieren");

  const dbRow = {
    ABBR:         number || null,   // alte Projektnummer beibehalten
    NAME:          name || null,
    COMPANY_ID:         ctx.companyId,
    PROJECT_STATUS_ID:  statusId,
    PROJECT_TYPE_ID:    typeId,
    PROJECT_MANAGER_ID: managerId,
    ADDRESS_ID:         addressId,
  };

  const matchKey = norm(number);
  const display = {
    number, name,
    status:  statusId  != null ? s(mapped.status)  : "",
    manager: managerId != null ? s(mapped.manager) : "",
    client:  addressId != null ? s(mapped.client)  : "",
  };
  return { ok, messages, dbRow, matchKey, display };
}

// ── Domäne: Projekt-Honorar (Leistungsstruktur + Vertrag) ────────────────────
// HOAI §34 Gebäude — Standard-Prozentsätze der Leistungsphasen (Summe 100).
const HOAI_LP = [
  { code: "LP1", name: "Grundlagenermittlung",       pct: 2 },
  { code: "LP2", name: "Vorplanung",                 pct: 7 },
  { code: "LP3", name: "Entwurfsplanung",            pct: 15 },
  { code: "LP4", name: "Genehmigungsplanung",        pct: 3 },
  { code: "LP5", name: "Ausführungsplanung",         pct: 25 },
  { code: "LP6", name: "Vorbereitung der Vergabe",   pct: 10 },
  { code: "LP7", name: "Mitwirkung bei der Vergabe", pct: 4 },
  { code: "LP8", name: "Objektüberwachung",          pct: 31 },
  { code: "LP9", name: "Objektbetreuung",            pct: 3 },
];

const PROJECT_FEE_FIELDS = [
  { key: "project_number", header: "Projektnummer",                  required: true,  example: "P-2024-012", aliases: ["projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "fee",            header: "Honorarsumme (netto)",           required: true,  example: "80000",      aliases: ["honorar", "honorarsumme", "summe", "betrag", "nettohonorar", "auftragssumme", "fee", "amount"] , type: "money" },
  { key: "billing",        header: "Abrechnungsart (Pauschal/Stunden)", required: false, example: "Pauschal", aliases: ["abrechnungsart", "abrechnung", "billing", "billingtype", "art"] , list: "billing" },
];

async function loadProjectFeeContext(supabase, tenantId) {
  const { data: projects } = await supabase
    .from("PROJECT").select("ID, ABBR, NAME, ADDRESS_ID, CONTACT_ID").eq("TENANT_ID", tenantId).limit(100000);
  const projectsByNumber = new Map();
  const idToNumber = new Map();
  for (const p of projects || []) {
    if (!p.ABBR) continue;
    projectsByNumber.set(norm(p.ABBR), { id: p.ID, name: p.NAME || p.ABBR, addressId: p.ADDRESS_ID ?? null, contactId: p.CONTACT_ID ?? null });
    idToNumber.set(p.ID, p.ABBR);
  }
  // Projekte, die bereits eine Leistungsstruktur haben → Honorar gilt als gesetzt (Dublette).
  const { data: structs } = await supabase.from("PROJECT_STRUCTURE").select("PROJECT_ID").eq("TENANT_ID", tenantId).limit(100000);
  const withStructure = new Set((structs || []).map((r) => r.PROJECT_ID));
  const existingKeys = new Set();
  for (const [id, num] of idToNumber) if (withStructure.has(id)) existingKeys.add(norm(num));
  // Tenant-Defaults für den Vertrag (Währung/MwSt).
  const { data: settingsRows } = await supabase.from("TENANT_SETTINGS").select("KEY, VALUE").eq("TENANT_ID", tenantId);
  const defaults = {};
  for (const r of settingsRows || []) defaults[r.KEY] = r.VALUE;
  return { projectsByNumber, existingKeys, defaults };
}

function buildProjectFeeEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const number = s(mapped.project_number);
  let proj = null;
  if (!number) { messages.push({ level: "error", text: "Projektnummer fehlt (Pflichtfeld)" }); ok = false; }
  else {
    proj = ctx.projectsByNumber.get(norm(number));
    if (!proj) { messages.push({ level: "error", text: `Projekt „${number}“ nicht gefunden — zuerst das Projekt importieren/anlegen` }); ok = false; }
  }

  const feeRaw = s(mapped.fee);
  const amount = parseAmountDE(feeRaw);
  if (!feeRaw) { messages.push({ level: "error", text: "Honorarsumme fehlt (Pflichtfeld)" }); ok = false; }
  else if (amount.invalid || amount.value == null) { messages.push({ level: "error", text: `Honorarsumme „${feeRaw}“ ist keine gültige Zahl` }); ok = false; }
  else if (amount.value < 0) { messages.push({ level: "error", text: "Honorarsumme darf nicht negativ sein" }); ok = false; }

  const bin = norm(mapped.billing);
  const billingTypeId = (bin.includes("stund") || bin.includes("tec") || bin.includes("zeit") || bin === "2") ? 2 : 1;

  const dbRow = proj ? {
    projectId: proj.id, projectNumber: number, projectName: proj.name,
    addressId: proj.addressId, contactId: proj.contactId,
    fee: amount.value ?? 0, billingTypeId,
  } : null;

  const matchKey = norm(number);
  const display = {
    number, name: proj ? proj.name : "",
    fee: amount.value != null ? amount.value.toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " €" : feeRaw,
    billing: billingTypeId === 2 ? "Stunden" : "Pauschal",
  };
  return { ok, messages, dbRow, matchKey, display };
}

// Custom-Commit: pro Projekt Struktur (1 Position ODER LP1–9) + Fortschritt + Vertrag,
// alles mit IMPORT_BATCH_ID getaggt.
async function commitProjectFeeRows(rows, { supabase, tenantId, batchId, ctx, options }) {
  const mode = options?.structureMode === "hoai" ? "hoai" : "single";
  const defaults = ctx.defaults || {};
  let done = 0;

  for (const r of rows) {
    const e = r._dbRow;
    const isPauschal = e.billingTypeId === 1;

    // 1) Struktur-Knoten
    let nodes;
    if (mode === "hoai") {
      let allocated = 0;
      nodes = HOAI_LP.map((lp) => {
        const rev = isPauschal ? fmt2(e.fee * lp.pct / 100) : 0;
        allocated = fmt2(allocated + rev);
        return { ABBR: lp.code, NAME: lp.name, REVENUE: rev };
      });
      if (isPauschal) {
        const diff = fmt2(e.fee - allocated);          // Rundungsrest auf LP8 (größte Phase)
        if (diff !== 0) nodes[7].REVENUE = fmt2(nodes[7].REVENUE + diff);
      }
    } else {
      nodes = [{ ABBR: "Honorar", NAME: isPauschal ? "Honorar (Pauschal)" : "Honorar (Stunden)", REVENUE: isPauschal ? fmt2(e.fee) : 0 }];
    }

    // 1a) Vertrag zuerst — die Strukturknoten sollen ihn kennen (CONTRACT_ID).
    //     Ein bereits vorhandener Vertrag wird verwendet, nicht ersetzt.
    const { data: existing } = await supabase.from("CONTRACT").select("ID").eq("TENANT_ID", tenantId).eq("PROJECT_ID", e.projectId).limit(1);
    let contractId = existing?.[0]?.ID ?? null;
    if (contractId == null) {
      const contractRow = {
        ABBR: e.projectNumber, NAME: e.projectName, PROJECT_ID: e.projectId,
        INVOICE_ADDRESS_ID: e.addressId, INVOICE_CONTACT_ID: e.contactId,
        TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
        ...contractDefaults(defaults),
      };
      const { data: cRows, error: cErr } = await supabase.from("CONTRACT").insert([contractRow]).select("ID");
      if (cErr) throw { status: 500, message: `Vertrag für Projekt ${e.projectNumber} fehlgeschlagen: ${cErr.message}` };
      contractId = cRows?.[0]?.ID ?? null;
    }

    // SORT_ORDER in Zehnerschritten wie beim manuellen Anlegen — ohne ihn stehen
    // alle Knoten auf 0 und die Leistungsphasen erscheinen in zufälliger Reihenfolge.
    const structRows = nodes.map((n, i) => ({
      ABBR: n.ABBR, NAME: n.NAME, PROJECT_ID: e.projectId,
      BILLING_TYPE_ID: e.billingTypeId, FATHER_ID: null, REVENUE: n.REVENUE,
      EXTRAS_PERCENT: 0, EXTRAS: 0, COSTS: 0,
      REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
      SORT_ORDER: i * 10, CONTRACT_ID: contractId,
      TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
    }));
    const { data: created, error: psErr } = await supabase
      .from("PROJECT_STRUCTURE").insert(structRows).select("ID, REVENUE, EXTRAS, EXTRAS_PERCENT");
    if (psErr) throw { status: 500, message: `Struktur für Projekt ${e.projectNumber} fehlgeschlagen: ${psErr.message}` };

    // 2) Fortschritt
    const progRows = (created || []).map((n) => ({
      STRUCTURE_ID: n.ID, TENANT_ID: tenantId, REVENUE: n.REVENUE ?? 0,
      EXTRAS_PERCENT: n.EXTRAS_PERCENT ?? 0, EXTRAS: n.EXTRAS ?? 0,
      REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
      IMPORT_BATCH_ID: batchId,
    }));
    if (progRows.length) {
      const { error: prErr } = await supabase.from("PROJECT_PROGRESS").insert(progRows);
      if (prErr) throw { status: 500, message: `Fortschritt für Projekt ${e.projectNumber} fehlgeschlagen: ${prErr.message}` };
    }

    done++;
  }
  return { inserted: done };
}

// ── Domäne: Projektstruktur (Leistungsbaum) ──────────────────────────────────
// Die Hierarchie kommt über die Gliederungsnummer („1“, „1.1“, „1.1.2“) — sie
// ist in Altsystemen fast immer vorhanden, im Blatt sichtbar und übersteht
// Umsortieren. Ersatzweise wird eine Ebenen-Spalte (1/2/3) in Dateireihenfolge
// gelesen; die ist bequemer zu tippen, aber ein Sortierklick in Excel zerstört
// den Baum, deshalb nur als Rückfallebene.
//
// Geld gehört ausschließlich an die Blätter: Elternwerte rechnet die App aus
// den Kindern (recalcParent), ein importierter Elternbetrag würde beim ersten
// Speichern in der Oberfläche überschrieben.
const MAX_STRUCTURE_DEPTH = 5;

const PROJECT_STRUCTURE_FIELDS = [
  { key: "project_number",  header: "Projektnummer",                   required: true,  example: "P-2024-012",                aliases: ["projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "outline",         header: "Gliederung",                      required: true,  example: "1.1",                       aliases: ["gliederung", "gliederungsnummer", "position", "pos", "ordnungszahl", "nr", "outline", "wbs", "stufe"], type: "text" },
  { key: "abbr",      header: "Kürzel",                          required: true,  example: "LP1-4",                     aliases: ["kuerzel", "kurzzeichen", "shortname", "code", "krzl"] },
  { key: "name",       header: "Bezeichnung",                     required: false, example: "Vorplanung bis Genehmigung", aliases: ["bezeichnung", "name", "namelong", "beschreibung", "leistung", "titel"] },
  { key: "billing",         header: "Abrechnungsart (Pauschal/Stunden)", required: false, example: "Pauschal",                aliases: ["abrechnungsart", "abrechnung", "billing", "billingtype", "art"], list: "billing" },
  { key: "revenue",         header: "Honorar netto",                   required: false, example: "27000",                     aliases: ["honorar", "honorarsumme", "betrag", "summe", "nettohonorar", "revenue", "wert"], type: "money" },
  { key: "extras_percent",  header: "Nebenkosten %",                   required: false, example: "5",                         aliases: ["nebenkosten", "nk", "nkprozent", "nebenkostenprozent", "extras", "extraspercent", "zuschlagprozent"] },
  { key: "level",           header: "Ebene (nur ohne Gliederung)",     required: false, example: "",                          aliases: ["ebene", "stufe", "level", "tiefe", "hierarchieebene"] },
];

async function loadProjectStructureContext(supabase, tenantId) {
  const [projRes, structRes, contractRes, settingsRes] = await Promise.all([
    supabase.from("PROJECT").select("ID, ABBR, NAME, ADDRESS_ID, CONTACT_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT_STRUCTURE").select("PROJECT_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("CONTRACT").select("ID, PROJECT_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("TENANT_SETTINGS").select("KEY, VALUE").eq("TENANT_ID", tenantId),
  ]);

  const withStructure = new Set((structRes.data || []).map((r) => r.PROJECT_ID));
  const contractByProject = new Map();
  for (const c of contractRes.data || []) if (!contractByProject.has(c.PROJECT_ID)) contractByProject.set(c.PROJECT_ID, c.ID);

  const projectsByNumber = new Map();
  const existingKeys = new Set();
  for (const p of projRes.data || []) {
    if (!p.ABBR) continue;
    projectsByNumber.set(norm(p.ABBR), {
      id: p.ID, number: p.ABBR, name: p.NAME || p.ABBR,
      addressId: p.ADDRESS_ID ?? null, contactId: p.CONTACT_ID ?? null,
      contractId: contractByProject.get(p.ID) ?? null,
    });
    if (withStructure.has(p.ID)) existingKeys.add(norm(p.ABBR));
  }

  const defaults = {};
  for (const r of settingsRes.data || []) defaults[r.KEY] = r.VALUE;
  return { projectsByNumber, existingKeys, defaults };
}

/** „1.2.3“, „1-2-3“, „1.2.3.“ → ["1","2","3"]; leer → null. */
function parseOutline(v) {
  const t = s(v).replace(/\s+/g, "");
  if (!t) return null;
  const parts = t.split(/[.\-/]/).filter((x) => x !== "");
  if (!parts.length) return null;
  return parts;
}

function buildProjectStructureEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const number = s(mapped.project_number);
  let proj = null;
  if (!number) { messages.push({ level: "error", text: "Projektnummer fehlt (Pflichtfeld)" }); ok = false; }
  else {
    proj = ctx.projectsByNumber.get(norm(number)) || null;
    if (!proj) { messages.push({ level: "error", text: `Projekt „${number}“ nicht gefunden — zuerst das Projekt importieren/anlegen` }); ok = false; }
  }

  const nameShort = s(mapped.abbr);
  if (!nameShort) { messages.push({ level: "error", text: "Kürzel fehlt (Pflichtfeld)" }); ok = false; }

  // Hierarchie: Gliederungsnummer bevorzugt, sonst Ebene.
  const outline = parseOutline(mapped.outline);
  const levelRaw = s(mapped.level);
  let level = null;
  if (levelRaw) {
    const n = parseInt(levelRaw, 10);
    if (!Number.isFinite(n) || n < 1) { messages.push({ level: "error", text: `Ebene „${levelRaw}“ ist keine Zahl ab 1` }); ok = false; }
    else level = n;
  }
  if (!outline && level == null) {
    messages.push({ level: "error", text: "Gliederung fehlt — z. B. 1, 1.1, 1.2 (ersatzweise Spalte „Ebene“)" });
    ok = false;
  }
  if (outline && outline.length > MAX_STRUCTURE_DEPTH) {
    messages.push({ level: "error", text: `Gliederung ist ${outline.length} Ebenen tief — maximal ${MAX_STRUCTURE_DEPTH}` });
    ok = false;
  }

  // Abrechnungsart: an Blättern Pflicht; ob die Zeile ein Blatt ist, entscheidet
  // erst finalizeRows.
  const bin = norm(mapped.billing);
  let billingTypeId = null;
  if (bin) billingTypeId = (bin.includes("stund") || bin.includes("tec") || bin.includes("zeit") || bin === "2") ? 2 : 1;

  const revRaw = s(mapped.revenue);
  const rev = parseAmountDE(mapped.revenue);
  if (revRaw && (rev.invalid || rev.value == null)) { messages.push({ level: "error", text: `Honorar „${revRaw}“ ist keine gültige Zahl` }); ok = false; }
  else if (rev.value != null && rev.value < 0) messages.push({ level: "warn", text: "Honorar ist negativ — als Minderung übernommen; bitte in der Vorschau prüfen" });

  const nkRaw = s(mapped.extras_percent);
  const nk = parseAmountDE(mapped.extras_percent);
  if (nkRaw && (nk.invalid || nk.value == null)) { messages.push({ level: "error", text: `Nebenkosten „${nkRaw}“ ist keine gültige Zahl` }); ok = false; }

  const dbRow = {
    projectNumber: number, projectId: proj?.id ?? null, projectName: proj?.name ?? "",
    addressId: proj?.addressId ?? null, contactId: proj?.contactId ?? null, contractId: proj?.contractId ?? null,
    outline, level, nameShort, nameLong: s(mapped.name) || nameShort,
    billingTypeId, revenue: rev.value ?? 0, extrasPercent: nk.value ?? 0,
    // von finalizeRows gesetzt:
    parentKey: null, key: null, depth: outline ? outline.length : (level || 1), isLeaf: true, sortIndex: 0,
  };

  const display = {
    number,
    node: `${s(mapped.outline) || `Ebene ${level ?? "?"}`}  ${nameShort}`,
    bezeichnung: dbRow.nameLong !== nameShort ? dbRow.nameLong : "",
    abrechnung: billingTypeId === 2 ? "Stunden" : billingTypeId === 1 ? "Pauschal" : "",
    honorar: rev.value ? rev.value.toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " €" : "",
  };
  // Der Baum wird nicht über die Projektnummer entdoppelt (viele Zeilen je
  // Projekt); der Schlüssel meldet nur „Projekt hat bereits eine Struktur“.
  return { ok, messages, dbRow, matchKey: norm(number), display };
}

/**
 * Zeilenübergreifende Prüfung des Baums, je Projekt:
 * Gliederung auflösen, Eltern finden, Blätter bestimmen, Geld dorthin zwingen.
 * Ist eine Zeile eines Projekts fehlerhaft, fällt das ganze Projekt aus — ein
 * halb importierter Baum (fehlender Elternknoten) wäre schlimmer als keiner.
 */
function finalizeProjectStructureRows(rows, ctx) {
  const byProject = new Map();
  for (const r of rows) {
    const num = r._dbRow?.projectNumber;
    if (!num) continue;
    if (!byProject.has(num)) byProject.set(num, []);
    byProject.get(num).push(r);
  }

  for (const [number, group] of byProject) {
    const usable = group.filter((r) => r.status !== "error");
    if (!usable.length) continue;

    // 1) Schlüssel je Zeile: Gliederungsnummer oder — ersatzweise — aus der
    //    Ebene und der Dateireihenfolge aufgebauter Pfad.
    const stack = [];
    for (const r of usable) {
      const e = r._dbRow;
      if (e.outline) {
        e.key = e.outline.join(".");
        e.parentKey = e.outline.length > 1 ? e.outline.slice(0, -1).join(".") : null;
        e.depth = e.outline.length;
        stack.length = e.depth;
        stack[e.depth - 1] = e.key;
      } else {
        const depth = Math.min(e.level || 1, MAX_STRUCTURE_DEPTH);
        e.depth = depth;
        e.parentKey = depth > 1 ? (stack[depth - 2] ?? null) : null;
        e.key = `${e.parentKey ? e.parentKey + "." : ""}${e.nameShort}#${r.row}`;
        stack.length = depth;
        stack[depth - 1] = e.key;
        if (depth > 1 && !e.parentKey) {
          r.status = "error";
          r.messages.push({ level: "error", text: `Ebene ${depth} ohne übergeordnete Zeile davor` });
        }
      }
    }

    // 2) Doppelte Gliederungsnummern
    const byKey = new Map();
    for (const r of usable) {
      const k = r._dbRow.key;
      if (byKey.has(k)) {
        r.status = "error";
        r.messages.push({ level: "error", text: `Gliederung „${k}“ kommt in diesem Projekt mehrfach vor` });
      } else byKey.set(k, r);
    }

    // 3) Fehlende Elternzeilen
    for (const r of usable) {
      const p = r._dbRow.parentKey;
      if (p && !byKey.has(p)) {
        r.status = "error";
        r.messages.push({ level: "error", text: `Übergeordnete Zeile „${p}“ fehlt in der Datei` });
      }
    }

    // 4) Blatt oder Knoten?
    const parents = new Set(usable.map((r) => r._dbRow.parentKey).filter(Boolean));
    for (const r of usable) {
      const e = r._dbRow;
      e.isLeaf = !parents.has(e.key);
      // Vorschau: Einrückung sichtbar machen. Führende Leerzeichen überleben die
      // Darstellung nicht, deshalb ein Zeichen je Ebene.
      const indent = e.depth > 1 ? "›".repeat(e.depth - 1) + " " : "";
      const label = e.outline ? e.outline.join(".") : `Ebene ${e.depth}`;
      r.display.node = `${indent}${label}  ${e.nameShort}`;
    }

    // 5) Geld und Abrechnungsart gehören an die Blätter
    for (const r of usable) {
      const e = r._dbRow;
      if (!e.isLeaf) {
        if (e.revenue) {
          r.messages.push({ level: "warn", text: "Übergeordnete Zeile: Honorar wird aus den Unterzeilen gerechnet und hier ignoriert" });
          e.revenue = 0;
        }
        e.billingTypeId = e.billingTypeId ?? null;
        continue;
      }
      if (!e.billingTypeId) {
        r.status = "error";
        r.messages.push({ level: "error", text: "Abrechnungsart fehlt (bei unterster Ebene Pflicht: Pauschal oder Stunden)" });
      } else if (e.billingTypeId === 2 && e.revenue) {
        r.messages.push({ level: "warn", text: "Stunden-Position: Honorar entsteht aus den Buchungen und wird hier ignoriert" });
        e.revenue = 0;
      }
    }

    // 6) Geschwisterreihenfolge (Reihenfolge des Auftretens)
    const perParent = new Map();
    for (const r of usable) {
      const p = r._dbRow.parentKey || "";
      const n = perParent.get(p) || 0;
      r._dbRow.sortIndex = n;
      perParent.set(p, n + 1);
    }

    // 7) Alles-oder-nichts je Projekt
    const broken = group.filter((r) => r.status === "error");
    if (broken.length) {
      for (const r of group) {
        if (r.status === "error") continue;
        r.status = "error";
        r.messages.push({ level: "error", text: `Projekt „${number}“ wird übersprungen — eine andere Zeile dieses Projekts ist fehlerhaft (Zeile ${broken[0].row})` });
      }
      continue;
    }

    const total = usable.reduce((a, r) => a + num(r._dbRow.revenue), 0);
    if (!total && usable.some((r) => r._dbRow.billingTypeId === 1)) {
      usable[0].messages.push({ level: "warn", text: "Kein Honorar hinterlegt — die Struktur entsteht mit 0,00 €" });
    }
  }
}

/**
 * Commit je Projekt: Vertrag → Knoten flach anlegen → FATHER_ID im zweiten Pass
 * setzen → Fortschritt → Elternwerte von unten nach oben rechnen.
 * Das entspricht dem Weg, den auch das Anlegen im Wizard geht.
 */
async function commitProjectStructureRows(rows, { supabase, tenantId, batchId, ctx }) {
  const defaults = ctx.defaults || {};
  const byProject = new Map();
  for (const r of rows) {
    const num = r._dbRow.projectNumber;
    if (!byProject.has(num)) byProject.set(num, []);
    byProject.get(num).push(r);
  }

  let inserted = 0;
  for (const [number, group] of byProject) {
    const first = group[0]._dbRow;
    try {
      // 1) Vertrag zuerst — die Knoten sollen ihn kennen.
      let contractId = first.contractId;
      if (contractId == null) {
        const contractRow = {
          ABBR: number, NAME: first.projectName, PROJECT_ID: first.projectId,
          INVOICE_ADDRESS_ID: first.addressId, INVOICE_CONTACT_ID: first.contactId,
          TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
          ...contractDefaults(defaults),
        };
        const { data: cRows, error: cErr } = await supabase.from("CONTRACT").insert([contractRow]).select("ID");
        if (cErr) throw { status: 500, message: cErr.message };
        contractId = cRows?.[0]?.ID ?? null;
      }

      // 2) Alle Knoten flach — FATHER_ID ist erst nach dem Insert bekannt.
      const ordered = [...group].sort((a, b) => a._dbRow.depth - b._dbRow.depth || a._dbRow.sortIndex - b._dbRow.sortIndex);
      const structRows = ordered.map((r) => {
        const e = r._dbRow;
        const revenue = e.billingTypeId === 1 ? fmt2(e.revenue) : 0;
        return {
          ABBR: e.nameShort, NAME: e.nameLong, PROJECT_ID: e.projectId,
          BILLING_TYPE_ID: e.billingTypeId, FATHER_ID: null, CONTRACT_ID: contractId,
          REVENUE: revenue, EXTRAS_PERCENT: e.extrasPercent, EXTRAS: fmt2(revenue * e.extrasPercent / 100), COSTS: 0,
          REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
          SORT_ORDER: e.sortIndex * 10,
          TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
        };
      });
      const { data: created, error: psErr } = await supabase
        .from("PROJECT_STRUCTURE").insert(structRows).select("ID, REVENUE, EXTRAS, EXTRAS_PERCENT");
      if (psErr) throw { status: 500, message: psErr.message };

      // 3) Zweiter Pass: FATHER_ID über die Gliederungsschlüssel setzen.
      const idByKey = new Map();
      (created || []).forEach((row, i) => idByKey.set(ordered[i]._dbRow.key, row.ID));
      for (const r of ordered) {
        const e = r._dbRow;
        if (!e.parentKey) continue;
        const childId = idByKey.get(e.key), fatherId = idByKey.get(e.parentKey);
        if (!childId || !fatherId) continue;
        const { error: uErr } = await supabase.from("PROJECT_STRUCTURE").update({ FATHER_ID: fatherId }).eq("ID", childId).eq("TENANT_ID", tenantId);
        if (uErr) throw { status: 500, message: uErr.message };
      }

      // 4) Fortschritts-Zeilen (ohne sie fehlen Leistungsstand und Reporting).
      const progRows = (created || []).map((n) => ({
        STRUCTURE_ID: n.ID, TENANT_ID: tenantId, REVENUE: n.REVENUE ?? 0,
        EXTRAS_PERCENT: n.EXTRAS_PERCENT ?? 0, EXTRAS: n.EXTRAS ?? 0,
        REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
        IMPORT_BATCH_ID: batchId,
      }));
      if (progRows.length) {
        const { error: prErr } = await supabase.from("PROJECT_PROGRESS").insert(progRows);
        if (prErr) throw { status: 500, message: prErr.message };
      }

      // 5) Elternwerte von unten nach oben — dieselbe Rechnung wie in der App.
      const parentKeys = [...new Set(ordered.map((r) => r._dbRow.parentKey).filter(Boolean))]
        .sort((a, b) => b.split(".").length - a.split(".").length);
      for (const key of parentKeys) {
        const parentId = idByKey.get(key);
        if (parentId) await projekteSvc.recalcParent(supabase, { parentId });
      }

      inserted += ordered.length;
    } catch (err) {
      throw { status: err?.status || 500, message: `Struktur für Projekt ${number} fehlgeschlagen: ${err?.message || err}` };
    }
  }
  return { inserted };
}


// ── Domäne: Projekte inkl. Struktur (kombiniert) ─────────────────────────────
//
// Warum es diese Domäne neben "project" und "project_structure" gibt: aus einem
// Altsystem kommen Projekt UND Leistungsstruktur in EINER Abfrage — sie in zwei
// Dateien zu zerlegen ist Handarbeit, die nur Fehler einbaut. Die beiden
// bestehenden Bereiche bleiben unverändert; wer getrennt importieren will,
// benutzt weiter sie.
//
// EINE ZEILE = EIN ELEMENT. Die Zeile mit LEERER Gliederung ist das Projekt
// selbst; alle übrigen werden zu Knoten seiner Leistungsstruktur. Das ist kein
// willkürliches Kennzeichen, sondern das, was die Quelle ohnehin hergibt: in
// wiko trägt die Projektwurzel den Pfad "000", und der wird beim Umsetzen zu
// einer leeren Gliederung.
const PROJECT_FULL_FIELDS = [
  { key: "legacy_ref",       header: "ID Vorsystem",     required: false, example: "138",                  aliases: ["idvorsystem", "altid", "legacyid", "quellid", "fremdid", "vorsystem", "herkunftsid"] , type: "text" },
  { key: "project_number",   header: "Projekt",          required: true,  example: "2016_099",             aliases: ["projekt", "projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "client",           header: "Projektadresse",   required: false, example: "Stadt Musterhausen",   aliases: ["projektadresse", "bauherr", "auftraggeber", "kunde", "adresse", "client"] , list: "addressName" },
  { key: "status",           header: "Status",           required: false, example: "in Bearbeitung",       aliases: ["status", "projektstatus", "projectstatus"] , list: "projectStatus" },
  { key: "manager",          header: "PL",               required: false, example: "MMu",                  aliases: ["pl", "projektleiter", "manager", "leiter", "verantwortlich", "projektverantwortlicher"] , list: "employeeShort" },
  { key: "project_type",     header: "Projekttyp",       required: false, example: "HOAI",                 aliases: ["projekttyp", "typ", "type", "projecttype"] , list: "projectType" },
  { key: "outline",          header: "Gliederung",       required: false, example: "1.2",                  aliases: ["gliederung", "gliederungsnummer", "position", "pos", "ordnungszahl", "outline", "wbs"] , type: "text" },
  { key: "abbr",             header: "Kürzel",           required: true,  example: "LP2",                  aliases: ["kuerzel", "kurzzeichen", "shortname", "code", "krzl"] },
  { key: "name",             header: "Bezeichnung",      required: false, example: "Vorplanung",           aliases: ["bezeichnung", "name", "namelong", "beschreibung", "leistung", "titel"] },
  { key: "billing",          header: "Abrechnungsart",   required: false, example: "Pauschal",             aliases: ["abrechnungsart", "abrechnung", "billing", "billingtype"] , list: "billing" },
  { key: "revenue",          header: "Honorar netto",    required: false, example: "27000",                aliases: ["honorar", "honorarnetto", "nettohonorar", "honorarsumme", "betrag", "summe", "revenue"] , type: "money" },
  { key: "extras_percent",   header: "Nebenkosten %",    required: false, example: "5",                    aliases: ["nebenkosten", "nk", "nkprozent", "nebenkostenprozent", "extras", "extraspercent"] },
  { key: "progress_percent", header: "Leistungsstand %", required: false, example: "40",                   aliases: ["leistungsstand", "leistungsstandprozent", "fortschritt", "stand", "fertigstellung", "erbracht"] },
  { key: "costs",            header: "Kosten",           required: false, example: "1500",                 aliases: ["kosten", "kostenanfangsbestand", "istkosten", "aufwand", "kostenblock"] , type: "money" },

  // ── Kalkulation ────────────────────────────────────────────────────────────
  // Alles optional: die meisten Projekte haben keine. Im wiko-Beispielexport
  // trugen 173 von 868 Projekten eine Kalkulation.
  //
  // Die Klammer ist die Kennung der Kalkulation, NICHT ihr Name: ein Projekt
  // kann mehrere haben, und zwei davon dürfen gleich heißen.
  { key: "calc_ref",         header: "Kalkulation ID Vorsystem", required: false, example: "131",          aliases: ["kalkulationidvorsystem", "kalkulationid", "kalkid", "hoaiid", "kalkulation"] , type: "text" },
  { key: "fee_master",       header: "Leistungsbild Kürzel",     required: false, example: "34_13_A",      aliases: ["leistungsbildkuerzel", "leistungsbild", "lb", "hoaiparagraph", "paragraph"] },
  { key: "calc_abbr",        header: "HOAI-Kürzel",              required: false, example: "34_13_A1",     aliases: ["hoaikuerzel", "kalkulationskuerzel", "kalkkuerzel"] },
  { key: "calc_name",        header: "HOAI-Bezeichnung",         required: false, example: "Gebäude",      aliases: ["hoaibezeichnung", "kalkulationsbezeichnung", "kalkname"] },
  { key: "zone",             header: "Zone",                     required: false, example: "3",            aliases: ["zone", "honorarzone"] },
  { key: "zone_percent",     header: "Zone %",                   required: false, example: "50",           aliases: ["zoneprozent", "zonesatz", "satzprozent", "honorarsatz"] },
  { key: "k0",               header: "K0",                       required: false, example: "",             aliases: ["k0"] , type: "money" },
  { key: "k1",               header: "K1",                       required: false, example: "",             aliases: ["k1"] , type: "money" },
  { key: "k2",               header: "K2",                       required: false, example: "81045.92",     aliases: ["k2"] , type: "money" },
  { key: "k3",               header: "K3",                       required: false, example: "",             aliases: ["k3"] , type: "money" },
  { key: "k4",               header: "K4",                       required: false, example: "",             aliases: ["k4"] , type: "money" },
  { key: "lph",              header: "LPH",                      required: false, example: "2",            aliases: ["lph", "leistungsphase", "phase"] , type: "text" },
  { key: "kx",               header: "KX",                       required: false, example: "3",            aliases: ["kx", "kbezug", "kreferenz"] , type: "text" },
  { key: "lph_percent",      header: "LPH Prozent",              required: false, example: "7",            aliases: ["lphprozent", "lphsatz", "phasenprozent", "prozentvereinbart"] },
];

/**
 * Leistungsbild-Kürzel aus wiko in das der plan&simple-Stammdaten übersetzen.
 *
 * wiko schreibt  <Paragraf>_<Jahr zweistellig>[_<Variante>]   → "34_13_A"
 * plan&simple    <Jahr vierstellig>_<Paragraf>[_<Variante>]   → "2013_34_A"
 *
 * Dieselben Leistungsbilder, andere Reihenfolge. Geprüft an allen sechs
 * Kürzeln des Beispielexports (34_13_A, 34_21_A, 55_13, 55_21, 51_21, 39_13) —
 * jedes hat seine Entsprechung im Katalog, und die LPH-Prozentsätze stimmen
 * überein.
 *
 * Es bleibt eine Regel über fremde Schreibweisen, deshalb wird der Originalwert
 * ebenfalls versucht: passt weder das eine noch das andere, bleibt die
 * Kalkulation aus und die Zeile sagt es. Das Element entsteht trotzdem.
 */
/**
 * Zonen heißen in plan&simple römisch ("Zone III"), in wiko stehen sie als
 * Zahl. Beides wird zur Zahl — mehr braucht der Abgleich nicht.
 */
/**
 * K-Bezug in die Schreibweise der Stammdaten bringen: 3 → "K3".
 * Steht schon "K3" da, bleibt es. Ohne Angabe null — dann setzt die
 * Oberflaeche ihren Vorgabewert.
 */
function kxSchreibweise(v) {
  const t = s(v).trim().toUpperCase();
  if (!t) return null;
  const ziffer = t.replace(/[^0-9]/g, "");
  if (!ziffer) return null;
  const n = parseInt(ziffer, 10);
  return n >= 0 && n <= 4 ? `K${n}` : null;
}

function roemischZuZahl(v) {
  const t = s(v).toUpperCase().replace(/[^IVX0-9]/g, "");
  if (!t) return null;
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  const tabelle = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  return tabelle[t] ?? null;
}

function feeMasterKandidaten(kuerzel) {
  const roh = s(kuerzel).trim();
  if (!roh) return [];
  const kandidaten = [roh];
  const m = roh.match(/^(\d+)_(\d{2})(?:_(.+))?$/);
  if (m) {
    const [, paragraf, jahr, variante] = m;
    const vierstellig = Number(jahr) >= 70 ? "19" + jahr : "20" + jahr;
    kandidaten.push(variante ? `${vierstellig}_${paragraf}_${variante}` : `${vierstellig}_${paragraf}`);
  }
  return kandidaten;
}

async function loadProjectFullContext(supabase, tenantId) {
  const [companyRes, statusRes, typeRes, empRes, addrRes, projRes, settingsRes,
         masterRes, zoneRes, phaseRes, tabelleRes] = await Promise.all([
    supabase.from("COMPANY").select("ID").eq("TENANT_ID", tenantId).order("ID", { ascending: true }).limit(1),
    supabase.from("PROJECT_STATUS").select("ID, ABBR"),                          // global, ohne Mandant
    supabase.from("PROJECT_TYPE").select("ID, ABBR").eq("TENANT_ID", tenantId),
    supabase.from("EMPLOYEE").select("ID, ABBR, FIRST_NAME, LAST_NAME").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("ADDRESS").select("ID, ADDRESS_NAME_1").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT").select("ID, ABBR").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("TENANT_SETTINGS").select("KEY, VALUE").eq("TENANT_ID", tenantId),
    // Honorar-Stammdaten: global, ohne Mandant (wie VAT und COUNTRY).
    supabase.from("FEE_MASTERS").select("ID, ABBR").limit(10000),
    supabase.from("FEE_ZONES").select("ID, FEE_MASTER_ID, ABBR").limit(10000),
    supabase.from("FEE_PHASE").select("ID, FEE_MASTER_ID, ABBR, SORT_ORDER, FEE_PERCENT").limit(10000),
    // Honorartafeln einmal fuer alle. Die Interpolation je Kalkulation und
    // K-Wert waere sonst ein Paar Abfragen pro Rechnung — bei hunderten
    // Kalkulationen wieder der Weg in den Zeitueberlauf.
    supabase.from("FEE_TABLES").select("FEE_MASTER_ID, BASE, ZONE_1, ZONE_2, ZONE_3, ZONE_4, ZONE_5, ZONE_TOP").limit(100000),
  ]);

  const statusByName = new Map();
  const statusNamen = [];
  for (const r of statusRes.data || []) if (r.ABBR) { statusByName.set(katalogKey(r.ABBR), r.ID); statusNamen.push(r.ABBR); }
  const typeByName = new Map();
  for (const r of typeRes.data || []) if (r.ABBR) typeByName.set(katalogKey(r.ABBR), r.ID);
  const empByName = new Map();
  for (const e of empRes.data || []) {
    if (e.ABBR) empByName.set(norm(e.ABBR), e.ID);
    const full = norm(`${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`);
    if (full) empByName.set(full, e.ID);
  }
  const addrByName = new Map();
  for (const a of addrRes.data || []) if (a.ADDRESS_NAME_1) addrByName.set(norm(a.ADDRESS_NAME_1), a.ID);

  const existingKeys = new Set();
  for (const p of projRes.data || []) if (p.ABBR) existingKeys.add(norm(p.ABBR));

  const defaults = {};
  for (const row of settingsRes.data || []) defaults[row.KEY] = row.VALUE;

  // Leistungsbild über sein Kürzel; Zone und Phase je Leistungsbild, weil
  // "Zone III" bei §34 und §55 verschiedene Zeilen sind.
  const feeMasterByAbbr = new Map();
  for (const m of masterRes.data || []) if (m.ABBR) feeMasterByAbbr.set(katalogKey(m.ABBR), m.ID);

  const zoneByMaster = new Map();     // FEE_MASTER_ID → Map(Nummer → ZONE_ID)
  for (const z of zoneRes.data || []) {
    if (!zoneByMaster.has(z.FEE_MASTER_ID)) zoneByMaster.set(z.FEE_MASTER_ID, new Map());
    const nummer = roemischZuZahl(z.ABBR);
    if (nummer != null) zoneByMaster.get(z.FEE_MASTER_ID).set(nummer, z.ID);
  }

  const phaseByMaster = new Map();    // FEE_MASTER_ID → Map(Nummer → { id, percent })
  for (const p of phaseRes.data || []) {
    if (!phaseByMaster.has(p.FEE_MASTER_ID)) phaseByMaster.set(p.FEE_MASTER_ID, new Map());
    const nummer = parseInt(String(p.ABBR || "").replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(nummer)) phaseByMaster.get(p.FEE_MASTER_ID).set(nummer, { id: p.ID, percent: num(p.FEE_PERCENT) });
  }

  // Zonenkuerzel (roemisch) je Zone-ID — die Honorartafel hat je Zone eine
  // eigene Spalte, und die Zuordnung laeuft ueber das Kuerzel.
  const zoneAbbrById = new Map();
  for (const z of zoneRes.data || []) zoneAbbrById.set(z.ID, z.ABBR);

  const tafelByMaster = new Map();
  for (const t of tabelleRes.data || []) {
    if (!tafelByMaster.has(t.FEE_MASTER_ID)) tafelByMaster.set(t.FEE_MASTER_ID, []);
    tafelByMaster.get(t.FEE_MASTER_ID).push(t);
  }
  for (const zeilen of tafelByMaster.values()) zeilen.sort((a, b) => num(a.BASE) - num(b.BASE));

  return {
    companyId: companyRes.data?.[0]?.ID ?? null,
    statusByName, statusNamen, typeByName, empByName, addrByName, existingKeys, defaults,
    feeMasterByAbbr, zoneByMaster, phaseByMaster, zoneAbbrById, tafelByMaster,
    existingIds: new Map(),   // Zusammenführen ist hier nicht vorgesehen
  };
}

function buildProjectFullEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const number = s(mapped.project_number);
  if (!number) { messages.push({ level: "error", text: "Projekt (Nummer) fehlt (Pflichtfeld)" }); ok = false; }

  const nameShort = s(mapped.abbr);
  if (!nameShort) { messages.push({ level: "error", text: "Kürzel fehlt (Pflichtfeld)" }); ok = false; }

  const outline = parseOutline(mapped.outline);
  const istProjektzeile = !outline;

  if (outline && outline.length > MAX_STRUCTURE_DEPTH) {
    messages.push({ level: "error", text: `Gliederung ist ${outline.length} Ebenen tief — maximal ${MAX_STRUCTURE_DEPTH}` });
    ok = false;
  }

  // ── Projektweite Felder ───────────────────────────────────────────────────
  // Sie stehen nur auf der Projektzeile; auf Unterzeilen werden sie ignoriert,
  // statt sie zu bemängeln — mancher Export wiederholt sie auf jeder Zeile.
  let statusId = null, managerId = null, typeId = null, typeNew = null, addressId = null;
  if (istProjektzeile) {
    const statusIn = s(mapped.status);
    if (statusIn) {
      const hit = ctx.statusByName.get(katalogKey(statusIn));
      if (hit != null) statusId = hit;
      else {
        const erlaubt = [...(ctx.statusNamen || [])].join(", ");
        messages.push({ level: "error", text: `Status „${statusIn}“ gibt es nicht${erlaubt ? ` — erlaubt sind: ${erlaubt}` : ""}` });
        ok = false;
      }
    } else {
      // Ohne Angabe die Vorbelegung. Ein Projekt ohne Status wäre in jeder
      // Liste und jedem Filter ein Sonderfall.
      const vorbelegung = Number(ctx.defaults?.default_project_status_id);
      if (Number.isFinite(vorbelegung) && vorbelegung > 0) statusId = vorbelegung;
      else { messages.push({ level: "error", text: "Status fehlt und es ist keine Vorbelegung gepflegt (Einstellungen → Vorbelegungen)" }); ok = false; }
    }

    const plIn = s(mapped.manager);
    if (plIn) {
      const hit = ctx.empByName.get(norm(plIn));
      if (hit != null) managerId = hit;
      else messages.push({ level: "warn", text: `Projektleiter „${plIn}“ nicht gefunden — bleibt leer (zuerst Mitarbeiter importieren)` });
    }

    // Projekttyp: unbekannte werden angelegt — wie die Abteilung beim
    // Mitarbeiter. Ein Projekttyp ist eine Bezeichnung, kein Regelwerk.
    const typIn = s(mapped.project_type);
    if (typIn) {
      const hit = ctx.typeByName.get(katalogKey(typIn));
      if (hit != null) typeId = hit;
      else { typeNew = typIn; messages.push({ level: "warn", text: `Projekttyp „${typIn}“ gibt es noch nicht — wird angelegt` }); }
    }

    const kundeIn = s(mapped.client);
    if (kundeIn) {
      const hit = ctx.addrByName.get(norm(kundeIn));
      if (hit != null) addressId = hit;
      else messages.push({ level: "warn", text: `Bauherr/Adresse „${kundeIn}“ nicht gefunden — bleibt leer (zuerst Adressen importieren)` });
    }
  }

  // ── Elementfelder ─────────────────────────────────────────────────────────
  // „Leistungsstand" ist wikos Name für Pauschal — beide Vokabulare erkennen,
  // damit dieselbe Datei vor und nach einer Umbenennung funktioniert.
  const bin = norm(mapped.billing);
  let billingTypeId = null;
  if (bin) {
    const nachAufwand = bin.includes("stund") || bin.includes("zeit") || bin.includes("tec")
      || bin.includes("nachweis") || bin.includes("aufwand") || bin === "2";
    billingTypeId = nachAufwand ? 2 : 1;
  }

  const revRaw = s(mapped.revenue);
  const rev = parseAmountDE(mapped.revenue);
  if (revRaw && (rev.invalid || rev.value == null)) {
    messages.push({ level: "error", text: rev.warDatum ? datumStattZahlHinweis("Honorar", revRaw) : `Honorar „${revRaw}“ ist keine gültige Zahl` });
    ok = false;
  } else if (rev.value != null && rev.value < 0) messages.push({ level: "warn", text: "Honorar ist negativ — als Minderung übernommen; bitte in der Vorschau prüfen" });

  const nkRaw = s(mapped.extras_percent);
  const nk = parseAmountDE(mapped.extras_percent);
  if (nkRaw && (nk.invalid || nk.value == null)) {
    messages.push({ level: "warn", text: nk.warDatum ? datumStattZahlHinweis("Nebenkosten %", nkRaw) : "Nebenkosten % ist keine Zahl — wird als 0 übernommen" });
  }

  const standRaw = s(mapped.progress_percent);
  const stand = parseAmountDE(mapped.progress_percent);
  let progress = 0;
  if (standRaw && (stand.invalid || stand.value == null)) {
    messages.push({ level: "warn", text: stand.warDatum ? datumStattZahlHinweis("Leistungsstand %", standRaw) : "Leistungsstand ist keine Zahl — wird als 0 übernommen" });
  }
  else if (stand.value != null) {
    progress = stand.value;
    if (progress < 0 || progress > 100) { messages.push({ level: "warn", text: `Leistungsstand ${progress} % liegt außerhalb 0–100 — wird begrenzt` }); progress = Math.min(100, Math.max(0, progress)); }
  }

  const kostenRaw = s(mapped.costs);
  const kosten = parseAmountDE(mapped.costs);
  let costs = 0;
  if (kostenRaw && (kosten.invalid || kosten.value == null)) {
    messages.push({ level: "warn", text: kosten.warDatum ? datumStattZahlHinweis("Kosten", kostenRaw) : "Kosten sind keine Zahl — werden nicht übernommen" });
  }
  else if (kosten.value != null) costs = kosten.value;

  // ── Kalkulation ───────────────────────────────────────────────────────────
  // Alles daran ist optional. Fehlt das Leistungsbild oder ist es unbekannt,
  // bleibt die Kalkulation aus — das ELEMENT entsteht trotzdem. Eine
  // Honorarermittlung ist eine Zugabe der Übernahme, kein Pflichtteil.
  let kalk = null;
  const calcRef = s(mapped.calc_ref);
  const lbIn = s(mapped.fee_master);
  if (calcRef || lbIn) {
    let feeMasterId = null;
    for (const kandidat of feeMasterKandidaten(lbIn)) {
      const hit = ctx.feeMasterByAbbr?.get(katalogKey(kandidat));
      if (hit != null) { feeMasterId = hit; break; }
    }
    if (feeMasterId == null) {
      if (lbIn) messages.push({ level: "warn", text: `Leistungsbild „${lbIn}“ nicht im Honorar-Stammdatensatz gefunden — die Kalkulation bleibt aus` });
      else messages.push({ level: "warn", text: "Kalkulation ohne Leistungsbild — bleibt aus" });
    } else {
      const zoneNr = roemischZuZahl(mapped.zone);
      const zoneId = zoneNr != null ? (ctx.zoneByMaster?.get(feeMasterId)?.get(zoneNr) ?? null) : null;
      if (zoneNr != null && zoneId == null) messages.push({ level: "warn", text: `Honorarzone ${zoneNr} gibt es bei diesem Leistungsbild nicht — bleibt leer` });

      const lphNr = parseInt(String(s(mapped.lph)).replace(/[^0-9]/g, ""), 10);
      const phase = Number.isFinite(lphNr) ? (ctx.phaseByMaster?.get(feeMasterId)?.get(lphNr) ?? null) : null;
      const phaseId = phase?.id ?? null;
      if (Number.isFinite(lphNr) && phaseId == null) messages.push({ level: "warn", text: `Leistungsphase ${lphNr} gibt es bei diesem Leistungsbild nicht — bleibt ohne Zuordnung` });

      const zahl = (v) => { const p = parseAmountDE(v); return p.value ?? 0; };
      const kBloecke = [zahl(mapped.k0), zahl(mapped.k1), zahl(mapped.k2), zahl(mapped.k3), zahl(mapped.k4)];

      // Welcher Kostenblock traegt die anrechenbaren Kosten?
      //
      // wikos KX taugt als Zeiger nicht: in der Uebernahme standen 535 Zeilen
      // auf KX=3, hatten aber nur K0 gefuellt. Uebernaehme man das, zeigte die
      // Kalkulation auf einen leeren Block — Basis 0, Honorar 0, und im Wizard
      // ueberall Gedankenstriche.
      //
      // Deshalb entscheidet der Inhalt: KX wird genommen, WENN es auf einen
      // gefuellten Block zeigt; sonst der erste gefuellte. Ohne jeden Wert
      // bleibt es bei K0.
      const gefuellt = kBloecke.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
      const kxRoh = parseInt(String(s(mapped.kx)).replace(/[^0-9]/g, ""), 10);
      const kIndex = Number.isFinite(kxRoh) && gefuellt.includes(kxRoh) ? kxRoh
        : (gefuellt.length ? gefuellt[0] : 0);
      if (gefuellt.length > 1) {
        messages.push({ level: "warn", text: `Anrechenbare Kosten stehen in mehreren Blöcken (K${gefuellt.join(", K")}) — die Kalkulation rechnet mit K${kIndex}` });
      }

      kalk = {
        ref: calcRef || `${number}#${lbIn}`,
        feeMasterId, zoneId,
        zonePercent: zahl(mapped.zone_percent),
        // K0..K4 sind die ANRECHENBAREN BAUKOSTEN, aus denen sich das Honorar
        // erst ergibt — nicht das Honorar selbst.
        k: kBloecke,
        abbr: s(mapped.calc_abbr) || lbIn,
        name: s(mapped.calc_name) || s(mapped.calc_abbr) || lbIn,
        // wiko fuehrt den K-Bezug als Ziffer, plan&simple als "K0".."K4" —
        // dieselbe Bedeutung, andere Schreibweise. Ohne die Umsetzung stand im
        // Wizard ueberall K0, also der falsche Kostenblock.
        phaseId, kx: `K${kIndex}`,
        phasePercent: zahl(mapped.lph_percent),
        // Der Tafelwert der Phase — im Wizard die Spalte "Basis %".
        phasePercentBase: phase?.percent ?? null,
      };
    }
  }

  const dbRow = {
    istProjektzeile, projectNumber: number, legacyRef: s(mapped.legacy_ref) || null, kalk,
    // Projektzeile
    projectName: s(mapped.name) || nameShort, statusId, managerId, typeId, typeNew, addressId,
    // Knoten
    outline, nameShort, nameLong: s(mapped.name) || nameShort,
    billingTypeId, revenue: rev.value ?? 0, extrasPercent: nk.value ?? 0,
    progressPercent: progress, costs,
    // von finalizeRows gesetzt:
    key: null, parentKey: null, depth: outline ? outline.length : 0, isLeaf: true, sortIndex: 0,
  };

  const display = {
    projekt: number,
    knoten: istProjektzeile ? "PROJEKT" : `${outline.join(".")}  ${nameShort}`,
    bezeichnung: dbRow.nameLong !== nameShort ? dbRow.nameLong : "",
    abrechnung: billingTypeId === 2 ? "Stunden" : billingTypeId === 1 ? "Pauschal" : "",
    honorar: rev.value ? rev.value.toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " €" : "",
    stand: progress ? progress + " %" : "",
    kalkulation: kalk ? `${kalk.abbr}${kalk.phaseId ? " · LPH " + s(mapped.lph) : ""}` : "",
  };

  // Entdoppelt wird über die Projektnummer — aber nur die Projektzeile trägt
  // den Schlüssel. Sonst hielte der Assistent jede Strukturzeile für eine
  // Dublette derselben Nummer.
  return { ok, messages, dbRow, matchKey: istProjektzeile ? norm(number) : `${norm(number)}#${outline.join(".")}`, display };
}


/**
 * Zeilenübergreifende Prüfung je Projekt.
 *
 * Eine einzelne Zeile kann nicht wissen, ob sie ein Blatt ist, ob ihr Vater
 * mitgeliefert wurde oder ob die Projektzeile überhaupt existiert. Deshalb
 * passiert das hier — und zwar ALLES-ODER-NICHTS je Projekt: eine halb
 * importierte Struktur ist schlimmer als gar keine, weil die Honorarsummen
 * dann still falsch stehen.
 */
function finalizeProjectFullRows(rows, ctx) {
  const byProject = new Map();
  for (const r of rows) {
    const num = r._dbRow?.projectNumber;
    if (!num) continue;
    if (!byProject.has(num)) byProject.set(num, []);
    byProject.get(num).push(r);
  }

  for (const [number, group] of byProject) {
    // ── 1. Projekt bereits vorhanden? Dann das GANZE Projekt als Dublette ──
    // Nur die Projektzeile zu markieren würde die Strukturzeilen heimatlos
    // zurücklassen: der Assistent überspränge eine Zeile und importierte die
    // übrigen ins Leere.
    if (ctx.existingKeys.has(norm(number))) {
      for (const r of group) {
        if (r.status === "error") continue;
        r.status = "duplicate";
        r.messages.push({ level: "warn", text: `Projekt „${number}“ gibt es bereits — Projekt und Struktur werden übersprungen` });
      }
      continue;
    }

    const usable = group.filter((r) => r.status !== "error");
    if (!usable.length) continue;

    // ── 2. Genau eine Projektzeile ────────────────────────────────────────
    const projektzeilen = usable.filter((r) => r._dbRow.istProjektzeile);
    if (projektzeilen.length === 0) {
      // Es gibt zwei sehr verschiedene Gruende dafuer, und sie auseinander zu
      // halten ist der Unterschied zwischen "deine Datei ist falsch gebaut" und
      // "ein Wert in dieser einen Zeile stimmt nicht".
      //
      // Vorher meldeten beide "hat keine Projektzeile". Bei der wiko-Uebernahme
      // hiess das fuer 177 Projekte: die Zeile WAR da, nur ihr Status stand
      // nicht im Katalog — und der Nutzer suchte den Fehler an der falschen
      // Stelle.
      const fehlerhafteProjektzeile = group.find((r) => r._dbRow.istProjektzeile);
      for (const r of group) {
        if (r === fehlerhafteProjektzeile) continue;   // die traegt ihren eigenen Fehler
        r.status = "error";
        r.messages.push({ level: "error", text: fehlerhafteProjektzeile
          ? `Projekt „${number}“ wird übersprungen — seine Projektzeile (Zeile ${fehlerhafteProjektzeile.row}) ist fehlerhaft; der Grund steht dort`
          : `Projekt „${number}“ hat keine Projektzeile — genau eine Zeile muss die Gliederung leer lassen` });
      }
      continue;
    }
    if (projektzeilen.length > 1) {
      for (const r of projektzeilen) {
        r.status = "error";
        r.messages.push({ level: "error", text: `Projekt „${number}“ hat ${projektzeilen.length} Zeilen mit leerer Gliederung — es darf nur eine geben` });
      }
    }

    const knoten = usable.filter((r) => !r._dbRow.istProjektzeile);

    // ── 3. Schlüssel und Eltern ───────────────────────────────────────────
    const byKey = new Map();
    for (const r of knoten) {
      const e = r._dbRow;
      e.key = e.outline.join(".");
      e.parentKey = e.outline.length > 1 ? e.outline.slice(0, -1).join(".") : null;
      e.depth = e.outline.length;
      const schon = byKey.get(e.key);
      if (schon) {
        const a = schon._dbRow, b = e;
        const gleich = norm(a.nameShort) === norm(b.nameShort)
          && a.billingTypeId === b.billingTypeId
          && num(a.revenue) === num(b.revenue)
          && num(a.extrasPercent) === num(b.extrasPercent)
          && num(a.progressPercent) === num(b.progressPercent);
        if (gleich) {
          // Dieselbe Position, nur eine weitere Leistungsphase.
          b.istZusatzzeile = true;
          a.mehrfachLph = (a.mehrfachLph || 1) + 1;
        } else {
          r.status = "error";
          r.messages.push({ level: "error", text: `Gliederung „${e.key}“ kommt in diesem Projekt mehrfach vor — und die Zeilen widersprechen sich` });
        }
      } else byKey.set(e.key, r);
    }
    for (const r of knoten) {
      const p = r._dbRow.parentKey;
      if (p && !byKey.has(p)) {
        r.status = "error";
        r.messages.push({ level: "error", text: `Übergeordnete Zeile „${p}“ fehlt in der Datei` });
      }
    }

    // Zusatzzeilen (weitere Leistungsphase desselben Elements) zaehlen ab
    // hier nicht mehr mit — der Knoten entsteht aus der ersten Zeile.
    const echte = knoten.filter((r) => !r._dbRow.istZusatzzeile);
    for (const r of knoten) {
      if (!r._dbRow.istZusatzzeile) continue;
      r.messages.push({ level: "warn", text: "Weitere Leistungsphase desselben Elements — der Knoten entsteht nur einmal" });
    }
    for (const r of echte) {
      if (!r._dbRow.mehrfachLph) continue;
      r.messages.push({ level: "warn", text: `Element hängt an ${r._dbRow.mehrfachLph} Leistungsphasen — die Kalkulation wird verknüpft, die Phase bleibt offen und ist nachzupflegen` });
      // Eine von mehreren Phasen willkürlich zu wählen wäre schlimmer als
      // keine: die Zahl sähe gepflegt aus und wäre geraten.
      if (r._dbRow.kalk) r._dbRow.kalk.phaseId = null;
    }

    // ── 4. Blatt oder Knoten ──────────────────────────────────────────────
    const eltern = new Set(echte.map((r) => r._dbRow.parentKey).filter(Boolean));
    for (const r of echte) {
      const e = r._dbRow;
      e.isLeaf = !eltern.has(e.key);
      const einzug = e.depth > 1 ? "›".repeat(e.depth - 1) + " " : "";
      r.display.knoten = `${einzug}${e.key}  ${e.nameShort}`;
    }

    // ── 5. Geld und Abrechnungsart gehören an die Blätter ─────────────────
    for (const r of echte) {
      const e = r._dbRow;
      if (!e.isLeaf) {
        if (e.revenue) {
          r.messages.push({ level: "warn", text: "Übergeordnete Zeile: Honorar wird aus den Unterzeilen gerechnet und hier ignoriert" });
          e.revenue = 0;
        }
        continue;
      }
      if (!e.billingTypeId) {
        r.status = "error";
        r.messages.push({ level: "error", text: "Abrechnungsart fehlt (bei unterster Ebene Pflicht: Pauschal oder Stunden)" });
      } else if (e.billingTypeId === 2 && e.revenue) {
        // Bei einer Stunden-Position entsteht der Erloes aus Buchungen, nicht
        // aus einem Feld am Knoten. Das mitgelieferte Honorar ist aber der
        // bisher erwirtschaftete Erloes des Altsystems — ihn wegzuwerfen hiesse,
        // die Position mit 0 zu starten und jede Folgerechnung (Leistungsstand,
        // Nebenkosten) auf einer Null aufzubauen.
        //
        // Er wird deshalb zur pauschalen ERLOESBUCHUNG, so wie die Kosten zur
        // Kostenbuchung werden. Jede weitere Buchung rechnet dann normal weiter.
        r.messages.push({ level: "warn", text: "Stunden-Position: das Honorar wird als pauschale Erlösbuchung übernommen (der Erlös entsteht hier aus Buchungen)" });
        e.revenueBooking = e.revenue;
        e.revenue = 0;
      }
    }

    // ── 6. Kosten brauchen einen Knoten ───────────────────────────────────
    const projektzeile = projektzeilen[0];
    if (projektzeile?._dbRow.costs) {
      projektzeile.messages.push({ level: "warn", text: "Kosten auf der Projektzeile werden nicht übernommen — sie gehören an ein Element" });
      projektzeile._dbRow.costs = 0;
    }

    // ── 7. Geschwisterreihenfolge ─────────────────────────────────────────
    const jeElternteil = new Map();
    for (const r of echte) {
      const p = r._dbRow.parentKey || "";
      const n = jeElternteil.get(p) || 0;
      r._dbRow.sortIndex = n;
      jeElternteil.set(p, n + 1);
    }

    // ── 8. Alles-oder-nichts ──────────────────────────────────────────────
    const kaputt = group.filter((r) => r.status === "error");
    if (kaputt.length) {
      for (const r of group) {
        if (r.status === "error") continue;
        r.status = "error";
        r.messages.push({ level: "error", text: `Projekt „${number}“ wird übersprungen — eine andere Zeile dieses Projekts ist fehlerhaft (Zeile ${kaputt[0].row})` });
      }
      continue;
    }

    if (!echte.length) {
      projektzeile.messages.push({ level: "warn", text: "Projekt ohne Struktur — es entsteht nur das Projekt samt Vertrag" });
    }
  }
}


/**
 * Schreiben je Projekt. Die Reihenfolge ist nicht beliebig:
 *
 *   1. Projekttypen, die es noch nicht gibt   (PROJECT.PROJECT_TYPE_ID zeigt darauf)
 *   2. PROJECT
 *   3. CONTRACT aus den Vorbelegungen         (die Knoten tragen seine ID)
 *   4. EMPLOYEE2PROJECT für die Projektleitung
 *   5. Knoten flach, dann FATHER_ID im zweiten Durchgang
 *   6. PROJECT_PROGRESS  — ohne diese Zeilen bleiben Leistungsstand und
 *      Reporting leer, obwohl die Struktur steht
 *   7. Kosten als Buchung
 *   8. Elternwerte von unten nach oben rechnen
 *
 * Ein Projekt scheitert als Ganzes oder gar nicht. Die Zeilen sind in
 * finalizeRows bereits daraufhin geprüft.
 */
async function commitProjectFullRows(rows, { supabase, tenantId, batchId, ctx, employeeId }) {
  const defaults = ctx.defaults || {};

  const byProject = new Map();
  for (const r of rows) {
    const num = r._dbRow.projectNumber;
    if (!byProject.has(num)) byProject.set(num, []);
    byProject.get(num).push(r);
  }

  // Alles geht gebuendelt. Die erste Fassung schrieb je Projekt: ein Insert,
  // ein Vertrag, eine Zuordnung, ein Struktur-Insert, ein UPDATE je Knoten fuer
  // FATHER_ID und drei Abfragen je Elternknoten zum Hochrechnen. Bei 868
  // Projekten mit 4050 Knoten sind das ueber 15.000 Anfragen nacheinander —
  // der Gateway bricht nach 30 Sekunden mit 504 ab, und der Nutzer sieht einen
  // halb geschriebenen Stapel.
  //
  // Jetzt: eine Handvoll Stapel-Inserts. Die Knoten entstehen EBENENWEISE,
  // dadurch ist FATHER_ID schon beim Einfuegen bekannt und es braucht kein
  // zweites Schreiben. Die Elternwerte rechnet JS von unten nach oben — bei
  // einem frisch angelegten Baum ohne Zuschlaege ist das dieselbe Summe, die
  // recalcParent bilden wuerde, nur ohne 4800 Rundreisen.
  const einfuegen = async (tabelle, zeilen, spalten, was) => {
    const out = [];
    for (let i = 0; i < zeilen.length; i += 500) {
      const teil = zeilen.slice(i, i + 500);
      const abfrage = supabase.from(tabelle).insert(teil);
      const { data, error } = spalten ? await abfrage.select(spalten) : await abfrage;
      if (error) throw { status: 500, message: `${was} fehlgeschlagen (${out.length} von ${zeilen.length} geschrieben): ${error.message}. Stapel #${batchId} kann zurückgesetzt werden.` };
      if (spalten) out.push(...(data || []));
    }
    return out;
  };

  // ── 1. Fehlende Projekttypen ──────────────────────────────────────────────
  const typen = new Map(ctx.typeByName);
  const neueTypen = new Map();
  for (const r of rows) {
    const t = r._dbRow.typeNew;
    if (t && !typen.has(katalogKey(t))) neueTypen.set(katalogKey(t), t);
  }
  if (neueTypen.size) {
    const angelegt = await einfuegen("PROJECT_TYPE",
      [...neueTypen.values()].map((abbr) => ({ TENANT_ID: tenantId, ABBR: abbr, IMPORT_BATCH_ID: batchId })),
      "ID, ABBR", "Projekttypen anlegen");
    for (const t of angelegt) typen.set(katalogKey(t.ABBR), t.ID);
  }

  // ── 2. Projekte ───────────────────────────────────────────────────────────
  const projektListe = [...byProject.entries()]
    .map(([number, group]) => ({ number, group, kopf: group.find((r) => r._dbRow.istProjektzeile)?._dbRow }))
    .filter((p) => p.kopf);

  const projektIds = await einfuegen("PROJECT", projektListe.map(({ number, kopf }) => ({
    ABBR: number, NAME: kopf.projectName,
    COMPANY_ID: ctx.companyId,
    PROJECT_STATUS_ID: kopf.statusId,
    PROJECT_TYPE_ID: kopf.typeId ?? (kopf.typeNew ? typen.get(katalogKey(kopf.typeNew)) ?? null : null),
    PROJECT_MANAGER_ID: kopf.managerId,
    ADDRESS_ID: kopf.addressId,
    LEGACY_REF: kopf.legacyRef,
    TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
  })), "ID", "Projekte anlegen");
  projektListe.forEach((p, i) => { p.projectId = projektIds[i]?.ID ?? null; });

  // ── 3. Vertraege ──────────────────────────────────────────────────────────
  // Die kaufmaennischen Felder ausschliesslich aus contractDefaults — vier
  // Stellen legen Vertraege an, und genau deren Driften hatte die
  // Skonto-Vorbelegung wirkungslos gemacht.
  const vertragsVorlage = contractDefaults(defaults);
  const vertragIds = await einfuegen("CONTRACT", projektListe.map(({ number, kopf, projectId }) => ({
    ABBR: number, NAME: kopf.projectName, PROJECT_ID: projectId,
    INVOICE_ADDRESS_ID: kopf.addressId, INVOICE_CONTACT_ID: null,
    TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId, ...vertragsVorlage,
  })), "ID", "Verträge anlegen");
  projektListe.forEach((p, i) => { p.contractId = vertragIds[i]?.ID ?? null; });

  // ── 4. Projektleitung ─────────────────────────────────────────────────────
  const zuordnungen = projektListe.filter((p) => p.kopf.managerId).map((p) => ({
    TENANT_ID: tenantId, PROJECT_ID: p.projectId, EMPLOYEE_ID: p.kopf.managerId,
    ROLE_ID: null, HOURLY_RATE: 0,
  }));
  if (zuordnungen.length) await einfuegen("EMPLOYEE2PROJECT", zuordnungen, null, "Projektleitung zuordnen");

  // ── 5. Kalkulationen ──────────────────────────────────────────────────────
  // Je Kennung EINE, auch wenn sie an zwanzig Elementen haengt.
  const kalkZeilen = [], kalkSchluessel = [];
  for (const p of projektListe) {
    const gesehen = new Set();
    for (const r of p.group) {
      const k = r._dbRow.kalk;
      if (!k || gesehen.has(k.ref)) continue;
      gesehen.add(k.ref);
      kalkSchluessel.push(k.ref);
      // Das Honorar je K-Wert aus der Honorartafel — genau die Rechnung, die
      // der Wizard beim Speichern macht. Ohne sie blieben REVENUE_K0..K4 leer
      // und die Kalkulation zeigte ueberall Gedankenstriche, obwohl Zone und
      // Baukosten dastehen.
      const zoneAbbr = k.zoneId != null ? ctx.zoneAbbrById?.get(k.zoneId) : null;
      const tafel = ctx.tafelByMaster?.get(k.feeMasterId) || null;
      const honorar = (kosten) => {
        if (!zoneAbbr || !tafel || !kosten) return 0;
        try {
          return fmt2(stammdatenSvc.honorarAusTafel({ zoneAbbr, tafel, zonePercent: k.zonePercent, cost: kosten }) ?? 0);
        } catch { return 0; }   // unbekannte Zonenschreibweise — dann eben ohne
      };
      k.revenueK = k.k.map(honorar);

      kalkZeilen.push({
        TENANT_ID: tenantId, PROJECT_ID: p.projectId,
        FEE_MASTER_ID: k.feeMasterId, ABBR: k.abbr, NAME: k.name,
        ZONE_ID: k.zoneId, ZONE_PERCENT: k.zonePercent,
        // Anrechenbare Baukosten — Eingabe der Rechnung …
        CONSTRUCTION_COSTS_K0: k.k[0], CONSTRUCTION_COSTS_K1: k.k[1],
        CONSTRUCTION_COSTS_K2: k.k[2], CONSTRUCTION_COSTS_K3: k.k[3],
        CONSTRUCTION_COSTS_K4: k.k[4],
        // … und ihr Ergebnis.
        REVENUE_K0: k.revenueK[0], REVENUE_K1: k.revenueK[1], REVENUE_K2: k.revenueK[2],
        REVENUE_K3: k.revenueK[3], REVENUE_K4: k.revenueK[4],
      });
    }
  }
  const kalkNachRef = new Map();       // ref → der Kalkulationssatz der ersten Zeile
  for (const r of rows) { const k = r._dbRow.kalk; if (k && !kalkNachRef.has(k.ref)) kalkNachRef.set(k.ref, k); }
  const kalkIdNachRef = new Map();
  if (kalkZeilen.length) {
    const angelegt = await einfuegen("FEE_CALCULATION_MASTER", kalkZeilen, "ID", "Kalkulationen anlegen");
    kalkSchluessel.forEach((ref, i) => { if (angelegt[i]) kalkIdNachRef.set(ref, angelegt[i].ID); });
  }

  const phasenZeilen = [], phasenSchluessel = [];
  {
    const gesehen = new Set();
    for (const r of rows) {
      const k = r._dbRow.kalk;
      if (!k?.phaseId) continue;
      const kalkId = kalkIdNachRef.get(k.ref);
      // revenueK haengt am ERSTEN Satz dieser Kalkulation — dort wurde gerechnet.
      k.revenueK = k.revenueK || kalkNachRef.get(k.ref)?.revenueK || [];
      const schluessel = `${k.ref}#${k.phaseId}`;
      if (!kalkId || gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      phasenSchluessel.push(schluessel);
      // Basis ist das Honorar des gewaehlten K-Bezugs; der Phasenanteil davon
      // ist ihr Honorar. Dieselben drei Felder, die der Wizard fuehrt.
      const kxIndex = k.kx ? parseInt(k.kx.replace(/[^0-9]/g, ""), 10) : 0;
      const basis = num(k.revenueK?.[Number.isFinite(kxIndex) ? kxIndex : 0]);
      phasenZeilen.push({
        TENANT_ID: tenantId, FEE_MASTER_ID: kalkId,
        FEE_PHASE_ID: k.phaseId, KX: k.kx || "K0",
        FEE_PERCENT_BASE: k.phasePercentBase,
        REVENUE_BASE: basis,
        FEE_PERCENT: k.phasePercent,
        PHASE_REVENUE: fmt2(basis * num(k.phasePercent) / 100),
      });
    }
  }
  const phasenIdNachSchluessel = new Map();
  if (phasenZeilen.length) {
    const angelegt = await einfuegen("FEE_CALCULATION_PHASE", phasenZeilen, "ID", "Leistungsphasen anlegen");
    phasenSchluessel.forEach((k, i) => { if (angelegt[i]) phasenIdNachSchluessel.set(k, angelegt[i].ID); });
  }

  // ── 6. Werte von unten nach oben rechnen ──────────────────────────────────
  // Ein frisch angelegter Baum hat keine Zuschlaege, keine Rechnungen und keine
  // Zahlungen — der Elternwert ist damit die reine Summe seiner Kinder, genau
  // das, was recalcParent bilden wuerde.
  for (const p of projektListe) {
    const knoten = p.group.filter((r) => !r._dbRow.istProjektzeile && !r._dbRow.istZusatzzeile);
    p.knoten = knoten;
    const nachKey = new Map(knoten.map((r) => [r._dbRow.key, r._dbRow]));
    for (const r of knoten) {
      const e = r._dbRow;
      // Blatt: Pauschal traegt sein Honorar, Nachweis den Erloes seiner
      // Buchung — genau die Rechnung, die recomputeStructure nach jeder
      // Buchung macht. Knoten bekommen ihre Werte gleich von unten.
      e.revenueFinal = !e.isLeaf ? 0
        : e.billingTypeId === 1 ? fmt2(e.revenue)
        : fmt2(e.revenueBooking || 0);
      e.extrasFinal = fmt2(e.revenueFinal * e.extrasPercent / 100);
      e.costsFinal = e.isLeaf ? fmt2(e.costs) : 0;
      // Bei Nachweis ist das Erbrachte das Gebuchte — also 100 %. Auch das
      // macht recomputeStructure so; ein abweichender Leistungsstand aus der
      // Datei waere hier eine Behauptung ueber bereits gebuchte Arbeit.
      e.progressFinal = e.isLeaf && e.billingTypeId === 2 && e.revenueFinal
        ? 100 : num(e.progressPercent);
    }
    // Von der tiefsten Ebene nach oben aufsummieren.
    const tiefen = [...new Set(knoten.map((r) => r._dbRow.depth))].sort((a, b) => b - a);
    for (const tiefe of tiefen) {
      for (const r of knoten.filter((x) => x._dbRow.depth === tiefe)) {
        const e = r._dbRow;
        if (!e.parentKey) continue;
        const vater = nachKey.get(e.parentKey);
        if (!vater) continue;
        vater.revenueFinal    = fmt2(num(vater.revenueFinal)    + num(e.revenueFinal));
        vater.extrasFinal     = fmt2(num(vater.extrasFinal)     + num(e.extrasFinal));
        vater.costsFinal      = fmt2(num(vater.costsFinal)      + num(e.costsFinal));
        // Der Elternstand ist kein Mittelwert der Kinder, sondern das
        // Verhaeltnis der erbrachten zu den gesamten Betraegen — sonst zoege
        // eine kleine, fertige Position eine grosse, offene mit hoch.
        vater.completionFinal = fmt2(num(vater.completionFinal) + num(e.revenueFinal) * num(e.progressFinal) / 100);
      }
    }
  }

  // ── 7. Knoten ebenenweise ─────────────────────────────────────────────────
  const idNachKnoten = new Map();      // Zeilenobjekt → ID
  const maxTiefe = Math.max(0, ...rows.map((r) => r._dbRow.depth || 0));
  for (let tiefe = 1; tiefe <= maxTiefe; tiefe++) {
    const stufe = [];
    for (const p of projektListe) {
      for (const r of (p.knoten || [])) {
        if (r._dbRow.depth !== tiefe) continue;
        stufe.push({ p, r });
      }
    }
    if (!stufe.length) continue;

    const nutzlast = stufe.map(({ p, r }) => {
      const e = r._dbRow;
      const vaterZeile = e.parentKey ? (p.knoten.find((x) => x._dbRow.key === e.parentKey) ?? null) : null;
      const anteil = e.isLeaf
        ? num(e.progressFinal)
        : (num(e.revenueFinal) > 0 ? fmt2(num(e.completionFinal) * 100 / num(e.revenueFinal)) : 0);
      return {
        ABBR: e.nameShort, NAME: e.nameLong, PROJECT_ID: p.projectId,
        BILLING_TYPE_ID: e.billingTypeId, CONTRACT_ID: p.contractId,
        FATHER_ID: vaterZeile ? (idNachKnoten.get(vaterZeile) ?? null) : null,
        REVENUE: e.revenueFinal, EXTRAS_PERCENT: e.extrasPercent, EXTRAS: e.extrasFinal,
        COSTS: e.costsFinal,
        REVENUE_COMPLETION_PERCENT: anteil, EXTRAS_COMPLETION_PERCENT: anteil,
        REVENUE_COMPLETION: fmt2(e.revenueFinal * anteil / 100),
        EXTRAS_COMPLETION: fmt2(e.extrasFinal * anteil / 100),
        SORT_ORDER: e.sortIndex * 10,
        LEGACY_REF: e.legacyRef,
        FEE_CALC_MASTER_ID: e.kalk ? (kalkIdNachRef.get(e.kalk.ref) ?? null) : null,
        FEE_CALC_PHASE_ID: e.kalk?.phaseId ? (phasenIdNachSchluessel.get(`${e.kalk.ref}#${e.kalk.phaseId}`) ?? null) : null,
        TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
      };
    });

    const angelegt = await einfuegen("PROJECT_STRUCTURE", nutzlast,
      "ID, REVENUE, EXTRAS, EXTRAS_PERCENT, REVENUE_COMPLETION_PERCENT, REVENUE_COMPLETION, EXTRAS_COMPLETION",
      `Leistungsstruktur (Ebene ${tiefe})`);
    stufe.forEach(({ r }, i) => { if (angelegt[i]) { idNachKnoten.set(r, angelegt[i].ID); r._angelegt = angelegt[i]; } });
  }

  // ── 8. Fortschrittszeilen ─────────────────────────────────────────────────
  // Ohne sie bleiben Leistungsstand und Reporting leer, obwohl die Struktur steht.
  const fortschritt = [];
  for (const p of projektListe) for (const r of (p.knoten || [])) {
    const n = r._angelegt;
    if (!n) continue;
    fortschritt.push({
      STRUCTURE_ID: n.ID, TENANT_ID: tenantId,
      REVENUE: n.REVENUE ?? 0, EXTRAS_PERCENT: n.EXTRAS_PERCENT ?? 0, EXTRAS: n.EXTRAS ?? 0,
      REVENUE_COMPLETION_PERCENT: n.REVENUE_COMPLETION_PERCENT ?? 0,
      EXTRAS_COMPLETION_PERCENT: n.REVENUE_COMPLETION_PERCENT ?? 0,
      REVENUE_COMPLETION: n.REVENUE_COMPLETION ?? 0,
      EXTRAS_COMPLETION: n.EXTRAS_COMPLETION ?? 0,
      IMPORT_BATCH_ID: batchId,
    });
  }
  if (fortschritt.length) await einfuegen("PROJECT_PROGRESS", fortschritt, null, "Fortschrittszeilen anlegen");

  // ── 9. Kosten als Buchung ─────────────────────────────────────────────────
  // COSTS steht bereits am Knoten (Schritt 6), die Buchung ist der Beleg dazu —
  // deshalb kein Nachrechnen je Buchung.
  const heute = new Date().toISOString().slice(0, 10);
  const grundzeile = (p, r, e) => ({
    TENANT_ID: tenantId, STATUS: "CONFIRMED", BOOKING_TYPE_ID: null,
    EMPLOYEE_ID: employeeId ?? null, BOOKING_DATE: heute,
    // QUANTITY_INT bleibt 0: Pauschalen sind keine Stunden und duerfen in
    // keiner Stundensumme mitzaehlen (siehe services/buchungen.js).
    QUANTITY_INT: 0,
    PROJECT_ID: p.projectId, STRUCTURE_ID: r._angelegt.ID, IMPORT_BATCH_ID: batchId,
  });

  const buchungen = [];
  for (const p of projektListe) for (const r of (p.knoten || [])) {
    const e = r._dbRow;
    if (!r._angelegt) continue;
    if (e.costs) {
      buchungen.push({
        ...grundzeile(p, r, e), BOOKING_KIND: "LUMP_COST",
        COST_RATE: e.costs, COST_TOTAL: fmt2(e.costs),
        QUANTITY_EXT: 0, HOURLY_RATE: 0, HOURLY_RATE_TOTAL: 0,
        POSTING_DESCRIPTION: `Kosten-Anfangsbestand aus Datenübernahme (${e.nameShort})`,
      });
    }
    if (e.revenueBooking) {
      // QUANTITY_EXT=1 haelt die Invariante HOURLY_RATE_TOTAL = Menge × Satz —
      // dieselbe Kodierung, die die App fuer LUMP_REVENUE benutzt.
      buchungen.push({
        ...grundzeile(p, r, e), BOOKING_KIND: "LUMP_REVENUE",
        COST_RATE: 0, COST_TOTAL: 0,
        QUANTITY_EXT: 1, HOURLY_RATE: e.revenueBooking, HOURLY_RATE_TOTAL: fmt2(e.revenueBooking),
        POSTING_DESCRIPTION: `Erlös-Anfangsbestand aus Datenübernahme (${e.nameShort})`,
      });
    }
  }
  if (buchungen.length) await einfuegen("BOOKING", buchungen, null, "Buchungen anlegen");

  return { inserted: rows.length };
}

/**
 * Zurücksetzen: von den Blättern der Abhängigkeit nach oben. EMPLOYEE2PROJECT
 * trägt keine Stapel-Kennung — dort wird über die Projekte dieses Stapels
 * gelöscht, was sicher ist, weil genau diese Projekte gleich mit verschwinden.
 */
async function rollbackProjectFull({ supabase, tenantId, batchId }) {
  const { data: projRows, error: pErr } = await supabase
    .from("PROJECT").select("ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  if (pErr) throw { status: 500, message: pErr.message };
  const projectIds = (projRows || []).map((r) => r.ID);

  // Schutz: hängt an den Projekten inzwischen echte Arbeit?
  if (projectIds.length) {
    const blocker = [];
    for (const dep of [
      { table: "INVOICE", label: "Rechnung(en)" },
      { table: "ADVANCE_INVOICE", label: "Abschlagsrechnung(en)" },
      { table: "OFFER", label: "Angebot(e)" },
    ]) {
      const { count, error } = await supabase.from(dep.table)
        .select("ID", { count: "exact", head: true }).eq("TENANT_ID", tenantId).in("PROJECT_ID", projectIds);
      if (error) continue;
      if (count > 0) blocker.push(`${count}× ${dep.label}`);
    }
    // Buchungen dieses Stapels sind die importierten Kosten — die zählen nicht.
    const { data: fremdeBuchungen } = await supabase.from("BOOKING")
      .select("ID, IMPORT_BATCH_ID").eq("TENANT_ID", tenantId).in("PROJECT_ID", projectIds).limit(100000);
    const fremd = (fremdeBuchungen || []).filter((b) => b.IMPORT_BATCH_ID !== batchId).length;
    if (fremd > 0) blocker.push(`${fremd}× Buchung(en)`);

    if (blocker.length) {
      throw { status: 409, message: `Rollback nicht möglich: An den importierten Projekten hängen bereits ${blocker.join(", ")}. Bitte diese zuerst entfernen.` };
    }
  }

  await supabase.from("BOOKING").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  await supabase.from("PROJECT_PROGRESS").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);

  // Kalkulationen tragen keine Stapel-Kennung — sie haengen ueber PROJECT_ID
  // an den Projekten dieses Stapels, und genau die verschwinden gleich mit.
  // Die Phasen zuerst: sie zeigen auf die Kalkulation.
  if (projectIds.length) {
    const { data: kalk } = await supabase.from("FEE_CALCULATION_MASTER")
      .select("ID").eq("TENANT_ID", tenantId).in("PROJECT_ID", projectIds);
    const kalkIds = (kalk || []).map((k) => k.ID);
    if (kalkIds.length) {
      await supabase.from("FEE_CALCULATION_PHASE").delete().eq("TENANT_ID", tenantId).in("FEE_MASTER_ID", kalkIds);
      await supabase.from("FEE_CALCULATION_MASTER").delete().eq("TENANT_ID", tenantId).in("ID", kalkIds);
    }
  }
  await supabase.from("PROJECT_STRUCTURE").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  await supabase.from("CONTRACT").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  if (projectIds.length) {
    await supabase.from("EMPLOYEE2PROJECT").delete().eq("TENANT_ID", tenantId).in("PROJECT_ID", projectIds);
  }
  const { data: del } = await supabase.from("PROJECT").delete()
    .eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId).select("ID");

  // Zuletzt die vom Stapel angelegten Projekttypen — aber nur, wenn sie
  // niemand sonst benutzt.
  const { data: typen } = await supabase.from("PROJECT_TYPE")
    .select("ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  for (const t of typen || []) {
    const { count } = await supabase.from("PROJECT")
      .select("ID", { count: "exact", head: true }).eq("TENANT_ID", tenantId).eq("PROJECT_TYPE_ID", t.ID);
    if (!count) await supabase.from("PROJECT_TYPE").delete().eq("ID", t.ID).eq("TENANT_ID", tenantId);
  }

  return { deleted: (del || []).length };
}

// ── Domäne: Anfangsbestände / Altrechnungen ──────────────────────────────────
// „bereits berechnet“ je Projekt → echter, gebuchter Referenz-Beleg (Abschlags-
// rechnung ODER Rechnung), damit der Wert das Self-Healing-Recompute überlebt.
// Erzeugt über die App-Pipeline init → Belegstruktur → book(skipDocuments).
const OPENING_BALANCE_FIELDS = [
  { key: "project_number", header: "Projektnummer",            required: true,  example: "P-2024-012",  aliases: ["projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "amount",         header: "Bereits berechnet (netto)", required: true,  example: "30000",       aliases: ["berechnet", "bereitsberechnet", "rechnungsbetrag", "betrag", "summe", "fakturiert", "invoiced"] , type: "money" },
  { key: "paid",           header: "Bereits bezahlt (netto, optional)", required: false, example: "30000", aliases: ["bezahlt", "bereitsbezahlt", "zahlung", "zahlbetrag", "payed", "paid", "eingegangen"] , type: "money" },
  { key: "doc_number",     header: "Belegnummer (optional)",    required: false, example: "RE-2023-044", aliases: ["belegnummer", "rechnungsnummer", "docnumber"] },
  { key: "doc_date",       header: "Belegdatum (optional)",     required: false, example: "31.12.2025",  aliases: ["belegdatum", "datum", "rechnungsdatum", "docdate", "stichtag"], type: "date" },
];

async function loadOpeningBalanceContext(supabase, tenantId) {
  const [projRes, contractRes, structRes, ppRes, invRes] = await Promise.all([
    supabase.from("PROJECT").select("ID, ABBR, NAME, ADDRESS_ID, CONTACT_ID, COMPANY_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("CONTRACT").select("ID, PROJECT_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT_STRUCTURE").select("ID, PROJECT_ID, REVENUE, EXTRAS_PERCENT, BILLING_TYPE_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("ADVANCE_INVOICE").select("PROJECT_ID").eq("TENANT_ID", tenantId).eq("STATUS_ID", 2).limit(100000),
    supabase.from("INVOICE").select("PROJECT_ID").eq("TENANT_ID", tenantId).eq("STATUS_ID", 2).limit(100000),
  ]);

  const contractByProject = new Map();
  for (const c of contractRes.data || []) if (!contractByProject.has(c.PROJECT_ID)) contractByProject.set(c.PROJECT_ID, c);

  const btByProject = new Map();
  for (const s of structRes.data || []) {
    if (Number(s.BILLING_TYPE_ID) !== 1 || num(s.REVENUE) <= 0) continue;
    if (!btByProject.has(s.PROJECT_ID)) btByProject.set(s.PROJECT_ID, []);
    btByProject.get(s.PROJECT_ID).push({ id: s.ID, revenue: num(s.REVENUE), extrasPercent: num(s.EXTRAS_PERCENT) });
  }

  const bookedProjects = new Set();
  for (const r of ppRes.data || [])  if (r.PROJECT_ID != null) bookedProjects.add(r.PROJECT_ID);
  for (const r of invRes.data || []) if (r.PROJECT_ID != null) bookedProjects.add(r.PROJECT_ID);

  const byNumber = new Map();
  const existingKeys = new Set();
  for (const p of projRes.data || []) {
    if (!p.ABBR) continue;
    const contract = contractByProject.get(p.ID) || null;
    const btStructures = btByProject.get(p.ID) || [];
    byNumber.set(norm(p.ABBR), {
      projectId: p.ID, name: p.NAME || p.ABBR, companyId: p.COMPANY_ID ?? null,
      addressId: p.ADDRESS_ID ?? null, contactId: p.CONTACT_ID ?? null,
      contract, btStructures,
    });
    if (bookedProjects.has(p.ID)) existingKeys.add(norm(p.ABBR));
  }
  return { byNumber, existingKeys };
}

function buildOpeningBalanceEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const number = s(mapped.project_number);
  let proj = null;
  if (!number) { messages.push({ level: "error", text: "Projektnummer fehlt (Pflichtfeld)" }); ok = false; }
  else {
    proj = ctx.byNumber.get(norm(number)) || null;
    if (!proj) { messages.push({ level: "error", text: `Projekt „${number}“ nicht gefunden` }); ok = false; }
    else {
      if (!proj.contract) { messages.push({ level: "error", text: "Projekt hat keinen Vertrag — zuerst „Projekt-Honorar“ importieren" }); ok = false; }
      if (!proj.btStructures.length) { messages.push({ level: "error", text: "Keine abrechenbare Pauschal-Struktur (nur Pauschal-Projekte)" }); ok = false; }
    }
  }

  const feeRaw = s(mapped.amount);
  const amount = parseAmountDE(feeRaw);
  if (!feeRaw) { messages.push({ level: "error", text: "Betrag fehlt (Pflichtfeld)" }); ok = false; }
  else if (amount.invalid || amount.value == null) { messages.push({ level: "error", text: `Betrag „${feeRaw}“ ist keine gültige Zahl` }); ok = false; }
  else if (amount.value <= 0) { messages.push({ level: "error", text: "Betrag muss größer als 0 sein" }); ok = false; }
  else if (proj && proj.btStructures.length) {
    const sumRev = proj.btStructures.reduce((a, n) => a + n.revenue, 0);
    if (amount.value > sumRev + 0.01) { messages.push({ level: "error", text: `Betrag übersteigt die Honorarsumme (max. ${sumRev.toFixed(2)})` }); ok = false; }
  }

  // Optional: bereits bezahlt (netto) — darf den berechneten Betrag nicht übersteigen.
  let paidVal = 0;
  const paidRaw = s(mapped.paid);
  if (paidRaw) {
    const paid = parseAmountDE(paidRaw);
    if (paid.invalid || paid.value == null) { messages.push({ level: "error", text: `Bezahlt „${paidRaw}“ ist keine gültige Zahl` }); ok = false; }
    else if (paid.value < 0) { messages.push({ level: "error", text: "Bezahlt darf nicht negativ sein" }); ok = false; }
    else if (amount.value != null && paid.value > amount.value + 0.01) { messages.push({ level: "error", text: "Bezahlt darf den berechneten Betrag nicht übersteigen" }); ok = false; }
    else paidVal = paid.value;
  }

  // Belegdatum: ohne Angabe bleibt der Beleg datumslos (wie bisher) — mit
  // Hinweis, weil er dann in Listen und Auswertungen ohne Datum steht.
  const docDate = parseDateISO(mapped.doc_date);
  if (docDate.invalid) { messages.push({ level: "error", text: "Belegdatum nicht erkannt (Format TT.MM.JJJJ oder JJJJ-MM-TT)" }); ok = false; }
  else if (!docDate.value) messages.push({ level: "warn", text: "Ohne Belegdatum erscheint der Beleg datumslos in Listen und Auswertungen" });

  const dbRow = (proj && ok) ? {
    docDate: docDate.value,
    projectId: proj.projectId, projectNumber: number, projectName: proj.name, companyId: proj.companyId,
    contractId: proj.contract.ID, invoiceAddressId: proj.contract.INVOICE_ADDRESS_ID ?? proj.addressId,
    invoiceContactId: proj.contract.INVOICE_CONTACT_ID ?? proj.contactId, addressId: proj.addressId,
    amount: amount.value, paid: paidVal, docNumber: s(mapped.doc_number) || null, btStructures: proj.btStructures,
  } : null;

  const matchKey = norm(number);
  const display = {
    number, name: proj ? proj.name : "",
    amount: amount.value != null ? amount.value.toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " €" : feeRaw,
    paid: paidVal ? paidVal.toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " €" : "",
  };
  return { ok, messages, dbRow, matchKey, display };
}

// Verteilt den Betrag proportional zur REVENUE über die BT1-Knoten (Rest auf den ersten).
function distributeOpening(amount, btStructures) {
  const sumRev = btStructures.reduce((a, n) => a + n.revenue, 0);
  let allocated = 0;
  const dist = btStructures.map((n) => {
    const amt = sumRev > 0 ? fmt2(amount * n.revenue / sumRev) : fmt2(amount / btStructures.length);
    allocated = fmt2(allocated + amt);
    return { id: n.id, extrasPercent: n.extrasPercent, amt };
  });
  const diff = fmt2(amount - allocated);
  if (diff !== 0 && dist.length) dist[0].amt = fmt2(dist[0].amt + diff);
  return dist;
}

async function commitOpeningBalanceRows(rows, { supabase, tenantId, batchId, options, employeeId }) {
  const docType = options?.docType === "invoice" ? "invoice" : "partial";
  let done = 0;

  for (const r of rows) {
    const e = r._dbRow;
    try {
      // 1) Vertrag braucht Rechnungsadresse + Kontakt (sonst wirft init…). Kontakt
      //    bei Bedarf aus erstem Kontakt der (Bauherr-)Adresse ableiten.
      let contactId = e.invoiceContactId;
      const addressId = e.invoiceAddressId || e.addressId;
      if (!addressId) throw { status: 400, message: `Projekt ${e.projectNumber}: keine Rechnungsadresse am Vertrag` };
      if (!contactId) {
        const { data: cts } = await supabase.from("CONTACTS").select("ID").eq("TENANT_ID", tenantId).eq("ADDRESS_ID", addressId).order("ID", { ascending: true }).limit(1);
        contactId = cts?.[0]?.ID ?? null;
        if (!contactId) throw { status: 400, message: `Projekt ${e.projectNumber}: kein Ansprechpartner zur Adresse — bitte Kontakt importieren` };
      }
      await supabase.from("CONTRACT").update({ INVOICE_ADDRESS_ID: addressId, INVOICE_CONTACT_ID: contactId }).eq("ID", e.contractId).eq("TENANT_ID", tenantId);
      if (!e.invoiceContactId) await supabase.from("PROJECT").update({ CONTACT_ID: contactId }).eq("ID", e.projectId).eq("TENANT_ID", tenantId).is("CONTACT_ID", null);

      const dist = distributeOpening(e.amount, e.btStructures);
      const { docId, vatPercent } = await bookReferenceDocument(supabase, {
        tenantId, batchId, employeeId, docType,
        doc: {
          companyId: e.companyId, projectId: e.projectId, contractId: e.contractId,
          docNumber: e.docNumber, docDate: e.docDate, positions: dist,
        },
      });

      // Optional: „bereits bezahlt“ als echte Zahlung gegen den Beleg buchen.
      if (e.paid > 0) {
        await recordOpeningPayment(supabase, { tenantId, batchId, docType, docId, projectId: e.projectId, contractId: e.contractId, paidNet: e.paid, vatPercent, dist });
      }
      done++;
    } catch (err) {
      throw { status: err?.status || 500, message: `Anfangsbestand für ${e.projectNumber} fehlgeschlagen: ${err?.message || err}` };
    }
  }
  return { inserted: done };
}

// Bucht „bereits bezahlt“ als echte Zahlung gegen den Beleg (spiegelt routes/payments.js).
async function recordOpeningPayment(supabase, { tenantId, batchId, docType, docId, projectId, contractId, paidNet, vatPercent, dist, paymentDate, purpose }) {
  const gross = fmt2(paidNet * (1 + num(vatPercent) / 100));
  const vat = fmt2(gross - paidNet);
  // Zahlungsdatum aus der Datei, sonst heute — eine Altzahlung auf „heute" zu
  // datieren verzerrt jede Perioden-Auswertung.
  const payDate = paymentDate || new Date().toISOString().slice(0, 10);

  const payRow = {
    ADVANCE_INVOICE_ID: docType === "partial" ? docId : null,
    INVOICE_ID:         docType === "invoice" ? docId : null,
    AMOUNT_PAYED_GROSS: gross, AMOUNT_PAYED_NET: paidNet, AMOUNT_PAYED_VAT: vat,
    PAYMENT_DATE: payDate, PROJECT_ID: projectId, CONTRACT_ID: contractId,
    PURPOSE_OF_PAYMENT: purpose || "Anfangsbestand (Import)", COMMENT: null,
    TENANT_ID: tenantId, AMOUNT_PAYED_EXTRAS_NET: null, IMPORT_BATCH_ID: batchId,
  };
  const { data: created, error } = await supabase.from("PAYMENT").insert([payRow]).select("ID").single();
  if (error) throw { status: 500, message: `Zahlung fehlgeschlagen: ${error.message}` };

  const { data: pr } = await supabase.from("PROJECT").select("PAYED").eq("ID", projectId).maybeSingle();
  await supabase.from("PROJECT").update({ PAYED: fmt2(num(pr?.PAYED) + paidNet) }).eq("ID", projectId);

  const totalDist = dist.reduce((a, d) => a + d.amt, 0);
  let allocated = 0;
  const psRows = dist.map((d) => {
    const share = totalDist > 0 ? fmt2(paidNet * d.amt / totalDist) : fmt2(paidNet / dist.length);
    allocated = fmt2(allocated + share);
    return {
      PAYMENT_ID: created.ID, ADVANCE_INVOICE_ID: docType === "partial" ? docId : null,
      INVOICE_ID: docType === "invoice" ? docId : null, STRUCTURE_ID: d.id,
      AMOUNT_PAYED_NET: share, AMOUNT_PAYED_EXTRAS_NET: 0, TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
    };
  });
  const diff = fmt2(paidNet - allocated);
  if (diff !== 0 && psRows.length) psRows[0].AMOUNT_PAYED_NET = fmt2(psRows[0].AMOUNT_PAYED_NET + diff);
  const { error: psErr } = await supabase.from("PAYMENT_STRUCTURE").insert(psRows);
  if (psErr) throw { status: 500, message: `Zahlungs-Struktur fehlgeschlagen: ${psErr.message}` };
  try { await insertProgressSnapshot(supabase, psRows.map((r) => ({ TENANT_ID: tenantId, STRUCTURE_ID: r.STRUCTURE_ID, PAYED: r.AMOUNT_PAYED_NET }))); } catch (_) { /* soft-fail */ }
}

/**
 * Einen Referenzbeleg über die echte Beleg-Pipeline anlegen und buchen:
 * init → Kopfdaten (Nummer/Datum/MwSt) → Belegpositionen → Summen → book.
 * `skipDocuments` verhindert PDF und XRechnung — Altbelege werden nicht
 * nachgebaut, sie sollen nur rechnerisch stimmen.
 *
 * Gemeinsamer Weg für Anfangsbestände (eine Summe je Projekt) und für einzeln
 * importierte offene Posten, damit beide sich identisch verhalten.
 */
async function bookReferenceDocument(supabase, { tenantId, batchId, employeeId, docType, doc }) {
  const isInvoice = docType === "invoice";
  const svc = isInvoice ? invSvc : ppSvc;

  const { id } = isInvoice
    ? await svc.initInvoice(supabase, { companyId: doc.companyId, employeeId, projectId: doc.projectId, contractId: doc.contractId, invoiceType: doc.invoiceType ?? null, tenantId })
    : await svc.initPartialPayment(supabase, { companyId: doc.companyId, employeeId, projectId: doc.projectId, contractId: doc.contractId, tenantId });

  const table = isInvoice ? "INVOICE" : "ADVANCE_INVOICE";
  const upd = { IMPORT_BATCH_ID: batchId };
  if (doc.docNumber) upd[isInvoice ? "INVOICE_NUMBER" : "ADVANCE_INVOICE_NUMBER"] = doc.docNumber;
  // Belegdatum: ohne es steht der Beleg datumslos in Listen und Auswertungen.
  if (doc.docDate) upd[isInvoice ? "INVOICE_DATE" : "ADVANCE_INVOICE_DATE"] = doc.docDate;
  if (doc.dueDate) upd.DUE_DATE = doc.dueDate;
  // MwSt aus der Datei schlägt den Vertragssatz — historische Belege können
  // einen anderen Satz tragen als der heute gültige.
  if (doc.vatPercent != null) upd.VAT_PERCENT = doc.vatPercent;
  if (doc.comment) upd.COMMENT = doc.comment;

  // Kennung des Vorsystems: die einzige Spur, die einen importierten Beleg
  // spaeter noch mit seiner Quelle verbindet — und der Weg, ueber den der
  // Zahlungsimport ihn wiederfindet.
  if (doc.legacyRef) upd.LEGACY_REF = doc.legacyRef;
  if (doc.text1) upd.TEXT_1 = doc.text1;
  if (doc.text2) upd.TEXT_2 = doc.text2;
  if (doc.buyerReference) upd.BUYER_REFERENCE = doc.buyerReference;
  if (doc.periodStart) upd.BILLING_PERIOD_START = doc.periodStart;
  if (doc.periodEnd) upd.BILLING_PERIOD_FINISH = doc.periodEnd;
  if (doc.cashDiscountPercent != null) upd.CASH_DISCOUNT_PERCENT = doc.cashDiscountPercent;
  if (doc.cashDiscountDays != null) upd.CASH_DISCOUNT_DAYS = doc.cashDiscountDays;
  // Den Storno-Bezug VOR dem Buchen setzen: bookInvoice/bookPartialPayment
  // setzen daraufhin das Original auf STATUS_ID 3. Ohne den Bezug bliebe es
  // auf 2 stehen, und jede Rueckrechnung zaehlte seinen Betrag doppelt.
  if (doc.cancelsId != null) upd[isInvoice ? "CANCELS_INVOICE_ID" : "CANCELS_ADVANCE_INVOICE_ID"] = doc.cancelsId;
  await supabase.from(table).update(upd).eq("ID", id).eq("TENANT_ID", tenantId);

  const structRows = doc.positions.map((d) => ({
    [isInvoice ? "INVOICE_ID" : "ADVANCE_INVOICE_ID"]: id,
    STRUCTURE_ID: d.id, AMOUNT_NET: d.amt,
    // Nebenkosten aus der Datei schlagen den Prozentsatz des Knotens — ein
    // Altbeleg traegt den Betrag, mit dem er tatsaechlich gestellt wurde.
    AMOUNT_EXTRAS_NET: d.extrasAmt != null ? d.extrasAmt : fmt2(d.amt * num(d.extrasPercent) / 100),
    TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
  }));
  const structureIds = doc.positions.map((d) => d.id);

  if (isInvoice) {
    await invSvc.writeInvoiceStructureRows(supabase, { invoiceId: id, rows: structRows, deleteStructureIds: structureIds });

    // Die Abzugskette VOR dem Summenlauf: die Schlussrechnung schuldet nur,
    // was nach Abzug der bereits gestellten Abschlaege uebrig bleibt.
    if (doc.abzuege && doc.abzuege.length) {
      await supabase.from("INVOICE_DEDUCTION").insert(doc.abzuege.map((d) => ({
        TENANT_ID: tenantId, INVOICE_ID: id,
        ADVANCE_INVOICE_ID: d.advanceId, DEDUCTION_AMOUNT_NET: d.betrag,
        IMPORT_BATCH_ID: batchId,
      })));
    }
    await invSvc.recomputeInvoiceTotals(supabase, id);

    // recomputeInvoiceTotals kennt die Abzuege nicht — sie stehen in einer
    // eigenen Tabelle, und nur finalInvoices.recomputeTotal liest sie. Statt
    // dessen Weg mit seinen PDF- und Pruefpflichten zu gehen, wird die Summe
    // hier nachgezogen: dieselbe Formel, eine Stelle (services/belegRechnung).
    if (doc.abzuege && doc.abzuege.length) {
      const abzugSumme = fmt2(doc.abzuege.reduce((a, d) => a + num(d.betrag), 0));
      const { data: stand } = await supabase
        .from("INVOICE").select("AMOUNT_NET, AMOUNT_EXTRAS_NET, VAT_PERCENT").eq("ID", id).maybeSingle();
      await supabase.from("INVOICE").update(belegSummen({
        positionen: [{ AMOUNT_NET: num(stand?.AMOUNT_NET), AMOUNT_EXTRAS_NET: num(stand?.AMOUNT_EXTRAS_NET) }],
        vatPercent: num(stand?.VAT_PERCENT),
        abzuege: abzugSumme,
      })).eq("ID", id).eq("TENANT_ID", tenantId);
    }
  } else {
    await ppSvc.writePpsRows(supabase, { partialPaymentId: id, structureIds, rows: structRows });
    await ppSvc.recomputePartialPaymentTotals(supabase, id);
  }

  const { data: row } = await supabase.from(table).select("*").eq("ID", id).single();
  if (isInvoice) await invSvc.bookInvoice(supabase, { id, inv: row, tenantId, force: true, skipDocuments: true });
  else await ppSvc.bookPartialPayment(supabase, { id, pp: row, tenantId, force: true, skipDocuments: true });

  // NACH dem Buchen, weil bookInvoice das Stornodatum des Originals auf HEUTE
  // setzt. Ein Altstorno von 2019 traegt sonst den Importtag. Auf der
  // Abschlagsseite setzt die Anwendung gar keines — hier schon.
  if (doc.cancelsId != null && doc.cancellationDate) {
    await supabase.from(table)
      .update({ CANCELLATION_DATE: doc.cancellationDate })
      .eq("ID", doc.cancelsId).eq("TENANT_ID", tenantId);
  }

  // Schlussrechnung: die abgerechneten Knoten schliessen. Ohne das haelt der
  // Schlussrechnungs-Assistent sie fuer offen und schlaegt sie erneut vor —
  // ein falscher Vorschlag mit unmittelbarer Geldfolge.
  if (isInvoice && doc.closesProject && structureIds.length) {
    await supabase.from("PROJECT_STRUCTURE")
      .update({ CLOSED_BY_INVOICE_ID: id })
      .in("ID", structureIds).eq("TENANT_ID", tenantId);
  }

  return { docId: id, vatPercent: num(row?.VAT_PERCENT) };
}

// Rollback der importierten Zahlungen (vor den Belegen, da sie diese referenzieren).
async function reverseOpeningPayments(supabase, tenantId, batchId) {
  const { data: pays } = await supabase.from("PAYMENT").select("ID, PROJECT_ID, AMOUNT_PAYED_NET").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  if (!pays || !pays.length) return;
  const { data: ps } = await supabase.from("PAYMENT_STRUCTURE").select("STRUCTURE_ID, AMOUNT_PAYED_NET").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);

  const byProject = new Map();
  for (const p of pays) byProject.set(p.PROJECT_ID, fmt2((byProject.get(p.PROJECT_ID) || 0) + num(p.AMOUNT_PAYED_NET)));
  for (const [pid, total] of byProject) {
    const { data: pr } = await supabase.from("PROJECT").select("PAYED").eq("ID", pid).maybeSingle();
    await supabase.from("PROJECT").update({ PAYED: fmt2(num(pr?.PAYED) - total) }).eq("ID", pid);
  }

  const affected = [...new Set((ps || []).map((r) => r.STRUCTURE_ID))];
  const progRows = [];
  const byStruct = new Map();
  for (const r of ps || []) byStruct.set(r.STRUCTURE_ID, fmt2((byStruct.get(r.STRUCTURE_ID) || 0) + num(r.AMOUNT_PAYED_NET)));
  for (const [sid, delta] of byStruct) progRows.push({ TENANT_ID: tenantId, STRUCTURE_ID: sid, PAYED: fmt2(-delta) });
  if (progRows.length) { try { await insertProgressSnapshot(supabase, progRows); } catch (_) { /* soft-fail */ } }

  await supabase.from("PAYMENT_STRUCTURE").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  await supabase.from("PAYMENT").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);

  // PROJECT_STRUCTURE.PAYED je betroffenem Knoten aus Rest-Zahlungen neu summieren (App-Parität).
  for (const sid of affected) {
    const { data: rem } = await supabase.from("PAYMENT_STRUCTURE").select("AMOUNT_PAYED_NET").eq("TENANT_ID", tenantId).eq("STRUCTURE_ID", sid);
    const sum = fmt2((rem || []).reduce((a, r) => a + num(r.AMOUNT_PAYED_NET), 0));
    await supabase.from("PROJECT_STRUCTURE").update({ PAYED: sum }).eq("ID", sid);
  }
}

// Rollback: reversiert die gebuchten Aggregate je Beleg-Art und löscht die Belege.
async function reverseOpeningDocs(supabase, tenantId, batchId, kind) {
  const docTable    = kind === "partial" ? "ADVANCE_INVOICE" : "INVOICE";
  const structTable = kind === "partial" ? "ADVANCE_INVOICE_STRUCTURE" : "INVOICE_STRUCTURE";
  const projCol     = kind === "partial" ? "ADVANCE_INVOICED" : "INVOICED";

  const { data: docs } = await supabase.from(docTable).select("ID, PROJECT_ID, TOTAL_AMOUNT_NET").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  if (!docs || !docs.length) return 0;
  const { data: structs } = await supabase.from(structTable).select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);

  // Projekt-Aggregat
  const byProject = new Map();
  for (const d of docs) byProject.set(d.PROJECT_ID, fmt2((byProject.get(d.PROJECT_ID) || 0) + num(d.TOTAL_AMOUNT_NET)));
  for (const [pid, total] of byProject) {
    const { data: pr } = await supabase.from("PROJECT").select(projCol).eq("ID", pid).maybeSingle();
    await supabase.from("PROJECT").update({ [projCol]: fmt2(num(pr?.[projCol]) - total) }).eq("ID", pid);
  }

  // Struktur-Aggregat + kompensierende PROGRESS-Snapshots
  const byStruct = new Map();
  for (const r of structs || []) byStruct.set(r.STRUCTURE_ID, fmt2((byStruct.get(r.STRUCTURE_ID) || 0) + num(r.AMOUNT_NET) + num(r.AMOUNT_EXTRAS_NET)));
  const progRows = [];
  for (const [sid, delta] of byStruct) {
    const { data: ps } = await supabase.from("PROJECT_STRUCTURE").select(projCol).eq("ID", sid).maybeSingle();
    await supabase.from("PROJECT_STRUCTURE").update({ [projCol]: fmt2(num(ps?.[projCol]) - delta) }).eq("ID", sid);
    progRows.push({ TENANT_ID: tenantId, STRUCTURE_ID: sid, [projCol]: fmt2(-delta) });
  }
  if (progRows.length) { try { await insertProgressSnapshot(supabase, progRows); } catch (_) { /* Ledger-Kompensation soft-fail */ } }

  await supabase.from(structTable).delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  await supabase.from(docTable).delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  return docs.length;
}

async function rollbackOpeningBalance({ supabase, tenantId, batchId }) {
  // Betroffene Projekte
  const projectIds = new Set();
  for (const t of ["ADVANCE_INVOICE", "INVOICE"]) {
    const { data } = await supabase.from(t).select("PROJECT_ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
    for (const r of data || []) if (r.PROJECT_ID != null) projectIds.add(r.PROJECT_ID);
  }
  const ids = [...projectIds];
  if (ids.length) {
    // Schutz: an den Projekten hängen weitere gebuchte Belege außerhalb dieses Stapels.
    const blockers = [];
    for (const t of [{ table: "ADVANCE_INVOICE", label: "Abschlagsrechnung(en)" }, { table: "INVOICE", label: "Rechnung(en)" }]) {
      const { data, error } = await supabase.from(t.table).select("ID, IMPORT_BATCH_ID").eq("TENANT_ID", tenantId).eq("STATUS_ID", 2).in("PROJECT_ID", ids);
      if (error) continue;
      const live = (data || []).filter((r) => r.IMPORT_BATCH_ID !== batchId).length;
      if (live > 0) blockers.push(`${live}× ${t.label}`);
    }
    if (blockers.length) throw { status: 409, message: `Rollback nicht möglich: An den Projekten hängen weitere gebuchte Belege (${blockers.join(", ")}). Diese zuerst stornieren.` };
  }
  // Zahlungen zuerst (referenzieren die Belege), dann die Belege.
  await reverseOpeningPayments(supabase, tenantId, batchId);
  let deleted = 0;
  deleted += await reverseOpeningDocs(supabase, tenantId, batchId, "partial");
  deleted += await reverseOpeningDocs(supabase, tenantId, batchId, "invoice");
  return { deleted };
}

// ── Domäne: Offene Posten (Altbelege einzeln, mit Positionen) ────────────────
// Anfangsbestände fassen je Projekt eine Summe zusammen — das genügt für alles,
// was bezahlt und abgeschlossen ist. Offene Forderungen brauchen mehr: eigene
// Nummer, Datum, Fälligkeit und Restbetrag, sonst lässt sich weder ein
// Zahlungseingang zuordnen noch gemahnt werden.
//
// Eine Zeile = eine Belegposition. Zeilen mit derselben Belegnummer gehören zu
// EINEM Beleg. Wer keine Positionen führt, schreibt eine Zeile je Beleg und
// lässt die Positionsspalte leer — der Betrag wird dann wie beim Anfangsbestand
// über die Pauschal-Knoten verteilt.
const OPEN_ITEM_FIELDS = [
  { key: "project_number", header: "Projektnummer",              required: true,  example: "P-2024-012",  aliases: ["projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "doc_number",     header: "Belegnummer",                required: true,  example: "RE-2025-044", aliases: ["belegnummer", "rechnungsnummer", "nr", "docnumber", "invoicenumber"], type: "text" },
  { key: "doc_type",       header: "Belegart (Abschlag/Rechnung)", required: false, example: "Abschlag",  aliases: ["belegart", "art", "typ", "doctype", "type"], list: "docType" },
  { key: "doc_date",       header: "Belegdatum",                 required: true,  example: "15.11.2025",  aliases: ["belegdatum", "datum", "rechnungsdatum", "docdate"], type: "date" },
  { key: "due_date",       header: "Fällig am",                  required: false, example: "15.12.2025",  aliases: ["faellig", "faelligam", "faelligkeit", "duedate", "zahlungsziel"], type: "date" },
  { key: "position",       header: "Position (Kürzel)",          required: false, example: "LP5",         aliases: ["position", "kuerzel", "leistung", "strukturkuerzel", "pos"] },
  { key: "amount_net",     header: "Betrag netto",               required: true,  example: "12500",       aliases: ["betrag", "nettobetrag", "summe", "amount", "honorar", "rechnungsbetrag"], type: "money" },
  { key: "vat_percent",    header: "MwSt %",                     required: false, example: "19",          aliases: ["mwst", "ust", "steuersatz", "vat", "vatpercent", "umsatzsteuer"] },
  { key: "paid_net",       header: "Bereits bezahlt (netto)",    required: false, example: "",            aliases: ["bezahlt", "bereitsbezahlt", "zahlung", "paid", "eingegangen"], type: "money" },
  { key: "paid_date",      header: "Zahlungsdatum",              required: false, example: "",            aliases: ["zahlungsdatum", "zahldatum", "paymentdate", "bezahltam"], type: "date" },
  { key: "comment",        header: "Bemerkung",                  required: false, example: "",            aliases: ["bemerkung", "kommentar", "notiz", "text", "comment"] },

  // ── Ab hier die Erweiterung fuer die vollstaendige Belegoruebernahme ──────
  // Alle neu und alle optional: eine Datei, die vor dieser Erweiterung lief,
  // laeuft unveraendert weiter.
  { key: "payment_terms_days", header: "Zahlungsziel (Tage)",     required: false, example: "30",          aliases: ["zahlungsziel", "zahlungszieltage", "paymtarget", "nettotage", "zieltage"] },
  { key: "cash_discount_percent", header: "Skonto %",             required: false, example: "",            aliases: ["skonto", "skontoprozent", "skontosatz", "discountperc"] },
  { key: "cash_discount_days", header: "Skonto Tage",             required: false, example: "",            aliases: ["skontotage", "skontofrist", "discountdays"] },
  { key: "period_start",   header: "Leistungszeitraum von",       required: false, example: "",            aliases: ["leistungszeitraumvon", "leistungvon", "invoicingperiodstart", "zeitraumvon"], type: "date" },
  { key: "period_end",     header: "Leistungszeitraum bis",       required: false, example: "",            aliases: ["leistungszeitraumbis", "leistungbis", "invoicingperiodend", "deliverydate", "zeitraumbis"], type: "date" },
  { key: "buyer_reference", header: "Leitweg-ID",                 required: false, example: "",            aliases: ["leitwegid", "leitweg", "buyerreference", "routingid"] },
  { key: "text_1",         header: "Belegtext oben",              required: false, example: "",            aliases: ["belegtextoben", "einleitung", "invoicedesc1", "text1", "kopftext"] },
  { key: "text_2",         header: "Belegtext unten",             required: false, example: "",            aliases: ["belegtextunten", "schlusstext", "invoicedesc2", "text2", "fusstext"] },
  { key: "deducts",        header: "Zieht Abschläge ab",          required: false, example: "",            aliases: ["ziehtabschlaegeab", "abzuege", "abschlagsabzug", "anrechnung", "deducts"], type: "text" },
  { key: "cancels_doc_number", header: "Storniert Beleg",         required: false, example: "",            aliases: ["storniertbeleg", "storniert", "stornozu", "assigned2invoice", "bezugsbeleg"], type: "text" },
  { key: "cancellation_date", header: "Stornodatum",              required: false, example: "",            aliases: ["stornodatum", "datestorno"], type: "date" },
  { key: "closes_project", header: "Schließt Positionen ab",      required: false, example: "",            aliases: ["schliesstab", "schliesstpositionenab", "abschluss", "closed"] },
  { key: "head_amount_net", header: "Kopfsumme netto (Prüfsumme)", required: false, example: "",           aliases: ["kopfsumme", "gesamtnetto", "rechnungsbetragnetto", "amountnet", "summenetto"], type: "money" },
  { key: "amount_extras_net", header: "Nebenkosten netto",        required: false, example: "",            aliases: ["nebenkosten", "nebenkostennetto", "extras", "bextras", "nk"], type: "money" },
  { key: "legacy_ref",     header: "ID im Altsystem",             required: false, example: "",            aliases: ["idimaltsystem", "altid", "legacyref", "wikoid", "quellid", "idvorsystem"], type: "text" },
  { key: "position_legacy_ref", header: "Position (ID Altsystem)", required: false, example: "",           aliases: ["positionidaltsystem", "positionaltid", "poslegacyref", "strukturaltid"], type: "text" },
];

// ---------------------------------------------------------------------------
// Belegart aus der Datei aufloesen.
//
// Die frueherer Heuristik war eine Zeile:
//     dt.includes("rechnung") && !dt.includes("abschlag") ? "invoice" : "partial"
// Sie traf "Schlussrechnung" richtig und "Storno-Abschlagsrechnung" falsch, und
// sie kannte nur zwei der sechs Belegarten. Vor allem aber hatte sie keinen
// Fehlerfall: alles Unbekannte wurde stillschweigend zur Abschlagsrechnung.
//
// `target`      welche Tabelle: ADVANCE_INVOICE oder INVOICE
// `invoiceType` INVOICE_TYPE (nur bei INVOICE; die Abschlagsrechnung ist eine
//               eigene Tabelle und traegt keine Typspalte)
// `negativ`     Belegart kehrt das Vorzeichen um (Gutschrift, Storno)
// ---------------------------------------------------------------------------
const DOC_TYPE_ALIASES = [
  { target: "advance", invoiceType: null, negativ: false, label: "Abschlagsrechnung",
    worte: ["abschlag", "abschlagsrechnung", "ar", "abschlagszahlung", "arechnung", "partpayment", "partial", "anzahlung"] },
  { target: "invoice", invoiceType: "rechnung", negativ: false, label: "Rechnung",
    worte: ["rechnung", "einzelrechnung", "re", "honorarrechnung", "invoice"] },
  { target: "invoice", invoiceType: "schlussrechnung", negativ: false, label: "Schlussrechnung",
    worte: ["schlussrechnung", "sr", "endrechnung", "schluss", "schlussrg"] },
  { target: "invoice", invoiceType: "teilschlussrechnung", negativ: false, label: "Teilschlussrechnung",
    worte: ["teilschlussrechnung", "tsr", "teilschluss", "teilschlussrg"] },
  { target: "invoice", invoiceType: "gutschrift", negativ: true, label: "Gutschrift",
    worte: ["gutschrift", "gs", "creditnote", "credit"] },
  // Das Ziel eines Stornos bestimmt der Beleg, den es storniert — eine Storno-
  // Abschlagsrechnung gehoert in ADVANCE_INVOICE, eine Storno-Rechnung in
  // INVOICE. Deshalb hier bewusst kein festes `target`.
  { target: null, invoiceType: "stornorechnung", negativ: true, label: "Storno",
    worte: ["storno", "stornorechnung", "stornobeleg", "cancellation", "cancel"] },
];

const DOC_TYPE_LOOKUP = (() => {
  const m = new Map();
  for (const eintrag of DOC_TYPE_ALIASES) {
    for (const w of eintrag.worte) m.set(katalogKey(w), eintrag);
  }
  return m;
})();

/** Erlaubte Schreibweisen fuer Meldung und Vorlagen-Dropdown. */
const DOC_TYPE_LABELS = DOC_TYPE_ALIASES.map((e) => e.label);

/** @returns {null|{target, invoiceType, negativ, label}} null = unbekannt */
function belegartAusText(text) {
  const k = katalogKey(text);
  if (!k) return null;
  return DOC_TYPE_LOOKUP.get(k) || null;
}

async function loadOpenItemContext(supabase, tenantId) {
  const [projRes, contractRes, structRes, ppRes, invRes] = await Promise.all([
    supabase.from("PROJECT").select("ID, ABBR, NAME, ADDRESS_ID, CONTACT_ID, COMPANY_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("CONTRACT").select("ID, PROJECT_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT_STRUCTURE").select("ID, PROJECT_ID, FATHER_ID, ABBR, NAME, REVENUE, EXTRAS_PERCENT, BILLING_TYPE_ID, LEGACY_REF").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("ADVANCE_INVOICE").select("ID, ADVANCE_INVOICE_NUMBER, PROJECT_ID, CONTRACT_ID, STATUS_ID, TOTAL_AMOUNT_NET, TOTAL_AMOUNT_GROSS, LEGACY_REF").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("INVOICE").select("ID, INVOICE_NUMBER, PROJECT_ID, CONTRACT_ID, STATUS_ID, INVOICE_TYPE, TOTAL_AMOUNT_NET, TOTAL_AMOUNT_GROSS, LEGACY_REF").eq("TENANT_ID", tenantId).limit(100000),
  ]);

  // Ein stilles Abschneiden an der Grenze waere hier kein Fehler, sondern ein
  // falsches Ergebnis: es fehlten Belegnummern in der Dublettenpruefung, und
  // der Import legte doppelte Nummern an, ohne sich zu melden.
  for (const [name, res] of [["Projekte", projRes], ["Projektstruktur", structRes],
                             ["Abschlagsrechnungen", ppRes], ["Rechnungen", invRes]]) {
    if ((res.data || []).length >= 100000) {
      throw { status: 500, message: `Bestand zu gross: ${name} wurde beim Lesen abgeschnitten. Bitte den Import in kleineren Mandanten oder nach Jahrgang fahren.` };
    }
  }

  const contractByProject = new Map();
  for (const c of contractRes.data || []) if (!contractByProject.has(c.PROJECT_ID)) contractByProject.set(c.PROJECT_ID, c);

  // Nur Blätter sind abrechenbar (Knoten tragen nur Summen ihrer Kinder).
  const fatherIds = new Set((structRes.data || []).map((r) => r.FATHER_ID).filter((x) => x != null));
  const nodesByProject = new Map();
  for (const st of structRes.data || []) {
    if (fatherIds.has(st.ID)) continue;
    if (!nodesByProject.has(st.PROJECT_ID)) nodesByProject.set(st.PROJECT_ID, []);
    nodesByProject.get(st.PROJECT_ID).push({
      id: st.ID, nameShort: st.ABBR || "", nameLong: st.NAME || "",
      revenue: num(st.REVENUE), extrasPercent: num(st.EXTRAS_PERCENT), billingTypeId: Number(st.BILLING_TYPE_ID),
      legacyRef: st.LEGACY_REF || null,
    });
  }

  // Vergebene Belegnummern — eine importierte Altnummer darf nicht mit einer
  // bestehenden kollidieren.
  //
  // Dazu der ganze Beleg, nicht nur seine Nummer: eine Schlussrechnung kann
  // einen Abschlag anrechnen, der in einem FRUEHEREN Stapel entstanden ist,
  // und ein Storno kann sich auf einen Beleg beziehen, den plan&simple selbst
  // erzeugt hat. Beides laesst sich nur beantworten, wenn der Bestand mit
  // Projekt, Status und Betrag dasteht.
  const takenNumbers = new Set();
  const docsByNumber = new Map();
  const docsByLegacy = new Map();
  const merke = (kind, id, nummer, row) => {
    if (!nummer) return;
    takenNumbers.add(norm(nummer));
    const eintrag = {
      kind, id, nummer,
      projectId: row.PROJECT_ID ?? null, contractId: row.CONTRACT_ID ?? null,
      statusId: Number(row.STATUS_ID) || null, invoiceType: row.INVOICE_TYPE ?? null,
      totalNet: num(row.TOTAL_AMOUNT_NET), totalGross: num(row.TOTAL_AMOUNT_GROSS),
      imBestand: true,
    };
    // Bei einer doppelt vergebenen Nummer gewinnt niemand: der Eintrag wird
    // als mehrdeutig markiert, damit ein Bezug darauf ein Fehler wird statt
    // stillschweigend den erstbesten Beleg zu treffen.
    const key = norm(nummer);
    if (docsByNumber.has(key)) docsByNumber.get(key).mehrdeutig = true;
    else docsByNumber.set(key, eintrag);
    if (row.LEGACY_REF) docsByLegacy.set(norm(row.LEGACY_REF), eintrag);
  };
  for (const r of ppRes.data || []) merke("advance", r.ID, r.ADVANCE_INVOICE_NUMBER, r);
  for (const r of invRes.data || []) merke("invoice", r.ID, r.INVOICE_NUMBER, r);

  // Welche Abschlaege eine Schlussrechnung bereits angerechnet hat. Ohne das
  // zieht ein Import denselben Abschlag ein zweites Mal ab, und die
  // Restforderung des Projekts faellt zu niedrig aus.
  //
  // Ein Anspruch aus einer STORNIERTEN Schlussrechnung zaehlt nicht — der
  // Abschlag ist dann wieder frei. Genau so liest es getDeductions.
  const stornierteRechnungen = new Set(
    (invRes.data || []).filter((r) => Number(r.STATUS_ID) === 3).map((r) => r.ID)
  );
  const { data: abzugRes } = await supabase
    .from("INVOICE_DEDUCTION")
    .select("INVOICE_ID, ADVANCE_INVOICE_ID")
    .eq("TENANT_ID", tenantId)
    .limit(100000);
  const beanspruchteAbschlaege = new Map();   // advanceId -> invoiceId
  for (const a of abzugRes || []) {
    if (stornierteRechnungen.has(a.INVOICE_ID)) continue;
    beanspruchteAbschlaege.set(a.ADVANCE_INVOICE_ID, a.INVOICE_ID);
  }

  // Welche Belege schon einen Storno tragen — ein zweiter waere eine doppelte
  // Gutschrift.
  const bereitsStorniert = new Set();
  for (const r of invRes.data || []) if (r.STATUS_ID === 3) bereitsStorniert.add(`invoice|${r.ID}`);
  for (const r of ppRes.data || []) if (r.STATUS_ID === 3) bereitsStorniert.add(`advance|${r.ID}`);

  const projectsByNumber = new Map();
  for (const p of projRes.data || []) {
    if (!p.ABBR) continue;
    const contract = contractByProject.get(p.ID) || null;
    projectsByNumber.set(norm(p.ABBR), {
      id: p.ID, name: p.NAME || p.ABBR, companyId: p.COMPANY_ID ?? null,
      addressId: p.ADDRESS_ID ?? null, contactId: p.CONTACT_ID ?? null, contract,
      nodes: nodesByProject.get(p.ID) || [],
    });
  }

  // Dubletten laufen hier über die Belegnummer (Fehler, nicht „überspringen").
  return {
    projectsByNumber, takenNumbers, docsByNumber, docsByLegacy,
    beanspruchteAbschlaege, bereitsStorniert,
    existingKeys: new Set(),
  };
}

function buildOpenItemEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const number = s(mapped.project_number);
  let proj = null;
  if (!number) { messages.push({ level: "error", text: "Projektnummer fehlt (Pflichtfeld)" }); ok = false; }
  else {
    proj = ctx.projectsByNumber.get(norm(number)) || null;
    if (!proj) { messages.push({ level: "error", text: `Projekt „${number}“ nicht gefunden` }); ok = false; }
    else if (!proj.contract) { messages.push({ level: "error", text: "Projekt hat keinen Vertrag — zuerst Projekt-Honorar oder Projektstruktur importieren" }); ok = false; }
  }

  const docNumber = s(mapped.doc_number);
  if (!docNumber) { messages.push({ level: "error", text: "Belegnummer fehlt (Pflichtfeld)" }); ok = false; }
  else if (ctx.takenNumbers.has(norm(docNumber))) {
    messages.push({ level: "error", text: `Belegnummer „${docNumber}“ ist bereits vergeben` }); ok = false;
  }

  // ── Belegart ───────────────────────────────────────────────────────────────
  // Unbekanntes ist ein Fehler, kein stiller Standardwert: ein falsch
  // einsortierter Beleg landet in der falschen Tabelle, und das faellt erst
  // auf, wenn die Schlussrechnung ihn nicht mehr findet.
  const belegartRoh = s(mapped.doc_type);
  let belegart = belegartAusText(belegartRoh);
  if (!belegartRoh) {
    belegart = DOC_TYPE_ALIASES[0];   // Abschlagsrechnung, wie bisher
    messages.push({ level: "warn", text: "Belegart leer — als Abschlagsrechnung übernommen" });
  } else if (!belegart) {
    messages.push({ level: "error", text: `Belegart „${belegartRoh}“ unbekannt — erlaubt sind: ${DOC_TYPE_LABELS.join(", ")}` });
    ok = false;
    belegart = DOC_TYPE_ALIASES[0];
  }
  const istStorno = belegart.invoiceType === "stornorechnung";
  // Das Ziel des Stornos steht erst fest, wenn der stornierte Beleg aufgeloest
  // ist — das passiert in finalizeOpenItemRows, wo die ganze Datei bekannt ist.
  const docType = belegart.target === "invoice" ? "invoice" : belegart.target === "advance" ? "partial" : null;

  const stornoZu = s(mapped.cancels_doc_number);
  if (istStorno && !stornoZu) {
    messages.push({ level: "error", text: "Storno ohne Bezugsbeleg — bitte die Nummer des stornierten Belegs angeben" });
    ok = false;
  }

  const docDate = parseDateISO(mapped.doc_date);
  if (!s(mapped.doc_date)) { messages.push({ level: "error", text: "Belegdatum fehlt (Pflichtfeld)" }); ok = false; }
  else if (docDate.invalid) { messages.push({ level: "error", text: "Belegdatum nicht erkannt (TT.MM.JJJJ oder JJJJ-MM-TT)" }); ok = false; }

  // Fälligkeit: steht sie nicht da, laesst sie sich aus dem Zahlungsziel
  // ableiten — das ist besser als zu warnen und den Beleg aus dem Mahnwesen
  // fallen zu lassen.
  const dueDate = parseDateISO(mapped.due_date);
  const zielTage = parseAmountDE(mapped.payment_terms_days);
  let faelligkeit = dueDate.value;
  if (dueDate.invalid) { messages.push({ level: "error", text: "Fälligkeitsdatum nicht erkannt" }); ok = false; }
  if (!faelligkeit && docDate.value && zielTage.value != null && zielTage.value > 0) {
    const d = new Date(`${docDate.value}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Math.round(zielTage.value));
    faelligkeit = d.toISOString().slice(0, 10);
  }
  if (!faelligkeit && !dueDate.invalid) {
    messages.push({ level: "warn", text: "Ohne Fälligkeit erscheint der Beleg nie im Mahnwesen" });
  }

  /** Geldfeld lesen und dabei die Datum-statt-Zahl-Falle benennen. */
  const geld = (key, label) => {
    const roh = s(mapped[key]);
    if (!roh) return { roh, wert: null };
    const p = parseAmountDE(mapped[key]);
    if (p.invalid || p.value == null) {
      messages.push({
        level: "error",
        text: p.warDatum ? datumStattZahlHinweis(label, roh) : `${label} „${roh}“ ist keine gültige Zahl`,
      });
      ok = false;
      return { roh, wert: null };
    }
    return { roh, wert: p.value };
  };

  const amtRaw = s(mapped.amount_net);
  const amount = geld("amount_net", "Betrag");
  if (!amtRaw) { messages.push({ level: "error", text: "Betrag fehlt (Pflichtfeld)" }); ok = false; }
  else if (amount.wert != null && amount.wert === 0) {
    messages.push({ level: "error", text: "Betrag darf nicht 0 sein" }); ok = false;
  }

  // Vorzeichen folgt der Belegart. Gutschrift und Storno mindern; schreibt die
  // Datei den Betrag positiv (der Regelfall in Altsystemen, dort steckt das
  // Vorzeichen in der Belegart), dreht der Import ihn und sagt es.
  let betrag = amount.wert;
  if (betrag != null && belegart.negativ && betrag > 0) {
    betrag = -betrag;
    messages.push({ level: "warn", text: `${belegart.label} mit positivem Betrag — als Minderung übernommen` });
  } else if (betrag != null && !belegart.negativ && betrag < 0) {
    messages.push({ level: "warn", text: `${belegart.label} mit negativem Betrag — bitte prüfen, ob es eine Gutschrift ist` });
  }

  const extras = geld("amount_extras_net", "Nebenkosten");
  let nebenkosten = extras.wert;
  if (nebenkosten != null && belegart.negativ && nebenkosten > 0) nebenkosten = -nebenkosten;

  const kopfsumme = geld("head_amount_net", "Kopfsumme netto");

  const vat = parseAmountDE(mapped.vat_percent);
  if (s(mapped.vat_percent) && (vat.invalid || vat.value == null)) { messages.push({ level: "error", text: "MwSt-Satz ist keine gültige Zahl" }); ok = false; }

  let paid = 0;
  const paidRaw = s(mapped.paid_net);
  if (paidRaw) {
    const p = parseAmountDE(mapped.paid_net);
    if (p.invalid || p.value == null) { messages.push({ level: "error", text: `Bezahlt „${paidRaw}“ ist keine gültige Zahl` }); ok = false; }
    else if (p.value < 0) { messages.push({ level: "error", text: "Bezahlt darf nicht negativ sein" }); ok = false; }
    else paid = p.value;
  }
  const paidDate = parseDateISO(mapped.paid_date);
  if (paidDate.invalid) { messages.push({ level: "error", text: "Zahlungsdatum nicht erkannt" }); ok = false; }

  // Position über das Kürzel des Strukturknotens auflösen (eindeutig sein muss
  // es), ersatzweise über die Kennung aus dem Vorsystem.
  const posRaw = s(mapped.position);
  const posLegacy = s(mapped.position_legacy_ref);
  let node = null;
  if ((posRaw || posLegacy) && proj) {
    let hits = [];
    if (posLegacy) hits = proj.nodes.filter((n) => n.legacyRef && norm(n.legacyRef) === norm(posLegacy));
    if (!hits.length && posRaw) {
      hits = proj.nodes.filter((n) => norm(n.nameShort) === norm(posRaw) || norm(n.nameLong) === norm(posRaw));
    }
    const bezeichnung = posRaw || posLegacy;
    if (!hits.length) {
      messages.push({ level: "error", text: `Position „${bezeichnung}“ nicht gefunden — Kürzel aus der Leistungsstruktur verwenden` }); ok = false;
    } else if (hits.length > 1) {
      messages.push({ level: "error", text: `Position „${bezeichnung}“ kommt im Projekt mehrfach vor — bitte eindeutig benennen` }); ok = false;
    } else {
      node = hits[0];
      // Frueher war das ein Fehler. Fuer eine echte Historie ist es falsch:
      // Altsysteme rechnen Abschlaege sehr wohl auf Stunden-Positionen ab. Der
      // Leistungsstand kann dadurch ueber 100 % laufen — das ist eine Aussage
      // ueber die Daten, kein Grund, den Beleg abzulehnen.
      if (node.billingTypeId !== 1) {
        messages.push({ level: "warn", text: `Position „${bezeichnung}“ wird nach Aufwand abgerechnet — der Leistungsstand kann dort über 100 % laufen` });
      }
    }
  } else if (proj && !proj.nodes.some((n) => n.billingTypeId === 1)) {
    // Ohne Positionsangabe verteilt der Import den Betrag ueber die
    // Pauschal-Knoten. Gibt es keine, gibt es auch nichts zu verteilen.
    messages.push({ level: "error", text: "Projekt hat keine abrechenbare Pauschal-Position — bitte die Position in der Datei angeben" });
    ok = false;
  }

  const dbRow = {
    projectNumber: number, projectId: proj?.id ?? null, projectName: proj?.name ?? "",
    companyId: proj?.companyId ?? null, contractId: proj?.contract?.ID ?? null,
    addressId: proj?.contract?.INVOICE_ADDRESS_ID ?? proj?.addressId ?? null,
    contactId: proj?.contract?.INVOICE_CONTACT_ID ?? proj?.contactId ?? null,
    nodes: proj?.nodes ?? [],
    docNumber, docType, docDate: docDate.value, dueDate: faelligkeit,
    amount: betrag ?? 0, extrasAmount: nebenkosten, vatPercent: vat.value ?? null,
    paid, paidDate: paidDate.value, comment: s(mapped.comment) || null,
    positionLabel: posRaw || posLegacy, node,

    // Belegart und ihre Folgen
    invoiceType: belegart.invoiceType, istStorno, negativ: belegart.negativ,
    belegartLabel: belegart.label, stornoZu: stornoZu || null,
    cancellationDate: parseDateISO(mapped.cancellation_date).value,
    deductsRaw: s(mapped.deducts) || null,
    closesProject: parseBool(mapped.closes_project),

    // Kopffelder, die unveraendert am Beleg landen
    kopfsumme: kopfsumme.wert,
    cashDiscountPercent: parseAmountDE(mapped.cash_discount_percent).value,
    cashDiscountDays: parseAmountDE(mapped.cash_discount_days).value,
    periodStart: parseDateISO(mapped.period_start).value,
    periodEnd: parseDateISO(mapped.period_end).value,
    buyerReference: s(mapped.buyer_reference) || null,
    text1: s(mapped.text_1) || null,
    text2: s(mapped.text_2) || null,
    legacyRef: s(mapped.legacy_ref) || null,
  };

  const display = {
    number, doc: `${docNumber} (${belegart.label})`,
    datum: s(mapped.doc_date), position: posRaw || posLegacy,
    betrag: betrag != null ? betrag.toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " €" : amtRaw,
    bezahlt: paid ? paid.toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " €" : "",
  };
  return { ok, messages, dbRow, matchKey: norm(docNumber), display };
}

/**
 * Zeilen zu Belegen bündeln und prüfen, was sich erst im Verbund zeigt:
 * Kopfdaten müssen je Beleg zusammenpassen, Positionen dürfen nicht mit einer
 * Sammelzeile gemischt werden, und die Summe muss zum Projekt passen.
 */
function finalizeOpenItemRows(rows, ctx) {
  const byDoc = new Map();
  for (const r of rows) {
    const e = r._dbRow;
    if (!e?.docNumber) continue;
    const key = norm(e.docNumber);
    if (!byDoc.has(key)) byDoc.set(key, []);
    byDoc.get(key).push(r);
  }

  for (const [, group] of byDoc) {
    const usable = group.filter((r) => r.status !== "error");
    if (!usable.length) continue;
    const head = usable[0]._dbRow;

    // Ein Beleg gehört zu genau einem Projekt.
    const projects = new Set(usable.map((r) => norm(r._dbRow.projectNumber)));
    if (projects.size > 1) {
      for (const r of usable) {
        r.status = "error";
        r.messages.push({ level: "error", text: `Belegnummer „${head.docNumber}“ steht bei mehreren Projekten — Nummern müssen eindeutig sein` });
      }
      continue;
    }

    // Entweder Positionen oder eine Sammelzeile — nicht beides.
    const withPos = usable.filter((r) => r._dbRow.node);
    const withoutPos = usable.filter((r) => !r._dbRow.node);
    if (withPos.length && withoutPos.length) {
      for (const r of withoutPos) {
        r.status = "error";
        r.messages.push({ level: "error", text: `Beleg „${head.docNumber}“ mischt Positionszeilen mit einer Zeile ohne Position — entweder alle Zeilen mit Position oder eine einzige ohne` });
      }
    }
    if (withoutPos.length > 1) {
      for (const r of withoutPos.slice(1)) {
        r.status = "error";
        r.messages.push({ level: "error", text: `Beleg „${head.docNumber}“ hat mehrere Zeilen ohne Position — bitte je Position ein Kürzel angeben` });
      }
    }
    // Dieselbe Position darf im selben Beleg nur einmal stehen.
    const seenNode = new Set();
    for (const r of withPos) {
      const id = r._dbRow.node.id;
      if (seenNode.has(id)) {
        r.status = "error";
        r.messages.push({ level: "error", text: `Position „${r._dbRow.positionLabel}“ steht in Beleg „${head.docNumber}“ mehrfach` });
      } else seenNode.add(id);
    }

    // Kopfdaten je Beleg: erste Zeile gewinnt, Abweichungen werden gemeldet.
    for (const r of usable.slice(1)) {
      const e = r._dbRow;
      const abweichend = [];
      if (e.docDate !== head.docDate) abweichend.push("Belegdatum");
      if (e.dueDate !== head.dueDate) abweichend.push("Fälligkeit");
      if (e.docType !== head.docType) abweichend.push("Belegart");
      if (abweichend.length) r.messages.push({ level: "warn", text: `${abweichend.join(" und ")} weicht von der ersten Zeile des Belegs ab — es gilt die erste Zeile` });
      e.docDate = head.docDate; e.dueDate = head.dueDate; e.docType = head.docType;
    }

    // Summe des Belegs gegen das Projekt prüfen (Honorar der Pauschal-Knoten).
    const alive = group.filter((r) => r.status !== "error");
    if (alive.length) {
      const total = alive.reduce((a, r) => a + num(r._dbRow.amount), 0);
      const paidTotal = alive.reduce((a, r) => a + num(r._dbRow.paid), 0);
      // Nur bei einer Forderung. Eine Gutschrift und ein Storno tragen einen
      // negativen Betrag — dort waere jede Zahlung von 0 "hoeher als der
      // Betrag", und der Beleg fiele mit einer sinnlosen Meldung durch.
      if (total > 0 && paidTotal > total + 0.01) {
        for (const r of alive) {
          r.status = "error";
          r.messages.push({ level: "error", text: `Beleg „${head.docNumber}“: bezahlt (${paidTotal.toFixed(2)}) übersteigt den Betrag (${total.toFixed(2)})` });
        }
      }
    }

    // Ein fehlerhafter Beleg wird als Ganzes verworfen — eine halbe Rechnung
    // waere eine falsche Forderung.
    const broken = group.filter((r) => r.status === "error");
    if (broken.length) {
      for (const r of group) {
        if (r.status === "error") continue;
        r.status = "error";
        r.messages.push({ level: "error", text: `Beleg „${head.docNumber}“ wird übersprungen — eine andere Zeile dieses Belegs ist fehlerhaft (Zeile ${broken[0].row})` });
      }
    }
  }

  verknuepfeBelege(byDoc, ctx);
}

// Wieviele Belege ein Lauf hoechstens traegt. Der gebuendelte Schreibweg
// schafft mehr, aber jenseits davon wird die Antwortzeit unhoeflich und ein
// Abbruch teuer. Die Grenze ist eine ehrliche Meldung wert — ein Gateway-
// Timeout nach 30 Sekunden ist keine.
const BELEG_OBERGRENZE = 6000;

/**
 * Was sich erst zeigt, wenn man alle Belege nebeneinander legt: die Abzuege
 * einer Schlussrechnung, der Bezug eines Stornos, die Pruefsumme und die
 * Reihenfolge, in der geschrieben werden muss.
 *
 * Das gehoert in die VORSCHAU und nicht in den Commit: nur hier kann der
 * Nutzer den Fehler sehen, bevor ein Beleg gebucht ist.
 */
function verknuepfeBelege(byDoc, ctx) {
  const fehlerAmBeleg = (group, text) => {
    for (const r of group) {
      r.status = "error";
      r.messages.push({ level: "error", text });
    }
  };

  if (byDoc.size > BELEG_OBERGRENZE) {
    for (const [, group] of byDoc) {
      fehlerAmBeleg(group, `Diese Datei enthält ${byDoc.size} Belege. Bitte in Läufe von höchstens ${BELEG_OBERGRENZE} teilen (zum Beispiel nach Jahrgang) — jeder Lauf ist ein eigener Stapel und einzeln rücknehmbar.`);
    }
    return;
  }

  /** Einen Belegbezug aufloesen: erst in dieser Datei, dann im Bestand. */
  const findeBeleg = (nummer) => {
    const key = norm(nummer);
    const inDatei = byDoc.get(key);
    if (inDatei && inDatei.length) {
      const e = inDatei[0]._dbRow;
      return {
        quelle: "datei", kind: e.docType === "invoice" ? "invoice" : "advance",
        projectId: e.projectId, invoiceType: e.invoiceType,
        totalNet: inDatei.reduce((a, r) => a + num(r._dbRow.amount) + num(r._dbRow.extrasAmount), 0),
        gruppe: inDatei, istStorno: e.istStorno,
      };
    }
    const imBestand = ctx.docsByNumber?.get(key);
    if (imBestand) return { quelle: "bestand", ...imBestand };
    return null;
  };

  // Ein Abschlag darf nur EINMAL angerechnet werden — auch innerhalb dieser
  // Datei. Der Bestand bringt seine eigenen Ansprueche mit.
  const beansprucht = new Map();   // normalisierte Nummer -> Belegnummer, die ihn zieht

  for (const [, group] of byDoc) {
    const lebendig = group.filter((r) => r.status !== "error");
    if (!lebendig.length) continue;
    const head = lebendig[0]._dbRow;

    // ── Pruefsumme ─────────────────────────────────────────────────────────
    // Geschrieben werden die POSITIONEN. Weicht ihre Summe von der Kopfsumme
    // ab, waere der Beleg eine falsche Forderung — deshalb Fehler, nicht
    // Warnung.
    if (head.kopfsumme != null) {
      const summe = fmt2(lebendig.reduce((a, r) => a + num(r._dbRow.amount) + num(r._dbRow.extrasAmount), 0));
      if (Math.abs(summe - fmt2(head.kopfsumme)) > 0.01) {
        fehlerAmBeleg(lebendig, `Beleg „${head.docNumber}“: die Positionen ergeben ${summe.toFixed(2)} €, die Kopfsumme sagt ${fmt2(head.kopfsumme).toFixed(2)} €`);
        continue;
      }
    }

    // ── Storno ─────────────────────────────────────────────────────────────
    if (head.istStorno) {
      const ziel = findeBeleg(head.stornoZu);
      if (!ziel) {
        fehlerAmBeleg(lebendig, `Storno „${head.docNumber}“: der Beleg „${head.stornoZu}“ steht weder in dieser Datei noch im System`);
        continue;
      }
      if (ziel.mehrdeutig) {
        fehlerAmBeleg(lebendig, `Storno „${head.docNumber}“: die Nummer „${head.stornoZu}“ gibt es mehrfach — bitte die Kennung aus dem Altsystem angeben`);
        continue;
      }
      if (ziel.istStorno || ziel.invoiceType === "stornorechnung") {
        fehlerAmBeleg(lebendig, `Storno „${head.docNumber}“: „${head.stornoZu}“ ist selbst ein Storno`);
        continue;
      }
      if (ziel.projectId != null && head.projectId != null && String(ziel.projectId) !== String(head.projectId)) {
        fehlerAmBeleg(lebendig, `Storno „${head.docNumber}“ gehört zu einem anderen Projekt als „${head.stornoZu}“`);
        continue;
      }
      if (ziel.quelle === "bestand" && ctx.bereitsStorniert?.has(`${ziel.kind}|${ziel.id}`)) {
        fehlerAmBeleg(lebendig, `Storno „${head.docNumber}“: „${head.stornoZu}“ ist bereits storniert`);
        continue;
      }
      // Erst jetzt steht das Ziel des Stornos fest: es folgt dem Beleg, den es
      // aufhebt — eine Storno-Abschlagsrechnung gehoert in ADVANCE_INVOICE.
      const docType = ziel.kind === "invoice" ? "invoice" : "partial";
      for (const r of group) {
        r._dbRow.docType = docType;
        r._dbRow.stornoZiel = ziel;
      }
    }

    // ── Abzuege der Schlussrechnung ────────────────────────────────────────
    const istSchluss = head.invoiceType === "schlussrechnung" || head.invoiceType === "teilschlussrechnung";
    const abzuege = [];
    if (head.deductsRaw) {
      if (!istSchluss) {
        for (const r of lebendig) {
          r.messages.push({ level: "warn", text: `Beleg „${head.docNumber}“ nennt Abzüge, ist aber keine Schlussrechnung — die Abzüge werden ignoriert` });
        }
      } else {
        for (const teil of head.deductsRaw.split(/[;,]/).map((t) => t.trim()).filter(Boolean)) {
          const [nummerRoh, betragRoh] = teil.split(":").map((t) => (t || "").trim());
          const ziel = findeBeleg(nummerRoh);
          if (!ziel) {
            fehlerAmBeleg(lebendig, `Schlussrechnung „${head.docNumber}“: der Abschlag „${nummerRoh}“ steht weder in dieser Datei noch im System`);
            break;
          }
          if (ziel.kind !== "advance") {
            fehlerAmBeleg(lebendig, `Schlussrechnung „${head.docNumber}“: „${nummerRoh}“ ist keine Abschlagsrechnung`);
            break;
          }
          if (ziel.projectId != null && head.projectId != null && String(ziel.projectId) !== String(head.projectId)) {
            fehlerAmBeleg(lebendig, `Schlussrechnung „${head.docNumber}“: der Abschlag „${nummerRoh}“ gehört zu einem anderen Projekt`);
            break;
          }
          const key = norm(nummerRoh);
          if (beansprucht.has(key)) {
            fehlerAmBeleg(lebendig, `Der Abschlag „${nummerRoh}“ wird in dieser Datei von zwei Belegen abgezogen (auch von „${beansprucht.get(key)}“)`);
            break;
          }
          if (ziel.quelle === "bestand" && ctx.beanspruchteAbschlaege?.has(ziel.id)) {
            fehlerAmBeleg(lebendig, `Der Abschlag „${nummerRoh}“ ist bereits von einer gebuchten Schlussrechnung angerechnet`);
            break;
          }
          const betrag = betragRoh ? parseAmountDE(betragRoh).value : Math.abs(ziel.totalNet);
          if (betrag == null) {
            fehlerAmBeleg(lebendig, `Schlussrechnung „${head.docNumber}“: „${betragRoh}“ ist kein gültiger Abzugsbetrag`);
            break;
          }
          beansprucht.set(key, head.docNumber);
          abzuege.push({ nummer: nummerRoh, betrag: fmt2(Math.abs(betrag)), ziel });
        }
      }
    } else if (istSchluss) {
      for (const r of lebendig) {
        r.messages.push({ level: "warn", text: `Schlussrechnung „${head.docNumber}“ ohne Abzüge — frühere Abschläge werden nicht angerechnet` });
      }
    }

    if (abzuege.length) {
      const summeAbzug = fmt2(abzuege.reduce((a, d) => a + d.betrag, 0));
      const summePos = fmt2(lebendig.reduce((a, r) => a + num(r._dbRow.amount) + num(r._dbRow.extrasAmount), 0));
      if (summeAbzug > summePos + 0.01) {
        for (const r of lebendig) {
          r.messages.push({ level: "warn", text: `Schlussrechnung „${head.docNumber}“: die Abzüge (${summeAbzug.toFixed(2)} €) übersteigen die Leistung (${summePos.toFixed(2)} €) — der Beleg wird negativ` });
        }
      }
      for (const r of group) r._dbRow.abzuege = abzuege;
    }

    // ── Reihenfolge ────────────────────────────────────────────────────────
    // Drei Stufen statt einer Sortierung nach Abhaengigkeit: Abschlaege und
    // einfache Rechnungen zuerst, dann die Schlussrechnungen, die sie
    // anrechnen, zuletzt die Stornos, die sich auf beides beziehen koennen.
    // Eine Datei darf ihre Belege damit in beliebiger Reihenfolge fuehren.
    const stufe = head.istStorno ? 2 : istSchluss ? 1 : 0;
    for (const r of group) r._dbRow.commitSeq = stufe;
  }
}

async function commitOpenItemRows(rows, { supabase, tenantId, batchId, ctx, employeeId }) {
  const byDoc = new Map();
  for (const r of rows) {
    const key = norm(r._dbRow.docNumber);
    if (!byDoc.has(key)) byDoc.set(key, []);
    byDoc.get(key).push(r);
  }

  // Reihenfolge aus der Vorschau: Abschlaege vor den Schlussrechnungen, die
  // sie anrechnen, Originale vor ihren Stornos. Die Datei darf ihre Belege
  // damit in beliebiger Reihenfolge fuehren.
  const gruppen = [...byDoc.values()].sort((a, b) => {
    const sa = num(a[0]._dbRow.commitSeq), sb = num(b[0]._dbRow.commitSeq);
    if (sa !== sb) return sa - sb;
    return String(a[0]._dbRow.docDate || "").localeCompare(String(b[0]._dbRow.docDate || ""));
  });

  // Welche Belegnummer welche Datenbank-ID bekommen hat — Stornos und
  // Schlussrechnungen brauchen sie, und ihre Bezugsbelege stehen dank der
  // Reihenfolge bereits.
  const idNachNummer = new Map();
  const geschrieben = [];   // fuer das Anheben des Nummernkreises

  let inserted = 0;
  for (const group of gruppen) {
    const head = group[0]._dbRow;
    try {
      // Rechnungsempfänger sicherstellen (init… verlangt Adresse + Kontakt).
      let contactId = head.contactId;
      if (!head.addressId) throw { status: 400, message: "keine Rechnungsadresse am Vertrag" };
      if (!contactId) {
        const { data: cts } = await supabase.from("CONTACTS").select("ID").eq("TENANT_ID", tenantId).eq("ADDRESS_ID", head.addressId).order("ID", { ascending: true }).limit(1);
        contactId = cts?.[0]?.ID ?? null;
        if (!contactId) throw { status: 400, message: "kein Ansprechpartner zur Rechnungsadresse — bitte Kontakt importieren" };
      }
      await supabase.from("CONTRACT").update({ INVOICE_ADDRESS_ID: head.addressId, INVOICE_CONTACT_ID: contactId }).eq("ID", head.contractId).eq("TENANT_ID", tenantId);

      // Positionen: benannte Knoten, sonst Verteilung über die Pauschal-Knoten.
      const withPos = group.filter((r) => r._dbRow.node);
      const totalNet = group.reduce((a, r) => a + num(r._dbRow.amount), 0);
      const positions = withPos.length
        ? withPos.map((r) => ({
            id: r._dbRow.node.id,
            extrasPercent: r._dbRow.node.extrasPercent,
            amt: fmt2(r._dbRow.amount),
            // Nebenkosten aus der Datei schlagen den Prozentsatz des Knotens:
            // ein Altbeleg traegt den Betrag, mit dem er gestellt wurde.
            extrasAmt: r._dbRow.extrasAmount != null ? fmt2(r._dbRow.extrasAmount) : null,
          }))
        : distributeOpening(fmt2(totalNet), head.nodes.filter((n) => n.billingTypeId === 1));

      // Bezugsbelege aufloesen: erst in diesem Stapel, dann im Bestand.
      const belegId = (nummer, kind) => {
        const ausStapel = idNachNummer.get(norm(nummer));
        if (ausStapel) return ausStapel.id;
        const ausBestand = ctx?.docsByNumber?.get(norm(nummer));
        return ausBestand && (!kind || ausBestand.kind === kind) ? ausBestand.id : null;
      };

      const stornoZielId = head.istStorno ? belegId(head.stornoZu) : null;
      const abzugZeilen = (head.abzuege || []).map((d) => ({
        advanceId: belegId(d.nummer, "advance"),
        betrag: d.betrag,
        nummer: d.nummer,
      }));
      const fehlend = abzugZeilen.find((d) => d.advanceId == null);
      if (fehlend) throw { status: 400, message: `der Abschlag „${fehlend.nummer}“ wurde nicht geschrieben` };
      if (head.istStorno && stornoZielId == null) {
        throw { status: 400, message: `der stornierte Beleg „${head.stornoZu}“ wurde nicht geschrieben` };
      }

      const { docId, vatPercent } = await bookReferenceDocument(supabase, {
        tenantId, batchId, employeeId, docType: head.docType,
        doc: {
          companyId: head.companyId, projectId: head.projectId, contractId: head.contractId,
          docNumber: head.docNumber, docDate: head.docDate, dueDate: head.dueDate,
          vatPercent: head.vatPercent, comment: head.comment, positions,
          invoiceType: head.invoiceType, legacyRef: head.legacyRef,
          text1: head.text1, text2: head.text2,
          buyerReference: head.buyerReference,
          periodStart: head.periodStart, periodEnd: head.periodEnd,
          cashDiscountPercent: head.cashDiscountPercent, cashDiscountDays: head.cashDiscountDays,
          cancelsId: stornoZielId, cancellationDate: head.cancellationDate,
          abzuege: abzugZeilen,
          closesProject: head.closesProject,
        },
      });

      idNachNummer.set(norm(head.docNumber), { id: docId, kind: head.docType === "invoice" ? "invoice" : "advance" });
      geschrieben.push({ companyId: head.companyId, nummer: head.docNumber, datum: head.docDate });

      const paidNet = fmt2(group.reduce((a, r) => a + num(r._dbRow.paid), 0));
      if (paidNet > 0) {
        await recordOpeningPayment(supabase, {
          tenantId, batchId, docType: head.docType, docId, projectId: head.projectId, contractId: head.contractId,
          paidNet, vatPercent, dist: positions,
          paymentDate: head.paidDate || head.docDate,
          purpose: `Zahlung zu ${head.docNumber} (Import)`,
        });
      }
      inserted += group.length;
    } catch (err) {
      throw { status: err?.status || 500, message: `Beleg ${head.docNumber} fehlgeschlagen: ${err?.message || err}` };
    }
  }

  // Zum Schluss den Nummernkreis anheben. Ein Fehler hier darf den Import
  // nicht kippen — die Belege stehen bereits —, aber er gehoert in die
  // Abschlussmeldung: sonst vergibt der Kunde spaeter eine Nummer, die es
  // schon gibt, und die Datenbank faengt das nicht ab.
  let nummernkreis = null;
  try {
    nummernkreis = await bumpNumberRanges(supabase, geschrieben);
  } catch (err) {
    nummernkreis = { angehoben: [], ungedeutet: [], fehler: err?.message || String(err) };
  }

  return { inserted, nummernkreis };
}

// ── Domäne: Kosten-Anfangsbestände (Kostenblöcke) ────────────────────────────
// Für (v. a. Stunden-/BOOKING-)Projekte: aggregierte, bereits angefallene Kosten je
// Projekt als EINE LUMP_COST-Buchung — KEINE Einzelbuchungen. Speist
// Deckungsbeitrag/Wirtschaftlichkeit ab Tag 1.
const OPENING_COST_FIELDS = [
  { key: "project_number", header: "Projektnummer",                      required: true,  example: "P-2024-012",                aliases: ["projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "cost",           header: "Bereits angefallene Kosten (netto)", required: true,  example: "45000",                     aliases: ["kosten", "kostenblock", "kostensumme", "aufwand", "betrag", "costs", "cost"] , type: "money" },
  { key: "description",    header: "Bezeichnung (optional)",             required: false, example: "Personalkosten bis 06/2026", aliases: ["bezeichnung", "beschreibung", "text", "description", "kommentar"] },
];

async function loadOpeningCostContext(supabase, tenantId) {
  const [projRes, structRes, tecRes] = await Promise.all([
    supabase.from("PROJECT").select("ID, ABBR").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT_STRUCTURE").select("ID, PROJECT_ID, FATHER_ID, BILLING_TYPE_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("BOOKING").select("PROJECT_ID").eq("TENANT_ID", tenantId).eq("BOOKING_KIND", "LUMP_COST").not("IMPORT_BATCH_ID", "is", null).limit(100000),
  ]);

  // Blatt-Knoten je Projekt ermitteln (kein anderer Knoten hat ihn als FATHER); BT2 bevorzugt.
  const fatherIds = new Set();
  for (const st of structRes.data || []) if (st.FATHER_ID != null) fatherIds.add(st.FATHER_ID);
  const leafByProject = new Map();
  for (const st of structRes.data || []) {
    if (fatherIds.has(st.ID)) continue;
    const cur = leafByProject.get(st.PROJECT_ID);
    if (!cur || (Number(st.BILLING_TYPE_ID) === 2 && Number(cur.BILLING_TYPE_ID) !== 2)) leafByProject.set(st.PROJECT_ID, st);
  }

  const byNumber = new Map();
  const idToNumber = new Map();
  for (const p of projRes.data || []) {
    if (!p.ABBR) continue;
    byNumber.set(norm(p.ABBR), { projectId: p.ID, structureId: leafByProject.get(p.ID)?.ID ?? null });
    idToNumber.set(p.ID, p.ABBR);
  }
  const importedCostProjects = new Set();
  for (const r of tecRes.data || []) if (r.PROJECT_ID != null) importedCostProjects.add(r.PROJECT_ID);
  const existingKeys = new Set();
  for (const [id, numv] of idToNumber) if (importedCostProjects.has(id)) existingKeys.add(norm(numv));

  return { byNumber, existingKeys };
}

function buildOpeningCostEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const number = s(mapped.project_number);
  let proj = null;
  if (!number) { messages.push({ level: "error", text: "Projektnummer fehlt (Pflichtfeld)" }); ok = false; }
  else {
    proj = ctx.byNumber.get(norm(number)) || null;
    if (!proj) { messages.push({ level: "error", text: `Projekt „${number}“ nicht gefunden` }); ok = false; }
  }

  const costRaw = s(mapped.cost);
  const cost = parseAmountDE(costRaw);
  if (!costRaw) { messages.push({ level: "error", text: "Kostenbetrag fehlt (Pflichtfeld)" }); ok = false; }
  else if (cost.invalid || cost.value == null) { messages.push({ level: "error", text: `Kosten „${costRaw}“ ist keine gültige Zahl` }); ok = false; }
  else if (cost.value <= 0) { messages.push({ level: "error", text: "Kostenbetrag muss größer als 0 sein" }); ok = false; }

  if (proj && ok && proj.structureId == null) messages.push({ level: "warn", text: "Projekt ohne Leistungsstruktur — Kosten werden auf Projektebene gebucht" });

  const description = s(mapped.description) || "Anfangsbestand Kosten (Import)";
  const dbRow = (proj && ok) ? { projectId: proj.projectId, projectNumber: number, structureId: proj.structureId, cost: cost.value, description } : null;
  const matchKey = norm(number);
  const display = { number, cost: cost.value != null ? cost.value.toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " €" : costRaw };
  return { ok, messages, dbRow, matchKey, display };
}

async function commitOpeningCostRows(rows, { supabase, tenantId, batchId, employeeId }) {
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  for (const r of rows) {
    const e = r._dbRow;
    try {
      // LUMP_COST: QUANTITY_INT=0 (keine Stunden), Betrag in COST_RATE/COST_TOTAL (Kosten).
      const insertRow = {
        TENANT_ID: tenantId, STATUS: "CONFIRMED", BOOKING_KIND: "LUMP_COST",
        BOOKING_TYPE_ID: null, EMPLOYEE_ID: employeeId ?? null, BOOKING_DATE: today,
        QUANTITY_INT: 0, COST_RATE: e.cost, COST_TOTAL: fmt2(e.cost), QUANTITY_EXT: 0, HOURLY_RATE: 0, HOURLY_RATE_TOTAL: 0,
        POSTING_DESCRIPTION: e.description, PROJECT_ID: e.projectId, STRUCTURE_ID: e.structureId,
        IMPORT_BATCH_ID: batchId,
      };
      const { error } = await supabase.from("BOOKING").insert([insertRow]);
      if (error) throw { status: 500, message: error.message };
      if (e.structureId) await recomputeStructure(supabase, e.structureId);
      done++;
    } catch (err) {
      throw { status: err?.status || 500, message: `Kosten-Anfangsbestand für ${e.projectNumber} fehlgeschlagen: ${err?.message || err}` };
    }
  }
  return { inserted: done };
}

async function rollbackOpeningCost({ supabase, tenantId, batchId }) {
  const { data: tec } = await supabase.from("BOOKING").select("ID, STRUCTURE_ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  const rows = tec || [];
  const structureIds = [...new Set(rows.map((r) => r.STRUCTURE_ID).filter((x) => x != null))];
  await supabase.from("BOOKING").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  for (const sid of structureIds) { try { await recomputeStructure(supabase, sid); } catch (_) { /* COSTS-Recompute soft-fail */ } }
  return { deleted: rows.length };
}

// Rollback-Schutz für die struktur-schreibenden Domänen: hängt am Projekt
// inzwischen echte Arbeit (Rechnung, Buchung, Abschlag), wird nicht gelöscht.
async function structureBatchBlockers({ supabase, tenantId, batchId }) {
  const { data: structs } = await supabase
    .from("PROJECT_STRUCTURE").select("PROJECT_ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  const projectIds = [...new Set((structs || []).map((r) => r.PROJECT_ID).filter(Boolean))];
  if (!projectIds.length) return [];
  const blockers = [];
  for (const dep of [{ table: "INVOICE", label: "Rechnung(en)" }, { table: "BOOKING", label: "Buchung(en)" }, { table: "ADVANCE_INVOICE", label: "Abschlagszahlung(en)" }]) {
    const { count, error } = await supabase
      .from(dep.table).select("ID", { count: "exact", head: true }).eq("TENANT_ID", tenantId).in("PROJECT_ID", projectIds);
    if (error) {
      if (/relation .* does not exist|column .* does not exist/i.test(error.message)) continue;
      throw { status: 500, message: error.message };
    }
    if (count > 0) blockers.push(`${count}× ${dep.label}`);
  }
  return blockers;
}

const DOMAINS = {
  address: {
    key: "address",
    mergeable: true,                   // Dubletten können mit der Datei zusammengeführt werden
    label: "Adressen",
    table: "ADDRESS",
    matchLabel: "Name 1 + PLZ",
    fields: ADDRESS_FIELDS,
    dependents: [
      { table: "PROJECT",  column: "ADDRESS_ID", label: "Projekt(e)" },
      { table: "CONTACTS", column: "ADDRESS_ID", label: "Kontakt(e)" },
    ],
    loadContext: loadAddressContext,
    buildEntry: buildAddressEntry,
  },
  employee: {
    key: "employee",
    mergeable: true,                   // Dubletten können mit der Datei zusammengeführt werden
    label: "Mitarbeiter",
    table: "EMPLOYEE",
    matchLabel: "E-Mail / Kürzel / Personalnummer",
    fields: EMPLOYEE_FIELDS,
    dependents: [
      { table: "PROJECT",          column: "PROJECT_MANAGER_ID", label: "Projekt(e) als Projektleiter" },
      { table: "BOOKING",              column: "EMPLOYEE_ID", label: "Buchung(en)" },
      { table: "EMPLOYEE2PROJECT", column: "EMPLOYEE_ID", label: "Projektzuordnung(en)" },
      { table: "ABSENCE",          column: "EMPLOYEE_ID", label: "Abwesenheit(en)" },
    ],
    loadContext: loadEmployeeContext,
    buildEntry: buildEmployeeEntry,
    finalizeRows: finalizeEmployeeRows,
    commitRows: commitEmployeeRows,
    rollbackExecute: rollbackEmployee,
  },
  contact: {
    key: "contact",
    mergeable: true,                   // Dubletten können mit der Datei zusammengeführt werden
    label: "Kontakte",
    table: "CONTACTS",
    matchLabel: "Adresse + Name",
    fields: CONTACT_FIELDS,
    dependents: [
      { table: "PROJECT",         column: "CONTACT_ID",         label: "Projekt(e)" },
      { table: "CONTRACT",        column: "INVOICE_CONTACT_ID", label: "Vertrag/Verträge" },
      { table: "OFFER",           column: "CONTACT_ID",         label: "Angebot(e)" },
      { table: "INVOICE",         column: "CONTACT_ID",         label: "Rechnung(en)" },
      { table: "ADVANCE_INVOICE", column: "CONTACT_ID",         label: "Abschlagsrechnung(en)" },
    ],
    loadContext: loadContactContext,
    buildEntry: buildContactEntry,
  },
  project: {
    key: "project",
    mergeable: true,                   // Dubletten können mit der Datei zusammengeführt werden
    label: "Projekte",
    table: "PROJECT",
    matchLabel: "Projektnummer",
    fields: PROJECT_FIELDS,
    dependents: [
      { table: "PROJECT_STRUCTURE", column: "PROJECT_ID", label: "Leistungsstruktur" },
      { table: "EMPLOYEE2PROJECT",  column: "PROJECT_ID", label: "Mitarbeiterzuordnung(en)" },
      { table: "CONTRACT",          column: "PROJECT_ID", label: "Vertrag/Verträge" },
      { table: "INVOICE",           column: "PROJECT_ID", label: "Rechnung(en)" },
      { table: "BOOKING",               column: "PROJECT_ID", label: "Buchung(en)" },
      { table: "OFFER",             column: "PROJECT_ID", label: "verknüpfte(s) Angebot(e)" },
    ],
    loadContext: loadProjectContext,
    buildEntry: buildProjectEntry,
  },
  project_fee: {
    key: "project_fee",
    label: "Projekt-Honorar",
    table: "PROJECT_STRUCTURE",          // primäre Tabelle (für Rollback-Zählung)
    matchLabel: "Projektnummer",
    fields: PROJECT_FEE_FIELDS,
    loadContext: loadProjectFeeContext,
    buildEntry: buildProjectFeeEntry,
    commitRows: commitProjectFeeRows,
    rollbackTables: ["PROJECT_PROGRESS", "PROJECT_STRUCTURE", "CONTRACT"], // PROGRESS vor STRUCTURE (FK)
    computeBlockers: async ({ supabase, tenantId, batchId }) => structureBatchBlockers({ supabase, tenantId, batchId }),
  },
  project_full: {
    key: "project_full",
    label: "Projekte inkl. Struktur",
    table: "PROJECT",
    matchLabel: "Projektnummer",
    fields: PROJECT_FULL_FIELDS,
    // Viele Zeilen je Projekt sind der Normalfall — eine wiederkehrende
    // Projektnummer ist hier keine Dublette. Ob es das Projekt schon GIBT,
    // entscheidet finalizeRows fuer das ganze Projekt auf einmal.
    dedupeInFile: false,
    loadContext: loadProjectFullContext,
    buildEntry: buildProjectFullEntry,
    finalizeRows: finalizeProjectFullRows,
    commitRows: commitProjectFullRows,
    rollbackExecute: rollbackProjectFull,
  },
  project_structure: {
    key: "project_structure",
    label: "Projektstruktur (Leistungsbaum)",
    table: "PROJECT_STRUCTURE",
    matchLabel: "Projektnummer",
    fields: PROJECT_STRUCTURE_FIELDS,
    exampleRows: [
      { project_number: "P-2024-012", outline: "1",   abbr: "LB Gebäude", name: "Leistungsbild Gebäude",       billing: "",         revenue: "",      extras_percent: "5" },
      { project_number: "P-2024-012", outline: "1.1", abbr: "LP1-4",      name: "Vorplanung bis Genehmigung",  billing: "Pauschal", revenue: "27000", extras_percent: "" },
      { project_number: "P-2024-012", outline: "1.2", abbr: "LP5",        name: "Ausführungsplanung",          billing: "Pauschal", revenue: "25000", extras_percent: "" },
      { project_number: "P-2024-012", outline: "1.3", abbr: "LP6-8",      name: "Vergabe und Bauüberwachung",  billing: "Pauschal", revenue: "28000", extras_percent: "" },
      { project_number: "P-2024-012", outline: "2",   abbr: "BL",         name: "Besondere Leistungen",        billing: "Stunden",  revenue: "",      extras_percent: "" },
    ],
    dedupeInFile: false,               // viele Zeilen je Projekt sind der Normalfall
    loadContext: loadProjectStructureContext,
    buildEntry: buildProjectStructureEntry,
    finalizeRows: finalizeProjectStructureRows,
    commitRows: commitProjectStructureRows,
    rollbackTables: ["PROJECT_PROGRESS", "PROJECT_STRUCTURE", "CONTRACT"],
    computeBlockers: async ({ supabase, tenantId, batchId }) => structureBatchBlockers({ supabase, tenantId, batchId }),
  },
  opening_balance: {
    key: "opening_balance",
    label: "Anfangsbestände (Altrechnungen)",
    table: "ADVANCE_INVOICE",
    matchLabel: "Projektnummer",
    fields: OPENING_BALANCE_FIELDS,
    loadContext: loadOpeningBalanceContext,
    buildEntry: buildOpeningBalanceEntry,
    commitRows: commitOpeningBalanceRows,
    rollbackExecute: rollbackOpeningBalance,
  },
  open_items: {
    key: "open_items",
    label: "Belege (Altbestand)",
    table: "ADVANCE_INVOICE",
    matchLabel: "Belegnummer",
    fields: OPEN_ITEM_FIELDS,
    exampleRows: [
      { project_number: "P-2024-012", doc_number: "AR-2025-007", doc_type: "Abschlag", doc_date: "15.11.2025", due_date: "15.12.2025", position: "LP5",   amount_net: "12500", vat_percent: "19" },
      { project_number: "P-2024-012", doc_number: "AR-2025-007", doc_type: "Abschlag", doc_date: "15.11.2025", due_date: "15.12.2025", position: "LP6-8", amount_net: "8000",  vat_percent: "19" },
      { project_number: "P-2024-013", doc_number: "RE-2025-101", doc_type: "Rechnung", doc_date: "01.12.2025", due_date: "31.12.2025", position: "",       amount_net: "4200",  vat_percent: "19", paid_net: "2000", paid_date: "20.12.2025" },
      { project_number: "P-2024-012", doc_number: "SR-2025-004", doc_type: "Schlussrechnung", doc_date: "20.12.2025", due_date: "19.01.2026", position: "LP5", amount_net: "60000", vat_percent: "19", deducts: "AR-2025-007" },
    ],
    dedupeInFile: false,               // mehrere Positionszeilen je Beleg sind der Normalfall
    loadContext: loadOpenItemContext,
    buildEntry: buildOpenItemEntry,
    finalizeRows: finalizeOpenItemRows,
    commitRows: commitOpenItemRows,
    rollbackExecute: rollbackOpeningBalance,   // reversiert Belege + Zahlungen des Stapels
  },
  opening_cost: {
    key: "opening_cost",
    label: "Kosten-Anfangsbestände",
    table: "BOOKING",
    matchLabel: "Projektnummer",
    fields: OPENING_COST_FIELDS,
    loadContext: loadOpeningCostContext,
    buildEntry: buildOpeningCostEntry,
    commitRows: commitOpeningCostRows,
    rollbackExecute: rollbackOpeningCost,
  },
};

function getDomain(key) {
  const d = DOMAINS[key];
  if (!d) throw { status: 400, message: `Unbekannte Import-Domäne: ${key}` };
  return d;
}

function publicField(f) {
  return { key: f.key, header: f.header, required: !!f.required, example: f.example || "" };
}

// ── Parsing / Mapping (rein) ─────────────────────────────────────────────────
/**
 * Buffer (XLSX/CSV) → { headers, rows, sheetName, sheetNames }.
 * Gelesen wird das erste Tabellenblatt; `sheetNames` macht im UI sichtbar,
 * wenn die Datei weitere Blätter hat (sonst wird das stumm ignoriert).
 */
function parseBuffer(buffer, sheetName) {
  return readTable(buffer, { sheetName });
}

/** Auto-Zuordnung: Feld → passende Datei-Spalte anhand Header/Aliassen. */
function buildAutoMapping(headers, domainKey) {
  const def = getDomain(domainKey);
  const map = {};
  const used = new Set();
  for (const f of def.fields) {
    const cands = [f.header, ...(f.aliases || [])].map(normHeader);
    const hit = headers.find((h) => !used.has(h) && cands.includes(normHeader(h)));
    if (hit) { map[f.key] = hit; used.add(hit); }
  }
  return map;
}

/** Trockenlauf: klassifiziert jede Zeile (ok/duplicate/error), schreibt nichts. */
function buildPreview({ domainKey, parsed, mapping, ctx }) {
  const def = getDomain(domainKey);
  const map = mapping && Object.keys(mapping).length ? mapping : buildAutoMapping(parsed.headers, domainKey);
  const seen = new Set();
  const rows = [];

  parsed.rows.forEach((raw, i) => {
    const mapped = {};
    for (const f of def.fields) mapped[f.key] = leerwert(map[f.key] != null ? raw[map[f.key]] : "");
    // Komplett leere Zeilen überspringen (kein Fehler, kein Import).
    if (def.fields.every((f) => !s(mapped[f.key]))) return;

    const entry = def.buildEntry(mapped, ctx);
    const messages = [...entry.messages];
    let status;

    if (!entry.ok) {
      // Pflichtfeld fehlt oder ist ungültig → NICHT importierbar.
      status = "error";
    } else {
      // Importierbar. Dublette schlägt Warnung; Warnung (optionale Hinweise)
      // schlägt "sauber". matchKey kann ein String oder mehrere Schlüssel sein
      // (z. B. Mitarbeiter: Mail/Kürzel/Pers.-Nr.).
      const keys = Array.isArray(entry.matchKey) ? entry.matchKey : [entry.matchKey];
      // Bäume liefern absichtlich viele Zeilen je Projekt — dort ist eine
      // wiederkehrende Projektnummer keine Dublette, sondern der Normalfall.
      if (def.dedupeInFile !== false && keys.some((k) => seen.has(k))) {
        status = "duplicate"; messages.push({ level: "warn", text: "Dublette innerhalb der Datei" });
      } else if (keys.some((k) => ctx.existingKeys.has(k))) {
        status = "duplicate"; messages.push({ level: "warn", text: "Bereits im System vorhanden" });
      } else {
        status = messages.some((m) => m.level === "warn") ? "warning" : "ok";
      }
      keys.forEach((k) => seen.add(k));
    }

    // `_raw` = die Originalzeile der Datei; sie speist das Fehlerprotokoll,
    // das der Nutzer korrigiert und unverändert wieder hochladen kann.
    // _extra: was eine Domaene mit eigener Schreiblogik braucht, aber nicht in
    // die eigene Tabelle gehoert (beim Mitarbeiter: Kostensatz, Arbeitszeit-
    // modell, Rolle, Vorgesetzter). _dbRow dafuer mitzubenutzen ginge nicht —
    // dessen Schluessel sind Spaltennamen und gehen so an die Datenbank.
    rows.push({ row: i + 2, status, messages, display: entry.display, _dbRow: entry.dbRow, _extra: entry.extra || null, _raw: raw, _matchKey: entry.matchKey });
  });

  // Zeilenübergreifende Prüfung (Hierarchien): eine Baumzeile lässt sich nicht
  // allein beurteilen — ob sie Blatt oder Knoten ist, sagt erst der Rest.
  if (def.finalizeRows) {
    def.finalizeRows(rows, ctx);
    // Dort ergänzte Hinweise müssen den Status nachziehen, sonst bliebe eine
    // Zeile „sauber“, obwohl an ihr eine Warnung hängt.
    for (const r of rows) {
      if (r.status === "ok" && r.messages.some((m) => m.level === "warn")) r.status = "warning";
    }
  }

  let ok = 0, warning = 0, duplicate = 0, error = 0;
  for (const r of rows) {
    if (r.status === "ok") ok++;
    else if (r.status === "warning") warning++;
    else if (r.status === "duplicate") duplicate++;
    else error++;
  }

  return { mapping: map, summary: { total: rows.length, ok, warning, duplicate, error }, rows };
}

// ── Orchestrierung (mit supabase) ────────────────────────────────────────────
/** ID des bestehenden Datensatzes zu einer als Dublette erkannten Zeile. */
function findExistingId(ctx, row) {
  if (!ctx.existingIds) return null;
  const keys = Array.isArray(row._matchKey) ? row._matchKey : [row._matchKey];
  for (const k of keys) {
    const id = ctx.existingIds.get(k);
    if (id != null) return id;
  }
  return null;
}

/**
 * Dubletten zusammenführen: die gefüllten Felder der Datei auf den bestehenden
 * Datensatz schreiben. Leere Zellen lassen den Bestand in Ruhe — ein Import
 * soll ergänzen, nicht ausradieren.
 *
 * Der vorherige Stand genau der geänderten Felder wandert als `undo` in den
 * Stapel, damit auch ein Zusammenführen zurückgenommen werden kann. Ohne das
 * wäre „Import zurücksetzen" für diesen Modus eine leere Zusage.
 */
async function mergeExistingRows(rows, { supabase, tenantId, def, ctx }) {
  const undo = [];
  let merged = 0;

  for (const r of rows) {
    const id = findExistingId(ctx, r);
    if (id == null) continue;

    // Nur gefüllte Felder übernehmen.
    const payload = {};
    for (const [col, val] of Object.entries(r._dbRow || {})) {
      if (val === null || val === undefined || val === "") continue;
      payload[col] = val;
    }
    if (!Object.keys(payload).length) continue;

    // Spaltennamen quoten — ADDRESS trägt z. B. "TAX-ID", und ein Bindestrich
    // im unquotierten Select ist für PostgREST ein Syntaxfehler.
    const cols = Object.keys(payload).map((c) => `"${c}"`).join(",");
    const { data: before, error: selErr } = await supabase
      .from(def.table).select(cols).eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
    if (selErr) throw { status: 500, message: selErr.message };

    const { error: updErr } = await supabase
      .from(def.table).update(payload).eq("ID", id).eq("TENANT_ID", tenantId);
    if (updErr) throw { status: 500, message: updErr.message };

    undo.push({ table: def.table, id, before: before || {} });
    merged++;
  }
  return { merged, undo };
}

/**
 * Zuletzt verwendete Spaltenzuordnung dieses Mandanten für diese Domäne.
 * Wer denselben Export monatlich einspielt, soll seine Zuordnung nicht jedes Mal
 * neu klicken. `MAPPING_JSON` wurde bisher zwar geschrieben, aber nie gelesen.
 */
async function loadRememberedMapping(supabase, tenantId, domainKey) {
  const { data, error } = await supabase
    .from("IMPORT_BATCH").select("MAPPING_JSON")
    .eq("TENANT_ID", tenantId).eq("DOMAIN", domainKey).eq("STATUS", "committed")
    .order("CREATED_AT", { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  const m = data[0].MAPPING_JSON;
  return m && typeof m === "object" ? m : null;
}

/** Gemerkte Zuordnung auf die Spalten der aktuellen Datei eindampfen. */
function applyRememberedMapping(remembered, headers, domainKey) {
  const auto = buildAutoMapping(headers, domainKey);
  if (!remembered) return { mapping: auto, source: "auto" };
  const known = new Set(headers);
  const usable = {};
  for (const [field, header] of Object.entries(remembered)) {
    if (known.has(header)) usable[field] = header;
  }
  if (!Object.keys(usable).length) return { mapping: auto, source: "auto" };
  return { mapping: { ...auto, ...usable }, source: "remembered" };
}

async function preview({ domainKey, buffer, filename, mapping, sheetName, supabase, tenantId }) {
  const def = getDomain(domainKey);
  const parsed = await parseBuffer(buffer, sheetName);
  if (!parsed.headers.length) throw { status: 400, message: "Die Datei enthält keine Spaltenüberschriften" };
  const ctx = await def.loadContext(supabase, tenantId);

  // Ohne ausdrückliche Zuordnung: die des letzten Imports vorschlagen, sonst
  // die automatische. Der Nutzer kann beides im nächsten Schritt korrigieren.
  let effective = mapping;
  let mappingSource = "manual";
  if (!mapping || !Object.keys(mapping).length) {
    const remembered = await loadRememberedMapping(supabase, tenantId, def.key);
    const applied = applyRememberedMapping(remembered, parsed.headers, def.key);
    effective = applied.mapping;
    mappingSource = applied.source;
  }

  const pv = buildPreview({ domainKey, parsed, mapping: effective, ctx });
  return {
    domain: def.key,
    filename: filename || null,
    sheetName: parsed.sheetName,
    sheetNames: parsed.sheetNames,
    headers: parsed.headers,
    mapping: pv.mapping,
    mappingSource,
    mergeable: !!def.mergeable,
    fields: def.fields.map(publicField),
    summary: pv.summary,
    rows: pv.rows.slice(0, 200).map((r) => ({ row: r.row, status: r.status, messages: r.messages, display: r.display })),
    truncated: pv.rows.length > 200,
  };
}

async function commit({ domainKey, buffer, filename, mapping, sheetName, duplicateMode, structureMode, docType, excludeRows, supabase, tenantId, employeeId }) {
  const def = getDomain(domainKey);
  const parsed = await parseBuffer(buffer, sheetName);
  const ctx = await def.loadContext(supabase, tenantId);
  const pv = buildPreview({ domainKey, parsed, mapping, ctx });

  const mode = duplicateMode === "merge" && def.mergeable ? "merge"
    : duplicateMode === "import" ? "import" : "skip";

  // In der Vorschau abgewählte Zeilen bleiben draußen.
  const excluded = new Set((excludeRows || []).map(Number).filter(Number.isFinite));

  // Importiert werden gültige Zeilen (sauber + mit Warnung); Dubletten nur,
  // wenn der Nutzer sie ausdrücklich anlegen oder zusammenführen will.
  const wanted = pv.rows.filter((r) => !excluded.has(r.row) &&
    (r.status === "ok" || r.status === "warning" || (r.status === "duplicate" && mode !== "skip")));
  if (!wanted.length) throw { status: 400, message: "Keine importierbaren Zeilen (alle leer, fehlerhaft, abgewählt oder Dubletten)." };

  // Beim Zusammenführen werden bestehende Datensätze aktualisiert statt neu
  // angelegt. Damit auch DAS rückgängig zu machen ist, wird der vorherige Stand
  // der geänderten Felder im Stapel mitgeschrieben.
  const toMerge = mode === "merge"
    ? wanted.filter((r) => r.status === "duplicate" && findExistingId(ctx, r) != null)
    : [];
  const mergeSet = new Set(toMerge);
  const toInsert = wanted.filter((r) => !mergeSet.has(r));

  // 1) Stapel anlegen
  const { data: batch, error: bErr } = await supabase.from("IMPORT_BATCH").insert([{
    TENANT_ID: tenantId, DOMAIN: def.key, STATUS: "committed", SOURCE_FILENAME: filename || null,
    MAPPING_JSON: pv.mapping, ROW_TOTAL: pv.summary.total, ROW_OK: pv.summary.ok,
    ROW_SKIPPED: pv.summary.duplicate, ROW_ERROR: pv.summary.error,
    SUMMARY_JSON: { ...pv.summary, structureMode: structureMode || null, docType: docType || null }, CREATED_BY: employeeId || null,
  }]).select("ID").single();
  if (bErr) throw { status: 500, message: "Import-Stapel konnte nicht angelegt werden: " + bErr.message };
  const batchId = batch.ID;

  // 2a) Domänen mit eigener Schreiblogik (z. B. Projekt-Honorar: Struktur +
  //     Fortschritt + Vertrag pro Projekt) — alles mit IMPORT_BATCH_ID getaggt.
  if (def.commitRows) {
    try {
      // duplicateMode gehoert mit hinein: eine Domaene mit eigener Schreib-
      // logik bekommt die Dubletten in `wanted` und muss selbst entscheiden,
      // ob sie sie anlegt oder zusammenfuehrt — der Standardweg weiter unten
      // kommt hier nicht mehr vorbei.
      const res = await def.commitRows(wanted, { supabase, tenantId, batchId, ctx, options: { structureMode, docType, duplicateMode: mode }, employeeId });
      const inserted = res?.inserted || 0;
      const merged   = res?.merged   || 0;
      const undo     = Array.isArray(res?.undo) ? res.undo : [];
      // Zusammengefuehrtes ist nur ruecknehmbar, wenn der vorherige Stand im
      // Stapel steht — loeschen kann man es nicht, die Zeile gab es vorher.
      if (merged || undo.length) {
        await supabase.from("IMPORT_BATCH").update({
          ROW_OK: inserted + merged,
          SUMMARY_JSON: { ...pv.summary, structureMode: structureMode || null, docType: docType || null, merged, undo },
        }).eq("ID", batchId).eq("TENANT_ID", tenantId);
      }
      return { batchId, inserted, merged, summary: pv.summary };
    } catch (e) {
      await supabase.from("IMPORT_BATCH").update({ ROW_OK: 0 }).eq("ID", batchId).eq("TENANT_ID", tenantId);
      throw { status: e?.status || 500, message: `${e?.message || e} Stapel #${batchId} kann zurückgesetzt werden.` };
    }
  }

  // 2b) Standard: ein Insert pro Zeile in die Domänen-Tabelle (gechunkt).
  const dbRows = toInsert.map((r) => ({ ...r._dbRow, TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId }));
  let inserted = 0;
  try {
    for (let i = 0; i < dbRows.length; i += 500) {
      const chunk = dbRows.slice(i, i + 500);
      const { error } = await supabase.from(def.table).insert(chunk);
      if (error) throw error;
      inserted += chunk.length;
    }
  } catch (e) {
    await supabase.from("IMPORT_BATCH").update({ ROW_OK: inserted }).eq("ID", batchId).eq("TENANT_ID", tenantId);
    throw { status: 500, message: `Import teilweise fehlgeschlagen (${inserted}/${dbRows.length} geschrieben): ${e.message}. Stapel #${batchId} kann zurückgesetzt werden.` };
  }

  // 2c) Zusammenführen: bestehende Datensätze mit den gefüllten Feldern der
  //     Datei aktualisieren. Leere Zellen überschreiben nichts.
  let merged = 0, undo = [];
  if (toMerge.length) {
    try {
      const r = await mergeExistingRows(toMerge, { supabase, tenantId, def, ctx });
      merged = r.merged; undo = r.undo;
    } catch (e) {
      await supabase.from("IMPORT_BATCH").update({ ROW_OK: inserted }).eq("ID", batchId).eq("TENANT_ID", tenantId);
      throw { status: e?.status || 500, message: `Zusammenführen fehlgeschlagen: ${e?.message || e}. Stapel #${batchId} kann zurückgesetzt werden.` };
    }
    await supabase.from("IMPORT_BATCH").update({
      ROW_OK: inserted + merged,
      SUMMARY_JSON: { ...pv.summary, structureMode: structureMode || null, docType: docType || null, merged, undo },
    }).eq("ID", batchId).eq("TENANT_ID", tenantId);
  }

  return { batchId, inserted, merged, summary: pv.summary };
}

/**
 * Fehlerprotokoll: die nicht importierbaren Zeilen als Excel — Originalspalten
 * unverändert, dahinter Zeilennummer und Grund. Der Nutzer korrigiert die Datei
 * und lädt sie erneut hoch; die beiden Zusatzspalten stören dabei nicht, weil
 * die Zuordnung unbekannte Überschriften ignoriert.
 */
async function errorReport({ domainKey, buffer, mapping, sheetName, supabase, tenantId, kind = "error" }) {
  const def = getDomain(domainKey);
  const parsed = await parseBuffer(buffer, sheetName);
  const ctx = await def.loadContext(supabase, tenantId);
  const pv = buildPreview({ domainKey, parsed, mapping, ctx });

  // Zwei Sichten auf denselben Trockenlauf. Warnungen getrennt, weil sie etwas
  // anderes bedeuten: die Zeile KOMMT, aber nicht ganz so, wie sie dasteht.
  // Bei einer Übernahme mit 2000 Hinweisen will man die durchsehen können,
  // ohne sie mit den Zeilen zu vermischen, die gar nicht ankommen.
  const istWarnung = kind === "warning";
  const bad = istWarnung
    ? pv.rows.filter((r) => r.status !== "error" && r.messages.some((m) => m.level === "warn"))
    : pv.rows.filter((r) => r.status === "error");
  if (!bad.length) {
    throw { status: 400, message: istWarnung
      ? "Keine Zeilen mit Hinweis — es gibt nichts durchzusehen."
      : "Keine fehlerhaften Zeilen — es gibt nichts zu korrigieren." };
  }

  const headers = [...parsed.headers, "Zeile", istWarnung ? "Hinweis" : "Fehler"];
  const wb = new ExcelJS.Workbook();
  wb.creator = "plan&simple";
  const ws = wb.addWorksheet("Daten");
  ws.addRow(headers);

  for (const r of bad) {
    const values = parsed.headers.map((h) => r._raw?.[h] ?? "");
    values.push(r.row);
    values.push(r.messages.filter((m) => m.level === (istWarnung ? "warn" : "error")).map((m) => m.text).join(" · "));
    ws.addRow(values);
  }

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: TPL.accent } };
  head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TPL.headBg } }; });
  ws.getColumn(headers.length).font = { color: { argb: "FFB3261E" } };
  headers.forEach((h, i) => {
    const width = Math.max(h.length + 2, ...bad.map((r) => String(r._raw?.[parsed.headers[i]] ?? "").length + 2));
    ws.getColumn(i + 1).width = Math.min(60, Math.max(12, width));
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const out = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(out),
    filename: `plan-und-simple_${istWarnung ? "Hinweise" : "Fehler"}_${def.key}.xlsx`,
    count: bad.length,
  };
}

async function listBatches(supabase, tenantId) {
  const { data, error } = await supabase
    .from("IMPORT_BATCH").select("*").eq("TENANT_ID", tenantId)
    .order("CREATED_AT", { ascending: false }).limit(200);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    throw { status: 500, message: error.message };
  }
  return (data || []).map((b) => ({
    id: b.ID, domain: b.DOMAIN, domainLabel: DOMAINS[b.DOMAIN]?.label || b.DOMAIN,
    status: b.STATUS, filename: b.SOURCE_FILENAME,
    rowOk: b.ROW_OK, rowSkipped: b.ROW_SKIPPED, rowError: b.ROW_ERROR,
    createdAt: b.CREATED_AT, rolledBackAt: b.ROLLED_BACK_AT,
  }));
}

async function rollback({ batchId, supabase, tenantId }) {
  if (!batchId) throw { status: 400, message: "Ungültige Stapel-ID" };
  const { data: batch, error } = await supabase
    .from("IMPORT_BATCH").select("*").eq("ID", batchId).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw { status: 500, message: error.message };
  if (!batch) throw { status: 404, message: "Import-Stapel nicht gefunden" };
  if (batch.STATUS !== "committed") throw { status: 400, message: "Dieser Import wurde bereits zurückgesetzt" };

  const def = getDomain(batch.DOMAIN);

  // Zusammengeführte Datensätze zuerst auf ihren alten Stand zurücksetzen —
  // sie wurden aktualisiert, nicht angelegt, und tragen deshalb keine
  // Stapel-Kennung, an der ein Löschen ansetzen könnte.
  const undo = Array.isArray(batch.SUMMARY_JSON?.undo) ? batch.SUMMARY_JSON.undo : [];
  let restored = 0;
  for (const u of undo) {
    if (!u?.table || u.id == null || !u.before) continue;
    const { error } = await supabase.from(u.table).update(u.before).eq("ID", u.id).eq("TENANT_ID", tenantId);
    if (error) throw { status: 500, message: `Zusammengeführter Datensatz konnte nicht zurückgesetzt werden: ${error.message}` };
    restored++;
  }

  // Domänen mit eigener Rollback-Logik (z. B. Anfangsbestände: gebuchte Finanz-
  // Aggregate reversieren statt nur Zeilen löschen).
  if (def.rollbackExecute) {
    const r = await def.rollbackExecute({ supabase, tenantId, batchId });
    await supabase.from("IMPORT_BATCH")
      .update({ STATUS: "rolled_back", ROLLED_BACK_AT: new Date().toISOString() })
      .eq("ID", batchId).eq("TENANT_ID", tenantId);
    return { rolledBack: true, deleted: r?.deleted ?? 0, restored };
  }

  // Schutz: hängen Live-Daten an den importierten Datensätzen? Dann blockieren.
  let blockers = [];
  if (def.computeBlockers) {
    blockers = await def.computeBlockers({ supabase, tenantId, batchId });
  } else {
    const { data: idRows, error: idErr } = await supabase
      .from(def.table).select("ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
    if (idErr) throw { status: 500, message: idErr.message };
    const ids = (idRows || []).map((r) => r.ID);
    for (const dep of (ids.length ? def.dependents || [] : [])) {
      const { count, error: dErr } = await supabase
        .from(dep.table).select("ID", { count: "exact", head: true })
        .eq("TENANT_ID", tenantId).in(dep.column, ids);
      if (dErr) {
        if (/relation .* does not exist|column .* does not exist/i.test(dErr.message)) continue;
        throw { status: 500, message: dErr.message };
      }
      if (count > 0) blockers.push(`${count}× ${dep.label}`);
    }
  }
  if (blockers.length) {
    throw { status: 409, message: `Rollback nicht möglich: An importierten Datensätzen hängen bereits ${blockers.join(", ")}. Bitte diese zuerst entfernen.` };
  }

  // Löschen: je Tabelle nach IMPORT_BATCH_ID (Reihenfolge beachtet FK-Abhängigkeiten).
  const tables = def.rollbackTables || [def.table];
  let deleted = 0;
  for (const t of tables) {
    const { data: del, error: delErr } = await supabase
      .from(t).delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId).select("ID");
    if (delErr) {
      if (/relation .* does not exist|column .* does not exist/i.test(delErr.message)) continue;
      throw { status: 500, message: delErr.message };
    }
    if (t === def.table) deleted = (del || []).length;
  }

  await supabase.from("IMPORT_BATCH")
    .update({ STATUS: "rolled_back", ROLLED_BACK_AT: new Date().toISOString() })
    .eq("ID", batchId).eq("TENANT_ID", tenantId);
  return { rolledBack: true, deleted, restored };
}

// ── Vorlagen ─────────────────────────────────────────────────────────────────
// Feste Wertelisten (systemweit, nicht mandantenabhängig).
const FIXED_LISTS = {
  addressType:    ADDRESS_TYPE_ALIASES.map((t) => t.label),
  billing:        ["Pauschal", "Stunden"],
  docType:        ["Abschlag", "Rechnung"],
  yesNo:          ["ja", "nein"],
  employeeStatus: ["Aktiv", "Inaktiv"],
};

const LIST_LABELS = {
  addressType:   "Kategorie",
  country:       "Land",
  gender:        "Geschlecht",
  salutation:    "Anrede",
  projectStatus: "Status",
  projectType:   "Projekttyp",
  employeeShort: "Mitarbeiter (Kürzel)",
  addressName:   "Adresse/Firma",
  billing:        "Abrechnungsart",
  docType:        "Belegart",
  yesNo:          "ja/nein",
  employeeStatus: "Status",
  department:     "Abteilung",
  workModel:      "Arbeitszeitmodell",
  userRole:       "Berechtigungsrolle",
};

/**
 * Wertelisten für die Vorlage — die mandantenabhängigen kommen aus der
 * Datenbank, damit in der Vorlage genau die Werte stehen, die der Import
 * später auch auflösen kann.
 */
async function loadTemplateLists(supabase, tenantId) {
  const lists = { ...FIXED_LISTS };
  if (!supabase) return lists;

  const pick = (rows, col) => [...new Set((rows || []).map((r) => s(r[col])).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  const safe = async (fn) => { try { return await fn(); } catch { return { data: [] }; } };

  const [countries, genders, salutations, statuses, types, employees, addresses,
         departments, workModels, userRoles] = await Promise.all([
    safe(() => supabase.from("COUNTRY").select("NAME")),
    safe(() => supabase.from("GENDER").select("GENDER")),
    safe(() => supabase.from("SALUTATION").select("SALUTATION")),
    safe(() => supabase.from("PROJECT_STATUS").select("ABBR")),
    safe(() => supabase.from("PROJECT_TYPE").select("ABBR").eq("TENANT_ID", tenantId)),
    safe(() => supabase.from("EMPLOYEE").select("ABBR").eq("TENANT_ID", tenantId).limit(2000)),
    safe(() => supabase.from("ADDRESS").select("ADDRESS_NAME_1").eq("TENANT_ID", tenantId).limit(2000)),
    safe(() => supabase.from("DEPARTMENT").select("NAME").eq("TENANT_ID", tenantId).limit(2000)),
    safe(() => supabase.from("WORKING_TIME_MODEL").select("NAME").eq("TENANT_ID", tenantId).limit(2000)),
    safe(() => supabase.from("USER_ROLE").select("ABBR").eq("TENANT_ID", tenantId).limit(2000)),
  ]);

  lists.country       = pick(countries.data, "NAME");
  lists.gender        = pick(genders.data, "GENDER");
  lists.salutation    = pick(salutations.data, "SALUTATION");
  lists.projectStatus = pick(statuses.data, "ABBR");
  lists.projectType   = pick(types.data, "ABBR");
  lists.employeeShort = pick(employees.data, "ABBR");
  lists.addressName   = pick(addresses.data, "ADDRESS_NAME_1");
  // Abteilung bleibt eine Vorschlagsliste, keine Auswahlpflicht: der Import
  // legt eine unbekannte Abteilung an. Arbeitszeitmodell und Berechtigungs-
  // rolle dagegen muessen existieren — steht die Liste leer, ist das der
  // Hinweis, dass im Mandanten noch nichts gepflegt ist.
  lists.department    = pick(departments.data, "NAME");
  lists.workModel     = pick(workModels.data, "NAME");
  lists.userRole      = pick(userRoles.data, "ABBR");
  return lists;
}

// Anleitungstexte je Bereich. Bewusst hier und nicht in DOMAINS: die Registry
// beschreibt die Technik, das hier ist Text fürs Blatt „Anleitung“.
const TEMPLATE_HELP = {
  address: {
    intro: "Adressen sind Firmen und Personen, mit denen du zu tun hast: Bauherren, Fachplaner, Behörden, Nachunternehmer, Lieferanten. Sie sind die Grundlage für Projekte, Verträge und Rechnungen — deshalb ist dies der erste Import.",
    before: ["Nichts. Adressen sind der Anfang der Kette."],
    after: ["Danach: Kontakte (Ansprechpartner zu diesen Firmen), dann Mitarbeiter, dann Projekte."],
  },
  contact: {
    intro: "Kontakte sind die Ansprechpartner zu einer Adresse — die Person, an die eine Rechnung adressiert wird.",
    before: [
      "Adressen importieren. Die Spalte „Firma/Adresse“ muss zu einem vorhandenen Adressnamen passen.",
      "Ist keine eigene Spalte „Geschlecht“ vorhanden, leiten wir es aus der Anrede ab (Herr/Frau).",
    ],
    after: ["Ohne Ansprechpartner lässt sich später kein Beleg erzeugen — mindestens einer je Rechnungsadresse."],
  },
  employee: {
    intro: "Deine Mitarbeiterinnen und Mitarbeiter als Stammdaten — Grundlage für Projektleitung, Zeiterfassung und Auswertungen. Kostensatz, Arbeitszeitmodell und Berechtigungsrolle lassen sich gleich mit übernehmen.",
    before: [
      "Nichts, wenn du nur die Stammdaten übernimmst.",
      "Sollen Arbeitszeitmodell oder Berechtigungsrolle mitkommen, müssen diese vorher angelegt sein (Einstellungen → Arbeitszeit bzw. → Rollen). Unbekannte Namen werden übersprungen, der Mitarbeiter entsteht trotzdem. Eine unbekannte Abteilung legt der Import dagegen selbst an.",
    ],
    after: [
      "Status ist Pflicht (Aktiv/Inaktiv) — Ausgeschiedene kommen als „Inaktiv“ mit: ihre gebuchten Stunden werden für Auswertungen vergangener Jahre gebraucht.",
      "Der Vorgesetzte wird über das Kürzel zugeordnet und darf auch weiter unten in derselben Datei stehen.",
      "Kostensatz und Arbeitszeitmodell brauchen je ein Gültigkeitsdatum — ohne das bleiben sie außen vor, weil beides eine Historie ist und nicht ein einzelner Wert.",
      "Wichtig: Importierte Mitarbeiter haben KEINEN Zugang. Die Einladung zum Login verschickst du danach unter Mitarbeiter.",
      "Der Stundensatz (Verkauf) wird hier nicht gesetzt — er hängt an der Projektrolle, nicht am Mitarbeiter.",
    ],
  },
  project_full: {
    intro: "Projekt UND Leistungsstruktur aus EINER Datei — gedacht für die Übernahme aus einem Altsystem, das beides in einer Abfrage liefert. Eine Zeile je Element. Die Zeile mit LEERER Gliederung ist das Projekt selbst, alle übrigen werden zu Knoten seiner Struktur.",
    before: [
      "Mitarbeiter importieren — die Projektleitung wird über das Kürzel zugeordnet.",
      "Adressen importieren, wenn der Bauherr mitkommen soll. Fehlt er, entsteht das Projekt trotzdem.",
      "Den Projekt-Nummernkreis (Einstellungen → Nummernkreise) auf einen Zähler oberhalb deiner höchsten übernommenen Nummer setzen.",
    ],
    after: [
      "Die Gliederung ist ein Pfad: 1, 1.1, 1.2, 2 … Honorar und Abrechnungsart gehören an die unterste Ebene; übergeordnete Werte rechnet plan&simple selbst hoch.",
      "Je Projekt gilt alles oder nichts: ist eine Zeile fehlerhaft, bleibt das ganze Projekt draußen. Eine halbe Struktur wäre schlimmer als keine, weil die Honorarsummen dann still falsch stünden.",
      "Mit angelegt werden: Vertrag (aus den Vorbelegungen), Fortschrittszeilen, die Zuordnung der Projektleitung und — sofern die Spalte gefüllt ist — die Kosten als Buchung.",
      "Ein Projekttyp, den es noch nicht gibt, wird angelegt. Ein Projekt, dessen Nummer es schon gibt, wird samt Struktur übersprungen.",
    ],
  },
  project: {
    intro: "Die Projekt-Stammdaten: Nummer, Name, Status, Typ, Projektleitung und Bauherr. Deine bisherigen Projektnummern bleiben erhalten.",
    before: [
      "Mitarbeiter importieren — die Projektleitung wird über das Kürzel zugeordnet.",
      "Adressen importieren — der Bauherr wird über den Namen zugeordnet.",
      "Tipp: Den Projekt-Nummernkreis (Einstellungen → Nummernkreise) auf einen Zähler oberhalb deiner höchsten importierten Nummer setzen.",
    ],
    after: ["Danach „Projekt-Honorar“: setzt Honorarsumme, Leistungsstruktur und Vertrag."],
  },
  project_fee: {
    intro: "Setzt die Honorarsumme auf bereits importierte Projekte und erzeugt dabei die Leistungsstruktur und den Vertrag.",
    before: [
      "Projekte importieren. Die Zuordnung läuft über die Projektnummer.",
      "Überlegen, ob die Summe als eine Position oder auf die Leistungsphasen LP1–9 verteilt werden soll — das wählst du beim Import.",
    ],
    after: ["Projekte, die bereits eine Leistungsstruktur haben, werden als Dublette übersprungen."],
  },
  project_structure: {
    intro: "Die Leistungsstruktur eines Projekts als Baum — Leistungsbilder, Leistungsphasen, Bauabschnitte, besondere Leistungen. Eine Zeile je Knoten; die Gliederungsnummer sagt, was unter was gehört.",
    before: [
      "Projekte importieren. Die Zuordnung läuft über die Projektnummer.",
      "Gliederung vergeben: 1, 1.1, 1.2, 2 … — „1.1“ liegt unter „1“. Reihenfolge und Hierarchie kommen allein aus dieser Spalte.",
      "Wer keine Gliederung hat, kann stattdessen die Spalte „Ebene“ (1/2/3) nutzen — dann zählt die Zeilenreihenfolge, und Sortieren in Excel zerstört den Baum.",
    ],
    after: [
      "Honorar und Abrechnungsart gehören an die UNTERSTEN Zeilen. Übergeordnete Zeilen werden aus ihren Unterzeilen gerechnet; ein dort eingetragener Betrag wird ignoriert.",
      "Stunden-Positionen bekommen kein Honorar — der Umsatz entsteht später aus den Buchungen.",
      "Ist eine Zeile eines Projekts fehlerhaft, wird das ganze Projekt übersprungen — ein halber Baum wäre schlimmer als keiner.",
      "Projekte, die bereits eine Struktur haben, werden übersprungen.",
    ],
  },
  opening_balance: {
    intro: "Was auf einem laufenden Projekt bereits berechnet (und ggf. bezahlt) wurde. Wird als echter, gebuchter Beleg angelegt — ohne PDF und ohne E-Rechnung —, damit offene Posten und Auswertungen ab Tag 1 stimmen.",
    before: [
      "Projekte und Projekt-Honorar importieren (das Projekt braucht Struktur und Vertrag).",
      "Zur Rechnungsadresse muss ein Ansprechpartner vorhanden sein.",
      "Nur Pauschal-Positionen: Stunden-Projekte rechnen ihren Umsatz aus den Buchungen.",
    ],
    after: [
      "Projekte mit bereits gebuchten Belegen werden übersprungen.",
      "Beträge netto. „Bereits bezahlt“ darf „Bereits berechnet“ nicht übersteigen.",
    ],
  },
  open_items: {
    intro: "Belege aus der alten Welt — offene wie bezahlte, mit eigener Nummer, Datum, Fälligkeit und Positionen. Sie werden als echte, gebuchte Belege angelegt (ohne PDF und ohne E-Rechnung): ein nachgebautes Altbeleg-Dokument mit heutigem Layout wäre eine Fälschung. Rechnerisch stimmt alles — offene Posten, Zahlungszuordnung, Mahnwesen und Umsatz je Jahr.",
    before: [
      "Projekte samt Leistungsstruktur importieren (Projekt-Honorar oder Projektstruktur) — die Belege hängen an deren Positionen.",
      "Zur Rechnungsadresse muss ein Ansprechpartner vorhanden sein.",
      "Belegnummern bereithalten: sie müssen eindeutig sein und dürfen mit keiner vorhandenen Nummer kollidieren.",
    ],
    after: [
      "Eine Zeile = eine Belegposition. Zeilen mit derselben Belegnummer gehören zu EINEM Beleg; Belegdatum und Fälligkeit gelten aus der ersten Zeile.",
      "Wer keine Positionen führt: eine Zeile je Beleg, Spalte „Position“ leer lassen — der Betrag wird dann über die Pauschal-Positionen des Projekts verteilt.",
      "„Position“ meint das Kürzel aus der Leistungsstruktur (z. B. LP5). Es muss im Projekt eindeutig sein.",
      "Belegarten: Abschlag, Rechnung, Schluss- und Teilschlussrechnung, Gutschrift, Storno. Alles andere wird abgewiesen statt stillschweigend als Abschlag verbucht.",
      "Eine Schlussrechnung nennt in „Zieht Abschläge ab“ die Nummern der angerechneten Abschläge (mehrere mit Semikolon, Teilbetrag als AR-2025-001:5000). Ein Storno nennt in „Storniert Beleg“ den Beleg, den es aufhebt.",
      "Die Reihenfolge in der Datei spielt keine Rolle: ein Abschlag darf hinter seiner Schlussrechnung stehen und aus einem früheren Import stammen.",
      "Steht in „Kopfsumme netto“ ein Betrag, muss er zur Summe der Positionen passen — sonst fällt der ganze Beleg durch.",
      "Ein fehlerhafter Beleg wird als Ganzes übersprungen — eine halbe Rechnung wäre eine falsche Forderung.",
    ],
  },
  opening_cost: {
    intro: "Bereits angefallene Kosten je Projekt als ein Kostenblock — keine Einzelbuchungen. Vor allem für Stunden-Projekte, damit Deckungsbeitrag und Wirtschaftlichkeit ab Tag 1 stimmen.",
    before: ["Projekte importieren."],
    after: ["Die Buchung landet auf dem untersten Strukturknoten des Projekts und zählt als Kosten, nicht als Arbeitszeit."],
  },
};

const TPL = {
  accent:  "FF1F3A5F",
  headBg:  "FFEDF2F8",
  reqBg:   "FFFDF3E3",
  muted:   "FF6B7A8D",
  DATA_ROWS: 500,      // so viele Zeilen bekommen Format + Auswahlliste
};

/** Überschrift der Vorlagen-Spalte (Pflichtfelder mit Stern). */
const templateHeader = (f) => f.header + (f.required ? " *" : "");

function styleHeaderRow(ws, fields) {
  const row = ws.getRow(1);
  row.height = 24;
  fields.forEach((f, i) => {
    const cell = row.getCell(i + 1);
    cell.font = { bold: true, color: { argb: TPL.accent } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f.required ? TPL.reqBg : TPL.headBg } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFB8C4D4" } } };
    // Formathinweis als Zellkommentar — direkt an der Spalte, wo er gebraucht wird.
    const hint = [
      f.required ? "Pflichtfeld." : "Optional.",
      f.type === "money" ? "Betrag netto, z. B. 12.500,00" : null,
      f.type === "date"  ? "Datum, z. B. 31.12.2026" : null,
      f.type === "text"  ? "Wird als Text übernommen (führende Nullen bleiben erhalten)." : null,
      f.list ? "Bitte einen Wert aus der Auswahlliste verwenden (Blatt „Listen“)." : null,
      f.example ? `Beispiel: ${f.example}` : null,
    ].filter(Boolean).join("\n");
    cell.note = hint;
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fields.length } };
}

function applyColumnFormats(ws, fields) {
  fields.forEach((f, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(42, Math.max(12, Math.max(templateHeader(f).length, String(f.example || "").length) + 3));
    if (f.type === "money") col.numFmt = "#,##0.00";
    else if (f.type === "date") col.numFmt = "DD.MM.YYYY";
    // PLZ, Steuernummer, Telefon: als Text formatieren, sonst frisst Excel
    // führende Nullen und macht aus 01067 die Zahl 1067.
    else if (f.type === "text") col.numFmt = "@";
  });
}

/** Auswahllisten an die Datenspalten hängen (Verweis auf das Blatt „Listen“). */
function applyValidations(ws, fields, listColumns, rowCount = TPL.DATA_ROWS) {
  fields.forEach((f, i) => {
    const ref = f.list && listColumns[f.list];
    if (!ref) return;
    for (let r = 2; r <= rowCount + 1; r++) {
      ws.getCell(r, i + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [ref],
        showErrorMessage: false,      // Tippen bleibt erlaubt — die Liste ist Hilfe, keine Sperre
      };
    }
  });
}

function buildListsSheet(ws, usedLists, lists) {
  const columns = {};
  usedLists.forEach((key, i) => {
    const values = lists[key] || [];
    const colIdx = i + 1;
    const head = ws.getCell(1, colIdx);
    head.value = LIST_LABELS[key] || key;
    head.font = { bold: true, color: { argb: TPL.accent } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TPL.headBg } };
    values.forEach((v, r) => { ws.getCell(r + 2, colIdx).value = v; });
    ws.getColumn(colIdx).width = Math.min(42, Math.max(14, ...values.map((v) => String(v).length + 3), String(head.value).length + 3));
    // Leere Liste (z. B. noch keine Mitarbeiter) → keine Auswahl anbieten.
    if (values.length) {
      const letter = ws.getColumn(colIdx).letter;
      columns[key] = `Listen!$${letter}$2:$${letter}$${values.length + 1}`;
    }
  });
  return columns;
}

function buildGuideSheet(ws, def, lists) {
  const help = TEMPLATE_HELP[def.key] || {};
  const hasLists = def.fields.some((f) => f.list && (lists[f.list] || []).length);
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 104;

  const lines = [];
  const H = (t) => lines.push({ t, style: "h" });
  const P = (t) => lines.push({ t, style: "p" });
  const L = (t) => lines.push({ t: "•  " + t, style: "li" });

  H(`Vorlage „${def.label}“ — so gehst du vor`);
  P(help.intro || "");
  P("");
  H("1. Blätter dieser Datei");
  L("„Daten“ — hier trägst du deine Daten ein. Nur dieses Blatt wird eingelesen.");
  L("„Beispiel“ — eine ausgefüllte Musterzeile zum Abschauen. Wird nicht importiert.");
  if (hasLists) L("„Listen“ — die erlaubten Werte aus deinem Konto. Speist die Auswahlfelder im Blatt „Daten“.");
  P("");
  H("2. Bevor du startest");
  (help.before || ["Keine Vorarbeiten nötig."]).forEach(L);
  P("");
  H("3. Pflichtfelder");
  P("Spalten mit * müssen gefüllt sein — Zeilen ohne sie werden nicht importiert:");
  def.fields.filter((f) => f.required).forEach((f) => L(f.header));
  P("");
  H("4. Formate");
  L("Beträge netto, Dezimaltrennzeichen Komma (12.500,00). Keine Währungszeichen nötig.");
  L("Datum als TT.MM.JJJJ oder JJJJ-MM-TT.");
  L("PLZ, Steuernummern und Telefonnummern bleiben Text — führende Nullen gehen nicht verloren.");
  const listed = def.fields.filter((f) => f.list && (lists[f.list] || []).length);
  if (listed.length) L(`Auswahlfelder (${listed.map((f) => f.header).join(", ")}): bitte einen Wert aus dem Blatt „Listen“ nehmen.`);
  P("");
  H("5. Und dann?");
  L("Datei in plan&simple unter Einstellungen → Datenimport hochladen.");
  L("Du siehst zuerst eine Vorschau mit Status je Zeile — gespeichert wird nichts ungefragt.");
  L("Jeder Import ist ein Stapel und lässt sich im Ganzen wieder zurücksetzen.");
  (help.after || []).forEach(L);

  lines.forEach((line, i) => {
    const cell = ws.getCell(i + 1, 2);
    cell.value = line.t;
    if (line.style === "h") cell.font = { bold: true, size: 12, color: { argb: TPL.accent } };
    else if (line.style === "li") cell.font = { color: { argb: "FF243447" } };
    else cell.font = { color: { argb: TPL.muted } };
    cell.alignment = { wrapText: true, vertical: "top" };
  });
}

/**
 * Excel-Vorlage einer Domäne als Buffer — vier Blätter:
 * „Anleitung“ (Vorgehen, Pflichtfelder, Formate), „Daten“ (nur Überschriften,
 * mit Auswahllisten und Zellformaten), „Beispiel“ (Musterzeile) und „Listen“
 * (erlaubte Werte aus dem Mandanten).
 *
 * Die Beispielzeile steht bewusst NICHT im Datenblatt — dort wurde sie
 * mitimportiert, wenn der Nutzer sie nicht selbst gelöscht hat. Eingelesen
 * wird beim Upload „Daten“ bzw. das erste Blatt.
 */
async function buildTemplate(domainKey, { supabase, tenantId, prefillRows } = {}) {
  const def = getDomain(domainKey);
  const lists = await loadTemplateLists(supabase, tenantId);

  const wb = new ExcelJS.Workbook();
  wb.creator = "plan&simple";
  wb.created = new Date();

  const wsGuide   = wb.addWorksheet("Anleitung", { views: [{ showGridLines: false }] });
  const wsData    = wb.addWorksheet("Daten");
  const wsExample = wb.addWorksheet("Beispiel");
  // „Listen“ nur, wenn der Bereich überhaupt Auswahlfelder hat (Anfangsbestände
  // haben keine) — ein leeres Blatt wäre nur Ballast.
  const usedLists = [...new Set(def.fields.map((f) => f.list).filter(Boolean))]
    .filter((k) => (lists[k] || []).length);
  const wsLists   = usedLists.length ? wb.addWorksheet("Listen") : null;

  buildGuideSheet(wsGuide, def, lists);

  wsData.addRow(def.fields.map(templateHeader));
  // Vorbefuellung: fertige Zeilen (z. B. der HOAI-Baum je Projekt), die der
  // Nutzer nur noch um die Betraege ergaenzt.
  (prefillRows || []).forEach((r) => wsData.addRow(def.fields.map((f) => r[f.key] ?? "")));
  styleHeaderRow(wsData, def.fields);
  applyColumnFormats(wsData, def.fields);

  wsExample.addRow(def.fields.map(templateHeader));
  // Manche Bereiche brauchen mehrere Zeilen, um verständlich zu sein — ein Baum
  // ist mit einer einzelnen Zeile nicht zu erklären.
  if (def.exampleRows) def.exampleRows.forEach((r) => wsExample.addRow(def.fields.map((f) => r[f.key] ?? "")));
  else wsExample.addRow(def.fields.map((f) => f.example ?? ""));
  styleHeaderRow(wsExample, def.fields);
  applyColumnFormats(wsExample, def.fields);

  if (wsLists) applyValidations(wsData, def.fields, buildListsSheet(wsLists, usedLists, lists), Math.max(TPL.DATA_ROWS, (prefillRows || []).length));

  const buffer = await wb.xlsx.writeBuffer();
  const suffix = (prefillRows || []).length ? "_vorbefuellt" : "";
  return { buffer: Buffer.from(buffer), filename: `plan-und-simple_Vorlage_${def.key}${suffix}.xlsx` };
}

/**
 * Vorbefüllte Strukturvorlage: für jedes Projekt ohne Leistungsstruktur ein
 * Leistungsbild mit den HOAI-Leistungsphasen darunter. Der Nutzer trägt nur noch
 * die Beträge ein — Gliederung, Kürzel und Abrechnungsart stehen schon da.
 *
 * Das ist der bequemste Weg zu einem Baum: tippen muss niemand mehr, und die
 * Projektnummern stimmen garantiert, weil sie aus dem Bestand kommen.
 */
async function buildStructurePrefill({ supabase, tenantId }) {
  const ctx = await loadProjectStructureContext(supabase, tenantId);
  const offen = [...ctx.projectsByNumber.values()]
    .filter((p) => !ctx.existingKeys.has(norm(p.number)))
    .sort((a, b) => String(a.number).localeCompare(String(b.number), "de", { numeric: true }));

  if (!offen.length) {
    throw { status: 400, message: "Alle Projekte haben bereits eine Leistungsstruktur — es gibt nichts vorzubereiten." };
  }

  const rows = [];
  for (const p of offen) {
    rows.push({ project_number: p.number, outline: "1", abbr: "LB", name: `Leistungsbild — ${p.name}` });
    HOAI_LP.forEach((lp, i) => {
      rows.push({
        project_number: p.number, outline: `1.${i + 1}`,
        abbr: lp.code, name: lp.name, billing: "Pauschal",
      });
    });
  }

  const tpl = await buildTemplate("project_structure", { supabase, tenantId, prefillRows: rows });
  return { ...tpl, projects: offen.length, rows: rows.length };
}

function listDomains() {
  return Object.values(DOMAINS).map((d) => ({
    key: d.key, label: d.label, matchLabel: d.matchLabel, fields: d.fields.map(publicField),
  }));
}

module.exports = {
  // rein / testbar
  s, norm, katalogKey, normHeader, parseDateISO, parseAmountDE, parseBuffer, buildAutoMapping, buildPreview,
  buildAddressEntry, buildEmployeeEntry, buildContactEntry, buildProjectEntry, buildProjectFeeEntry, buildProjectStructureEntry, finalizeProjectStructureRows, parseOutline, buildOpeningBalanceEntry, buildOpenItemEntry, finalizeOpenItemRows, buildOpeningCostEntry,
  // orchestriert
  preview, commit, errorReport, listBatches, rollback, buildTemplate, buildStructurePrefill, listDomains, DOMAINS,
};
