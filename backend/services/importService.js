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
// Phase 3: Anfangsbestände werden über die bewährten Beleg-Services gebucht
// (init → Struktur → book(skipDocuments)) statt von Hand geschrieben.
const ppSvc = require("./partialPayments");
const invSvc = require("./invoices");
const { insertProgressSnapshot } = require("./projectProgress");
const { recomputeStructure } = require("./buchungen");
// recalcParent: Elternwerte aus den Kindern — dieselbe Rechnung wie im Wizard.
const projekteSvc = require("./projekte");

// ── Helpers ──────────────────────────────────────────────────────────────────
/** String-Wert sicher trimmen (null/undefined → ""). */
function s(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
/** Vergleichs-Normalisierung von Werten (Dubletten-Schlüssel). */
function norm(v) {
  return s(v).toLowerCase().replace(/\s+/g, " ").trim();
}
/** Spaltenüberschrift normalisieren (nur Buchstaben/Ziffern) für Auto-Mapping. */
function normHeader(h) {
  return s(h).toLowerCase().replace(/[^a-z0-9]/gi, "");
}
/** Datum aus DE-/ISO-Schreibweise → 'YYYY-MM-DD'. {invalid:true} wenn nicht parsebar. */
function parseDateISO(v) {
  const t = s(v);
  if (!t) return { value: null };
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { value: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` };
  m = t.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (m) return { value: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` };
  return { value: null, invalid: true };
}
/** Währungsbetrag (DE/EN) → Zahl. Komma = Dezimaltrenner; reine 1.234.567-Gruppen = Tausender. */
function parseAmountDE(v) {
  // Echte Zahlenzelle: unverändert übernehmen. Der Umweg über den Text würde
  // aus 1.234 (ein Komma-Wert) eine Tausendergruppe machen → 1234.
  if (typeof v === "number") return Number.isFinite(v) ? { value: fmt2(v) } : { value: null, invalid: true };
  let t = s(v).replace(/[€\s]/g, "");
  if (!t) return { value: null };
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
  const { data: countries } = await supabase.from("COUNTRY").select("ID, NAME_LONG, NAME_SHORT");
  const byName = new Map();
  let def = null;
  for (const c of countries || []) {
    const nl = norm(c.NAME_LONG), ns = norm(c.NAME_SHORT);
    if (nl) byName.set(nl, c.ID);
    if (ns) byName.set(ns, c.ID);
    if (nl === "deutschland" || nl === "germany" || ns === "de" || ns === "ger") def = c.ID;
  }

  // Bestand für Dubletten-Erkennung: Name 1 + PLZ.
  const existingKeys = new Set();
  const { data: addrs } = await supabase
    .from("ADDRESS").select("ADDRESS_NAME_1, POST_CODE").eq("TENANT_ID", tenantId).limit(100000);
  for (const a of addrs || []) existingKeys.add(norm(a.ADDRESS_NAME_1) + "|" + norm(a.POST_CODE));

  return { countries: { byName, default: def }, existingKeys };
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
const EMPLOYEE_FIELDS = [
  { key: "short_name",       header: "Kürzel",         required: true,  example: "MMu",               aliases: ["kuerzel", "kurzzeichen", "shortname", "initialen", "krzl"] },
  { key: "first_name",       header: "Vorname",        required: true,  example: "Maria",             aliases: ["vorname", "firstname"] },
  { key: "last_name",        header: "Nachname",       required: true,  example: "Muster",            aliases: ["nachname", "name", "lastname", "familienname", "surname"] },
  { key: "gender",           header: "Geschlecht",     required: true,  example: "weiblich",          aliases: ["geschlecht", "gender"] , list: "gender" },
  { key: "title",            header: "Titel",          required: false, example: "Dipl.-Ing.",        aliases: ["titel", "title"] },
  { key: "email",            header: "E-Mail",         required: false, example: "m.muster@buero.de", aliases: ["email", "mail", "emailadresse", "mailadresse"] },
  { key: "mobile",           header: "Telefon/Mobil",  required: false, example: "+49 170 1234567",   aliases: ["mobil", "telefon", "mobile", "phone", "tel", "handy", "telefonnummer"] , type: "text" },
  { key: "personnel_number", header: "Personalnummer", required: false, example: "P-001",             aliases: ["personalnummer", "persnr", "personalnr", "personnelnumber", "mitarbeiternummer", "pnr"] , type: "text" },
  { key: "entry_date",       header: "Eintrittsdatum", required: false, example: "2022-03-01",        aliases: ["eintritt", "eintrittsdatum", "entrydate", "startdatum", "eingestelltam"] , type: "date" },
  { key: "exit_date",        header: "Austrittsdatum", required: false, example: "",                  aliases: ["austritt", "austrittsdatum", "exitdate"] , type: "date" },
];

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
  const { data: emps } = await supabase
    .from("EMPLOYEE").select("SHORT_NAME, MAIL, PERSONNEL_NUMBER").eq("TENANT_ID", tenantId).limit(100000);
  for (const e of emps || []) {
    if (e.MAIL) existingKeys.add("mail:" + norm(e.MAIL));
    if (e.SHORT_NAME) existingKeys.add("short:" + norm(e.SHORT_NAME));
    if (e.PERSONNEL_NUMBER) existingKeys.add("pnr:" + norm(e.PERSONNEL_NUMBER));
  }
  return { genders: { byName, byId, default: def }, existingKeys };
}

function buildEmployeeEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const short = s(mapped.short_name);
  const first = s(mapped.first_name);
  const last  = s(mapped.last_name);
  if (!short) { messages.push({ level: "error", text: "Kürzel fehlt (Pflichtfeld)" }); ok = false; }
  if (!first) { messages.push({ level: "error", text: "Vorname fehlt (Pflichtfeld)" }); ok = false; }
  if (!last)  { messages.push({ level: "error", text: "Nachname fehlt (Pflichtfeld)" }); ok = false; }

  // Geschlecht (Pflicht, FK auf GENDER)
  let genderId = null;
  const gin = s(mapped.gender);
  if (!gin) {
    if (ctx.genders.default != null) genderId = ctx.genders.default;
    else { messages.push({ level: "error", text: "Geschlecht fehlt (Pflichtfeld)" }); ok = false; }
  } else {
    const found = ctx.genders.byName.get(norm(gin));
    if (found != null) genderId = found;
    else { messages.push({ level: "error", text: `Geschlecht „${gin}“ nicht erkannt (z. B. weiblich/männlich/divers)` }); ok = false; }
  }

  const email = s(mapped.email);
  if (email && !email.includes("@")) messages.push({ level: "warn", text: "E-Mail sieht ungültig aus (kein @)" });

  const entry = parseDateISO(mapped.entry_date);
  if (entry.invalid) messages.push({ level: "warn", text: "Eintrittsdatum nicht erkannt — übersprungen (Format JJJJ-MM-TT oder TT.MM.JJJJ)" });
  const exit = parseDateISO(mapped.exit_date);
  if (exit.invalid) messages.push({ level: "warn", text: "Austrittsdatum nicht erkannt — übersprungen" });

  const dbRow = {
    SHORT_NAME:       short || null,
    TITLE:            s(mapped.title) || null,
    FIRST_NAME:       first || null,
    LAST_NAME:        last || null,
    MAIL:             email || null,
    MOBILE:           s(mapped.mobile) || null,
    PERSONNEL_NUMBER: s(mapped.personnel_number) || null,
    GENDER_ID:        genderId,
    ENTRY_DATE:       entry.value,
    EXIT_DATE:        exit.value,
    ACTIVE:           1,
  };

  const matchKey = [];
  if (email) matchKey.push("mail:" + norm(email));
  if (short) matchKey.push("short:" + norm(short));
  if (s(mapped.personnel_number)) matchKey.push("pnr:" + norm(mapped.personnel_number));

  const display = {
    short_name: short, first_name: first, last_name: last,
    gender: genderId != null ? (ctx.genders.byId.get(genderId) || gin) : gin, mail: email,
  };
  return { ok, messages, dbRow, matchKey, display };
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
    supabase.from("CONTACTS").select("ADDRESS_ID, FIRST_NAME, LAST_NAME").eq("TENANT_ID", tenantId).limit(100000),
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
  for (const c of contactRes.data || []) {
    existingKeys.add(`${c.ADDRESS_ID}|` + norm(`${c.FIRST_NAME || ""} ${c.LAST_NAME || ""}`));
  }
  return { addrByName, salByName, genders: { byName: gByName, default: gDefault }, existingKeys };
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
  { key: "name_long",      header: "Projektname",              required: true,  example: "Neubau Kita Sonnenschein",  aliases: ["projektname", "name", "namelong", "bezeichnung", "projectname"] },
  { key: "status",         header: "Status",                   required: true,  example: "in Bearbeitung",            aliases: ["status", "projektstatus", "projectstatus"] , list: "projectStatus" },
  { key: "project_type",   header: "Projekttyp",               required: false, example: "Neubau",                    aliases: ["projekttyp", "typ", "type", "projecttype", "art"] , list: "projectType" },
  { key: "manager",        header: "Projektleiter (Kürzel)",   required: true,  example: "MMu",                       aliases: ["projektleiter", "pl", "manager", "leiter", "verantwortlich", "projektverantwortlicher"] , list: "employeeShort" },
  { key: "client",         header: "Bauherr/Auftraggeber",     required: true,  example: "Stadt Musterhausen",        aliases: ["bauherr", "auftraggeber", "kunde", "adresse", "client"] , list: "addressName" },
];

async function loadProjectContext(supabase, tenantId) {
  const [companyRes, statusRes, typeRes, empRes, addrRes, projRes] = await Promise.all([
    supabase.from("COMPANY").select("ID").eq("TENANT_ID", tenantId).order("ID", { ascending: true }).limit(1),
    supabase.from("PROJECT_STATUS").select("ID, NAME_SHORT"),                          // global
    supabase.from("PROJECT_TYPE").select("ID, NAME_SHORT").eq("TENANT_ID", tenantId),
    supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("ADDRESS").select("ID, ADDRESS_NAME_1").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT").select("NAME_SHORT").eq("TENANT_ID", tenantId).limit(100000),
  ]);

  const companyId = companyRes.data?.[0]?.ID ?? null;
  const statusByName = new Map();
  for (const r of statusRes.data || []) if (r.NAME_SHORT) statusByName.set(norm(r.NAME_SHORT), r.ID);
  const typeByName = new Map();
  for (const r of typeRes.data || []) if (r.NAME_SHORT) typeByName.set(norm(r.NAME_SHORT), r.ID);
  const empByName = new Map();
  for (const e of empRes.data || []) {
    if (e.SHORT_NAME) empByName.set(norm(e.SHORT_NAME), e.ID);
    const full = norm(`${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`);
    if (full) empByName.set(full, e.ID);
  }
  const addrByName = new Map();
  for (const a of addrRes.data || []) if (a.ADDRESS_NAME_1) addrByName.set(norm(a.ADDRESS_NAME_1), a.ID);
  const existingKeys = new Set();
  for (const p of projRes.data || []) if (p.NAME_SHORT) existingKeys.add(norm(p.NAME_SHORT));

  return { companyId, statusByName, typeByName, empByName, addrByName, existingKeys };
}

function buildProjectEntry(mapped, ctx) {
  const messages = [];
  let ok = true;

  const number = s(mapped.project_number);
  const name   = s(mapped.name_long);
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
    NAME_SHORT:         number || null,   // alte Projektnummer beibehalten
    NAME_LONG:          name || null,
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
    .from("PROJECT").select("ID, NAME_SHORT, NAME_LONG, ADDRESS_ID, CONTACT_ID").eq("TENANT_ID", tenantId).limit(100000);
  const projectsByNumber = new Map();
  const idToNumber = new Map();
  for (const p of projects || []) {
    if (!p.NAME_SHORT) continue;
    projectsByNumber.set(norm(p.NAME_SHORT), { id: p.ID, name: p.NAME_LONG || p.NAME_SHORT, addressId: p.ADDRESS_ID ?? null, contactId: p.CONTACT_ID ?? null });
    idToNumber.set(p.ID, p.NAME_SHORT);
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
        return { NAME_SHORT: lp.code, NAME_LONG: lp.name, REVENUE: rev };
      });
      if (isPauschal) {
        const diff = fmt2(e.fee - allocated);          // Rundungsrest auf LP8 (größte Phase)
        if (diff !== 0) nodes[7].REVENUE = fmt2(nodes[7].REVENUE + diff);
      }
    } else {
      nodes = [{ NAME_SHORT: "Honorar", NAME_LONG: isPauschal ? "Honorar (Pauschal)" : "Honorar (Stunden)", REVENUE: isPauschal ? fmt2(e.fee) : 0 }];
    }

    // 1a) Vertrag zuerst — die Strukturknoten sollen ihn kennen (CONTRACT_ID).
    //     Ein bereits vorhandener Vertrag wird verwendet, nicht ersetzt.
    const { data: existing } = await supabase.from("CONTRACT").select("ID").eq("TENANT_ID", tenantId).eq("PROJECT_ID", e.projectId).limit(1);
    let contractId = existing?.[0]?.ID ?? null;
    if (contractId == null) {
      const contractRow = {
        NAME_SHORT: e.projectNumber, NAME_LONG: e.projectName, PROJECT_ID: e.projectId,
        INVOICE_ADDRESS_ID: e.addressId, INVOICE_CONTACT_ID: e.contactId,
        TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
        ...(defaults.default_currency_id ? { CURRENCY_ID: Number(defaults.default_currency_id) } : {}),
        ...(defaults.default_vat_id ? { VAT_ID: Number(defaults.default_vat_id) } : {}),
      };
      const { data: cRows, error: cErr } = await supabase.from("CONTRACT").insert([contractRow]).select("ID");
      if (cErr) throw { status: 500, message: `Vertrag für Projekt ${e.projectNumber} fehlgeschlagen: ${cErr.message}` };
      contractId = cRows?.[0]?.ID ?? null;
    }

    // SORT_ORDER in Zehnerschritten wie beim manuellen Anlegen — ohne ihn stehen
    // alle Knoten auf 0 und die Leistungsphasen erscheinen in zufälliger Reihenfolge.
    const structRows = nodes.map((n, i) => ({
      NAME_SHORT: n.NAME_SHORT, NAME_LONG: n.NAME_LONG, PROJECT_ID: e.projectId,
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
  { key: "name_short",      header: "Kürzel",                          required: true,  example: "LP1-4",                     aliases: ["kuerzel", "kurzzeichen", "shortname", "code", "krzl"] },
  { key: "name_long",       header: "Bezeichnung",                     required: false, example: "Vorplanung bis Genehmigung", aliases: ["bezeichnung", "name", "namelong", "beschreibung", "leistung", "titel"] },
  { key: "billing",         header: "Abrechnungsart (Pauschal/Stunden)", required: false, example: "Pauschal",                aliases: ["abrechnungsart", "abrechnung", "billing", "billingtype", "art"], list: "billing" },
  { key: "revenue",         header: "Honorar netto",                   required: false, example: "27000",                     aliases: ["honorar", "honorarsumme", "betrag", "summe", "nettohonorar", "revenue", "wert"], type: "money" },
  { key: "extras_percent",  header: "Nebenkosten %",                   required: false, example: "5",                         aliases: ["nebenkosten", "nk", "nkprozent", "nebenkostenprozent", "extras", "extraspercent", "zuschlagprozent"] },
  { key: "level",           header: "Ebene (nur ohne Gliederung)",     required: false, example: "",                          aliases: ["ebene", "stufe", "level", "tiefe", "hierarchieebene"] },
];

async function loadProjectStructureContext(supabase, tenantId) {
  const [projRes, structRes, contractRes, settingsRes] = await Promise.all([
    supabase.from("PROJECT").select("ID, NAME_SHORT, NAME_LONG, ADDRESS_ID, CONTACT_ID").eq("TENANT_ID", tenantId).limit(100000),
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
    if (!p.NAME_SHORT) continue;
    projectsByNumber.set(norm(p.NAME_SHORT), {
      id: p.ID, number: p.NAME_SHORT, name: p.NAME_LONG || p.NAME_SHORT,
      addressId: p.ADDRESS_ID ?? null, contactId: p.CONTACT_ID ?? null,
      contractId: contractByProject.get(p.ID) ?? null,
    });
    if (withStructure.has(p.ID)) existingKeys.add(norm(p.NAME_SHORT));
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

  const nameShort = s(mapped.name_short);
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
  else if (rev.value != null && rev.value < 0) { messages.push({ level: "error", text: "Honorar darf nicht negativ sein" }); ok = false; }

  const nkRaw = s(mapped.extras_percent);
  const nk = parseAmountDE(mapped.extras_percent);
  if (nkRaw && (nk.invalid || nk.value == null)) { messages.push({ level: "error", text: `Nebenkosten „${nkRaw}“ ist keine gültige Zahl` }); ok = false; }

  const dbRow = {
    projectNumber: number, projectId: proj?.id ?? null, projectName: proj?.name ?? "",
    addressId: proj?.addressId ?? null, contactId: proj?.contactId ?? null, contractId: proj?.contractId ?? null,
    outline, level, nameShort, nameLong: s(mapped.name_long) || nameShort,
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
          NAME_SHORT: number, NAME_LONG: first.projectName, PROJECT_ID: first.projectId,
          INVOICE_ADDRESS_ID: first.addressId, INVOICE_CONTACT_ID: first.contactId,
          TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
          ...(defaults.default_currency_id ? { CURRENCY_ID: Number(defaults.default_currency_id) } : {}),
          ...(defaults.default_vat_id ? { VAT_ID: Number(defaults.default_vat_id) } : {}),
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
          NAME_SHORT: e.nameShort, NAME_LONG: e.nameLong, PROJECT_ID: e.projectId,
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
    supabase.from("PROJECT").select("ID, NAME_SHORT, NAME_LONG, ADDRESS_ID, CONTACT_ID, COMPANY_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("CONTRACT").select("ID, PROJECT_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT_STRUCTURE").select("ID, PROJECT_ID, REVENUE, EXTRAS_PERCENT, BILLING_TYPE_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PARTIAL_PAYMENT").select("PROJECT_ID").eq("TENANT_ID", tenantId).eq("STATUS_ID", 2).limit(100000),
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
    if (!p.NAME_SHORT) continue;
    const contract = contractByProject.get(p.ID) || null;
    const btStructures = btByProject.get(p.ID) || [];
    byNumber.set(norm(p.NAME_SHORT), {
      projectId: p.ID, name: p.NAME_LONG || p.NAME_SHORT, companyId: p.COMPANY_ID ?? null,
      addressId: p.ADDRESS_ID ?? null, contactId: p.CONTACT_ID ?? null,
      contract, btStructures,
    });
    if (bookedProjects.has(p.ID)) existingKeys.add(norm(p.NAME_SHORT));
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
    PARTIAL_PAYMENT_ID: docType === "partial" ? docId : null,
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
      PAYMENT_ID: created.ID, PARTIAL_PAYMENT_ID: docType === "partial" ? docId : null,
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
    ? await svc.initInvoice(supabase, { companyId: doc.companyId, employeeId, projectId: doc.projectId, contractId: doc.contractId, invoiceType: null, tenantId })
    : await svc.initPartialPayment(supabase, { companyId: doc.companyId, employeeId, projectId: doc.projectId, contractId: doc.contractId, tenantId });

  const table = isInvoice ? "INVOICE" : "PARTIAL_PAYMENT";
  const upd = { IMPORT_BATCH_ID: batchId };
  if (doc.docNumber) upd[isInvoice ? "INVOICE_NUMBER" : "PARTIAL_PAYMENT_NUMBER"] = doc.docNumber;
  // Belegdatum: ohne es steht der Beleg datumslos in Listen und Auswertungen.
  if (doc.docDate) upd[isInvoice ? "INVOICE_DATE" : "PARTIAL_PAYMENT_DATE"] = doc.docDate;
  if (doc.dueDate) upd.DUE_DATE = doc.dueDate;
  // MwSt aus der Datei schlägt den Vertragssatz — historische Belege können
  // einen anderen Satz tragen als der heute gültige.
  if (doc.vatPercent != null) upd.VAT_PERCENT = doc.vatPercent;
  if (doc.comment) upd.COMMENT = doc.comment;
  await supabase.from(table).update(upd).eq("ID", id).eq("TENANT_ID", tenantId);

  const structRows = doc.positions.map((d) => ({
    [isInvoice ? "INVOICE_ID" : "PARTIAL_PAYMENT_ID"]: id,
    STRUCTURE_ID: d.id, AMOUNT_NET: d.amt, AMOUNT_EXTRAS_NET: fmt2(d.amt * num(d.extrasPercent) / 100),
    TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
  }));
  const structureIds = doc.positions.map((d) => d.id);

  if (isInvoice) {
    await invSvc.writeInvoiceStructureRows(supabase, { invoiceId: id, rows: structRows, deleteStructureIds: structureIds });
    await invSvc.recomputeInvoiceTotals(supabase, id);
  } else {
    await ppSvc.writePpsRows(supabase, { partialPaymentId: id, structureIds, rows: structRows });
    await ppSvc.recomputePartialPaymentTotals(supabase, id);
  }

  const { data: row } = await supabase.from(table).select("*").eq("ID", id).single();
  if (isInvoice) await invSvc.bookInvoice(supabase, { id, inv: row, tenantId, force: true, skipDocuments: true });
  else await ppSvc.bookPartialPayment(supabase, { id, pp: row, tenantId, force: true, skipDocuments: true });

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
  const docTable    = kind === "partial" ? "PARTIAL_PAYMENT" : "INVOICE";
  const structTable = kind === "partial" ? "PARTIAL_PAYMENT_STRUCTURE" : "INVOICE_STRUCTURE";
  const projCol     = kind === "partial" ? "PARTIAL_PAYMENTS" : "INVOICED";

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
  for (const t of ["PARTIAL_PAYMENT", "INVOICE"]) {
    const { data } = await supabase.from(t).select("PROJECT_ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
    for (const r of data || []) if (r.PROJECT_ID != null) projectIds.add(r.PROJECT_ID);
  }
  const ids = [...projectIds];
  if (ids.length) {
    // Schutz: an den Projekten hängen weitere gebuchte Belege außerhalb dieses Stapels.
    const blockers = [];
    for (const t of [{ table: "PARTIAL_PAYMENT", label: "Abschlagsrechnung(en)" }, { table: "INVOICE", label: "Rechnung(en)" }]) {
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
];

async function loadOpenItemContext(supabase, tenantId) {
  const [projRes, contractRes, structRes, ppRes, invRes] = await Promise.all([
    supabase.from("PROJECT").select("ID, NAME_SHORT, NAME_LONG, ADDRESS_ID, CONTACT_ID, COMPANY_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("CONTRACT").select("ID, PROJECT_ID, INVOICE_ADDRESS_ID, INVOICE_CONTACT_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT_STRUCTURE").select("ID, PROJECT_ID, FATHER_ID, NAME_SHORT, NAME_LONG, REVENUE, EXTRAS_PERCENT, BILLING_TYPE_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PARTIAL_PAYMENT").select("PARTIAL_PAYMENT_NUMBER").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("INVOICE").select("INVOICE_NUMBER").eq("TENANT_ID", tenantId).limit(100000),
  ]);

  const contractByProject = new Map();
  for (const c of contractRes.data || []) if (!contractByProject.has(c.PROJECT_ID)) contractByProject.set(c.PROJECT_ID, c);

  // Nur Blätter sind abrechenbar (Knoten tragen nur Summen ihrer Kinder).
  const fatherIds = new Set((structRes.data || []).map((r) => r.FATHER_ID).filter((x) => x != null));
  const nodesByProject = new Map();
  for (const st of structRes.data || []) {
    if (fatherIds.has(st.ID)) continue;
    if (!nodesByProject.has(st.PROJECT_ID)) nodesByProject.set(st.PROJECT_ID, []);
    nodesByProject.get(st.PROJECT_ID).push({
      id: st.ID, nameShort: st.NAME_SHORT || "", nameLong: st.NAME_LONG || "",
      revenue: num(st.REVENUE), extrasPercent: num(st.EXTRAS_PERCENT), billingTypeId: Number(st.BILLING_TYPE_ID),
    });
  }

  // Vergebene Belegnummern — eine importierte Altnummer darf nicht mit einer
  // bestehenden kollidieren.
  const takenNumbers = new Set();
  for (const r of ppRes.data || []) if (r.PARTIAL_PAYMENT_NUMBER) takenNumbers.add(norm(r.PARTIAL_PAYMENT_NUMBER));
  for (const r of invRes.data || []) if (r.INVOICE_NUMBER) takenNumbers.add(norm(r.INVOICE_NUMBER));

  const projectsByNumber = new Map();
  for (const p of projRes.data || []) {
    if (!p.NAME_SHORT) continue;
    const contract = contractByProject.get(p.ID) || null;
    projectsByNumber.set(norm(p.NAME_SHORT), {
      id: p.ID, name: p.NAME_LONG || p.NAME_SHORT, companyId: p.COMPANY_ID ?? null,
      addressId: p.ADDRESS_ID ?? null, contactId: p.CONTACT_ID ?? null, contract,
      nodes: nodesByProject.get(p.ID) || [],
    });
  }

  // Dubletten laufen hier über die Belegnummer (Fehler, nicht „überspringen").
  return { projectsByNumber, takenNumbers, existingKeys: new Set() };
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
    else if (!proj.nodes.some((n) => n.billingTypeId === 1)) { messages.push({ level: "error", text: "Projekt hat keine abrechenbare Pauschal-Position" }); ok = false; }
  }

  const docNumber = s(mapped.doc_number);
  if (!docNumber) { messages.push({ level: "error", text: "Belegnummer fehlt (Pflichtfeld)" }); ok = false; }
  else if (ctx.takenNumbers.has(norm(docNumber))) {
    messages.push({ level: "error", text: `Belegnummer „${docNumber}“ ist bereits vergeben` }); ok = false;
  }

  const dt = norm(mapped.doc_type);
  const docType = (dt.includes("rechnung") && !dt.includes("abschlag")) || dt === "invoice" ? "invoice" : "partial";

  const docDate = parseDateISO(mapped.doc_date);
  if (!s(mapped.doc_date)) { messages.push({ level: "error", text: "Belegdatum fehlt (Pflichtfeld)" }); ok = false; }
  else if (docDate.invalid) { messages.push({ level: "error", text: "Belegdatum nicht erkannt (TT.MM.JJJJ oder JJJJ-MM-TT)" }); ok = false; }

  const dueDate = parseDateISO(mapped.due_date);
  if (dueDate.invalid) { messages.push({ level: "error", text: "Fälligkeitsdatum nicht erkannt" }); ok = false; }
  else if (!dueDate.value) messages.push({ level: "warn", text: "Ohne Fälligkeit kann nicht gemahnt werden" });

  const amtRaw = s(mapped.amount_net);
  const amount = parseAmountDE(mapped.amount_net);
  if (!amtRaw) { messages.push({ level: "error", text: "Betrag fehlt (Pflichtfeld)" }); ok = false; }
  else if (amount.invalid || amount.value == null) { messages.push({ level: "error", text: `Betrag „${amtRaw}“ ist keine gültige Zahl` }); ok = false; }
  else if (amount.value <= 0) { messages.push({ level: "error", text: "Betrag muss größer als 0 sein" }); ok = false; }

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

  // Position über das Kürzel des Strukturknotens auflösen (eindeutig sein muss es).
  const posRaw = s(mapped.position);
  let node = null;
  if (posRaw && proj) {
    const hits = proj.nodes.filter((n) => norm(n.nameShort) === norm(posRaw) || norm(n.nameLong) === norm(posRaw));
    if (!hits.length) {
      messages.push({ level: "error", text: `Position „${posRaw}“ nicht gefunden — Kürzel aus der Leistungsstruktur verwenden` }); ok = false;
    } else if (hits.length > 1) {
      messages.push({ level: "error", text: `Position „${posRaw}“ kommt im Projekt mehrfach vor — bitte eindeutig benennen` }); ok = false;
    } else if (hits[0].billingTypeId !== 1) {
      messages.push({ level: "error", text: `Position „${posRaw}“ ist eine Stunden-Position — dort entsteht der Umsatz aus den Buchungen` }); ok = false;
    } else node = hits[0];
  }

  const dbRow = {
    projectNumber: number, projectId: proj?.id ?? null, projectName: proj?.name ?? "",
    companyId: proj?.companyId ?? null, contractId: proj?.contract?.ID ?? null,
    addressId: proj?.contract?.INVOICE_ADDRESS_ID ?? proj?.addressId ?? null,
    contactId: proj?.contract?.INVOICE_CONTACT_ID ?? proj?.contactId ?? null,
    nodes: proj?.nodes ?? [],
    docNumber, docType, docDate: docDate.value, dueDate: dueDate.value,
    amount: amount.value ?? 0, vatPercent: vat.value ?? null,
    paid, paidDate: paidDate.value, comment: s(mapped.comment) || null,
    positionLabel: posRaw, node,
  };

  const display = {
    number, doc: `${docNumber}${docType === "invoice" ? " (Rechnung)" : " (Abschlag)"}`,
    datum: s(mapped.doc_date), position: posRaw,
    betrag: amount.value != null ? amount.value.toLocaleString("de-DE", { minimumFractionDigits: 2 }) + " €" : amtRaw,
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
      if (paidTotal > total + 0.01) {
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
}

async function commitOpenItemRows(rows, { supabase, tenantId, batchId, employeeId }) {
  const byDoc = new Map();
  for (const r of rows) {
    const key = norm(r._dbRow.docNumber);
    if (!byDoc.has(key)) byDoc.set(key, []);
    byDoc.get(key).push(r);
  }

  let inserted = 0;
  for (const [, group] of byDoc) {
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
        ? withPos.map((r) => ({ id: r._dbRow.node.id, extrasPercent: r._dbRow.node.extrasPercent, amt: fmt2(r._dbRow.amount) }))
        : distributeOpening(fmt2(totalNet), head.nodes.filter((n) => n.billingTypeId === 1));

      const { docId, vatPercent } = await bookReferenceDocument(supabase, {
        tenantId, batchId, employeeId, docType: head.docType,
        doc: {
          companyId: head.companyId, projectId: head.projectId, contractId: head.contractId,
          docNumber: head.docNumber, docDate: head.docDate, dueDate: head.dueDate,
          vatPercent: head.vatPercent, comment: head.comment, positions,
        },
      });

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
  return { inserted };
}

// ── Domäne: Kosten-Anfangsbestände (Kostenblöcke) ────────────────────────────
// Für (v. a. Stunden-/TEC-)Projekte: aggregierte, bereits angefallene Kosten je
// Projekt als EINE LUMP_COST-Buchung — KEINE Einzelbuchungen. Speist
// Deckungsbeitrag/Wirtschaftlichkeit ab Tag 1.
const OPENING_COST_FIELDS = [
  { key: "project_number", header: "Projektnummer",                      required: true,  example: "P-2024-012",                aliases: ["projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "cost",           header: "Bereits angefallene Kosten (netto)", required: true,  example: "45000",                     aliases: ["kosten", "kostenblock", "kostensumme", "aufwand", "betrag", "costs", "cost"] , type: "money" },
  { key: "description",    header: "Bezeichnung (optional)",             required: false, example: "Personalkosten bis 06/2026", aliases: ["bezeichnung", "beschreibung", "text", "description", "kommentar"] },
];

async function loadOpeningCostContext(supabase, tenantId) {
  const [projRes, structRes, tecRes] = await Promise.all([
    supabase.from("PROJECT").select("ID, NAME_SHORT").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("PROJECT_STRUCTURE").select("ID, PROJECT_ID, FATHER_ID, BILLING_TYPE_ID").eq("TENANT_ID", tenantId).limit(100000),
    supabase.from("TEC").select("PROJECT_ID").eq("TENANT_ID", tenantId).eq("BOOKING_KIND", "LUMP_COST").not("IMPORT_BATCH_ID", "is", null).limit(100000),
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
    if (!p.NAME_SHORT) continue;
    byNumber.set(norm(p.NAME_SHORT), { projectId: p.ID, structureId: leafByProject.get(p.ID)?.ID ?? null });
    idToNumber.set(p.ID, p.NAME_SHORT);
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
      // LUMP_COST: QUANTITY_INT=0 (keine Stunden), Betrag in CP_RATE/CP_TOT (Kosten).
      const insertRow = {
        TENANT_ID: tenantId, STATUS: "CONFIRMED", BOOKING_KIND: "LUMP_COST",
        BOOKING_TYPE_ID: null, EMPLOYEE_ID: employeeId ?? null, DATE_VOUCHER: today,
        QUANTITY_INT: 0, CP_RATE: e.cost, CP_TOT: fmt2(e.cost), QUANTITY_EXT: 0, SP_RATE: 0, SP_TOT: 0,
        POSTING_DESCRIPTION: e.description, PROJECT_ID: e.projectId, STRUCTURE_ID: e.structureId,
        IMPORT_BATCH_ID: batchId,
      };
      const { error } = await supabase.from("TEC").insert([insertRow]);
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
  const { data: tec } = await supabase.from("TEC").select("ID, STRUCTURE_ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  const rows = tec || [];
  const structureIds = [...new Set(rows.map((r) => r.STRUCTURE_ID).filter((x) => x != null))];
  await supabase.from("TEC").delete().eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
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
  for (const dep of [{ table: "INVOICE", label: "Rechnung(en)" }, { table: "TEC", label: "Buchung(en)" }, { table: "PARTIAL_PAYMENT", label: "Abschlagszahlung(en)" }]) {
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
    label: "Mitarbeiter",
    table: "EMPLOYEE",
    matchLabel: "E-Mail / Kürzel / Personalnummer",
    fields: EMPLOYEE_FIELDS,
    dependents: [
      { table: "PROJECT",          column: "PROJECT_MANAGER_ID", label: "Projekt(e) als Projektleiter" },
      { table: "TEC",              column: "EMPLOYEE_ID", label: "Buchung(en)" },
      { table: "EMPLOYEE2PROJECT", column: "EMPLOYEE_ID", label: "Projektzuordnung(en)" },
      { table: "ABSENCE",          column: "EMPLOYEE_ID", label: "Abwesenheit(en)" },
    ],
    loadContext: loadEmployeeContext,
    buildEntry: buildEmployeeEntry,
  },
  contact: {
    key: "contact",
    label: "Kontakte",
    table: "CONTACTS",
    matchLabel: "Adresse + Name",
    fields: CONTACT_FIELDS,
    dependents: [
      { table: "PROJECT",         column: "CONTACT_ID",         label: "Projekt(e)" },
      { table: "CONTRACT",        column: "INVOICE_CONTACT_ID", label: "Vertrag/Verträge" },
      { table: "OFFER",           column: "CONTACT_ID",         label: "Angebot(e)" },
      { table: "INVOICE",         column: "CONTACT_ID",         label: "Rechnung(en)" },
      { table: "PARTIAL_PAYMENT", column: "CONTACT_ID",         label: "Abschlagsrechnung(en)" },
    ],
    loadContext: loadContactContext,
    buildEntry: buildContactEntry,
  },
  project: {
    key: "project",
    label: "Projekte",
    table: "PROJECT",
    matchLabel: "Projektnummer",
    fields: PROJECT_FIELDS,
    dependents: [
      { table: "PROJECT_STRUCTURE", column: "PROJECT_ID", label: "Leistungsstruktur" },
      { table: "EMPLOYEE2PROJECT",  column: "PROJECT_ID", label: "Mitarbeiterzuordnung(en)" },
      { table: "CONTRACT",          column: "PROJECT_ID", label: "Vertrag/Verträge" },
      { table: "INVOICE",           column: "PROJECT_ID", label: "Rechnung(en)" },
      { table: "TEC",               column: "PROJECT_ID", label: "Buchung(en)" },
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
  project_structure: {
    key: "project_structure",
    label: "Projektstruktur (Leistungsbaum)",
    table: "PROJECT_STRUCTURE",
    matchLabel: "Projektnummer",
    fields: PROJECT_STRUCTURE_FIELDS,
    exampleRows: [
      { project_number: "P-2024-012", outline: "1",   name_short: "LB Gebäude", name_long: "Leistungsbild Gebäude",       billing: "",         revenue: "",      extras_percent: "5" },
      { project_number: "P-2024-012", outline: "1.1", name_short: "LP1-4",      name_long: "Vorplanung bis Genehmigung",  billing: "Pauschal", revenue: "27000", extras_percent: "" },
      { project_number: "P-2024-012", outline: "1.2", name_short: "LP5",        name_long: "Ausführungsplanung",          billing: "Pauschal", revenue: "25000", extras_percent: "" },
      { project_number: "P-2024-012", outline: "1.3", name_short: "LP6-8",      name_long: "Vergabe und Bauüberwachung",  billing: "Pauschal", revenue: "28000", extras_percent: "" },
      { project_number: "P-2024-012", outline: "2",   name_short: "BL",         name_long: "Besondere Leistungen",        billing: "Stunden",  revenue: "",      extras_percent: "" },
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
    table: "PARTIAL_PAYMENT",
    matchLabel: "Projektnummer",
    fields: OPENING_BALANCE_FIELDS,
    loadContext: loadOpeningBalanceContext,
    buildEntry: buildOpeningBalanceEntry,
    commitRows: commitOpeningBalanceRows,
    rollbackExecute: rollbackOpeningBalance,
  },
  open_items: {
    key: "open_items",
    label: "Offene Posten (Altbelege)",
    table: "PARTIAL_PAYMENT",
    matchLabel: "Belegnummer",
    fields: OPEN_ITEM_FIELDS,
    exampleRows: [
      { project_number: "P-2024-012", doc_number: "AR-2025-007", doc_type: "Abschlag", doc_date: "15.11.2025", due_date: "15.12.2025", position: "LP5",   amount_net: "12500", vat_percent: "19" },
      { project_number: "P-2024-012", doc_number: "AR-2025-007", doc_type: "Abschlag", doc_date: "15.11.2025", due_date: "15.12.2025", position: "LP6-8", amount_net: "8000",  vat_percent: "19" },
      { project_number: "P-2024-013", doc_number: "RE-2025-101", doc_type: "Rechnung", doc_date: "01.12.2025", due_date: "31.12.2025", position: "",       amount_net: "4200",  vat_percent: "19", paid_net: "2000", paid_date: "20.12.2025" },
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
    table: "TEC",
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
    for (const f of def.fields) mapped[f.key] = map[f.key] != null ? raw[map[f.key]] : "";
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
    rows.push({ row: i + 2, status, messages, display: entry.display, _dbRow: entry.dbRow, _raw: raw });
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
async function preview({ domainKey, buffer, filename, mapping, sheetName, supabase, tenantId }) {
  const def = getDomain(domainKey);
  const parsed = await parseBuffer(buffer, sheetName);
  if (!parsed.headers.length) throw { status: 400, message: "Die Datei enthält keine Spaltenüberschriften" };
  const ctx = await def.loadContext(supabase, tenantId);
  const pv = buildPreview({ domainKey, parsed, mapping, ctx });
  return {
    domain: def.key,
    filename: filename || null,
    sheetName: parsed.sheetName,
    sheetNames: parsed.sheetNames,
    headers: parsed.headers,
    mapping: pv.mapping,
    fields: def.fields.map(publicField),
    summary: pv.summary,
    rows: pv.rows.slice(0, 200).map((r) => ({ row: r.row, status: r.status, messages: r.messages, display: r.display })),
    truncated: pv.rows.length > 200,
  };
}

async function commit({ domainKey, buffer, filename, mapping, sheetName, duplicateMode, structureMode, docType, supabase, tenantId, employeeId }) {
  const def = getDomain(domainKey);
  const parsed = await parseBuffer(buffer, sheetName);
  const ctx = await def.loadContext(supabase, tenantId);
  const pv = buildPreview({ domainKey, parsed, mapping, ctx });

  // Importiert werden gültige Zeilen (sauber + mit Warnung); Dubletten nur bei duplicateMode='import'.
  const wanted = pv.rows.filter((r) => r.status === "ok" || r.status === "warning" || (r.status === "duplicate" && duplicateMode === "import"));
  if (!wanted.length) throw { status: 400, message: "Keine importierbaren Zeilen (alle leer, fehlerhaft oder Dubletten)." };

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
      const { inserted } = await def.commitRows(wanted, { supabase, tenantId, batchId, ctx, options: { structureMode, docType }, employeeId });
      return { batchId, inserted, summary: pv.summary };
    } catch (e) {
      await supabase.from("IMPORT_BATCH").update({ ROW_OK: 0 }).eq("ID", batchId).eq("TENANT_ID", tenantId);
      throw { status: e?.status || 500, message: `${e?.message || e} Stapel #${batchId} kann zurückgesetzt werden.` };
    }
  }

  // 2b) Standard: ein Insert pro Zeile in die Domänen-Tabelle (gechunkt).
  const dbRows = wanted.map((r) => ({ ...r._dbRow, TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId }));
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

  return { batchId, inserted, summary: pv.summary };
}

/**
 * Fehlerprotokoll: die nicht importierbaren Zeilen als Excel — Originalspalten
 * unverändert, dahinter Zeilennummer und Grund. Der Nutzer korrigiert die Datei
 * und lädt sie erneut hoch; die beiden Zusatzspalten stören dabei nicht, weil
 * die Zuordnung unbekannte Überschriften ignoriert.
 */
async function errorReport({ domainKey, buffer, mapping, sheetName, supabase, tenantId }) {
  const def = getDomain(domainKey);
  const parsed = await parseBuffer(buffer, sheetName);
  const ctx = await def.loadContext(supabase, tenantId);
  const pv = buildPreview({ domainKey, parsed, mapping, ctx });

  const bad = pv.rows.filter((r) => r.status === "error");
  if (!bad.length) throw { status: 400, message: "Keine fehlerhaften Zeilen — es gibt nichts zu korrigieren." };

  const headers = [...parsed.headers, "Zeile", "Fehler"];
  const wb = new ExcelJS.Workbook();
  wb.creator = "plan&simple";
  const ws = wb.addWorksheet("Daten");
  ws.addRow(headers);

  for (const r of bad) {
    const values = parsed.headers.map((h) => r._raw?.[h] ?? "");
    values.push(r.row);
    values.push(r.messages.filter((m) => m.level === "error").map((m) => m.text).join(" · "));
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
    filename: `plan-und-simple_Fehler_${def.key}.xlsx`,
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

  // Domänen mit eigener Rollback-Logik (z. B. Anfangsbestände: gebuchte Finanz-
  // Aggregate reversieren statt nur Zeilen löschen).
  if (def.rollbackExecute) {
    const r = await def.rollbackExecute({ supabase, tenantId, batchId });
    await supabase.from("IMPORT_BATCH")
      .update({ STATUS: "rolled_back", ROLLED_BACK_AT: new Date().toISOString() })
      .eq("ID", batchId).eq("TENANT_ID", tenantId);
    return { rolledBack: true, deleted: r?.deleted ?? 0 };
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
  return { rolledBack: true, deleted };
}

// ── Vorlagen ─────────────────────────────────────────────────────────────────
// Feste Wertelisten (systemweit, nicht mandantenabhängig).
const FIXED_LISTS = {
  addressType: ADDRESS_TYPE_ALIASES.map((t) => t.label),
  billing:     ["Pauschal", "Stunden"],
  docType:     ["Abschlag", "Rechnung"],
  yesNo:       ["ja", "nein"],
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
  billing:       "Abrechnungsart",
  docType:       "Belegart",
  yesNo:         "ja/nein",
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

  const [countries, genders, salutations, statuses, types, employees, addresses] = await Promise.all([
    safe(() => supabase.from("COUNTRY").select("NAME_LONG")),
    safe(() => supabase.from("GENDER").select("GENDER")),
    safe(() => supabase.from("SALUTATION").select("SALUTATION")),
    safe(() => supabase.from("PROJECT_STATUS").select("NAME_SHORT")),
    safe(() => supabase.from("PROJECT_TYPE").select("NAME_SHORT").eq("TENANT_ID", tenantId)),
    safe(() => supabase.from("EMPLOYEE").select("SHORT_NAME").eq("TENANT_ID", tenantId).limit(2000)),
    safe(() => supabase.from("ADDRESS").select("ADDRESS_NAME_1").eq("TENANT_ID", tenantId).limit(2000)),
  ]);

  lists.country       = pick(countries.data, "NAME_LONG");
  lists.gender        = pick(genders.data, "GENDER");
  lists.salutation    = pick(salutations.data, "SALUTATION");
  lists.projectStatus = pick(statuses.data, "NAME_SHORT");
  lists.projectType   = pick(types.data, "NAME_SHORT");
  lists.employeeShort = pick(employees.data, "SHORT_NAME");
  lists.addressName   = pick(addresses.data, "ADDRESS_NAME_1");
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
    intro: "Deine Mitarbeiterinnen und Mitarbeiter als Stammdaten — Grundlage für Projektleitung, Zeiterfassung und Auswertungen.",
    before: ["Nichts. Mitarbeiter hängen an keinem anderen Bereich."],
    after: [
      "Wichtig: Importierte Mitarbeiter haben KEINEN Zugang und KEINE Rolle. Login und Berechtigungen vergibst du danach unter Mitarbeiter.",
      "Ebenfalls danach zu pflegen: Arbeitszeitmodell und Stundensätze — ohne sie bleiben Zeitkonto und Kostenauswertung leer.",
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
    intro: "Rechnungen und Abschlagsrechnungen aus der alten Welt, die noch offen sind — mit eigener Nummer, Datum, Fälligkeit und Restbetrag. Sie werden als echte, gebuchte Belege angelegt (ohne PDF und ohne E-Rechnung), damit offene Posten, Zahlungszuordnung und Mahnwesen ab Tag 1 stimmen.",
    before: [
      "Projekte samt Leistungsstruktur importieren (Projekt-Honorar oder Projektstruktur) — die Belege hängen an deren Positionen.",
      "Zur Rechnungsadresse muss ein Ansprechpartner vorhanden sein.",
      "Belegnummern bereithalten: sie müssen eindeutig sein und dürfen mit keiner vorhandenen Nummer kollidieren.",
    ],
    after: [
      "Eine Zeile = eine Belegposition. Zeilen mit derselben Belegnummer gehören zu EINEM Beleg; Belegdatum und Fälligkeit gelten aus der ersten Zeile.",
      "Wer keine Positionen führt: eine Zeile je Beleg, Spalte „Position“ leer lassen — der Betrag wird dann über die Pauschal-Positionen des Projekts verteilt.",
      "„Position“ meint das Kürzel aus der Leistungsstruktur (z. B. LP5). Es muss im Projekt eindeutig sein.",
      "Bezahlte Altbelege gehören NICHT hierher, sondern als eine Summe je Projekt in „Anfangsbestände“.",
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
    rows.push({ project_number: p.number, outline: "1", name_short: "LB", name_long: `Leistungsbild — ${p.name}` });
    HOAI_LP.forEach((lp, i) => {
      rows.push({
        project_number: p.number, outline: `1.${i + 1}`,
        name_short: lp.code, name_long: lp.name, billing: "Pauschal",
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
  s, norm, normHeader, parseDateISO, parseAmountDE, parseBuffer, buildAutoMapping, buildPreview,
  buildAddressEntry, buildEmployeeEntry, buildContactEntry, buildProjectEntry, buildProjectFeeEntry, buildProjectStructureEntry, finalizeProjectStructureRows, parseOutline, buildOpeningBalanceEntry, buildOpenItemEntry, finalizeOpenItemRows, buildOpeningCostEntry,
  // orchestriert
  preview, commit, errorReport, listBatches, rollback, buildTemplate, buildStructurePrefill, listDomains, DOMAINS,
};
