"use strict";

// Adressen und Kontakte (UI-Pilot Runde 8). Jeder Block hier war ein Fehler:
// Loeschpruefung auf Spalten, die es nicht gibt; Verknuepfungen, die immer
// leer waren; Adressnamen fremder Mandanten in der Kontaktliste; Kontakte an
// fremden Adressen; mehrere „Hauptansprechpartner"; ein Name aus
// Leerzeichen; Angebote ohne Ansprechpartner (Tabelle CONTACT statt CONTACTS).

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const dep = require("../services/dependencyCheck");
const adressen = require("../services/adressen");
const ctrl = require("../controllers/stammdaten");
const angebote = require("../services/angebote");

const T = 7, F = 99;

function base(extra = {}) {
  return {
    ADDRESS: [
      { ID: 1, TENANT_ID: T, ADDRESS_NAME_1: "Stadt Musterstadt", COUNTRY_ID: 1 },
      { ID: 2, TENANT_ID: T, ADDRESS_NAME_1: "Wohnbau Süd GmbH", COUNTRY_ID: 1 },
      { ID: 50, TENANT_ID: F, ADDRESS_NAME_1: "Fremdes Büro", COUNTRY_ID: 1 },
    ],
    CONTACTS: [], PROJECT: [], OFFER: [], CONTRACT: [], INVOICE: [], ADVANCE_INVOICE: [], NACHTRAG: [],
    SALUTATION: [{ ID: 1, SALUTATION: "Frau" }], GENDER: [{ ID: 1, GENDER: "weiblich" }],
    COUNTRY: [{ ID: 1, NAME: "Deutschland" }],
    ...extra,
  };
}

function call(handler, db, { params = {}, body = {}, query = {}, permissions = null } = {}) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const req = {
    params, body, query, tenantId: T,
    _permissionsUnrestricted: permissions === null,
    permissions: new Set(permissions || []),
  };
  return Promise.resolve(handler(req, res, db)).then(() => res);
}

describe("Loeschpruefung Adresse", () => {
  test.each([
    ["Rechnung", { INVOICE: [{ ID: 3, TENANT_ID: T, INVOICE_ADDRESS_ID: 2, INVOICE_NUMBER: "RE-2026-0041" }] }, "1 Rechnung (RE-2026-0041)"],
    ["Abschlag", { ADVANCE_INVOICE: [{ ID: 4, TENANT_ID: T, ADVANCE_INVOICE_ADDRESS_ID: 2, ADVANCE_INVOICE_NUMBER: "AR-2026-0007" }] }, "1 Abschlag (AR-2026-0007)"],
    ["Vertrag", { CONTRACT: [{ ID: 5, TENANT_ID: T, INVOICE_ADDRESS_ID: 2, ABBR: "V-2024-001" }] }, "1 Vertrag (V-2024-001)"],
    ["Nachtrag", { NACHTRAG: [{ ID: 6, TENANT_ID: T, ADDRESS_ID: 2, ABBR: "N-002" }] }, "1 Nachtrag (N-002)"],
  ])("%s blockiert", async (_n, extra, text) => {
    const r = await dep.checkAddress(makeFakeSupabase(base(extra)), { tenantId: T, id: 2 });
    expect(r.blocked).toBe(true);
    expect(r.message).toContain(text);
  });

  test("Belege eines fremden Mandanten zaehlen nicht", async () => {
    const db = makeFakeSupabase(base({ INVOICE: [{ ID: 3, TENANT_ID: F, INVOICE_ADDRESS_ID: 2, INVOICE_NUMBER: "X" }] }));
    expect((await dep.checkAddress(db, { tenantId: T, id: 2 })).blocked).toBe(false);
  });

  test("Kontakt: Rechnungskontakt in Rechnung und Vertrag blockiert", async () => {
    const db = makeFakeSupabase(base({
      CONTACTS: [{ ID: 8, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Petra", LAST_NAME: "Albrecht" }],
      INVOICE: [{ ID: 3, TENANT_ID: T, INVOICE_CONTACT_ID: 8, INVOICE_NUMBER: "RE-1" }],
      CONTRACT: [{ ID: 5, TENANT_ID: T, INVOICE_CONTACT_ID: 8, ABBR: "V-1" }],
    }));
    const r = await dep.checkContact(db, { tenantId: T, id: 8 });
    expect(r.message).toMatch(/1 Vertrag \(V-1\) und 1 Rechnung \(RE-1\)/);
  });

  test("Projekttyp und Rolle: die richtigen Spalten", async () => {
    const db = makeFakeSupabase({
      PROJECT_TYPE: [{ ID: 3, ABBR: "Neubau" }], ROLE: [{ ID: 2, TENANT_ID: T, ABBR: "PL" }],
      PROJECT: [{ ID: 1, TENANT_ID: T, ABBR: "P-1", PROJECT_TYPE_ID: 3 }],
      EMPLOYEE2PROJECT: [], OFFER_STRUCTURE: [],
      PROJECT_HOURLY_RATES: [{ ID: 1, TENANT_ID: T, ROLE_ID: 2 }], BOOKING: [{ ID: 1, TENANT_ID: T, ROLE_ID: 2 }],
    });
    expect((await dep.checkProjectTyp(db, { tenantId: T, id: 3 })).message).toContain("1 Projekt (P-1)")
    expect((await dep.checkRole(db, { tenantId: T, id: 2 })).message).toMatch(/1 Preisliste und 1 Buchung/);
  });
});

describe("Verknuepfungen der Adressseite", () => {
  const extra = {
    PROJECT: [{ ID: 1, TENANT_ID: T, ADDRESS_ID: 2, ABBR: "P-2024-002", NAME: "Sanierung" }],
    INVOICE: [{ ID: 3, TENANT_ID: T, INVOICE_ADDRESS_ID: 2, INVOICE_NUMBER: "RE-2026-0042", INVOICE_DATE: "2026-07-08", PROJECT_ID: 1 }],
    CONTRACT: [{ ID: 5, TENANT_ID: T, INVOICE_ADDRESS_ID: 2, ABBR: "V-2024-002", NAME: "Hauptauftrag", PROJECT_ID: 1 }],
    CONTACTS: [{ ID: 8, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Rainer", LAST_NAME: "Vogt", SALUTATION_ID: 1, GENDER_ID: 1 }],
  };

  test("Rechnungen und Vertraege ueber den Rechnungsempfaenger", async () => {
    const links = await adressen.addressLinks(makeFakeSupabase(base(extra)), { tenantId: T, addressId: 2, can: () => true });
    expect(links.invoices.map(i => i.INVOICE_NUMBER)).toEqual(["RE-2026-0042"]);
    expect(links.contracts.map(c => c.ABBR)).toEqual(["V-2024-002"]);
    expect(links.projects).toHaveLength(1);
  });

  test("nur, was man sehen darf", async () => {
    const res = await call(ctrl.getAddressDetail, makeFakeSupabase(base(extra)), {
      params: { id: "2" }, permissions: ["addresses.view", "projects.view"],
    });
    expect(res.code).toBe(200);
    expect(res.body.data.projects).toHaveLength(1);
    expect(res.body.data.invoices).toEqual([]);
    expect(res.body.data.contacts).toEqual([]);
    expect(res.body.data.visible).toMatchObject({ projects: true, invoices: false, contacts: false, contracts: false });
  });
});

describe("Kontakte", () => {
  const body = { first_name: " Petra ", last_name: "Albrecht", salutation_id: 1, gender_id: 1, address_id: 2 };

  test("an fremder Adresse: abgelehnt", async () => {
    const db = makeFakeSupabase(base(), { strictSchema: true });
    const res = await call(ctrl.postContact, db, { body: { ...body, address_id: 50 } });
    expect(res.code).toBe(400);
    expect(res.body.error).toMatch(/gibt es nicht/);
  });

  test("Pflichtfelder werden benannt", async () => {
    const res = await call(ctrl.postContact, makeFakeSupabase(base()), { body: { ...body, first_name: "  ", gender_id: "" } });
    expect(res.code).toBe(400);
    expect(res.body.error).toBe("Bitte noch angeben: Vorname, Geschlecht.");
  });

  test("nur ein Hauptansprechpartner je Adresse, neue ID kommt zurueck", async () => {
    const db = makeFakeSupabase(base({ CONTACTS: [
      { ID: 8, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Rainer", LAST_NAME: "Vogt", IS_PRIMARY: 1 },
      { ID: 9, TENANT_ID: T, ADDRESS_ID: 1, FIRST_NAME: "Anna", LAST_NAME: "Andere", IS_PRIMARY: 1 },
    ] }), { strictSchema: true });
    const res = await call(ctrl.postContact, db, { body: { ...body, is_primary: true } });
    expect(res.code).toBe(200);
    const newId = res.body.data.ID;
    expect(newId).toBeTruthy();
    const all = (await db.from("CONTACTS").select("*")).data;
    expect(all.find(c => c.ID === 8).IS_PRIMARY).toBe(0);
    expect(all.find(c => c.ID === 9).IS_PRIMARY).toBe(1);   // andere Adresse bleibt
    expect(all.find(c => c.ID === newId)).toMatchObject({ FIRST_NAME: "Petra", IS_PRIMARY: 1 });
  });

  test("Aendern: fremder Kontakt ist 404, fremde Adresse 400", async () => {
    const db = makeFakeSupabase(base({ CONTACTS: [
      { ID: 8, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Rainer", LAST_NAME: "Vogt" },
      { ID: 70, TENANT_ID: F, ADDRESS_ID: 50, FIRST_NAME: "X", LAST_NAME: "Y" },
    ] }));
    expect((await call(ctrl.patchContact, db, { params: { id: "70" }, body })).code).toBe(404);
    expect((await call(ctrl.patchContact, db, { params: { id: "8" }, body: { ...body, address_id: 50 } })).code).toBe(400);
  });

  test("Liste: Adressnamen nur aus dem eigenen Mandanten", async () => {
    const db = makeFakeSupabase(base({ CONTACTS: [
      { ID: 8, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Rainer", LAST_NAME: "Vogt" },
      // Altlast: ein Kontakt, der auf eine fremde Adresse zeigt
      { ID: 9, TENANT_ID: T, ADDRESS_ID: 50, FIRST_NAME: "Alt", LAST_NAME: "Last" },
    ] }));
    const res = await call(ctrl.listContacts, db);
    const by = Object.fromEntries(res.body.data.map(c => [c.ID, c.ADDRESS]));
    expect(by[8]).toBe("Wohnbau Süd GmbH");
    expect(by[9]).toBe("");
  });
});

describe("Adresse anlegen und aendern", () => {
  test("Name aus Leerzeichen: abgelehnt, auch beim Aendern", async () => {
    const db = makeFakeSupabase(base());
    expect((await call(ctrl.postAddress, db, { body: { address_name_1: "   ", country_id: 1 } })).code).toBe(400);
    const r = await call(ctrl.patchAddress, db, { params: { id: "2" }, body: { address_name_1: "  ", country_id: 1 } });
    expect(r.code).toBe(400);
    expect(r.body.error).toMatch(/Namen/);
  });

  test("Anlegen kuerzt und liefert die neue ID", async () => {
    const db = makeFakeSupabase(base(), { strictSchema: true });
    const res = await call(ctrl.postAddress, db, { body: { address_name_1: "  Kreissparkasse ", country_id: "1", city: " Ulm " } });
    expect(res.code).toBe(200);
    const row = (await db.from("ADDRESS").select("*").eq("ID", res.body.data.ID)).data[0];
    expect(row).toMatchObject({ ADDRESS_NAME_1: "Kreissparkasse", CITY: "Ulm", TENANT_ID: T });
  });

  test("Aendern einer fremden Adresse: 404", async () => {
    const res = await call(ctrl.patchAddress, makeFakeSupabase(base()), { params: { id: "50" }, body: { address_name_1: "X", country_id: 1 } });
    expect(res.code).toBe(404);
  });
});

describe("Angebote: Ansprechpartner aus CONTACTS", () => {
  test("die Liste nennt den Kontakt", async () => {
    const db = makeFakeSupabase(base({
      OFFER: [{ ID: 1, TENANT_ID: T, ABBR: "A-1", ADDRESS_ID: 2, CONTACT_ID: 8 }],
      CONTACTS: [{ ID: 8, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Rainer", LAST_NAME: "Vogt" }],
      OFFER_STATUS: [], EMPLOYEE: [], OFFER_STRUCTURE: [],
    }));
    const rows = await angebote.listOffers(db, { tenantId: T });
    expect(JSON.stringify(rows[0])).toContain("Vogt");
  });
});

describe("Kontakte je Adresse (Vorbelegung, Runde 9)", () => {
  test("Hauptansprechpartner steht vorn und ist gekennzeichnet; fremde fehlen", async () => {
    const db = makeFakeSupabase(base({
      CONTACTS: [
        { ID: 8, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Anna", LAST_NAME: "Albers", IS_PRIMARY: 0 },
        { ID: 9, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Zoe", LAST_NAME: "Zeller", IS_PRIMARY: 1 },
        { ID: 10, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Ben", LAST_NAME: "Bauer", IS_PRIMARY: null },
        { ID: 60, TENANT_ID: F, ADDRESS_ID: 2, FIRST_NAME: "Fremd", LAST_NAME: "Fremd", IS_PRIMARY: 1 },
      ],
    }));
    const r = await call(ctrl.getContactsByAddress, db, { query: { address_id: "2" } });
    expect(r.body.data.map(c => [c.ID, c.IS_PRIMARY])).toEqual([[9, 1], [8, 0], [10, 0]]);
  });
});
