"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Nummernkreis nach einem Belegimport anheben.
//
// Ein Beleg mit eigener Nummer laeuft an der Nummernvergabe vorbei, der
// Zaehler bleibt stehen — und es gibt nirgends einen Unique-Index auf
// Belegnummern. Bei Belegen aus dem laufenden Jahr vergibt plan&simple danach
// eine Nummer, die es schon gibt, und niemand merkt es.
//
// Der Parser darf dabei NICHT raten: eine falsch gedeutete Nummer hebt den
// Zaehler in den Unsinn, und zurueck geht es nicht.
// ─────────────────────────────────────────────────────────────────────────────

const { parseDocumentNumber, planeBump } = require("../services/numberRangeBump");

describe("parseDocumentNumber", () => {
  // Fall A: Praefix – Jahr – Zaehler
  it.each([
    ["RE-2025-0044", 2025, 44],
    ["AR-2025-7",    2025, 7],
    ["2025/123",     2025, 123],
    ["2025-0001",    2025, 1],
    ["R 2019 42",    2019, 42],
  ])("liest %s als %i/%i", (roh, jahr, zaehler) => {
    expect(parseDocumentNumber(roh)).toEqual({ jahr, zaehler });
  });

  // Fall B: Jahreszahl irgendwo, Zaehler ist die letzte Ziffernfolge
  it("findet das Jahr auch mitten in der Nummer", () => {
    expect(parseDocumentNumber("R2025/0123")).toEqual({ jahr: 2025, zaehler: 123 });
    expect(parseDocumentNumber("2025-RE-123")).toEqual({ jahr: 2025, zaehler: 123 });
  });

  // Fall C: gar keine Jahreszahl — durchlaufende Nummerierung
  it("nimmt das Jahr des Belegdatums, wenn die Nummer keines traegt", () => {
    expect(parseDocumentNumber("10234", 2024)).toEqual({ jahr: 2024, zaehler: 10234 });
  });

  it("deutet eine Nummer ohne Jahr und ohne Belegdatum NICHT", () => {
    expect(parseDocumentNumber("10234")).toBeNull();
  });

  it("deutet eine Nummer ohne jede Ziffer NICHT", () => {
    expect(parseDocumentNumber("Schlussrechnung", 2025)).toBeNull();
    expect(parseDocumentNumber("", 2025)).toBeNull();
    expect(parseDocumentNumber(null, 2025)).toBeNull();
  });

  // Der Deckel. Ohne ihn hebt eine verstuemmelte Kennung den Zaehler in den
  // Unsinn — und senken kann man ihn nicht mehr.
  it("verwirft einen unsinnig hohen Zaehler", () => {
    expect(parseDocumentNumber("2019004711234", 2025)).toBeNull();
    expect(parseDocumentNumber("RE-2025-1000000")).toBeNull();
  });

  // Ein Storno traegt in plan&simple das Praefix S- vor der Originalnummer.
  it("liest eine Stornonummer wie ihr Original", () => {
    expect(parseDocumentNumber("S-RE-2025-0044")).toEqual({ jahr: 2025, zaehler: 44 });
  });
});

describe("planeBump", () => {
  const beleg = (companyId, nummer, datum) => ({ companyId, nummer, datum });

  it("hebt je Firma und Jahr auf das Maximum plus eins", () => {
    const { anheben } = planeBump([
      beleg(1, "RE-2025-0044", "2025-11-15"),
      beleg(1, "RE-2025-0109", "2025-12-01"),
      beleg(1, "RE-2024-0300", "2024-06-01"),
    ]);
    expect(anheben).toEqual([
      { companyId: 1, jahr: 2024, minNext: 301 },
      { companyId: 1, jahr: 2025, minNext: 110 },
    ]);
  });

  it("haelt Firmen auseinander", () => {
    const { anheben } = planeBump([
      beleg(1, "RE-2025-0044", "2025-11-15"),
      beleg(2, "RE-2025-0900", "2025-11-15"),
    ]);
    expect(anheben).toEqual([
      { companyId: 1, jahr: 2025, minNext: 45 },
      { companyId: 2, jahr: 2025, minNext: 901 },
    ]);
  });

  it("meldet ungedeutete Nummern namentlich, statt sie zu raten", () => {
    const { anheben, ungedeutet } = planeBump([
      beleg(1, "RE-2025-0044", "2025-11-15"),
      beleg(1, "Sammelbeleg",  "2025-11-15"),
      beleg(1, "ohne Nummer",  "2025-11-15"),
    ]);
    expect(anheben).toEqual([{ companyId: 1, jahr: 2025, minNext: 45 }]);
    expect(ungedeutet).toEqual(["Sammelbeleg", "ohne Nummer"]);
  });

  // Durchlaufende Nummerierung: die naechste Nummer faellt im LAUFENDEN Jahr
  // an, also muss der Zaehler dort ueber allem liegen, was verbraucht ist.
  it("hebt bei durchlaufender Nummerierung zusaetzlich das laufende Jahr", () => {
    const heuer = new Date().getFullYear();
    const { anheben } = planeBump([
      beleg(1, "10234", "2019-03-01"),
      beleg(1, "10999", "2021-07-01"),
    ]);
    const laufend = anheben.find((a) => a.jahr === heuer);
    expect(laufend).toMatchObject({ companyId: 1, minNext: 11000, wegenDurchlaufend: true });
  });

  it("ignoriert Belege ohne Firma oder ohne Nummer", () => {
    const { anheben } = planeBump([
      { companyId: null, nummer: "RE-2025-0044", datum: "2025-01-01" },
      { companyId: 1, nummer: "", datum: "2025-01-01" },
    ]);
    expect(anheben).toEqual([]);
  });
});
