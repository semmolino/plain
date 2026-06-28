"use strict";

const XLSX = require("xlsx");
const {
  normHeader,
  parseBuffer,
  buildAutoMapping,
  buildPreview,
  buildAddressEntry,
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
