"use strict";

/**
 * Umbuchen von Buchungen (Migration 0139).
 *
 * Die drei Punkte, an denen es fachlich wehtut, wenn sie brechen:
 *   1. Eine abgerechnete Buchung darf sich NICHT verschieben lassen — sonst
 *      verliert eine gestellte Rechnung ihre Grundlage.
 *   2. Kosten und Erloes muessen bei Quelle UND Ziel neu stehen; ein
 *      halbseitiger Lauf verdoppelt oder verliert Geld in der Auswertung.
 *   3. Die Vorschau muss dasselbe sagen wie die Ausfuehrung — sie ist die
 *      Entscheidungsgrundlage des Nutzers.
 */

const { makeFakeSupabase } = require("./helpers/fakeSupabase");

jest.mock("../services/budgetWarnings", () => ({
  evaluateAfterTecChange: jest.fn().mockResolvedValue(undefined),
}));

const svc = require("../services/buchungen");

const TENANT = 7;

/** Zwei Projekte, je ein Blatt-Element (BILLING_TYPE_ID=2, also Stundenprojekt). */
function welt(extraTec = []) {
  return makeFakeSupabase({
    PROJECT: [
      { ID: 1, TENANT_ID: TENANT, NAME_SHORT: "P-26-001", NAME_LONG: "Falsches Projekt" },
      { ID: 2, TENANT_ID: TENANT, NAME_SHORT: "P-26-002", NAME_LONG: "Richtiges Projekt" },
      { ID: 9, TENANT_ID: 99,     NAME_SHORT: "FREMD",    NAME_LONG: "Anderer Mandant" },
    ],
    PROJECT_STRUCTURE: [
      { ID: 10, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, NAME_SHORT: "LP5", NAME_LONG: "Ausführungsplanung", BILLING_TYPE_ID: 2, EXTRAS_PERCENT: 0, COSTS: 0, REVENUE: 0 },
      { ID: 20, TENANT_ID: TENANT, PROJECT_ID: 2, FATHER_ID: null, NAME_SHORT: "LP3", NAME_LONG: "Entwurfsplanung",   BILLING_TYPE_ID: 2, EXTRAS_PERCENT: 0, COSTS: 0, REVENUE: 0 },
      // Knoten mit Kind: kein Blatt, also kein gueltiges Ziel.
      { ID: 30, TENANT_ID: TENANT, PROJECT_ID: 2, FATHER_ID: null, NAME_SHORT: "LP4", NAME_LONG: "Genehmigung", BILLING_TYPE_ID: 2, EXTRAS_PERCENT: 0, COSTS: 0, REVENUE: 0 },
      { ID: 31, TENANT_ID: TENANT, PROJECT_ID: 2, FATHER_ID: 30,   NAME_SHORT: "LP4.1", NAME_LONG: null, BILLING_TYPE_ID: 2, EXTRAS_PERCENT: 0, COSTS: 0, REVENUE: 0 },
    ],
    EMPLOYEE2PROJECT: [
      { ID: 1, TENANT_ID: TENANT, EMPLOYEE_ID: 5, PROJECT_ID: 2, ROLE_ID: 3, ROLE_NAME_SHORT: "PL", ROLE_NAME_LONG: "Projektleitung", SP_RATE: 110 },
    ],
    INVOICE: [{ ID: 500, TENANT_ID: TENANT, INVOICE_NUMBER: "R-2026-0042" }],
    PARTIAL_PAYMENT: [],
    TEC_REBOOKING: [],
    TEC: [
      // offen, Mitarbeiter 5, 10 h zu 80 € Kostensatz und 90 € Stundensatz
      { ID: 100, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 5, DATE_VOUCHER: "2026-08-03",
        QUANTITY_INT: 10, QUANTITY_EXT: 10, CP_RATE: 80, CP_TOT: 800, SP_RATE: 90, SP_TOT: 900,
        POSTING_DESCRIPTION: "Grundrisse", STATUS: "CONFIRMED", BOOKING_KIND: "WORK", ENTRY_KIND: "WORK",
        INVOICE_ID: null, PARTIAL_PAYMENT_ID: null },
      // dieselbe Struktur, aber abgerechnet
      { ID: 101, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 5, DATE_VOUCHER: "2026-08-04",
        QUANTITY_INT: 4, QUANTITY_EXT: 4, CP_RATE: 80, CP_TOT: 320, SP_RATE: 90, SP_TOT: 360,
        POSTING_DESCRIPTION: "Details", STATUS: "CONFIRMED", BOOKING_KIND: "WORK", ENTRY_KIND: "WORK",
        INVOICE_ID: 500, PARTIAL_PAYMENT_ID: null },
      ...extraTec,
    ],
  });
}

const args = (over = {}) => ({
  ids: [100], targetProjectId: 2, targetStructureId: 20,
  tenantId: TENANT, employeeId: 5, ...over,
});

describe("rebookBuchungen", () => {
  it("verschiebt eine offene Buchung und übernimmt den Stundensatz des Zielprojekts", async () => {
    const db = welt();
    const res = await svc.rebookBuchungen(db, args({ reason: "Falsches Projekt gewählt" }));

    expect(res.rebooked).toBe(1);
    const tec = db._tables.TEC.find(r => r.ID === 100);
    expect(tec.PROJECT_ID).toBe(2);
    expect(tec.STRUCTURE_ID).toBe(20);
    // 10 h × 110 € aus EMPLOYEE2PROJECT des Zielprojekts
    expect(tec.SP_RATE).toBe(110);
    expect(tec.SP_TOT).toBe(1100);
    expect(tec.ROLE_NAME_SHORT).toBe("PL");
    // Kostensatz haengt am Mitarbeiter, nicht am Projekt — er bleibt.
    expect(tec.CP_RATE).toBe(80);
    // Menge, Datum, Person, Beschreibung bleiben unberuehrt.
    expect(tec.QUANTITY_INT).toBe(10);
    expect(tec.DATE_VOUCHER).toBe("2026-08-03");
    expect(tec.POSTING_DESCRIPTION).toBe("Grundrisse");
  });

  it("rechnet Kosten und Erlös bei Quelle UND Ziel neu", async () => {
    const db = welt();
    await svc.rebookBuchungen(db, args());

    const quelle = db._tables.PROJECT_STRUCTURE.find(s => s.ID === 10);
    const ziel   = db._tables.PROJECT_STRUCTURE.find(s => s.ID === 20);
    // Auf der Quelle bleibt nur die abgerechnete Buchung (4 h × 80 € / 360 €).
    expect(quelle.COSTS).toBe(320);
    expect(quelle.REVENUE).toBe(360);
    // Auf dem Ziel steht die verschobene Buchung mit dem neuen Satz.
    expect(ziel.COSTS).toBe(800);
    expect(ziel.REVENUE).toBe(1100);
  });

  it("sperrt abgerechnete Buchungen und nennt den Beleg", async () => {
    const db = welt();
    const res = await svc.rebookBuchungen(db, args({ ids: [100, 101] }));

    expect(res.rebooked).toBe(1);
    const gesperrt = res.skipped.find(s => s.ID === 101);
    expect(gesperrt.reason).toBe("billed");
    expect(gesperrt.message).toContain("R-2026-0042");
    // Die abgerechnete Zeile liegt unveraendert im alten Projekt.
    const tec = db._tables.TEC.find(r => r.ID === 101);
    expect(tec.PROJECT_ID).toBe(1);
    expect(tec.STRUCTURE_ID).toBe(10);
  });

  it("schreibt je verschobener Buchung einen Protokolleintrag", async () => {
    const db = welt();
    await svc.rebookBuchungen(db, args({ ids: [100, 101], reason: "Fehlbuchung" }));

    const log = db._tables.TEC_REBOOKING;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      TENANT_ID: TENANT, TEC_ID: 100,
      FROM_PROJECT_ID: 1, FROM_PROJECT_NAME: "P-26-001",
      FROM_STRUCTURE_ID: 10, FROM_STRUCTURE_NAME: "LP5: Ausführungsplanung",
      TO_PROJECT_ID: 2, TO_STRUCTURE_ID: 20,
      SP_RATE_BEFORE: 90, SP_RATE_AFTER: 110,
      REASON: "Fehlbuchung", CREATED_BY_EMPLOYEE_ID: 5,
    });
  });

  it("Vorschau schreibt nichts und sagt dasselbe wie die Ausführung", async () => {
    const dbVorschau = welt();
    const vorschau = await svc.rebookBuchungen(dbVorschau, args({ ids: [100, 101], dryRun: true }));

    expect(vorschau.movedCount).toBe(1);
    expect(vorschau.rebooked).toBeUndefined();
    expect(dbVorschau._tables.TEC.find(r => r.ID === 100).PROJECT_ID).toBe(1);
    expect(dbVorschau._tables.TEC_REBOOKING).toHaveLength(0);

    const dbLauf = welt();
    const lauf = await svc.rebookBuchungen(dbLauf, args({ ids: [100, 101] }));
    expect(lauf.moved).toEqual(vorschau.moved);
    expect(lauf.skipped).toEqual(vorschau.skipped);
    expect(lauf.warnings).toEqual(vorschau.warnings);
  });

  it("warnt, wenn sich der Stundensatz ändert oder im Ziel keiner hinterlegt ist", async () => {
    const db = welt([
      { ID: 102, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 6, DATE_VOUCHER: "2026-08-05",
        QUANTITY_INT: 2, QUANTITY_EXT: 2, CP_RATE: 70, CP_TOT: 140, SP_RATE: 85, SP_TOT: 170,
        POSTING_DESCRIPTION: "Abstimmung", STATUS: "CONFIRMED", BOOKING_KIND: "WORK", ENTRY_KIND: "WORK",
        INVOICE_ID: null, PARTIAL_PAYMENT_ID: null },
    ]);
    const res = await svc.rebookBuchungen(db, args({ ids: [100, 102] }));

    const codes = res.warnings.map(w => w.code);
    expect(codes).toContain("rate_changed");
    expect(codes).toContain("no_assignment");
    // Mitarbeiter 6 hat im Zielprojekt keinen Satz — der alte bleibt stehen.
    const ohne = db._tables.TEC.find(r => r.ID === 102);
    expect(ohne.SP_RATE).toBe(85);
    expect(ohne.SP_TOT).toBe(170);
    expect(ohne.STRUCTURE_ID).toBe(20);
  });

  it("lässt Pauschalen ihren Preis und Entwürfe/Pausen liegen", async () => {
    const db = welt([
      { ID: 103, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 5, DATE_VOUCHER: "2026-08-06",
        QUANTITY_INT: 0, QUANTITY_EXT: 1, CP_RATE: 0, CP_TOT: 0, SP_RATE: 2500, SP_TOT: 2500,
        POSTING_DESCRIPTION: "Gutachten", STATUS: "CONFIRMED", BOOKING_KIND: "LUMP_REVENUE", ENTRY_KIND: "WORK",
        INVOICE_ID: null, PARTIAL_PAYMENT_ID: null },
      { ID: 104, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 5, DATE_VOUCHER: "2026-08-07",
        QUANTITY_INT: 3, QUANTITY_EXT: 3, CP_RATE: 80, CP_TOT: 240, SP_RATE: 90, SP_TOT: 270,
        POSTING_DESCRIPTION: "Entwurf", STATUS: "DRAFT", BOOKING_KIND: "WORK", ENTRY_KIND: "WORK",
        INVOICE_ID: null, PARTIAL_PAYMENT_ID: null },
      { ID: 105, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: null, EMPLOYEE_ID: 5, DATE_VOUCHER: "2026-08-07",
        QUANTITY_INT: 1, QUANTITY_EXT: 0, CP_RATE: 0, CP_TOT: 0, SP_RATE: 0, SP_TOT: 0,
        POSTING_DESCRIPTION: "Pause", STATUS: "CONFIRMED", BOOKING_KIND: "WORK", ENTRY_KIND: "BREAK",
        INVOICE_ID: null, PARTIAL_PAYMENT_ID: null },
    ]);
    const res = await svc.rebookBuchungen(db, args({ ids: [103, 104, 105] }));

    expect(res.rebooked).toBe(1);
    // Pauschale: verschoben, Preis unveraendert (kein Stundensatz aus der Zuordnung).
    const pauschale = db._tables.TEC.find(r => r.ID === 103);
    expect(pauschale.STRUCTURE_ID).toBe(20);
    expect(pauschale.SP_RATE).toBe(2500);
    expect(pauschale.SP_TOT).toBe(2500);
    expect(res.skipped.map(s => s.reason).sort()).toEqual(["break", "draft"]);
  });

  it("weist fremde und unpassende Ziele ab", async () => {
    // Fremder Mandant: nicht gefunden (kein Unterschied zu „existiert nicht").
    await expect(svc.rebookBuchungen(welt(), args({ targetProjectId: 9, targetStructureId: 20 })))
      .rejects.toMatchObject({ status: 404 });
    // Element gehoert zu einem anderen Projekt.
    await expect(svc.rebookBuchungen(welt(), args({ targetProjectId: 1, targetStructureId: 20 })))
      .rejects.toMatchObject({ status: 400 });
    // Kein Blatt-Element.
    await expect(svc.rebookBuchungen(welt(), args({ targetStructureId: 30 })))
      .rejects.toMatchObject({ status: 400 });
    // Ohne Auswahl.
    await expect(svc.rebookBuchungen(welt(), args({ ids: [] })))
      .rejects.toMatchObject({ status: 400 });
    // Eine ID, die es im eigenen Mandanten nicht gibt (oder einem fremden
    // gehoert — die Abfrage ist mandantengefiltert und unterscheidet das
    // bewusst nicht): uebersprungen, der Rest laeuft trotzdem durch.
    const db = welt();
    const res = await svc.rebookBuchungen(db, args({ ids: [100, 4711] }));
    expect(res.rebooked).toBe(1);
    expect(res.skipped).toEqual([{ ID: 4711, reason: "not_found", message: "Buchung nicht gefunden" }]);
  });

  it("zieht Summen und Protokoll auch nach, wenn ein Schreibvorgang abbricht", async () => {
    // Zwei Mitarbeiter = zwei Nutzlasten = zwei Update-Aufrufe. Der zweite
    // schlaegt fehl. Was schon verschoben ist, muss trotzdem in den Summen und
    // im Protokoll stehen — sonst zeigt die Struktur still den alten Stand.
    const db = welt([
      { ID: 106, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 10, EMPLOYEE_ID: 6, DATE_VOUCHER: "2026-08-08",
        QUANTITY_INT: 2, QUANTITY_EXT: 2, CP_RATE: 70, CP_TOT: 140, SP_RATE: 85, SP_TOT: 170,
        POSTING_DESCRIPTION: "Abstimmung", STATUS: "CONFIRMED", BOOKING_KIND: "WORK", ENTRY_KIND: "WORK",
        INVOICE_ID: null, PARTIAL_PAYMENT_ID: null },
    ]);
    const echtesFrom = db.from;
    let tecUpdates = 0;
    db.from = (table) => {
      const b = echtesFrom(table);
      if (table !== "TEC") return b;
      const echtesUpdate = b.update;
      b.update = (payload) => {
        echtesUpdate(payload);
        if (++tecUpdates === 2) {
          // Ab hier antwortet dieser Aufruf mit einem Fehler statt zu schreiben.
          b.then = (resolve) => resolve({ data: null, error: { message: "Verbindung verloren" } });
        }
        return b;
      };
      return b;
    };

    await expect(svc.rebookBuchungen(db, args({ ids: [100, 106] })))
      .rejects.toMatchObject({ status: 500, message: expect.stringContaining("1 von 2") });

    // Die erste Zeile ist verschoben, protokolliert und in den Summen drin.
    expect(db._tables.TEC_REBOOKING).toHaveLength(1);
    expect(db._tables.PROJECT_STRUCTURE.find(s => s.ID === 20).COSTS).toBe(800);
    expect(db._tables.PROJECT_STRUCTURE.find(s => s.ID === 10).COSTS).toBe(460);
  });

  it("überspringt Buchungen, die schon auf dem Ziel liegen", async () => {
    const db = welt();
    const res = await svc.rebookBuchungen(db, args({ targetProjectId: 1, targetStructureId: 10 }));
    expect(res.skipped[0].reason).toBe("unchanged");
    expect(res.rebooked).toBe(0);
    expect(db._tables.TEC_REBOOKING).toHaveLength(0);
  });
});
