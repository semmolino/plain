"use strict";

/**
 * Nachtrags-Freigabe: uebernimmt die freigegebenen Positionen als Knoten in die
 * Projektstruktur.
 *
 * WARUM ES DIESEN TEST GIBT
 *   `release()` war bis 2026-09-17 ungetestet - und kaputt. Der Insert nach
 *   PROJECT_STRUCTURE schrieb ROLE_ABBR/ROLE_NAME/ROLE_ID, Spalten, die es dort
 *   nie gab (auf OFFER_STRUCTURE und NACHTRAG_STRUCTURE schon). PostgREST lehnt
 *   ab, release() wirft 500, und weil keine Transaktionsklammer drum liegt,
 *   bleiben der Container- und der Gruppenknoten angelegt zurueck.
 *
 *   Aufgefallen ist das nicht, weil das In-Memory-Fake jeden Spaltennamen
 *   annimmt. Deshalb laeuft dieser Test mit `strictSchema: true`: das Fake
 *   haelt jede geschriebene Spalte gegen db/schema/inventar_*.txt und
 *   antwortet sonst wie PostgREST.
 *
 * WARUM `test.failing`
 *   Der Fehler ist noch nicht behoben - ob die Rolleninformation im Projekt
 *   ueberhaupt erhalten bleiben soll, ist eine fachliche Frage (dann braucht es
 *   eine Migration; sonst reicht es, die drei Felder zu streichen). Bis dahin
 *   haelt `test.failing` den Zustand fest, ohne CI rot zu faerben, und schlaegt
 *   an, sobald jemand den Fehler behebt: dann besteht der Test unerwartet und
 *   Jest meldet das. Beim Beheben: `test.failing` in `test` aendern.
 */

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { load } = require("./helpers/schemaInventory");
const svc = require("../services/nachtraege");

const TENANT = 4;
const PROJECT = 77;
const NACHTRAG = 900;

/** Minimaler Datenstand, aus dem heraus eine Freigabe laufen kann. */
function fixture() {
  return makeFakeSupabase({
    NACHTRAG: [{
      ID: NACHTRAG, TENANT_ID: TENANT, PROJECT_ID: PROJECT,
      NACHTRAG_STATUS_ID: 3, ABBR: "N-001", NAME: "Mehrleistung Dach",
      AMOUNT_NET: 5000, COMPANY_ID: 14,
    }],
    // ALLOWS_RELEASE ist das Tor: ohne einen Status, der Freigabe erlaubt,
    // bricht release() mit 409 ab, bevor es ueberhaupt schreibt.
    NACHTRAG_STATUS: [{ ID: 3, CODE: "REVIEWED", ALLOWS_RELEASE: true }],
    NACHTRAG_STRUCTURE: [{
      ID: 5001, TENANT_ID: TENANT, NACHTRAG_ID: NACHTRAG, FATHER_ID: null,
      ABBR: "1", NAME: "Zusaetzliche Dachflaeche", BILLING_TYPE_ID: 1,
      REVENUE: 5000, REVENUE_BASIS: 5000, EXTRAS_PERCENT: 5, EXTRAS: 250,
      SORT_ORDER: 10, APPROVAL_STATE: null,
      ROLE_ID: 2, ROLE_ABBR: "PL", ROLE_NAME: "Projektleitung",
    }],
    PROJECT: [{ ID: PROJECT, TENANT_ID: TENANT, ABBR: "P-26-001", NAME: "Dachsanierung" }],
    PROJECT_STRUCTURE: [],
    PROJECT_PROGRESS: [],
    NACHTRAG_RELEASE: [],
    NACHTRAG_AUDIT: [],
  }, { strictSchema: true });
}

describe("Nachtrag: Freigabe uebernimmt Positionen ins Projekt", () => {
  it("das Spalteninventar liegt vor — sonst prueft dieser Test nichts", () => {
    // Ohne Inventar schaltet strictSchema still ab. Dann waere ein gruener
    // Test wertlos, und das soll man sehen.
    expect(load()).not.toBeNull();
  });

  it("PROJECT_STRUCTURE hat keine Rollenspalten — OFFER_STRUCTURE schon", () => {
    const inv = load();
    expect(inv.get("PROJECT_STRUCTURE").has("ROLE_ABBR")).toBe(false);
    expect(inv.get("PROJECT_STRUCTURE").has("ROLE_NAME")).toBe(false);
    expect(inv.get("PROJECT_STRUCTURE").has("ROLE_ID")).toBe(false);
    expect(inv.get("OFFER_STRUCTURE").has("ROLE_ABBR")).toBe(true);
  });

  test.failing("legt die freigegebene Position als Knoten im Projekt an", async () => {
    const supabase = fixture();

    await svc.release(supabase, {
      tenantId: TENANT,
      nachtragId: NACHTRAG,
      employeeId: 1,
      body: {
        release_kind: "PARTIAL",
        release_basis: "WRITTEN",
        positions: [{ nachtrag_structure_id: 5001, approved_amount_net: 5000 }],
      },
    });

    // Erwartet: Container, Gruppe und die Position selbst.
    const struktur = supabase._tables.PROJECT_STRUCTURE;
    const position = struktur.find((r) => r.NAME === "Zusaetzliche Dachflaeche");
    expect(position).toBeTruthy();
    expect(position.REVENUE).toBe(5000);
    expect(position.EXTRAS).toBe(250);
    expect(position.PROJECT_ID).toBe(PROJECT);
  });
});
