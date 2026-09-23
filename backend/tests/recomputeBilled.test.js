"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// recomputeBilledByStructure — die Rueckrechnung aus den Rohzeilen.
//
// Sie ist die Klammer des Belegimports: der Import setzt die Aggregate am Ende
// EINMAL aus dieser Funktion, statt sie je Beleg fortzuschreiben, und das
// Ruecksetzen rechnet mit derselben Funktion zurueck. Damit haengt das
// Ergebnis nicht davon ab, wer in der Zwischenzeit sonst gebucht hat.
//
// Bis 09/2026 war sie weder exportiert noch geprueft, obwohl getPhases und
// savePhases sich auf sie stuetzen. Diese Tests halten die drei Eigenschaften
// fest, auf die sich der Import verlaesst.
// ─────────────────────────────────────────────────────────────────────────────

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { recomputeBilledByStructure } = require("../services/finalInvoices");

const TENANT = 7;

/** @param {Array} belege  [{id, contractId, statusId, positionen:[[strukturId, netto, extras]]}] */
function bestand(belege = [], abschlaege = []) {
  const invoice = [], invStruct = [], adv = [], advStruct = [];
  for (const b of belege) {
    invoice.push({ ID: b.id, TENANT_ID: TENANT, CONTRACT_ID: b.contractId, STATUS_ID: b.statusId });
    for (const [sid, netto, extras = 0] of b.positionen || []) {
      invStruct.push({ ID: invStruct.length + 1, TENANT_ID: TENANT, INVOICE_ID: b.id,
        STRUCTURE_ID: sid, AMOUNT_NET: netto, AMOUNT_EXTRAS_NET: extras });
    }
  }
  for (const a of abschlaege) {
    adv.push({ ID: a.id, TENANT_ID: TENANT, CONTRACT_ID: a.contractId, STATUS_ID: a.statusId });
    for (const [sid, netto, extras = 0] of a.positionen || []) {
      advStruct.push({ ID: advStruct.length + 1, TENANT_ID: TENANT, ADVANCE_INVOICE_ID: a.id,
        STRUCTURE_ID: sid, AMOUNT_NET: netto, AMOUNT_EXTRAS_NET: extras });
    }
  }
  return makeFakeSupabase({
    INVOICE: invoice, INVOICE_STRUCTURE: invStruct,
    ADVANCE_INVOICE: adv, ADVANCE_INVOICE_STRUCTURE: advStruct,
  });
}

describe("recomputeBilledByStructure", () => {
  it("summiert Positionen je Strukturknoten", async () => {
    const sb = bestand([
      { id: 1, contractId: 50, statusId: 2, positionen: [[11, 1000, 50], [12, 500]] },
      { id: 2, contractId: 50, statusId: 2, positionen: [[11, 200]] },
    ]);
    const r = await recomputeBilledByStructure(sb, { contractId: 50 });

    expect(r.ok).toBe(true);
    expect(r.invoiced.get("11")).toBe(1250);   // 1000 + 50 Nebenkosten + 200
    expect(r.invoiced.get("12")).toBe(500);
  });

  it("laesst Entwuerfe aussen vor", async () => {
    const sb = bestand([
      { id: 1, contractId: 50, statusId: 2, positionen: [[11, 1000]] },
      { id: 2, contractId: 50, statusId: 1, positionen: [[11, 9999]] },   // Entwurf
    ]);
    const r = await recomputeBilledByStructure(sb, { contractId: 50 });
    expect(r.invoiced.get("11")).toBe(1000);
  });

  // Der Grund, warum STATUS 3 mitgelesen wird: sonst bleibt beim Storno nur
  // die negative Haelfte stehen und das Original faellt raus.
  it("hebt ein Storno-Paar auf null auf", async () => {
    const sb = bestand([
      { id: 1, contractId: 50, statusId: 3, positionen: [[11, 10000]] },   // storniertes Original
      { id: 2, contractId: 50, statusId: 2, positionen: [[11, -10000]] },  // die Stornorechnung
    ]);
    const r = await recomputeBilledByStructure(sb, { contractId: 50 });
    expect(r.invoiced.get("11")).toBe(0);
  });

  it("trennt Rechnungen von Abschlagsrechnungen", async () => {
    const sb = bestand(
      [{ id: 1, contractId: 50, statusId: 2, positionen: [[11, 1000]] }],
      [{ id: 9, contractId: 50, statusId: 2, positionen: [[11, 400]] }],
    );
    const r = await recomputeBilledByStructure(sb, { contractId: 50 });
    expect(r.invoiced.get("11")).toBe(1000);
    expect(r.partial.get("11")).toBe(400);
  });

  it("nimmt einen Beleg auf Wunsch aus", async () => {
    const sb = bestand([
      { id: 1, contractId: 50, statusId: 2, positionen: [[11, 1000]] },
      { id: 2, contractId: 50, statusId: 2, positionen: [[11, 300]] },
    ]);
    const r = await recomputeBilledByStructure(sb, { contractId: 50, excludeInvoiceId: 2 });
    expect(r.invoiced.get("11")).toBe(1000);
  });

  // Das ist die Erweiterung, auf der der gebuendelte Import aufsetzt.
  it("rechnet mehrere Vertraege in einem Lauf", async () => {
    const sb = bestand([
      { id: 1, contractId: 50, statusId: 2, positionen: [[11, 1000]] },
      { id: 2, contractId: 51, statusId: 2, positionen: [[21, 700]] },
      { id: 3, contractId: 52, statusId: 2, positionen: [[31, 300]] },
    ]);
    const r = await recomputeBilledByStructure(sb, { contractIds: [50, 51, 52] });

    expect(r.ok).toBe(true);
    expect(r.invoiced.get("11")).toBe(1000);
    expect(r.invoiced.get("21")).toBe(700);
    expect(r.invoiced.get("31")).toBe(300);
  });

  it("zaehlt einen doppelt genannten Vertrag nur einmal", async () => {
    const sb = bestand([{ id: 1, contractId: 50, statusId: 2, positionen: [[11, 1000]] }]);
    const r = await recomputeBilledByStructure(sb, { contractIds: [50, 50] });
    expect(r.invoiced.get("11")).toBe(1000);
  });

  // ok:false ist fuer den Import ein Abbruchgrund, kein stiller Rueckfall —
  // deshalb muss der Zustand eindeutig erkennbar sein.
  it("meldet ok:false ohne Vertrag", async () => {
    const r = await recomputeBilledByStructure(bestand(), { contractIds: [] });
    expect(r.ok).toBe(false);
    expect(r.invoiced.size).toBe(0);
  });
});
