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

// ── Domänen-Registry ─────────────────────────────────────────────────────────
// Jede Domäne: table, fields (key/header/required/example/aliases), dependents
// (Tabellen, die Zeilen referenzieren → blockieren Rollback), loadContext (lädt
// Lookups + Bestand für Dubletten), buildEntry (mapped-Row → {ok,messages,dbRow,
// matchKey,display}).

const ADDRESS_FIELDS = [
  { key: "address_name_1",   header: "Name 1 (Firma/Nachname)", required: true,  example: "Mustermann Architekten GmbH", aliases: ["name", "name1", "firma", "company", "adressname", "nachname"] },
  { key: "address_name_2",   header: "Name 2 (Zusatz)",         required: false, example: "z. Hd. Herr Muster",          aliases: ["name2", "zusatz", "namenszusatz", "adresszusatz"] },
  { key: "street",           header: "Straße",                   required: false, example: "Musterstraße 12",            aliases: ["strasse", "street", "adresse"] },
  { key: "post_code",        header: "PLZ",                      required: false, example: "10115",                      aliases: ["plz", "postleitzahl", "postcode", "zip"] },
  { key: "city",             header: "Ort",                      required: false, example: "Berlin",                     aliases: ["ort", "stadt", "city"] },
  { key: "post_office_box",  header: "Postfach",                 required: false, example: "",                           aliases: ["postfach", "pob", "postbox"] },
  { key: "country",          header: "Land",                     required: false, example: "Deutschland",                aliases: ["land", "country", "staat"] },
  { key: "customer_number",  header: "Kundennummer",             required: false, example: "K-1001",                     aliases: ["kundennummer", "kundennr", "kundenr", "customer", "customernumber"] },
  { key: "tax_id",           header: "USt-IdNr.",                required: false, example: "DE123456789",                aliases: ["ustid", "ustidnr", "umsatzsteuer", "vat", "vatid", "taxid", "steuernummer"] },
  { key: "buyer_reference",  header: "Leitweg-ID",               required: false, example: "",                           aliases: ["leitweg", "leitwegid", "buyerreference", "kaeuferreferenz"] },
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

  const dbRow = {
    ADDRESS_NAME_1:  name1 || null,
    ADDRESS_NAME_2:  s(mapped.address_name_2) || null,
    STREET:          s(mapped.street) || null,
    POST_CODE:       s(mapped.post_code) || null,
    CITY:            s(mapped.city) || null,
    POST_OFFICE_BOX: s(mapped.post_office_box) || null,
    COUNTRY_ID:      countryId,
    CUSTOMER_NUMBER: s(mapped.customer_number) || null,
    "TAX-ID":        s(mapped.tax_id) || null,
    BUYER_REFERENCE: s(mapped.buyer_reference) || null,
  };

  const matchKey = norm(name1) + "|" + norm(mapped.post_code);
  const display = {
    name_1: name1, name_2: dbRow.ADDRESS_NAME_2, street: dbRow.STREET,
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
      { table: "TEC",              column: "EMPLOYEE_ID", label: "Buchung(en)" },
      { table: "EMPLOYEE2PROJECT", column: "EMPLOYEE_ID", label: "Projektzuordnung(en)" },
      { table: "ABSENCE",          column: "EMPLOYEE_ID", label: "Abwesenheit(en)" },
    ],
    loadContext: loadEmployeeContext,
    buildEntry: buildEmployeeEntry,
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

async function commit({ domainKey, buffer, filename, mapping, duplicateMode, structureMode, supabase, tenantId, employeeId }) {
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
    SUMMARY_JSON: { ...pv.summary, structureMode: structureMode || null }, CREATED_BY: employeeId || null,
  }]).select("ID").single();
  if (bErr) throw { status: 500, message: "Import-Stapel konnte nicht angelegt werden: " + bErr.message };
  const batchId = batch.ID;

  // 2a) Domänen mit eigener Schreiblogik (z. B. Projekt-Honorar: Struktur +
  //     Fortschritt + Vertrag pro Projekt) — alles mit IMPORT_BATCH_ID getaggt.
  if (def.commitRows) {
    try {
      const { inserted } = await def.commitRows(wanted, { supabase, tenantId, batchId, ctx, options: { structureMode } });
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
  const { data: idRows, error: idErr } = await supabase
    .from(def.table).select("ID").eq("TENANT_ID", tenantId).eq("IMPORT_BATCH_ID", batchId);
  if (idErr) throw { status: 500, message: idErr.message };
  const ids = (idRows || []).map((r) => r.ID);

  if (ids.length) {
    // Schutz: hängen Live-Daten an den importierten Zeilen? Dann blockieren.
    const blockers = [];
    for (const dep of def.dependents || []) {
      const { count, error: dErr } = await supabase
        .from(dep.table).select("ID", { count: "exact", head: true })
        .eq("TENANT_ID", tenantId).in(dep.column, ids);
      if (dErr) {
        if (/relation .* does not exist|column .* does not exist/i.test(dErr.message)) continue;
        throw { status: 500, message: dErr.message };
      }
      if (count > 0) blockers.push(`${count}× ${dep.label}`);
    }
    if (blockers.length) {
      throw { status: 409, message: `Rollback nicht möglich: An importierten Datensätzen hängen bereits ${blockers.join(", ")}. Bitte diese zuerst entfernen.` };
    }

    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error: delErr } = await supabase.from(def.table).delete().eq("TENANT_ID", tenantId).in("ID", chunk);
      if (delErr) throw { status: 500, message: delErr.message };
    }
  }

  await supabase.from("IMPORT_BATCH")
    .update({ STATUS: "rolled_back", ROLLED_BACK_AT: new Date().toISOString() })
    .eq("ID", batchId).eq("TENANT_ID", tenantId);
  return { rolledBack: true, deleted: ids.length };
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
  s, norm, normHeader, parseDateISO, parseBuffer, buildAutoMapping, buildPreview,
  buildAddressEntry, buildEmployeeEntry, buildProjectEntry,
  // orchestriert
  preview, commit, listBatches, rollback, buildTemplate, listDomains, DOMAINS,
};
