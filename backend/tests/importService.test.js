"use strict";

const { xlsxBuffer } = require("./helpers/sheetFixture");
const {
  normHeader,
  parseDateISO,
  parseBuffer,
  buildAutoMapping,
  buildPreview,
  parseAmountDE,
  buildAddressEntry,
  buildEmployeeEntry,
  buildContactEntry,
  buildProjectEntry,
  buildProjectFeeEntry,
  buildOpeningBalanceEntry,
  buildOpeningCostEntry,
} = require("../services/importService");

// Hilfs-Context für die Adress-Validierung (kein supabase nötig).
function makeCtx() {
  return {
    countries: {
      byName: new Map([
        ["deutschland", 1], ["de", 1],
        ["österreich", 2], ["at", 2],
      ]),
      default: 1,
    },
    existingKeys: new Set(["bestand gmbh|10115"]),
  };
}

// ── normHeader ────────────────────────────────────────────────────────────────
describe("normHeader", () => {
  it("strips spaces, punctuation and case", () => {
    expect(normHeader("Name 1 (Firma) *")).toBe("name1firma");
    expect(normHeader("USt-IdNr.")).toBe("ustidnr");
  });
});

// ── parseBuffer ─────────────────────────────────────────────────────────────
describe("parseBuffer", () => {
  it("reads headers and rows from a sheet", async () => {
    const buf = await xlsxBuffer([
      ["Name 1 (Firma/Nachname)", "PLZ", "Ort"],
      ["Acme GmbH", "10115", "Berlin"],
    ]);
    const { headers, rows } = await parseBuffer(buf);
    expect(headers).toEqual(["Name 1 (Firma/Nachname)", "PLZ", "Ort"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]["Ort"]).toBe("Berlin");
  });
});

// ── buildAutoMapping ──────────────────────────────────────────────────────────
describe("buildAutoMapping (address)", () => {
  it("maps by header and aliases, case/format-insensitive", () => {
    const map = buildAutoMapping(["Firma", "plz", "Ort", "USt-IdNr."], "address");
    expect(map.address_name_1).toBe("Firma");
    expect(map.post_code).toBe("plz");
    expect(map.city).toBe("Ort");
    expect(map.tax_id).toBe("USt-IdNr.");
  });

  it("matches the template headers (with required star)", () => {
    const map = buildAutoMapping(["Name 1 (Firma/Nachname) *", "PLZ", "Land"], "address");
    expect(map.address_name_1).toBe("Name 1 (Firma/Nachname) *");
    expect(map.country).toBe("Land");
  });
});

// ── buildAddressEntry ─────────────────────────────────────────────────────────
describe("buildAddressEntry", () => {
  const ctx = makeCtx();

  it("accepts a valid row and defaults country to Germany when blank", () => {
    const e = buildAddressEntry({ address_name_1: "Acme GmbH", post_code: "10115" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.COUNTRY_ID).toBe(1);
    expect(e.dbRow.ADDRESS_NAME_1).toBe("Acme GmbH");
    expect(e.matchKey).toBe("acme gmbh|10115");
  });

  it("resolves a named country", () => {
    const e = buildAddressEntry({ address_name_1: "Wiener Büro", country: "Österreich" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.COUNTRY_ID).toBe(2);
  });

  it("flags missing required name", () => {
    const e = buildAddressEntry({ address_name_1: "", post_code: "10115" }, ctx);
    expect(e.ok).toBe(false);
    expect(e.messages.some((m) => m.level === "error")).toBe(true);
  });

  it("flags an unknown country", () => {
    const e = buildAddressEntry({ address_name_1: "X", country: "Atlantis" }, ctx);
    expect(e.ok).toBe(false);
  });

  it("maps the extended fields (Kategorie/Steuernummer/Kommunikation/Notizen)", () => {
    const e = buildAddressEntry({
      address_name_1: "Acme GmbH", post_code: "10115", address_type: "Fachplaner",
      tax_number: "12/345/67890", phone: "+49 30 111", email: "info@acme.de",
      website: "www.acme.de", notes: "Bestandskunde",
    }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.ADDRESS_TYPE).toBe(2);
    expect(e.dbRow.TAX_NUMBER).toBe("12/345/67890");
    expect(e.dbRow.PHONE).toBe("+49 30 111");
    expect(e.dbRow.EMAIL).toBe("info@acme.de");
    expect(e.dbRow.WEBSITE).toBe("www.acme.de");
    expect(e.dbRow.NOTES).toBe("Bestandskunde");
    expect(e.display.category).toBe("Fachplaner");
  });

  it("resolves the category from a numeric code and by loose text", () => {
    expect(buildAddressEntry({ address_name_1: "A", address_type: "1" }, ctx).dbRow.ADDRESS_TYPE).toBe(1);
    expect(buildAddressEntry({ address_name_1: "A", address_type: "bauherr" }, ctx).dbRow.ADDRESS_TYPE).toBe(1);
    expect(buildAddressEntry({ address_name_1: "A", address_type: "Lieferant" }, ctx).dbRow.ADDRESS_TYPE).toBe(5);
  });

  it("warns (still importable) on an unknown category and keeps it empty", () => {
    const e = buildAddressEntry({ address_name_1: "A", address_type: "Phantasie" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.ADDRESS_TYPE).toBeNull();
    expect(e.messages.some((m) => m.level === "warn")).toBe(true);
  });
});

describe("buildAutoMapping (address, extended fields)", () => {
  it("maps the new columns and routes Steuernummer to tax_number (not tax_id)", () => {
    const map = buildAutoMapping(["Kategorie", "USt-IdNr.", "Steuernummer", "Telefon", "E-Mail", "Webseite", "Notizen"], "address");
    expect(map.address_type).toBe("Kategorie");
    expect(map.tax_id).toBe("USt-IdNr.");
    expect(map.tax_number).toBe("Steuernummer");
    expect(map.phone).toBe("Telefon");
    expect(map.email).toBe("E-Mail");
    expect(map.website).toBe("Webseite");
    expect(map.notes).toBe("Notizen");
  });
});

// ── buildPreview ──────────────────────────────────────────────────────────────
describe("buildPreview (address)", () => {
  const ctx = makeCtx();
  const headers = ["Name 1 (Firma/Nachname)", "PLZ", "Land"];

  function preview(dataRows) {
    const parsed = {
      headers,
      rows: dataRows.map((r) => ({ "Name 1 (Firma/Nachname)": r[0], "PLZ": r[1], "Land": r[2] ?? "" })),
    };
    return buildPreview({ domainKey: "address", parsed, mapping: null, ctx });
  }

  it("classifies ok / error / duplicate correctly", () => {
    const pv = preview([
      ["Acme GmbH", "10115", ""],     // ok
      ["", "20000", ""],              // error (no name)
      ["Bestand GmbH", "10115", ""],  // duplicate vs existing
      ["Acme GmbH", "10115", ""],     // duplicate within file
    ]);
    expect(pv.summary.total).toBe(4);
    expect(pv.summary.ok).toBe(1);
    expect(pv.summary.error).toBe(1);
    expect(pv.summary.duplicate).toBe(2);
    expect(pv.rows[0].row).toBe(2); // file row number (1 = header)
  });

  it("skips fully empty rows", () => {
    const pv = preview([["", "", ""], ["Acme GmbH", "10115", ""]]);
    expect(pv.summary.total).toBe(1);
    expect(pv.summary.ok).toBe(1);
  });
});

// ── parseDateISO ──────────────────────────────────────────────────────────────
describe("parseDateISO", () => {
  it("passes through ISO dates and pads", () => {
    expect(parseDateISO("2022-03-01").value).toBe("2022-03-01");
    expect(parseDateISO("2022-3-1").value).toBe("2022-03-01");
  });
  it("converts German dd.mm.yyyy", () => {
    expect(parseDateISO("1.3.2022").value).toBe("2022-03-01");
    expect(parseDateISO("01.03.2022").value).toBe("2022-03-01");
  });
  it("returns null for blank, invalid flag for garbage", () => {
    expect(parseDateISO("").value).toBeNull();
    expect(parseDateISO("foo").invalid).toBe(true);
  });

  // Altsystem-Exporte liefern Datumswerte als TEXT mit angehaengter Uhrzeit.
  // Ohne den Schnitt fiel jede solche Zelle als "nicht erkannt" durch — und
  // der Import legte Mitarbeiter ohne Eintrittsdatum an, mit einer Warnung,
  // die in 999 Zeilen niemand liest.
  it("schneidet eine mitgelieferte Uhrzeit ab", () => {
    expect(parseDateISO("2000-01-01 00:00:00.000").value).toBe("2000-01-01");
    expect(parseDateISO("2019-01-01 00:00:00").value).toBe("2019-01-01");
    expect(parseDateISO("2020-02-01T00:00:00Z").value).toBe("2020-02-01");
    expect(parseDateISO("01.02.2020 08:30").value).toBe("2020-02-01");
  });

  it("haelt Muell auch mit Uhrzeit-Anhang fuer Muell", () => {
    expect(parseDateISO("irgendwann 08:30").invalid).toBe(true);
  });
});

// ── Mitarbeiter ───────────────────────────────────────────────────────────────
function makeEmpCtx() {
  return {
    genders: {
      byName: new Map([
        ["weiblich", 1], ["w", 1], ["frau", 1],
        ["männlich", 2], ["maennlich", 2], ["m", 2],
        ["divers", 3], ["d", 3],
      ]),
      byId: new Map([[1, "weiblich"], [2, "männlich"], [3, "divers"]]),
      default: 3,
    },
    // Die drei Kataloge, die der Mitarbeiter-Import ueber ihren NAMEN aufloest.
    departments: new Map([["hochbau", 10]]),
    workModels:  new Map([["40hwoche", 20]]),
    userRoles:   new Map([["projektleiter", 30]]),
    empIdByAbbr: new Map([["chef", 99]]),
    existingKeys: new Set(["mail:alt@buero.de", "short:abc"]),
  };
}

/** Pflichtfelder einer Mitarbeiterzeile, damit ein Test nur sein Thema setzt. */
const EMP_BASIS = { abbr: "MMu", first_name: "Maria", last_name: "Muster", gender: "weiblich", status: "Aktiv" };

describe("buildAutoMapping (employee)", () => {
  it("maps employee headers and aliases", () => {
    const map = buildAutoMapping(["Kürzel", "Vorname", "Nachname", "Geschlecht", "E-Mail", "Personalnummer"], "employee");
    expect(map.abbr).toBe("Kürzel");
    expect(map.first_name).toBe("Vorname");
    expect(map.gender).toBe("Geschlecht");
    expect(map.email).toBe("E-Mail");
    expect(map.personnel_number).toBe("Personalnummer");
  });
});

describe("buildEmployeeEntry", () => {
  const ctx = makeEmpCtx();

  it("accepts a valid row and resolves gender + date", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, entry_date: "01.03.2022" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.GENDER_ID).toBe(1);
    expect(e.dbRow.ENTRY_DATE).toBe("2022-03-01");
    expect(e.dbRow.ACTIVE).toBe(1);
    expect(e.matchKey).toContain("short:mmu");
  });

  it("defaults gender when blank (neutral default present)", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, abbr: "X", gender: "" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.GENDER_ID).toBe(3);
  });

  it("flags missing required fields", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, abbr: "", first_name: "", gender: "w" }, ctx);
    expect(e.ok).toBe(false);
    expect(e.messages.filter(m => m.level === "error").length).toBeGreaterThanOrEqual(2);
  });

  it("flags an unknown gender", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, abbr: "Y", gender: "Hamster" }, ctx);
    expect(e.ok).toBe(false);
  });

  it("warns (not errors) on invalid date and bad email", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, abbr: "Z", gender: "m", email: "noatsign", entry_date: "kaputt" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.messages.some(m => m.level === "warn")).toBe(true);
  });

  // ── Status (Pflicht seit 09/2026) ─────────────────────────────────────────
  // 2 ist das Inaktiv, nicht 0. Das ganze Produkt prueft auf ACTIVE === 2 bzw.
  // neq("ACTIVE", 2) — Login, Sitzungswaechter, Lizenzplaetze, Oberflaeche.
  // Mit einer 0 haetten sich Ausgeschiedene weiter anmelden koennen.
  it("uebernimmt Aktiv/Inaktiv nach ACTIVE — inaktiv ist die 2", () => {
    expect(buildEmployeeEntry({ ...EMP_BASIS, status: "Aktiv" }, ctx).dbRow.ACTIVE).toBe(1);
    expect(buildEmployeeEntry({ ...EMP_BASIS, status: "Inaktiv" }, ctx).dbRow.ACTIVE).toBe(2);
    expect(buildEmployeeEntry({ ...EMP_BASIS, status: "ausgeschieden" }, ctx).dbRow.ACTIVE).toBe(2);
    expect(buildEmployeeEntry({ ...EMP_BASIS, status: "nein" }, ctx).dbRow.ACTIVE).toBe(2);
  });

  it("zeigt den Status in der Vorschau im Klartext", () => {
    expect(buildEmployeeEntry({ ...EMP_BASIS, status: "Inaktiv" }, ctx).display.status).toBe("Inaktiv");
    expect(buildEmployeeEntry({ ...EMP_BASIS, status: "Aktiv" }, ctx).display.status).toBe("Aktiv");
  });

  it("weist eine Zeile ohne Status ab", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, status: "" }, ctx);
    expect(e.ok).toBe(false);
    expect(e.messages.some(m => m.level === "error" && /Status fehlt/.test(m.text))).toBe(true);
  });

  // ── Geschlecht: nur die drei gepflegten Werte ─────────────────────────────
  // In plan&simple ist GENDER.ID 1 = maennlich, im wiko-Export bedeutet die 1
  // "weiblich". Wer Zahlen durchliesse, drehte jede Anrede um.
  it("weist Zahlencodes als Geschlecht ab und sagt warum", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, gender: "1" }, ctx);
    expect(e.ok).toBe(false);
    expect(e.messages.some(m => /Zahlencode/.test(m.text))).toBe(true);
  });

  // ── Abteilung / Modell / Rolle ────────────────────────────────────────────
  it("loest eine bekannte Abteilung auf", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, department: "Hochbau" }, ctx);
    expect(e.dbRow.DEPARTMENT_ID).toBe(10);
    expect(e.extra.departmentNew).toBe(null);
  });

  it("merkt eine unbekannte Abteilung zum Anlegen vor", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, department: "Tiefbau" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.DEPARTMENT_ID).toBe(null);
    expect(e.extra.departmentNew).toBe("Tiefbau");
  });

  it("legt ein unbekanntes Arbeitszeitmodell NICHT an, sondern warnt", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, work_model: "Gleitzeit", work_model_valid_from: "01.01.2024" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.extra.workModel).toBe(null);
    expect(e.messages.some(m => m.level === "warn" && /Arbeitszeitmodell/.test(m.text))).toBe(true);
  });

  it("ordnet ein bekanntes Arbeitszeitmodell mit Stichtag zu", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, work_model: "40h-Woche", work_model_valid_from: "01.02.2020" }, ctx);
    expect(e.extra.workModel).toEqual({ modelId: 20, from: "2020-02-01" });
  });

  it("verwirft eine unbekannte Berechtigungsrolle mit Warnung", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, role: "Chefetage" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.extra.roleId).toBe(null);
    expect(e.messages.some(m => m.level === "warn" && /Berechtigungsrolle/.test(m.text))).toBe(true);
  });

  // ── Kostensatz: Betrag UND Stichtag ───────────────────────────────────────
  it("uebernimmt den Kostensatz nur mit Gueltigkeitsdatum", () => {
    const mit = buildEmployeeEntry({ ...EMP_BASIS, cost_rate: "150,91", cost_rate_valid_from: "01.01.2023" }, ctx);
    expect(mit.extra.costRate).toEqual({ value: 150.91, from: "2023-01-01" });

    const ohne = buildEmployeeEntry({ ...EMP_BASIS, cost_rate: "150,91" }, ctx);
    expect(ohne.extra.costRate).toBe(null);
    expect(ohne.messages.some(m => /ohne Gültigkeitsdatum/.test(m.text))).toBe(true);
  });

  // ── Telefon und Mobil sind zwei Felder ────────────────────────────────────
  it("schreibt Telefon und Mobil in getrennte Spalten", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, phone: "+49 30 1234567", mobile: "+49 170 1234567" }, ctx);
    expect(e.dbRow.PHONE).toBe("+49 30 1234567");
    expect(e.dbRow.MOBILE).toBe("+49 170 1234567");
  });

  it("uebernimmt Geburtstag und Notiz", () => {
    const e = buildEmployeeEntry({ ...EMP_BASIS, birth_date: "23.04.1985", notes: "Teilzeit ab Herbst" }, ctx);
    expect(e.dbRow.BIRTH_DATE).toBe("1985-04-23");
    expect(e.dbRow.NOTES).toBe("Teilzeit ab Herbst");
  });
});

// ── Vorgesetzter: darf weiter unten in derselben Datei stehen ───────────────
// Genau deshalb entscheidet finalizeRows und nicht buildEntry: eine einzelne
// Zeile kann nicht wissen, ob das Kuerzel spaeter noch kommt.
describe("Vorgesetzter (zeilenuebergreifend)", () => {
  const ctx = makeEmpCtx();
  const headers = ["Kürzel", "Vorname", "Nachname", "Geschlecht", "Status (Aktiv/Inaktiv)", "Vorgesetzter (Kürzel)"];

  function preview(dataRows) {
    const parsed = {
      headers,
      rows: dataRows.map(r => ({
        "Kürzel": r[0], "Vorname": r[1], "Nachname": r[2], "Geschlecht": r[3],
        "Status (Aktiv/Inaktiv)": "Aktiv", "Vorgesetzter (Kürzel)": r[4] ?? "",
      })),
    };
    return buildPreview({ domainKey: "employee", parsed, mapping: null, ctx });
  }

  it("akzeptiert einen Vorgesetzten, der erst spaeter in der Datei steht", () => {
    const pv = preview([
      ["AW", "Ansgar", "Woermann", "m", "SF"],
      ["SF", "Simon", "Feldhaus", "m", ""],
    ]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[0]._extra.supervisorAbbr).toBe("SF");
  });

  it("akzeptiert einen Vorgesetzten aus dem Bestand", () => {
    const pv = preview([["AW", "Ansgar", "Woermann", "m", "CHEF"]]);
    expect(pv.rows[0]._extra.supervisorAbbr).toBe("CHEF");
  });

  it("warnt bei einem unbekannten Vorgesetzten und laesst das Feld leer", () => {
    const pv = preview([["AW", "Ansgar", "Woermann", "m", "NIEMAND"]]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[0]._extra.supervisorAbbr).toBe(null);
    expect(pv.rows[0].messages.some(m => /nicht gefunden/.test(m.text))).toBe(true);
  });

  it("laesst niemanden sein eigener Vorgesetzter sein", () => {
    const pv = preview([["AW", "Ansgar", "Woermann", "m", "AW"]]);
    expect(pv.rows[0]._extra.supervisorAbbr).toBe(null);
    expect(pv.rows[0].messages.some(m => /selbst/.test(m.text))).toBe(true);
  });
});

describe("buildPreview (employee, multi-key dedup)", () => {
  const ctx = makeEmpCtx();
  const headers = ["Kürzel", "Vorname", "Nachname", "Geschlecht", "E-Mail", "Status (Aktiv/Inaktiv)"];

  function preview(dataRows) {
    const parsed = {
      headers,
      rows: dataRows.map(r => ({
        "Kürzel": r[0], "Vorname": r[1], "Nachname": r[2], "Geschlecht": r[3],
        "E-Mail": r[4] ?? "", "Status (Aktiv/Inaktiv)": "Aktiv",
      })),
    };
    return buildPreview({ domainKey: "employee", parsed, mapping: null, ctx });
  }

  it("detects duplicates by mail OR abbr, plus in-file", () => {
    const pv = preview([
      ["NEU", "A", "B", "w", "neu@buero.de"],   // ok
      ["XYZ", "C", "D", "m", "alt@buero.de"],   // duplicate (existing mail)
      ["ABC", "E", "F", "d", "frisch@buero.de"],// duplicate (existing short 'abc')
      ["NEU", "G", "H", "w", "anders@buero.de"],// duplicate in-file (short 'neu')
    ]);
    expect(pv.summary.ok).toBe(1);
    expect(pv.summary.duplicate).toBe(3);
    expect(pv.summary.error).toBe(0);
  });
});

// ── Projekte ──────────────────────────────────────────────────────────────────
function makeProjCtx() {
  return {
    companyId: 7,
    statusByName: new Map([["in bearbeitung", 10], ["abgeschlossen", 11]]),
    typeByName: new Map([["neubau", 20]]),
    empByName: new Map([["mmu", 30], ["maria muster", 30]]),
    addrByName: new Map([["stadt musterhausen", 40]]),
    existingKeys: new Set(["p-2023-001"]),
  };
}

describe("buildAutoMapping (project)", () => {
  it("maps project headers and aliases", () => {
    const map = buildAutoMapping(["Projektnummer", "Projektname", "Status", "Projektleiter (Kürzel)", "Bauherr/Auftraggeber"], "project");
    expect(map.project_number).toBe("Projektnummer");
    expect(map.name).toBe("Projektname");
    expect(map.manager).toBe("Projektleiter (Kürzel)");
    expect(map.client).toBe("Bauherr/Auftraggeber");
  });
});

describe("buildProjectEntry", () => {
  const ctx = makeProjCtx();

  it("keeps the project number, resolves FKs and sets company", () => {
    const e = buildProjectEntry({ project_number: "P-2024-012", name: "Neubau Kita", status: "in Bearbeitung", project_type: "Neubau", manager: "MMu", client: "Stadt Musterhausen" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.ABBR).toBe("P-2024-012");
    expect(e.dbRow.COMPANY_ID).toBe(7);
    expect(e.dbRow.PROJECT_STATUS_ID).toBe(10);
    expect(e.dbRow.PROJECT_TYPE_ID).toBe(20);
    expect(e.dbRow.PROJECT_MANAGER_ID).toBe(30);
    expect(e.dbRow.ADDRESS_ID).toBe(40);
  });

  it("flags missing required fields as errors (number, name, status, manager, client)", () => {
    const e = buildProjectEntry({ project_number: "", name: "" }, ctx);
    expect(e.ok).toBe(false);
    expect(e.messages.filter(m => m.level === "error").length).toBeGreaterThanOrEqual(2);
  });

  it("errors (not warns) when a required FK is provided but unresolvable", () => {
    const e = buildProjectEntry({ project_number: "P-9", name: "X", status: "Phantasie", manager: "ZZZ", client: "Unbekannt" }, ctx);
    expect(e.ok).toBe(false);
    expect(e.messages.filter(m => m.level === "error").length).toBe(3); // status, manager, client
  });

  it("treats project_type as optional (warning, still importable)", () => {
    const e = buildProjectEntry({ project_number: "P-9", name: "X", status: "in Bearbeitung", manager: "MMu", client: "Stadt Musterhausen", project_type: "Phantasie" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.PROJECT_TYPE_ID).toBeNull();
    expect(e.messages.some(m => m.level === "warn")).toBe(true);
  });
});

describe("buildPreview (project, dedup by number)", () => {
  const ctx = makeProjCtx();
  const headers = ["Projektnummer", "Projektname", "Status", "Projektleiter (Kürzel)", "Bauherr/Auftraggeber"];
  function preview(rows) {
    const parsed = { headers, rows: rows.map(r => ({
      "Projektnummer": r[0], "Projektname": r[1], "Status": "in Bearbeitung",
      "Projektleiter (Kürzel)": "MMu", "Bauherr/Auftraggeber": "Stadt Musterhausen",
    })) };
    return buildPreview({ domainKey: "project", parsed, mapping: null, ctx });
  }
  it("flags existing and in-file duplicate project numbers", () => {
    const pv = preview([
      ["P-2024-100", "Neu A"],   // ok (all required resolve)
      ["P-2023-001", "Alt"],     // duplicate vs existing
      ["P-2024-100", "Neu B"],   // duplicate in-file
    ]);
    expect(pv.summary.ok).toBe(1);
    expect(pv.summary.duplicate).toBe(2);
    expect(pv.summary.error).toBe(0);
  });
});

// ── parseAmountDE ─────────────────────────────────────────────────────────────
describe("parseAmountDE", () => {
  it("parses plain and grouped numbers", () => {
    expect(parseAmountDE("80000").value).toBe(80000);
    expect(parseAmountDE("80.000").value).toBe(80000);
    expect(parseAmountDE("1.234.567").value).toBe(1234567);
  });
  it("parses decimals (DE comma and EN dot)", () => {
    expect(parseAmountDE("80.000,50").value).toBe(80000.5);
    expect(parseAmountDE("1.234,56").value).toBe(1234.56);
    expect(parseAmountDE("80000.50").value).toBe(80000.5);
    expect(parseAmountDE("80,5").value).toBe(80.5);
  });
  it("handles currency symbol and blanks/garbage", () => {
    expect(parseAmountDE("80.000 €").value).toBe(80000);
    expect(parseAmountDE("").value).toBeNull();
    expect(parseAmountDE("abc").invalid).toBe(true);
  });
});

// ── Projekt-Honorar ───────────────────────────────────────────────────────────
function makeFeeCtx() {
  return {
    projectsByNumber: new Map([
      ["p-2024-012", { id: 1, name: "Neubau Kita", addressId: 40, contactId: 50 }],
      ["p-2024-013", { id: 2, name: "Sanierung",   addressId: 41, contactId: 51 }],
    ]),
    existingKeys: new Set(["p-2024-013"]), // hat schon Struktur
    defaults: {},
  };
}

describe("buildProjectFeeEntry", () => {
  const ctx = makeFeeCtx();

  it("resolves the project, parses the fee, defaults to Pauschal", () => {
    const e = buildProjectFeeEntry({ project_number: "P-2024-012", fee: "80.000,00" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.projectId).toBe(1);
    expect(e.dbRow.fee).toBe(80000);
    expect(e.dbRow.billingTypeId).toBe(1);
    expect(e.dbRow.addressId).toBe(40);
  });

  it("flags an unknown project as error", () => {
    const e = buildProjectFeeEntry({ project_number: "P-9999", fee: "1000" }, ctx);
    expect(e.ok).toBe(false);
  });

  it("flags an invalid fee as error", () => {
    const e = buildProjectFeeEntry({ project_number: "P-2024-012", fee: "achtzigtausend" }, ctx);
    expect(e.ok).toBe(false);
  });

  it("detects hourly billing", () => {
    const e = buildProjectFeeEntry({ project_number: "P-2024-012", fee: "5000", billing: "Stunden" }, ctx);
    expect(e.dbRow.billingTypeId).toBe(2);
  });
});

describe("buildPreview (project_fee)", () => {
  const ctx = makeFeeCtx();
  const headers = ["Projektnummer", "Honorarsumme (netto)"];
  function preview(rows) {
    const parsed = { headers, rows: rows.map(r => ({ "Projektnummer": r[0], "Honorarsumme (netto)": r[1] })) };
    return buildPreview({ domainKey: "project_fee", parsed, mapping: null, ctx });
  }
  it("ok for fresh project, duplicate when project already has structure, error when unknown", () => {
    const pv = preview([
      ["P-2024-012", "80000"],   // ok
      ["P-2024-013", "50000"],   // duplicate (already has structure)
      ["P-9999",     "1000"],    // error (unknown project)
    ]);
    expect(pv.summary.ok).toBe(1);
    expect(pv.summary.duplicate).toBe(1);
    expect(pv.summary.error).toBe(1);
  });
});

// ── Kontakte ──────────────────────────────────────────────────────────────────
function makeContactCtx() {
  return {
    addrByName: new Map([["stadt musterhausen", 40], ["acme gmbh", 41]]),
    salByName: new Map([["herr", 1], ["frau", 2]]),
    genders: { byName: new Map([["männlich", 10], ["maennlich", 10], ["weiblich", 11], ["divers", 12]]), default: 12 },
    existingKeys: new Set(["40|hans meier"]),
  };
}

describe("buildAutoMapping (contact)", () => {
  it("maps contact headers and aliases", () => {
    const map = buildAutoMapping(["Firma", "Anrede", "Vorname", "Nachname", "E-Mail"], "contact");
    expect(map.address).toBe("Firma");
    expect(map.salutation).toBe("Anrede");
    expect(map.first_name).toBe("Vorname");
    expect(map.email).toBe("E-Mail");
  });
});

describe("buildContactEntry", () => {
  const ctx = makeContactCtx();

  it("resolves address + salutation and derives gender from Anrede", () => {
    const e = buildContactEntry({ address: "Stadt Musterhausen", salutation: "Herr", first_name: "Thomas", last_name: "Beispiel" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.ADDRESS_ID).toBe(40);
    expect(e.dbRow.SALUTATION_ID).toBe(1);
    expect(e.dbRow.GENDER_ID).toBe(10);   // aus "Herr" abgeleitet
  });

  it("uses an explicit gender column when present", () => {
    const e = buildContactEntry({ address: "Acme GmbH", salutation: "Frau", first_name: "A", last_name: "B", gender: "divers" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.GENDER_ID).toBe(12);
  });

  it("errors on unknown address (required)", () => {
    const e = buildContactEntry({ address: "Unbekannt GmbH", salutation: "Herr", first_name: "X", last_name: "Y" }, ctx);
    expect(e.ok).toBe(false);
  });

  it("errors on missing salutation (required)", () => {
    const e = buildContactEntry({ address: "Acme GmbH", salutation: "", first_name: "X", last_name: "Y" }, ctx);
    expect(e.ok).toBe(false);
  });

  it("maps the extended fields (Funktion/Abteilung/Festnetz/Notizen) and the primary flag", () => {
    const e = buildContactEntry({
      address: "Acme GmbH", salutation: "Herr", first_name: "Thomas", last_name: "Beispiel",
      position: "Bauleiter", department: "Hochbau", phone: "+49 30 999", is_primary: "ja", notes: "Direktkontakt",
    }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.POSITION).toBe("Bauleiter");
    expect(e.dbRow.DEPARTMENT).toBe("Hochbau");
    expect(e.dbRow.PHONE).toBe("+49 30 999");
    expect(e.dbRow.IS_PRIMARY).toBe(1);
    expect(e.dbRow.NOTES).toBe("Direktkontakt");
    expect(e.display.position).toBe("Bauleiter");
  });

  it("defaults the primary flag to 0 when blank/falsey", () => {
    expect(buildContactEntry({ address: "Acme GmbH", salutation: "Herr", first_name: "A", last_name: "B" }, ctx).dbRow.IS_PRIMARY).toBe(0);
    expect(buildContactEntry({ address: "Acme GmbH", salutation: "Herr", first_name: "A", last_name: "B", is_primary: "nein" }, ctx).dbRow.IS_PRIMARY).toBe(0);
  });
});

describe("buildAutoMapping (contact, extended fields)", () => {
  it("maps the new columns; Festnetz → phone, Telefon/Mobil → mobile", () => {
    const map = buildAutoMapping(["Funktion", "Abteilung", "Telefon", "Festnetz", "Hauptkontakt", "Notizen"], "contact");
    expect(map.position).toBe("Funktion");
    expect(map.department).toBe("Abteilung");
    expect(map.mobile).toBe("Telefon");   // bestehende Semantik bleibt: „Telefon" → Mobil
    expect(map.phone).toBe("Festnetz");
    expect(map.is_primary).toBe("Hauptkontakt");
    expect(map.notes).toBe("Notizen");
  });
});

describe("buildPreview (contact)", () => {
  const ctx = makeContactCtx();
  const headers = ["Firma", "Anrede", "Vorname", "Nachname"];
  function preview(rows) {
    const parsed = { headers, rows: rows.map(r => ({ "Firma": r[0], "Anrede": r[1], "Vorname": r[2], "Nachname": r[3] })) };
    return buildPreview({ domainKey: "contact", parsed, mapping: null, ctx });
  }
  it("ok / duplicate (existing) / error (unknown address)", () => {
    const pv = preview([
      ["Stadt Musterhausen", "Herr", "Thomas", "Beispiel"], // ok
      ["Stadt Musterhausen", "Herr", "Hans", "Meier"],      // duplicate (existing 40|hans meier)
      ["Unbekannt GmbH",     "Herr", "X", "Y"],             // error
    ]);
    expect(pv.summary.ok).toBe(1);
    expect(pv.summary.duplicate).toBe(1);
    expect(pv.summary.error).toBe(1);
  });
});

// ── Anfangsbestände ───────────────────────────────────────────────────────────
function makeOpeningCtx() {
  return {
    byNumber: new Map([
      ["p-2024-012", { projectId: 1, name: "Neubau Kita", companyId: 7, addressId: 40, contactId: 50, contract: { ID: 200, INVOICE_ADDRESS_ID: 40, INVOICE_CONTACT_ID: 50 }, btStructures: [{ id: 301, revenue: 80000, extrasPercent: 0 }] }],
      ["p-booked",   { projectId: 4, name: "Schon gebucht", companyId: 7, addressId: 44, contactId: 54, contract: { ID: 204, INVOICE_ADDRESS_ID: 44, INVOICE_CONTACT_ID: 54 }, btStructures: [{ id: 304, revenue: 60000, extrasPercent: 0 }] }],
      ["p-nostruct", { projectId: 2, name: "Ohne Struktur", companyId: 7, addressId: 41, contactId: 51, contract: { ID: 201, INVOICE_ADDRESS_ID: 41, INVOICE_CONTACT_ID: 51 }, btStructures: [] }],
      ["p-nocontract", { projectId: 3, name: "Ohne Vertrag", companyId: 7, addressId: 42, contactId: 52, contract: null, btStructures: [{ id: 303, revenue: 50000, extrasPercent: 0 }] }],
    ]),
    existingKeys: new Set(["p-booked"]),
  };
}

describe("buildOpeningBalanceEntry", () => {
  const ctx = makeOpeningCtx();

  it("accepts a valid amount on a project with contract + structure", () => {
    const e = buildOpeningBalanceEntry({ project_number: "P-2024-012", amount: "30.000,00" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.amount).toBe(30000);
    expect(e.dbRow.contractId).toBe(200);
    expect(e.dbRow.btStructures).toHaveLength(1);
  });

  it("errors when the project is unknown", () => {
    expect(buildOpeningBalanceEntry({ project_number: "P-9999", amount: "1000" }, ctx).ok).toBe(false);
  });

  it("errors without a contract or without billable structure", () => {
    expect(buildOpeningBalanceEntry({ project_number: "p-nocontract", amount: "1000" }, ctx).ok).toBe(false);
    expect(buildOpeningBalanceEntry({ project_number: "p-nostruct", amount: "1000" }, ctx).ok).toBe(false);
  });

  it("errors on invalid amount or amount above the fee", () => {
    expect(buildOpeningBalanceEntry({ project_number: "P-2024-012", amount: "abc" }, ctx).ok).toBe(false);
    expect(buildOpeningBalanceEntry({ project_number: "P-2024-012", amount: "90000" }, ctx).ok).toBe(false); // > 80.000
  });

  it("accepts optional paid (≤ amount) and rejects paid > amount", () => {
    const ok = buildOpeningBalanceEntry({ project_number: "P-2024-012", amount: "30000", paid: "20000" }, ctx);
    expect(ok.ok).toBe(true);
    expect(ok.dbRow.paid).toBe(20000);
    expect(buildOpeningBalanceEntry({ project_number: "P-2024-012", amount: "30000", paid: "40000" }, ctx).ok).toBe(false);
  });
});

describe("buildPreview (opening_balance)", () => {
  const ctx = makeOpeningCtx();
  const headers = ["Projektnummer", "Bereits berechnet (netto)", "Belegdatum (optional)"];
  function preview(rows) {
    const parsed = { headers, rows: rows.map(r => ({ "Projektnummer": r[0], "Bereits berechnet (netto)": r[1], "Belegdatum (optional)": r[2] ?? "" })) };
    return buildPreview({ domainKey: "opening_balance", parsed, mapping: null, ctx });
  }
  it("ok / duplicate (already booked) / error (unknown)", () => {
    const pv = preview([
      ["P-2024-012", "30000", "31.12.2025"], // ok
      ["p-booked",   "10000", "31.12.2025"], // duplicate (existing booked)
      ["P-9999",     "1000",  "31.12.2025"], // error
    ]);
    expect(pv.summary.ok).toBe(1);
    expect(pv.summary.duplicate).toBe(1);
    expect(pv.summary.error).toBe(1);
  });

  it("warnt ohne Belegdatum — sonst steht der Beleg datumslos in den Listen", () => {
    const pv = preview([["P-2024-012", "30000"]]);
    expect(pv.summary.warning).toBe(1);
    expect(pv.rows[0].messages.map(m => m.text).join()).toContain("datumslos");
  });

  it("uebernimmt ein deutsches Belegdatum als ISO-Datum", () => {
    const e = buildOpeningBalanceEntry({ project_number: "P-2024-012", amount: "30000", doc_date: "31.12.2025" }, makeOpeningCtx());
    expect(e.dbRow.docDate).toBe("2025-12-31");
  });
});

// ── Kosten-Anfangsbestände ────────────────────────────────────────────────────
function makeOpeningCostCtx() {
  return {
    byNumber: new Map([
      ["p-2024-012", { projectId: 1, structureId: 301 }],
      ["p-nostruct", { projectId: 2, structureId: null }],
      ["p-hadcost",  { projectId: 3, structureId: 303 }],
    ]),
    existingKeys: new Set(["p-hadcost"]),
  };
}

describe("buildOpeningCostEntry", () => {
  const ctx = makeOpeningCostCtx();

  it("accepts a cost on a known project and targets the leaf structure", () => {
    const e = buildOpeningCostEntry({ project_number: "P-2024-012", cost: "45.000,00" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.cost).toBe(45000);
    expect(e.dbRow.structureId).toBe(301);
  });

  it("is importable with a warning when the project has no structure (project-level cost)", () => {
    const e = buildOpeningCostEntry({ project_number: "p-nostruct", cost: "1000" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.structureId).toBeNull();
    expect(e.messages.some(m => m.level === "warn")).toBe(true);
  });

  it("errors on unknown project or invalid cost", () => {
    expect(buildOpeningCostEntry({ project_number: "P-9999", cost: "1000" }, ctx).ok).toBe(false);
    expect(buildOpeningCostEntry({ project_number: "P-2024-012", cost: "0" }, ctx).ok).toBe(false);
    expect(buildOpeningCostEntry({ project_number: "P-2024-012", cost: "abc" }, ctx).ok).toBe(false);
  });
});

describe("buildPreview (opening_cost)", () => {
  const ctx = makeOpeningCostCtx();
  const headers = ["Projektnummer", "Bereits angefallene Kosten (netto)"];
  function preview(rows) {
    const parsed = { headers, rows: rows.map(r => ({ "Projektnummer": r[0], "Bereits angefallene Kosten (netto)": r[1] })) };
    return buildPreview({ domainKey: "opening_cost", parsed, mapping: null, ctx });
  }
  it("ok / duplicate (cost already imported) / error (unknown)", () => {
    const pv = preview([
      ["P-2024-012", "45000"], // ok
      ["p-hadcost",  "10000"], // duplicate (existing imported cost)
      ["P-9999",     "1000"],  // error
    ]);
    expect(pv.summary.ok).toBe(1);
    expect(pv.summary.duplicate).toBe(1);
    expect(pv.summary.error).toBe(1);
  });
});


// ── Projekte inkl. Struktur (kombiniert) ─────────────────────────────────────
// Der Bereich liest Projekt UND Leistungsstruktur aus EINER Datei. Die Zeile
// mit leerer Gliederung ist das Projekt — das ist das einzige Kennzeichen, und
// entsprechend genau muss es geprueft sein.
describe("buildPreview (project_full)", () => {
  const KOPF = ["Projekt", "Projektadresse", "Status", "PL", "Projekttyp", "Gliederung",
                "Kürzel", "Bezeichnung", "Abrechnungsart", "Honorar netto", "Leistungsstand %", "Kosten"];

  function makeCtx(ueber = {}) {
    return {
      companyId: 1,
      statusByName: new Map([["inbearbeitung", 1], ["abgeschlossen", 2]]),
      typeByName:   new Map([["neubau", 7]]),
      empByName:    new Map([["mmu", 10]]),
      addrByName:   new Map([["stadt musterhausen", 20]]),
      existingKeys: new Set(),
      defaults: { default_project_status_id: "1" },
      existingIds: new Map(),
      // Honorar-Stammdaten: Schluessel wie katalogKey sie bildet (ohne
      // Unterstriche). 2013_34_A ist §34 HOAI 2013 Anlage A — "Gebaeude".
      feeMasterByAbbr: new Map([["201334a", 5]]),
      zoneByMaster: new Map([[5, new Map([[1, 51], [2, 52], [3, 53], [4, 54], [5, 55]])]]),
      phaseByMaster: new Map([[5, new Map([[1, 501], [2, 502], [3, 503]])]]),
      ...ueber,
    };
  }

  function preview(zeilen, ctx = makeCtx()) {
    const rows = zeilen.map((z) => Object.fromEntries(KOPF.map((h, i) => [h, z[i] ?? ""])));
    return buildPreview({ domainKey: "project_full", parsed: { headers: KOPF, rows }, mapping: null, ctx });
  }

  const PROJEKT = ["P-1", "Stadt Musterhausen", "in Bearbeitung", "MMu", "Neubau", "", "P-1", "Kita Sonnenschein", "", "", "", ""];

  it("erkennt die Zeile mit leerer Gliederung als Projekt", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1",   "LP1-4", "Vorentwurf",  "Pauschal", "12000", "50", ""],
      ["P-1", "", "", "", "", "1.1", "LP1",   "Grundlagen",  "Pauschal", "5000",  "80", "300"],
      ["P-1", "", "", "", "", "1.2", "LP2",   "Vorplanung",  "Pauschal", "7000",  "20", ""],
    ]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[0]._dbRow.istProjektzeile).toBe(true);
    expect(pv.rows[0]._dbRow.statusId).toBe(1);
    expect(pv.rows[0]._dbRow.managerId).toBe(10);
    expect(pv.rows[0]._dbRow.addressId).toBe(20);
    expect(pv.rows[1]._dbRow.istProjektzeile).toBe(false);
  });

  it("baut den Baum ueber die Gliederung und erkennt Blaetter", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1",   "A", "", "Pauschal", "12000", "", ""],
      ["P-1", "", "", "", "", "1.1", "B", "", "Pauschal", "5000",  "", ""],
      ["P-1", "", "", "", "", "1.2", "C", "", "Pauschal", "7000",  "", ""],
    ]);
    const [, a, b, c] = pv.rows;
    expect(a._dbRow.parentKey).toBe(null);
    expect(b._dbRow.parentKey).toBe("1");
    expect(c._dbRow.parentKey).toBe("1");
    expect(a._dbRow.isLeaf).toBe(false);
    expect(b._dbRow.isLeaf).toBe(true);
    // Honorar am Knoten wird verworfen — plan&simple rechnet von unten hoch.
    expect(a._dbRow.revenue).toBe(0);
    expect(b._dbRow.revenue).toBe(5000);
  });

  it("weist ein Projekt ohne Projektzeile vollstaendig ab", () => {
    const pv = preview([
      ["P-9", "", "", "", "", "1",   "A", "", "Pauschal", "1000", "", ""],
      ["P-9", "", "", "", "", "1.1", "B", "", "Pauschal", "1000", "", ""],
    ]);
    expect(pv.summary.error).toBe(2);
    expect(pv.rows[0].messages.some((m) => /keine Projektzeile/.test(m.text))).toBe(true);
  });

  // Die Projektzeile IST da, aber sie hat einen Fehler. Vorher meldete der
  // Import fuer die ganze Gruppe "hat keine Projektzeile" — bei der
  // wiko-Uebernahme suchten deshalb 177 Projekte lang alle an der falschen
  // Stelle, dabei stand nur ein Status nicht im Katalog.
  it("unterscheidet eine FEHLENDE von einer FEHLERHAFTEN Projektzeile", () => {
    const pv = preview([
      ["P-1", "", "Phantasiestatus", "MMu", "", "", "P-1", "Kita", "", "", "", ""],
      ["P-1", "", "", "", "", "1", "A", "", "Pauschal", "1000", "", ""],
    ]);
    expect(pv.summary.error).toBe(2);
    // Die Projektzeile nennt ihren eigenen Grund …
    expect(pv.rows[0].messages.some((m) => /Status .* gibt es nicht/.test(m.text))).toBe(true);
    // … und verweist nicht faelschlich auf eine fehlende Zeile.
    expect(pv.rows[0].messages.some((m) => /keine Projektzeile/.test(m.text))).toBe(false);
    // Die Strukturzeile zeigt dorthin, statt einen falschen Grund zu nennen.
    expect(pv.rows[1].messages.some((m) => m.text.includes("Projektzeile (Zeile 2) ist fehlerhaft"))).toBe(true);
  });

  it("nennt die erlaubten Statuswerte", () => {
    const pv = preview([["P-1", "", "Phantasiestatus", "MMu", "", "", "P-1", "Kita", "", "", "", ""]],
      { ...makeCtx(), statusNamen: ["in Bearbeitung", "abgeschlossen"] });
    expect(pv.rows[0].messages.some((m) => /erlaubt sind: in Bearbeitung, abgeschlossen/.test(m.text))).toBe(true);
  });

  it("weist zwei Projektzeilen ab", () => {
    const pv = preview([PROJEKT, PROJEKT]);
    expect(pv.summary.error).toBe(2);
    expect(pv.rows[0].messages.some((m) => /nur eine geben/.test(m.text))).toBe(true);
  });

  // Nur die Projektzeile zu ueberspringen wuerde die Strukturzeilen heimatlos
  // zuruecklassen — deshalb wird das GANZE Projekt zur Dublette.
  it("markiert ein bereits vorhandenes Projekt samt Struktur als Dublette", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1", "A", "", "Pauschal", "1000", "", ""],
    ], makeCtx({ existingKeys: new Set(["p-1"]) }));
    expect(pv.summary.duplicate).toBe(2);
    expect(pv.summary.ok).toBe(0);
  });

  it("meldet eine fehlende Elternzeile und kippt das ganze Projekt", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1.1", "B", "", "Pauschal", "1000", "", ""],
    ]);
    expect(pv.summary.error).toBe(2);
    expect(pv.rows[1].messages.some((m) => /fehlt in der Datei/.test(m.text))).toBe(true);
  });

  it("verlangt die Abrechnungsart nur an Blaettern", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1",   "A", "", "",         "", "", ""],
      ["P-1", "", "", "", "", "1.1", "B", "", "Pauschal", "1000", "", ""],
    ]);
    expect(pv.summary.error).toBe(0);
  });

  // wiko nennt Pauschal "Leistungsstand" und Stunden "Nachweis".
  it("erkennt beide Vokabulare der Abrechnungsart", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1", "A", "", "Leistungsstand", "1000", "", ""],
      ["P-1", "", "", "", "", "2", "B", "", "Nachweis",       "",     "", ""],
      ["P-1", "", "", "", "", "3", "C", "", "Stunden",        "",     "", ""],
    ]);
    expect(pv.rows[1]._dbRow.billingTypeId).toBe(1);
    expect(pv.rows[2]._dbRow.billingTypeId).toBe(2);
    expect(pv.rows[3]._dbRow.billingTypeId).toBe(2);
  });

  it("merkt einen unbekannten Projekttyp zum Anlegen vor, aber keinen unbekannten Bauherrn", () => {
    const pv = preview([
      ["P-2", "Firma Unbekannt", "in Bearbeitung", "MMu", "Umbau", "", "P-2", "Projekt", "", "", "", ""],
    ]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[0]._dbRow.typeNew).toBe("Umbau");
    expect(pv.rows[0]._dbRow.addressId).toBe(null);
    expect(pv.rows[0].messages.some((m) => /Bauherr/.test(m.text))).toBe(true);
  });

  it("nimmt den Status aus der Vorbelegung, wenn die Spalte leer ist", () => {
    const pv = preview([["P-3", "", "", "MMu", "", "", "P-3", "Projekt", "", "", "", ""]]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[0]._dbRow.statusId).toBe(1);
  });

  it("weist einen unbekannten Status ab statt still die Vorbelegung zu nehmen", () => {
    const pv = preview([["P-4", "", "Phantasie", "MMu", "", "", "P-4", "Projekt", "", "", "", ""]]);
    expect(pv.summary.error).toBe(1);
  });

  // Die haeufigste Art, eine Zahl zu verlieren: die CSV wird in Excel
  // geoeffnet, und die deutsche Einstellung liest "10.03" als 10. Maerz.
  // Gespeichert als .xlsx kommt bei uns eine Datumszelle an. "Keine Zahl" ist
  // dann zwar richtig, aber unbrauchbar — niemand kommt von da auf Excel.
  it("nennt ein Datum im Zahlenfeld beim Namen", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1", "A", "", "Pauschal", "1000", "2026-03-10", ""],
    ]);
    const hinweis = pv.rows[1].messages.find((m) => /Leistungsstand/.test(m.text));
    expect(hinweis).toBeTruthy();
    expect(hinweis.text).toMatch(/ist ein Datum/);
    expect(hinweis.text).toMatch(/Excel/);
    expect(hinweis.text).toMatch(/CSV direkt hochladen|als Text/);
    // Die Zeile kommt trotzdem — nur ohne Leistungsstand.
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[1]._dbRow.progressPercent).toBe(0);
  });

  it("laesst eine echte Zahl mit Punkt unangetastet", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1", "A", "", "Pauschal", "1000", "10.03", ""],
    ]);
    expect(pv.rows[1]._dbRow.progressPercent).toBe(10.03);
  });

  it("uebernimmt Leistungsstand und Kosten je Element", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1", "A", "", "Pauschal", "10000", "40", "1500"],
    ]);
    expect(pv.rows[1]._dbRow.progressPercent).toBe(40);
    expect(pv.rows[1]._dbRow.costs).toBe(1500);
  });

  // Eine Honorarminderung ist ein echter Vorgang und steht bei einer
  // Datenuebernahme als negative Position in der Quelle. Sie abzuweisen hiesse,
  // vollstaendige Projekte draussen zu lassen, damit eine Zahl schoen bleibt.
  // SQL Server schreibt eine leere Zelle beim CSV-Export als das WORT "NULL".
  // Im wiko-Projektexport waren das 78.086 Zellen. Ungefiltert waere eine
  // Projektzeile ohne Gliederung ein Strukturknoten namens "NULL" — also
  // genau kein Projekt.
  it("liest das Wort NULL als leere Zelle", () => {
    const pv = preview([
      ["P-1", "NULL", "in Bearbeitung", "MMu", "NULL", "NULL", "P-1", "Kita", "NULL", "NULL", "NULL", "NULL"],
      ["P-1", "NULL", "NULL", "NULL", "NULL", "1", "A", "NULL", "Pauschal", "1000", "NULL", "NULL"],
    ]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[0]._dbRow.istProjektzeile).toBe(true);
    expect(pv.rows[0]._dbRow.addressId).toBe(null);
    expect(pv.rows[0]._dbRow.typeNew).toBe(null);
    // Ohne die Behandlung hiesse der Knoten "NULL" statt "A".
    expect(pv.rows[1]._dbRow.nameLong).toBe("A");
    expect(pv.rows[1]._dbRow.progressPercent).toBe(0);
  });

  it("laesst negatives Honorar zu, weist aber darauf hin", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1", "A", "", "Pauschal", "-2500", "", ""],
    ]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[1]._dbRow.revenue).toBe(-2500);
    expect(pv.rows[1].messages.some((m) => m.level === "warn" && /negativ/.test(m.text))).toBe(true);
  });

  // wiko kann EIN Element an mehrere Leistungsphasen haengen — der Export
  // liefert dann mehrere Zeilen mit derselben Gliederung.
  it("legt ein Element mit mehreren Leistungsphasen nur einmal an", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1", "A", "Sammelposition", "Pauschal", "9000", "", ""],
      ["P-1", "", "", "", "", "1", "A", "Sammelposition", "Pauschal", "9000", "", ""],
      ["P-1", "", "", "", "", "1", "A", "Sammelposition", "Pauschal", "9000", "", ""],
    ]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[1]._dbRow.istZusatzzeile).toBeFalsy();
    expect(pv.rows[2]._dbRow.istZusatzzeile).toBe(true);
    expect(pv.rows[3]._dbRow.istZusatzzeile).toBe(true);
    expect(pv.rows[1].messages.some((m) => /3 Leistungsphasen/.test(m.text))).toBe(true);
  });

  // Widersprechen sich die Zeilen dagegen in den Elementdaten, weiss niemand,
  // welche gilt — das bleibt ein Fehler.
  it("weist widersprechende Zeilen mit gleicher Gliederung ab", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1", "A", "", "Pauschal", "9000", "", ""],
      ["P-1", "", "", "", "", "1", "B", "", "Pauschal", "4000", "", ""],
    ]);
    expect(pv.summary.error).toBe(3);
    expect(pv.rows[2].messages.some((m) => /widersprechen/.test(m.text))).toBe(true);
  });

  // ── Kalkulation ───────────────────────────────────────────────────────────
  // Eigene Kopfzeile: die Kalkulation haengt hinten an den 28 Spalten des
  // wiko-Exports, die kurze KOPF-Liste oben reicht dafuer nicht.
  const KOPF_KALK = ["ID Vorsystem", "Projekt", "Projektadresse", "Status", "PL", "Projekttyp",
    "Gliederung", "Kürzel", "Bezeichnung", "Abrechnungsart", "Honorar netto", "Nebenkosten %",
    "Kalkulation ID Vorsystem", "Leistungsbild Kürzel", "HOAI-Kürzel", "HOAI-Bezeichnung",
    "Zone", "Zone %", "K0", "K1", "K2", "K3", "K4", "LPH", "KX", "LPH Prozent",
    "Leistungsstand %", "Kosten"];

  function previewKalk(zeilen, ctx = makeCtx()) {
    const rows = zeilen.map((z) => Object.fromEntries(KOPF_KALK.map((h, i) => [h, z[i] ?? ""])));
    return buildPreview({ domainKey: "project_full", parsed: { headers: KOPF_KALK, rows }, mapping: null, ctx });
  }

  // Projektzeile und ein Knoten mit Kalkulation, in der Spaltenfolge des Exports.
  const P_KALK = ["1", "P-1", "", "in Bearbeitung", "MMu", "", "", "P-1", "Kita", "", "", "",
                  "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
  const K_ZEILE = (ueber = {}) => {
    const z = ["2", "P-1", "", "", "", "", "1", "A", "Grundlagen", "Pauschal", "10000", "",
               "131", "34_13_A", "34_13_A1", "Gebäude", "3", "50",
               "", "", "400000", "", "", "2", "3", "7", "", ""];
    for (const [i, v] of Object.entries(ueber)) z[i] = v;
    return z;
  };

  // wiko schreibt <Paragraf>_<Jahr>[_<Variante>], plan&simple
  // <Jahr>_<Paragraf>[_<Variante>]. Dieselben Leistungsbilder, andere Folge.
  it("uebersetzt das wiko-Leistungsbild in den p&s-Katalog", () => {
    const pv = previewKalk([P_KALK, K_ZEILE()]);
    const k = pv.rows[1]._dbRow.kalk;
    expect(k).toBeTruthy();
    expect(k.feeMasterId).toBe(5);
    expect(k.zoneId).toBe(53);
    expect(k.zonePercent).toBe(50);
    expect(k.phaseId).toBe(502);
    expect(k.phasePercent).toBe(7);
    expect(k.ref).toBe("131");
  });

  // K0..K4 sind die ANRECHENBAREN BAUKOSTEN, aus denen sich das Honorar erst
  // ergibt — nicht das Honorar selbst.
  it("liest K0..K4 als anrechenbare Baukosten", () => {
    const pv = previewKalk([P_KALK, K_ZEILE()]);
    expect(pv.rows[1]._dbRow.kalk.k).toEqual([0, 0, 400000, 0, 0]);
  });

  it("laesst die Kalkulation aus, wenn das Leistungsbild unbekannt ist — das Element bleibt", () => {
    const pv = previewKalk([P_KALK, K_ZEILE({ 13: "99_99_Z" })]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[1]._dbRow.kalk).toBe(null);
    expect(pv.rows[1]._dbRow.revenue).toBe(10000);
    expect(pv.rows[1].messages.some((m) => /Leistungsbild/.test(m.text))).toBe(true);
  });

  it("warnt bei einer Honorarzone, die es beim Leistungsbild nicht gibt", () => {
    const pv = previewKalk([P_KALK, K_ZEILE({ 16: "9" })]);
    expect(pv.rows[1]._dbRow.kalk.zoneId).toBe(null);
    expect(pv.rows[1].messages.some((m) => /Honorarzone/.test(m.text))).toBe(true);
  });

  // Eine von mehreren Phasen willkuerlich zu waehlen waere schlimmer als
  // keine: die Zahl saehe gepflegt aus und waere geraten.
  it("laesst die Phase offen, wenn ein Element an mehreren haengt", () => {
    const pv = previewKalk([P_KALK, K_ZEILE(), K_ZEILE({ 23: "3" })]);
    expect(pv.summary.error).toBe(0);
    expect(pv.rows[1]._dbRow.kalk.feeMasterId).toBe(5);   // Kalkulation bleibt
    expect(pv.rows[1]._dbRow.kalk.phaseId).toBe(null);    // die Phase nicht
    expect(pv.rows[2]._dbRow.istZusatzzeile).toBe(true);
  });

  it("begrenzt einen Leistungsstand ausserhalb 0-100", () => {
    const pv = preview([
      PROJEKT,
      ["P-1", "", "", "", "", "1", "A", "", "Pauschal", "10000", "140", ""],
    ]);
    expect(pv.rows[1]._dbRow.progressPercent).toBe(100);
    expect(pv.rows[1].messages.some((m) => /ausserhalb|außerhalb/.test(m.text))).toBe(true);
  });
});
