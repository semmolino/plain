"use strict";

// Nachtrag als eigenes Projekt freigeben (Migration 0182, Gesamtprojekt Stufe 3).
// Festgehalten wird:
//   - das neue Projekt bekommt Gesamtprojekt, Team und Vertragskonditionen des
//     Ursprungsprojekts, aber seinen eigenen Rechnungsempfaenger,
//   - ohne Gesamtprojekt entsteht eins aus dem Ursprungsprojekt,
//   - Rechte (projects.create, ggf. projects.edit) und Adressen werden VOR dem
//     ersten Schreiben geprueft — kein halbes Projekt nach einer Ablehnung,
//   - Folgefreigaben gehen nur in ein Projekt, das dieser Nachtrag selbst
//     angelegt hat.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const svc = require("../services/nachtraege");

const T = 4, F = 99;
const SRC = 77, NT = 900;
const alles = () => true;

function welt({ group = true } = {}) {
  const db = makeFakeSupabase({
    NACHTRAG: [{
      ID: NT, TENANT_ID: T, PROJECT_ID: SRC, NACHTRAG_STATUS_ID: 3,
      ABBR: "N-003", NAME: "Außenanlagen Schulhof", ADDRESS_ID: 8, CONTACT_ID: 81, AMOUNT_APPROVED_NET: 0,
    }],
    NACHTRAG_STATUS: [
      { ID: 3, CODE: "REVIEWED", ALLOWS_RELEASE: true },
      { ID: 4, CODE: "PARTIALLY_COMMISSIONED", ALLOWS_RELEASE: true },
      { ID: 5, CODE: "COMMISSIONED", ALLOWS_RELEASE: false },
    ],
    NACHTRAG_STRUCTURE: [
      { ID: 5001, TENANT_ID: T, NACHTRAG_ID: NT, FATHER_ID: null, ABBR: "1", NAME: "Freianlagen Planung",
        BILLING_TYPE_ID: 1, REVENUE: 5000, EXTRAS_PERCENT: 5, APPROVAL_STATE: "OPEN", RELEASED_STRUCTURE_ID: null },
      { ID: 5002, TENANT_ID: T, NACHTRAG_ID: NT, FATHER_ID: null, ABBR: "2", NAME: "Abstimmung Nutzer",
        BILLING_TYPE_ID: 2, QUANTITY: 10, REVENUE: 950, EXTRAS_PERCENT: 0, APPROVAL_STATE: "OPEN", RELEASED_STRUCTURE_ID: null },
    ],
    PROJECT: [
      { ID: SRC, TENANT_ID: T, ABBR: "P-26-001", NAME: "Schule Nord", COMPANY_ID: 14, PROJECT_TYPE_ID: 2,
        DEPARTMENT_ID: 1, PROJECT_MANAGER_ID: 5, ADDRESS_ID: 3, PROJECT_GROUP_ID: group ? 1 : null },
      { ID: 60, TENANT_ID: F, ABBR: "F-1", NAME: "Fremd" },
    ],
    PROJECT_GROUP: group ? [{ ID: 1, TENANT_ID: T, ABBR: "P-26-001", NAME: "Schule Nord" }] : [],
    EMPLOYEE2PROJECT: [{ ID: 1, TENANT_ID: T, PROJECT_ID: SRC, EMPLOYEE_ID: 5, ROLE_ID: 2, ROLE_ABBR: "PL", ROLE_NAME: "Projektleitung", HOURLY_RATE: 95 }],
    CONTRACT: [{ ID: 70, TENANT_ID: T, PROJECT_ID: SRC, INVOICE_ADDRESS_ID: 3, VAT_ID: 1, VAT_CATEGORY: "AE",
      SE_ENABLED: true, SE_PERCENT: 5, SE_BASIS: "NETTO", CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 10 }],
    ADDRESS: [
      { ID: 3, TENANT_ID: T, ADDRESS_NAME_1: "Stadt Musterstadt" },
      { ID: 8, TENANT_ID: T, ADDRESS_NAME_1: "Förderverein Schule Nord" },
      { ID: 66, TENANT_ID: F, ADDRESS_NAME_1: "Fremd" },
    ],
    CONTACTS: [{ ID: 81, TENANT_ID: T, ADDRESS_ID: 8 }, { ID: 31, TENANT_ID: T, ADDRESS_ID: 3 }],
    EMPLOYEE: [{ ID: 5, TENANT_ID: T, ABBR: "AB" }],
    TENANT_SETTINGS: [],
    PROJECT_STRUCTURE: [], PROJECT_PROGRESS: [], NACHTRAG_RELEASE: [], NACHTRAG_AUDIT: [], BUDGET_WARNING_RULE: [],
  });
  db.rpc = async () => ({ data: "P-26-099", error: null });
  return db;
}

const ziel = (extra = {}) => ({
  kind: "new_project", name: "Außenanlagen Schulhof", project_status_id: 2, project_manager_id: 5,
  address_id: 8, contact_id: 81, abbr_mode: "derived", ...extra,
});

async function fehler(p) {
  try { await p; return null; } catch (e) { return e; }
}

const neuesProjekt = (db) => db._tables.PROJECT.find((p) => p.ID !== SRC && p.ID !== 60);

describe("Nachtrag als eigenes Projekt", () => {
  test("Projekt im Gesamtprojekt: Nummer abgeleitet, eigener Rechnungsempfänger, Konditionen und Team vom Ursprung", async () => {
    const db = welt();
    const r = await svc.release(db, {
      tenantId: T, nachtragId: NT, employeeId: 5, can: alles,
      body: { release_kind: "FULL", target: ziel() },
    });
    const p = neuesProjekt(db);
    expect(p).toMatchObject({
      ABBR: "P-26-001-02", NAME: "Außenanlagen Schulhof", PROJECT_GROUP_ID: 1, COMPANY_ID: 14,
      PROJECT_TYPE_ID: 2, ADDRESS_ID: 8, CONTACT_ID: 81, TENANT_ID: T,
    });
    expect(r.target_project).toMatchObject({ ID: p.ID, ABBR: "P-26-001-02" });
    expect(r.group_created).toBe(false);

    // Vertrag: Rechnungsempfaenger aus dem Dialog, Konditionen vom Ursprungsvertrag
    const c = db._tables.CONTRACT.find((x) => x.PROJECT_ID === p.ID);
    expect(c).toMatchObject({ INVOICE_ADDRESS_ID: 8, VAT_CATEGORY: "AE", SE_ENABLED: true, SE_PERCENT: 5, CASH_DISCOUNT_DAYS: 10 });
    // Team mit Stundensatz
    expect(db._tables.EMPLOYEE2PROJECT.filter((e) => e.PROJECT_ID === p.ID))
      .toEqual([expect.objectContaining({ EMPLOYEE_ID: 5, ROLE_ID: 2, HOURLY_RATE: 95 })]);

    // Positionen auf oberster Ebene im neuen Projekt, kein „Nachträge"-Knoten im Ursprung
    const nodes = db._tables.PROJECT_STRUCTURE;
    expect(nodes.every((n) => n.PROJECT_ID === p.ID && n.FATHER_ID === null && n.NACHTRAG_ID === NT)).toBe(true);
    expect(nodes.map((n) => n.NAME)).toEqual(["Freianlagen Planung", "Abstimmung Nutzer"]);
    expect(nodes.find((n) => n.BILLING_TYPE_ID === 2)).toMatchObject({ REVENUE: 0, PLAN_HOURS: 10, PLAN_REVENUE: 950 });
    // Rückverweise und Protokoll
    expect(db._tables.NACHTRAG_STRUCTURE.every((s) => nodes.some((n) => n.ID === s.RELEASED_STRUCTURE_ID))).toBe(true);
    expect(db._tables.NACHTRAG_RELEASE).toEqual([expect.objectContaining({ RELEASE_NO: 1, TARGET_PROJECT_ID: p.ID, AMOUNT_NET: 5250 })]);
    // Der Nachtrag bleibt am Ursprungsprojekt
    expect(db._tables.NACHTRAG[0].PROJECT_ID).toBe(SRC);
  });

  test("Nummernkreis statt abgeleiteter Nummer", async () => {
    const db = welt();
    await svc.release(db, { tenantId: T, nachtragId: NT, can: alles, body: { release_kind: "FULL", target: ziel({ abbr_mode: "range" }) } });
    expect(neuesProjekt(db).ABBR).toBe("P-26-099");
  });

  test("ohne Gesamtprojekt: entsteht aus dem Ursprungsprojekt, beide gehören dazu", async () => {
    const db = welt({ group: false });
    const r = await svc.release(db, { tenantId: T, nachtragId: NT, can: alles, body: { release_kind: "FULL", target: ziel() } });
    expect(r.group_created).toBe(true);
    const g = db._tables.PROJECT_GROUP[0];
    expect(g).toMatchObject({ NAME: "Schule Nord", ABBR: "P-26-001", ADDRESS_ID: 3, MANAGER_ID: 5, TENANT_ID: T });
    expect(db._tables.PROJECT.find((p) => p.ID === SRC).PROJECT_GROUP_ID).toBe(g.ID);
    // Das Ursprungsprojekt traegt das Kuerzel selbst und zaehlt als 01
    expect(neuesProjekt(db)).toMatchObject({ PROJECT_GROUP_ID: g.ID, ABBR: "P-26-001-02" });
  });

  test("ohne projects.create: 403, nichts geschrieben", async () => {
    const db = welt();
    const e = await fehler(svc.release(db, {
      tenantId: T, nachtragId: NT, can: (k) => k !== "projects.create", body: { release_kind: "FULL", target: ziel() },
    }));
    expect(e?.status).toBe(403);
    expect(neuesProjekt(db)).toBeUndefined();
    expect(db._tables.PROJECT_STRUCTURE).toEqual([]);
    expect(db._tables.NACHTRAG_RELEASE).toEqual([]);
  });

  test("ohne Gesamtprojekt und ohne projects.edit: 403, kein Gesamtprojekt, kein Projekt", async () => {
    const db = welt({ group: false });
    const e = await fehler(svc.release(db, {
      tenantId: T, nachtragId: NT, can: (k) => k !== "projects.edit", body: { release_kind: "FULL", target: ziel() },
    }));
    expect(e?.status).toBe(403);
    expect(db._tables.PROJECT_GROUP).toEqual([]);
    expect(neuesProjekt(db)).toBeUndefined();
  });

  test("Rechnungsempfänger eines fremden Büros oder Kontakt einer anderen Adresse: 400, nichts geschrieben", async () => {
    for (const t of [ziel({ address_id: 66 }), ziel({ contact_id: 31 })]) {
      const db = welt();
      const e = await fehler(svc.release(db, { tenantId: T, nachtragId: NT, can: alles, body: { release_kind: "FULL", target: t } }));
      expect(e?.status).toBe(400);
      expect(neuesProjekt(db)).toBeUndefined();
    }
  });

  test("Folgefreigabe in das Projekt aus der ersten Freigabe; andere Projekte abgewiesen", async () => {
    const db = welt();
    await svc.release(db, {
      tenantId: T, nachtragId: NT, can: alles,
      body: { release_kind: "PARTIAL", positions: [{ nachtrag_structure_id: 5001 }], target: ziel() },
    });
    const p = neuesProjekt(db);

    // Ein beliebiges Projekt (auch das Ursprungsprojekt über diesen Weg) geht nicht
    for (const pid of [SRC, 60]) {
      const e = await fehler(svc.release(db, {
        tenantId: T, nachtragId: NT, can: alles,
        body: { release_kind: "PARTIAL", positions: [{ nachtrag_structure_id: 5002 }], target: { kind: "release_project", project_id: pid } },
      }));
      expect(e?.status).toBe(400);
    }

    const r = await svc.release(db, {
      tenantId: T, nachtragId: NT, can: alles,
      body: { release_kind: "PARTIAL", positions: [{ nachtrag_structure_id: 5002 }], target: { kind: "release_project", project_id: p.ID } },
    });
    expect(r.target_project).toMatchObject({ ID: p.ID });
    expect(r.status_code).toBe("COMMISSIONED");
    const nodes = db._tables.PROJECT_STRUCTURE.filter((n) => n.PROJECT_ID === p.ID);
    expect(nodes.map((n) => [n.NAME, n.SORT_ORDER])).toEqual([["Freianlagen Planung", 10], ["Abstimmung Nutzer", 20]]);
    // Kein zweites Projekt
    expect(db._tables.PROJECT.filter((x) => x.TENANT_ID === T)).toHaveLength(2);

    const list = await svc.listReleases(db, { tenantId: T, nachtragId: NT });
    expect(list.map((x) => [x.RELEASE_NO, x.TARGET_PROJECT_ABBR])).toEqual([[1, "P-26-001-02"], [2, "P-26-001-02"]]);
  });

  test("ohne Ziel wie bisher: ins Ursprungsprojekt unter dem Knoten Nachträge", async () => {
    const db = welt();
    const r = await svc.release(db, { tenantId: T, nachtragId: NT, body: { release_kind: "FULL" } });
    expect(r.target_project).toBeNull();
    expect(db._tables.PROJECT_STRUCTURE.every((n) => n.PROJECT_ID === SRC)).toBe(true);
    expect(db._tables.PROJECT_STRUCTURE.some((n) => n.NAME === "Nachträge")).toBe(true);
    expect(db._tables.NACHTRAG_RELEASE[0]).not.toHaveProperty("TARGET_PROJECT_ID");
  });
});
