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

const XLSX = require("xlsx");
// Phase 3: Anfangsbestände werden über die bewährten Beleg-Services gebucht
// (init → Struktur → book(skipDocuments)) statt von Hand geschrieben.
const ppSvc = require("./partialPayments");
const invSvc = require("./invoices");
const { insertProgressSnapshot } = require("./projectProgress");
const { recomputeStructure } = require("./buchungen");

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
/** „Ja/Wahr"-artige Werte → true (für Flags wie Hauptkontakt). Leer/unklar → false. */
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
  { key: "address_type",     header: "Kategorie",                required: false, example: "Kunde / Bauherr",            aliases: ["kategorie", "typ", "art", "adresstyp", "adressart", "addresstype", "category", "gruppe"] },
  { key: "street",           header: "Straße",                   required: false, example: "Musterstraße 12",            aliases: ["strasse", "street", "adresse"] },
  { key: "post_code",        header: "PLZ",                      required: false, example: "10115",                      aliases: ["plz", "postleitzahl", "postcode", "zip"] },
  { key: "city",             header: "Ort",                      required: false, example: "Berlin",                     aliases: ["ort", "stadt", "city"] },
  { key: "post_office_box",  header: "Postfach",                 required: false, example: "",                           aliases: ["postfach", "pob", "postbox"] },
  { key: "country",          header: "Land",                     required: false, example: "Deutschland",                aliases: ["land", "country", "staat"] },
  { key: "customer_number",  header: "Kundennummer",             required: false, example: "K-1001",                     aliases: ["kundennummer", "kundennr", "kundenr", "customer", "customernumber"] },
  { key: "tax_id",           header: "USt-IdNr.",                required: false, example: "DE123456789",                aliases: ["ustid", "ustidnr", "umsatzsteuer", "vat", "vatid", "taxid"] },
  { key: "tax_number",       header: "Steuernummer",             required: false, example: "12/345/67890",               aliases: ["steuernummer", "steuernr", "stnr", "taxnumber"] },
  { key: "buyer_reference",  header: "Leitweg-ID",               required: false, example: "",                           aliases: ["leitweg", "leitwegid", "buyerreference", "kaeuferreferenz"] },
  { key: "phone",            header: "Telefon",                  required: false, example: "+49 30 1234567",             aliases: ["telefon", "tel", "phone", "festnetz", "telefonnummer"] },
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
    else { messages.push({ level: "error", text: `Land „${cin}" nicht gefunden` }); ok = false; }
  }

  // Kategorie (optional, fester Katalog): unbekannt → Warnung, Feld bleibt leer.
  let addressType = null;
  const atin = s(mapped.address_type);
  if (atin) {
    const hit = addressTypeByText.get(norm(atin));
    if (hit != null) addressType = hit;
    else messages.push({ level: "warn", text: `Kategorie „${atin}" nicht erkannt — bleibt leer (z. B. Kunde/Bauherr, Fachplaner, Behörde, Nachunternehmer, Lieferant, Sonstige)` });
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
  { key: "gender",           header: "Geschlecht",     required: true,  example: "weiblich",          aliases: ["geschlecht", "gender"] },
  { key: "title",            header: "Titel",          required: false, example: "Dipl.-Ing.",        aliases: ["titel", "title"] },
  { key: "email",            header: "E-Mail",         required: false, example: "m.muster@buero.de", aliases: ["email", "mail", "emailadresse", "mailadresse"] },
  { key: "mobile",           header: "Telefon/Mobil",  required: false, example: "+49 170 1234567",   aliases: ["mobil", "telefon", "mobile", "phone", "tel", "handy", "telefonnummer"] },
  { key: "personnel_number", header: "Personalnummer", required: false, example: "P-001",             aliases: ["personalnummer", "persnr", "personalnr", "personnelnumber", "mitarbeiternummer", "pnr"] },
  { key: "entry_date",       header: "Eintrittsdatum", required: false, example: "2022-03-01",        aliases: ["eintritt", "eintrittsdatum", "entrydate", "startdatum", "eingestelltam"] },
  { key: "exit_date",        header: "Austrittsdatum", required: false, example: "",                  aliases: ["austritt", "austrittsdatum", "exitdate"] },
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
    else { messages.push({ level: "error", text: `Geschlecht „${gin}" nicht erkannt (z. B. weiblich/männlich/divers)` }); ok = false; }
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
  { key: "address",    header: "Firma/Adresse (Zugehörigkeit)", required: true,  example: "Stadt Musterhausen", aliases: ["firma", "adresse", "unternehmen", "kunde", "bauherr", "company", "addressname"] },
  { key: "salutation", header: "Anrede",                        required: true,  example: "Herr",               aliases: ["anrede", "salutation"] },
  { key: "first_name", header: "Vorname",                       required: true,  example: "Thomas",             aliases: ["vorname", "firstname"] },
  { key: "last_name",  header: "Nachname",                      required: true,  example: "Beispiel",           aliases: ["nachname", "name", "lastname", "familienname", "surname"] },
  { key: "gender",     header: "Geschlecht",                    required: false, example: "männlich",           aliases: ["geschlecht", "gender"] },
  { key: "title",      header: "Titel",                         required: false, example: "Dr.",                aliases: ["titel", "title"] },
  { key: "position",   header: "Funktion/Position",             required: false, example: "Bauleiter",          aliases: ["funktion", "position", "rolle", "jobtitle", "role", "taetigkeit"] },
  { key: "department", header: "Abteilung",                     required: false, example: "Hochbau",            aliases: ["abteilung", "department", "bereich", "team"] },
  { key: "email",      header: "E-Mail",                        required: false, example: "t.beispiel@muster.de", aliases: ["email", "mail", "emailadresse", "mailadresse"] },
  { key: "mobile",     header: "Telefon/Mobil",                 required: false, example: "+49 170 1234567",    aliases: ["mobil", "telefon", "mobile", "phone", "tel", "handy", "telefonnummer"] },
  { key: "phone",      header: "Festnetz",                      required: false, example: "+49 30 1234567",     aliases: ["festnetz", "festnetznummer", "landline", "telefonfestnetz"] },
  { key: "is_primary", header: "Hauptkontakt (ja/nein)",        required: false, example: "ja",                 aliases: ["hauptkontakt", "primär", "primar", "primary", "isprimary", "haupt", "standardkontakt"] },
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
    if (addressId == null) { messages.push({ level: "error", text: `Firma/Adresse „${ain}" nicht gefunden — zuerst Adressen importieren` }); ok = false; }
  }

  // Anrede (Pflicht).
  let salutationId = null;
  const sin = s(mapped.salutation);
  if (!sin) { messages.push({ level: "error", text: "Anrede fehlt (Pflichtfeld, z. B. Herr/Frau)" }); ok = false; }
  else {
    salutationId = ctx.salByName.get(norm(sin)) ?? null;
    if (salutationId == null) { messages.push({ level: "error", text: `Anrede „${sin}" nicht gefunden (z. B. Herr/Frau)` }); ok = false; }
  }

  // Geschlecht (Pflicht in der App): aus Spalte, sonst aus Anrede ableiten, sonst Default.
  let genderId = null;
  const gin = s(mapped.gender);
  if (gin) {
    genderId = ctx.genders.byName.get(norm(gin)) ?? null;
    if (genderId == null) messages.push({ level: "warn", text: `Geschlecht „${gin}" nicht erkannt — aus Anrede abgeleitet` });
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
  { key: "status",         header: "Status",                   required: true,  example: "in Bearbeitung",            aliases: ["status", "projektstatus", "projectstatus"] },
  { key: "project_type",   header: "Projekttyp",               required: false, example: "Neubau",                    aliases: ["projekttyp", "typ", "type", "projecttype", "art"] },
  { key: "manager",        header: "Projektleiter (Kürzel)",   required: true,  example: "MMu",                       aliases: ["projektleiter", "pl", "manager", "leiter", "verantwortlich", "projektverantwortlicher"] },
  { key: "client",         header: "Bauherr/Auftraggeber",     required: true,  example: "Stadt Musterhausen",        aliases: ["bauherr", "auftraggeber", "kunde", "adresse", "client"] },
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
    if (hit == null) { messages.push({ level: "error", text: `${label} „${v}" nicht gefunden${hint ? ` — ${hint}` : ""}` }); ok = false; return null; }
    return hit;
  };
  // Optionale FKs: gesetzt-aber-unbekannt → Warnung (Feld bleibt leer, Zeile bleibt importierbar).
  const resolveOpt = (val, map, label) => {
    const v = s(val);
    if (!v) return null;
    const hit = map.get(norm(v));
    if (hit == null) { messages.push({ level: "warn", text: `${label} „${v}" nicht gefunden — bleibt leer` }); return null; }
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
  { key: "fee",            header: "Honorarsumme (netto)",           required: true,  example: "80000",      aliases: ["honorar", "honorarsumme", "summe", "betrag", "nettohonorar", "auftragssumme", "fee", "amount"] },
  { key: "billing",        header: "Abrechnungsart (Pauschal/Stunden)", required: false, example: "Pauschal", aliases: ["abrechnungsart", "abrechnung", "billing", "billingtype", "art"] },
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
    if (!proj) { messages.push({ level: "error", text: `Projekt „${number}" nicht gefunden — zuerst das Projekt importieren/anlegen` }); ok = false; }
  }

  const feeRaw = s(mapped.fee);
  const amount = parseAmountDE(feeRaw);
  if (!feeRaw) { messages.push({ level: "error", text: "Honorarsumme fehlt (Pflichtfeld)" }); ok = false; }
  else if (amount.invalid || amount.value == null) { messages.push({ level: "error", text: `Honorarsumme „${feeRaw}" ist keine gültige Zahl` }); ok = false; }
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

    const structRows = nodes.map((n) => ({
      NAME_SHORT: n.NAME_SHORT, NAME_LONG: n.NAME_LONG, PROJECT_ID: e.projectId,
      BILLING_TYPE_ID: e.billingTypeId, FATHER_ID: null, REVENUE: n.REVENUE,
      EXTRAS_PERCENT: 0, EXTRAS: 0, COSTS: 0,
      REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
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

    // 3) Vertrag (nur wenn noch keiner existiert)
    const { data: existing } = await supabase.from("CONTRACT").select("ID").eq("TENANT_ID", tenantId).eq("PROJECT_ID", e.projectId).limit(1);
    if (!existing || existing.length === 0) {
      const contractRow = {
        NAME_SHORT: e.projectNumber, NAME_LONG: e.projectName, PROJECT_ID: e.projectId,
        INVOICE_ADDRESS_ID: e.addressId, INVOICE_CONTACT_ID: e.contactId,
        TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId,
        ...(defaults.default_currency_id ? { CURRENCY_ID: Number(defaults.default_currency_id) } : {}),
        ...(defaults.default_vat_id ? { VAT_ID: Number(defaults.default_vat_id) } : {}),
      };
      const { error: cErr } = await supabase.from("CONTRACT").insert([contractRow]);
      if (cErr) throw { status: 500, message: `Vertrag für Projekt ${e.projectNumber} fehlgeschlagen: ${cErr.message}` };
    }
    done++;
  }
  return { inserted: done };
}

// ── Domäne: Anfangsbestände / Altrechnungen ──────────────────────────────────
// „bereits berechnet" je Projekt → echter, gebuchter Referenz-Beleg (Abschlags-
// rechnung ODER Rechnung), damit der Wert das Self-Healing-Recompute überlebt.
// Erzeugt über die App-Pipeline init → Belegstruktur → book(skipDocuments).
const OPENING_BALANCE_FIELDS = [
  { key: "project_number", header: "Projektnummer",            required: true,  example: "P-2024-012",  aliases: ["projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "amount",         header: "Bereits berechnet (netto)", required: true,  example: "30000",       aliases: ["berechnet", "bereitsberechnet", "rechnungsbetrag", "betrag", "summe", "fakturiert", "invoiced"] },
  { key: "paid",           header: "Bereits bezahlt (netto, optional)", required: false, example: "30000", aliases: ["bezahlt", "bereitsbezahlt", "zahlung", "zahlbetrag", "payed", "paid", "eingegangen"] },
  { key: "doc_number",     header: "Belegnummer (optional)",    required: false, example: "RE-2023-044", aliases: ["belegnummer", "rechnungsnummer", "docnumber"] },
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
    if (!proj) { messages.push({ level: "error", text: `Projekt „${number}" nicht gefunden` }); ok = false; }
    else {
      if (!proj.contract) { messages.push({ level: "error", text: "Projekt hat keinen Vertrag — zuerst „Projekt-Honorar“ importieren" }); ok = false; }
      if (!proj.btStructures.length) { messages.push({ level: "error", text: "Keine abrechenbare Pauschal-Struktur (nur Pauschal-Projekte)" }); ok = false; }
    }
  }

  const feeRaw = s(mapped.amount);
  const amount = parseAmountDE(feeRaw);
  if (!feeRaw) { messages.push({ level: "error", text: "Betrag fehlt (Pflichtfeld)" }); ok = false; }
  else if (amount.invalid || amount.value == null) { messages.push({ level: "error", text: `Betrag „${feeRaw}" ist keine gültige Zahl` }); ok = false; }
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
    if (paid.invalid || paid.value == null) { messages.push({ level: "error", text: `Bezahlt „${paidRaw}" ist keine gültige Zahl` }); ok = false; }
    else if (paid.value < 0) { messages.push({ level: "error", text: "Bezahlt darf nicht negativ sein" }); ok = false; }
    else if (amount.value != null && paid.value > amount.value + 0.01) { messages.push({ level: "error", text: "Bezahlt darf den berechneten Betrag nicht übersteigen" }); ok = false; }
    else paidVal = paid.value;
  }

  const dbRow = (proj && ok) ? {
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
      let docId = null, vatPercent = 0;

      if (docType === "invoice") {
        const { id } = await invSvc.initInvoice(supabase, { companyId: e.companyId, employeeId, projectId: e.projectId, contractId: e.contractId, invoiceType: null });
        const upd = { IMPORT_BATCH_ID: batchId }; if (e.docNumber) upd.INVOICE_NUMBER = e.docNumber;
        await supabase.from("INVOICE").update(upd).eq("ID", id);
        const isRows = dist.map((d) => ({ INVOICE_ID: id, STRUCTURE_ID: d.id, AMOUNT_NET: d.amt, AMOUNT_EXTRAS_NET: fmt2(d.amt * d.extrasPercent / 100), TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId }));
        await invSvc.writeInvoiceStructureRows(supabase, { invoiceId: id, rows: isRows, deleteStructureIds: dist.map((d) => d.id) });
        await invSvc.recomputeInvoiceTotals(supabase, id);
        const { data: inv } = await supabase.from("INVOICE").select("*").eq("ID", id).single();
        await invSvc.bookInvoice(supabase, { id, inv, tenantId, force: true, skipDocuments: true });
        docId = id; vatPercent = num(inv.VAT_PERCENT);
      } else {
        const { id } = await ppSvc.initPartialPayment(supabase, { companyId: e.companyId, employeeId, projectId: e.projectId, contractId: e.contractId });
        const upd = { IMPORT_BATCH_ID: batchId }; if (e.docNumber) upd.PARTIAL_PAYMENT_NUMBER = e.docNumber;
        await supabase.from("PARTIAL_PAYMENT").update(upd).eq("ID", id);
        const psRows = dist.map((d) => ({ PARTIAL_PAYMENT_ID: id, STRUCTURE_ID: d.id, AMOUNT_NET: d.amt, AMOUNT_EXTRAS_NET: fmt2(d.amt * d.extrasPercent / 100), TENANT_ID: tenantId, IMPORT_BATCH_ID: batchId }));
        await ppSvc.writePpsRows(supabase, { partialPaymentId: id, structureIds: dist.map((d) => d.id), rows: psRows });
        await ppSvc.recomputePartialPaymentTotals(supabase, id);
        const { data: pp } = await supabase.from("PARTIAL_PAYMENT").select("*").eq("ID", id).single();
        await ppSvc.bookPartialPayment(supabase, { id, pp, tenantId, force: true, skipDocuments: true });
        docId = id; vatPercent = num(pp.VAT_PERCENT);
      }

      // Optional: „bereits bezahlt" als echte Zahlung gegen den Beleg buchen.
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

// Bucht „bereits bezahlt" als echte Zahlung gegen den Beleg (spiegelt routes/payments.js).
async function recordOpeningPayment(supabase, { tenantId, batchId, docType, docId, projectId, contractId, paidNet, vatPercent, dist }) {
  const gross = fmt2(paidNet * (1 + num(vatPercent) / 100));
  const vat = fmt2(gross - paidNet);
  const today = new Date().toISOString().slice(0, 10);

  const payRow = {
    PARTIAL_PAYMENT_ID: docType === "partial" ? docId : null,
    INVOICE_ID:         docType === "invoice" ? docId : null,
    AMOUNT_PAYED_GROSS: gross, AMOUNT_PAYED_NET: paidNet, AMOUNT_PAYED_VAT: vat,
    PAYMENT_DATE: today, PROJECT_ID: projectId, CONTRACT_ID: contractId,
    PURPOSE_OF_PAYMENT: "Anfangsbestand (Import)", COMMENT: null,
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

// ── Domäne: Kosten-Anfangsbestände (Kostenblöcke) ────────────────────────────
// Für (v. a. Stunden-/TEC-)Projekte: aggregierte, bereits angefallene Kosten je
// Projekt als EINE LUMP_COST-Buchung — KEINE Einzelbuchungen. Speist
// Deckungsbeitrag/Wirtschaftlichkeit ab Tag 1.
const OPENING_COST_FIELDS = [
  { key: "project_number", header: "Projektnummer",                      required: true,  example: "P-2024-012",                aliases: ["projektnummer", "projektnr", "nummer", "nameshort", "projectnumber", "projnr"] },
  { key: "cost",           header: "Bereits angefallene Kosten (netto)", required: true,  example: "45000",                     aliases: ["kosten", "kostenblock", "kostensumme", "aufwand", "betrag", "costs", "cost"] },
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
    if (!proj) { messages.push({ level: "error", text: `Projekt „${number}" nicht gefunden` }); ok = false; }
  }

  const costRaw = s(mapped.cost);
  const cost = parseAmountDE(costRaw);
  if (!costRaw) { messages.push({ level: "error", text: "Kostenbetrag fehlt (Pflichtfeld)" }); ok = false; }
  else if (cost.invalid || cost.value == null) { messages.push({ level: "error", text: `Kosten „${costRaw}" ist keine gültige Zahl` }); ok = false; }
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
    async computeBlockers({ supabase, tenantId, batchId }) {
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
    },
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
/** Buffer (XLSX/CSV) → { headers:string[], rows: object[] } (Zeilen nach Header). */
function parseBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw { status: 400, message: "Die Datei enthält keine Tabelle" };
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
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
  let ok = 0, warning = 0, duplicate = 0, error = 0;

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
      if (keys.some((k) => seen.has(k))) {
        status = "duplicate"; messages.push({ level: "warn", text: "Dublette innerhalb der Datei" });
      } else if (keys.some((k) => ctx.existingKeys.has(k))) {
        status = "duplicate"; messages.push({ level: "warn", text: "Bereits im System vorhanden" });
      } else {
        status = messages.some((m) => m.level === "warn") ? "warning" : "ok";
      }
      keys.forEach((k) => seen.add(k));
    }

    if (status === "ok") ok++;
    else if (status === "warning") warning++;
    else if (status === "duplicate") duplicate++;
    else error++;
    rows.push({ row: i + 2, status, messages, display: entry.display, _dbRow: entry.dbRow });
  });

  return { mapping: map, summary: { total: rows.length, ok, warning, duplicate, error }, rows };
}

// ── Orchestrierung (mit supabase) ────────────────────────────────────────────
async function preview({ domainKey, buffer, filename, mapping, supabase, tenantId }) {
  const def = getDomain(domainKey);
  const parsed = parseBuffer(buffer);
  if (!parsed.headers.length) throw { status: 400, message: "Die Datei enthält keine Spaltenüberschriften" };
  const ctx = await def.loadContext(supabase, tenantId);
  const pv = buildPreview({ domainKey, parsed, mapping, ctx });
  return {
    domain: def.key,
    filename: filename || null,
    headers: parsed.headers,
    mapping: pv.mapping,
    fields: def.fields.map(publicField),
    summary: pv.summary,
    rows: pv.rows.slice(0, 200).map((r) => ({ row: r.row, status: r.status, messages: r.messages, display: r.display })),
    truncated: pv.rows.length > 200,
  };
}

async function commit({ domainKey, buffer, filename, mapping, duplicateMode, structureMode, docType, supabase, tenantId, employeeId }) {
  const def = getDomain(domainKey);
  const parsed = parseBuffer(buffer);
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

/** Leere Excel-Vorlage einer Domäne (Header + Beispielzeile) als Buffer. */
function buildTemplate(domainKey) {
  const def = getDomain(domainKey);
  const headers = def.fields.map((f) => f.header + (f.required ? " *" : ""));
  const example = def.fields.map((f) => f.example ?? "");
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, def.label);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return { buffer, filename: `plan-und-simple_Vorlage_${def.key}.xlsx` };
}

function listDomains() {
  return Object.values(DOMAINS).map((d) => ({
    key: d.key, label: d.label, matchLabel: d.matchLabel, fields: d.fields.map(publicField),
  }));
}

module.exports = {
  // rein / testbar
  s, norm, normHeader, parseDateISO, parseAmountDE, parseBuffer, buildAutoMapping, buildPreview,
  buildAddressEntry, buildEmployeeEntry, buildContactEntry, buildProjectEntry, buildProjectFeeEntry, buildOpeningBalanceEntry, buildOpeningCostEntry,
  // orchestriert
  preview, commit, listBatches, rollback, buildTemplate, listDomains, DOMAINS,
};
