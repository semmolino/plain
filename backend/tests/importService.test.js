"use strict";

const XLSX = require("xlsx");
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

// Buffer aus Array-of-Arrays bauen (simuliert hochgeladene Datei).
function xlsxBuffer(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
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
  it("reads headers and rows from a sheet", () => {
    const buf = xlsxBuffer([
      ["Name 1 (Firma/Nachname)", "PLZ", "Ort"],
      ["Acme GmbH", "10115", "Berlin"],
    ]);
    const { headers, rows } = parseBuffer(buf);
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
    existingKeys: new Set(["mail:alt@buero.de", "short:abc"]),
  };
}

describe("buildAutoMapping (employee)", () => {
  it("maps employee headers and aliases", () => {
    const map = buildAutoMapping(["Kürzel", "Vorname", "Nachname", "Geschlecht", "E-Mail", "Personalnummer"], "employee");
    expect(map.short_name).toBe("Kürzel");
    expect(map.first_name).toBe("Vorname");
    expect(map.gender).toBe("Geschlecht");
    expect(map.email).toBe("E-Mail");
    expect(map.personnel_number).toBe("Personalnummer");
  });
});

describe("buildEmployeeEntry", () => {
  const ctx = makeEmpCtx();

  it("accepts a valid row and resolves gender + date", () => {
    const e = buildEmployeeEntry({ short_name: "MMu", first_name: "Maria", last_name: "Muster", gender: "weiblich", entry_date: "01.03.2022" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.GENDER_ID).toBe(1);
    expect(e.dbRow.ENTRY_DATE).toBe("2022-03-01");
    expect(e.dbRow.ACTIVE).toBe(1);
    expect(e.matchKey).toContain("short:mmu");
  });

  it("defaults gender when blank (neutral default present)", () => {
    const e = buildEmployeeEntry({ short_name: "X", first_name: "A", last_name: "B", gender: "" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.GENDER_ID).toBe(3);
  });

  it("flags missing required fields", () => {
    const e = buildEmployeeEntry({ short_name: "", first_name: "", last_name: "B", gender: "w" }, ctx);
    expect(e.ok).toBe(false);
    expect(e.messages.filter(m => m.level === "error").length).toBeGreaterThanOrEqual(2);
  });

  it("flags an unknown gender", () => {
    const e = buildEmployeeEntry({ short_name: "Y", first_name: "A", last_name: "B", gender: "Hamster" }, ctx);
    expect(e.ok).toBe(false);
  });

  it("warns (not errors) on invalid date and bad email", () => {
    const e = buildEmployeeEntry({ short_name: "Z", first_name: "A", last_name: "B", gender: "m", email: "noatsign", entry_date: "kaputt" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.messages.some(m => m.level === "warn")).toBe(true);
  });
});

describe("buildPreview (employee, multi-key dedup)", () => {
  const ctx = makeEmpCtx();
  const headers = ["Kürzel", "Vorname", "Nachname", "Geschlecht", "E-Mail"];

  function preview(dataRows) {
    const parsed = {
      headers,
      rows: dataRows.map(r => ({ "Kürzel": r[0], "Vorname": r[1], "Nachname": r[2], "Geschlecht": r[3], "E-Mail": r[4] ?? "" })),
    };
    return buildPreview({ domainKey: "employee", parsed, mapping: null, ctx });
  }

  it("detects duplicates by mail OR short_name, plus in-file", () => {
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
    expect(map.name_long).toBe("Projektname");
    expect(map.manager).toBe("Projektleiter (Kürzel)");
    expect(map.client).toBe("Bauherr/Auftraggeber");
  });
});

describe("buildProjectEntry", () => {
  const ctx = makeProjCtx();

  it("keeps the project number, resolves FKs and sets company", () => {
    const e = buildProjectEntry({ project_number: "P-2024-012", name_long: "Neubau Kita", status: "in Bearbeitung", project_type: "Neubau", manager: "MMu", client: "Stadt Musterhausen" }, ctx);
    expect(e.ok).toBe(true);
    expect(e.dbRow.NAME_SHORT).toBe("P-2024-012");
    expect(e.dbRow.COMPANY_ID).toBe(7);
    expect(e.dbRow.PROJECT_STATUS_ID).toBe(10);
    expect(e.dbRow.PROJECT_TYPE_ID).toBe(20);
    expect(e.dbRow.PROJECT_MANAGER_ID).toBe(30);
    expect(e.dbRow.ADDRESS_ID).toBe(40);
  });

  it("flags missing required fields as errors (number, name, status, manager, client)", () => {
    const e = buildProjectEntry({ project_number: "", name_long: "" }, ctx);
    expect(e.ok).toBe(false);
    expect(e.messages.filter(m => m.level === "error").length).toBeGreaterThanOrEqual(2);
  });

  it("errors (not warns) when a required FK is provided but unresolvable", () => {
    const e = buildProjectEntry({ project_number: "P-9", name_long: "X", status: "Phantasie", manager: "ZZZ", client: "Unbekannt" }, ctx);
    expect(e.ok).toBe(false);
    expect(e.messages.filter(m => m.level === "error").length).toBe(3); // status, manager, client
  });

  it("treats project_type as optional (warning, still importable)", () => {
    const e = buildProjectEntry({ project_number: "P-9", name_long: "X", status: "in Bearbeitung", manager: "MMu", client: "Stadt Musterhausen", project_type: "Phantasie" }, ctx);
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
  const headers = ["Projektnummer", "Bereits berechnet (netto)"];
  function preview(rows) {
    const parsed = { headers, rows: rows.map(r => ({ "Projektnummer": r[0], "Bereits berechnet (netto)": r[1] })) };
    return buildPreview({ domainKey: "opening_balance", parsed, mapping: null, ctx });
  }
  it("ok / duplicate (already booked) / error (unknown)", () => {
    const pv = preview([
      ["P-2024-012", "30000"], // ok
      ["p-booked",   "10000"], // duplicate (existing booked)
      ["P-9999",     "1000"],  // error
    ]);
    expect(pv.summary.ok).toBe(1);
    expect(pv.summary.duplicate).toBe(1);
    expect(pv.summary.error).toBe(1);
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
