"use strict";

// Angebotsdaten speichern (UI-Pilot Runde 9). Vorher: ein leerer Titel wurde
// gespeichert, ein leerer Kontakt kam als 0 an und endete als Serverfehler,
// Adresse und Kontakt eines anderen Bueros bzw. einer anderen Adresse gingen
// durch, eine Wahrscheinlichkeit von 250 % auch, und ein fremdes Angebot
// meldete 500 statt 404.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const angebote = require("../services/angebote");

const T = 7, F = 99;

function db(extra = {}) {
  const sb = makeFakeSupabase({
    ADDRESS: [
      { ID: 1, TENANT_ID: T, ADDRESS_NAME_1: "Stadt Musterstadt" },
      { ID: 2, TENANT_ID: T, ADDRESS_NAME_1: "Wohnbau Süd GmbH" },
      { ID: 50, TENANT_ID: F, ADDRESS_NAME_1: "Fremdes Büro" },
    ],
    CONTACTS: [
      { ID: 11, TENANT_ID: T, ADDRESS_ID: 1, FIRST_NAME: "Petra", LAST_NAME: "Albrecht" },
      { ID: 21, TENANT_ID: T, ADDRESS_ID: 2, FIRST_NAME: "Jonas", LAST_NAME: "Keller" },
      { ID: 51, TENANT_ID: F, ADDRESS_ID: 50, FIRST_NAME: "Fremd", LAST_NAME: "Person" },
    ],
    OFFER: [
      { ID: 300, TENANT_ID: T, ABBR: "A-2026-004", NAME: "Neubau Kita", ADDRESS_ID: 1, CONTACT_ID: 11,
        EMPLOYEE_ID: 5, OFFER_STATUS_ID: 1, COMPANY_ID: 1, PROBABILITY: 50 },
      { ID: 900, TENANT_ID: F, ABBR: "X-1", NAME: "Fremd", ADDRESS_ID: 50, CONTACT_ID: 51 },
    ],
    OFFER_STRUCTURE: [],
    TENANT_SETTINGS: [],
    ...extra,
  }, { strictSchema: true });
  sb.rpc = async () => ({ data: "A-2026-005", error: null });
  return sb;
}

const update = (sb, body, offerId = 300) => angebote.updateOffer(sb, { tenantId: T, offerId, body });
const row = (sb, id = 300) => sb._tables.OFFER.find(o => o.ID === id);

describe("Angebot ändern", () => {
  test("gültige Änderung wird gespeichert", async () => {
    const sb = db();
    const r = await update(sb, { name: "  Neubau Kita Nord ", address_id: 2, contact_id: 21, probability: 70 });
    expect(r.NAME).toBe("Neubau Kita Nord");
    expect(row(sb)).toMatchObject({ ADDRESS_ID: 2, CONTACT_ID: 21, PROBABILITY: 70 });
  });

  test.each([
    ["leerer Titel", { name: "   " }, /Angebotstitel/],
    ["leerer Kontakt", { contact_id: "" }, /Kontakt/],
    ["Kontakt 0", { contact_id: 0 }, /Kontakt/],
    ["leere Adresse", { address_id: "" }, /Adresse/],
    ["leerer Status", { offer_status_id: "" }, /Angebotsstatus/],
    ["leer zuständig", { employee_id: "" }, /Zuständig/],
    ["Wahrscheinlichkeit über 100", { probability: 250 }, /0 und 100/],
    ["negative Wahrscheinlichkeit", { probability: -5 }, /0 und 100/],
  ])("%s → 400, nichts gespeichert", async (_n, body, msg) => {
    const sb = db();
    await expect(update(sb, body)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(msg) });
    expect(row(sb)).toMatchObject({ NAME: "Neubau Kita", ADDRESS_ID: 1, CONTACT_ID: 11, PROBABILITY: 50 });
  });

  test("leere Wahrscheinlichkeit heißt keine Angabe", async () => {
    const sb = db();
    await update(sb, { probability: "" });
    expect(row(sb).PROBABILITY).toBeNull();
  });

  test("Adresse eines anderen Büros wird abgewiesen", async () => {
    const sb = db();
    await expect(update(sb, { address_id: 50, contact_id: 51 })).rejects.toMatchObject({ status: 400 });
    expect(row(sb).ADDRESS_ID).toBe(1);
  });

  test("Kontakt einer anderen Adresse wird abgewiesen", async () => {
    const sb = db();
    await expect(update(sb, { address_id: 1, contact_id: 21 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/gehört nicht zur gewählten Adresse/) });
  });

  test("nur der Kontakt geändert: geprüft gegen die gespeicherte Adresse", async () => {
    const sb = db();
    await expect(update(sb, { contact_id: 21 })).rejects.toMatchObject({ status: 400 });
    sb._tables.CONTACTS.push({ ID: 12, TENANT_ID: T, ADDRESS_ID: 1, FIRST_NAME: "Lea", LAST_NAME: "Brandt" });
    await update(sb, { contact_id: 12 });
    expect(row(sb).CONTACT_ID).toBe(12);
  });

  test("nur die Adresse geändert: der alte Kontakt passt nicht mehr", async () => {
    await expect(update(db(), { address_id: 2 })).rejects.toMatchObject({ status: 400 });
  });

  test("fremdes Angebot → 404 statt Serverfehler", async () => {
    const sb = db();
    await expect(update(sb, { name: "Übernommen" }, 900)).rejects.toMatchObject({ status: 404 });
    expect(row(sb, 900).NAME).toBe("Fremd");
  });

  test("unbekanntes Angebot → 404", async () => {
    await expect(update(db(), { name: "X" }, 4711)).rejects.toMatchObject({ status: 404 });
  });

  test("Beauftragt markieren (ohne Empfänger) bleibt möglich", async () => {
    const sb = db();
    await update(sb, { order_date: "2026-09-29", project_id: null, offer_status_id: 3 });
    expect(row(sb)).toMatchObject({ ORDER_DATE: "2026-09-29", OFFER_STATUS_ID: 3 });
  });
});

describe("Angebot anlegen", () => {
  const body = (extra = {}) => ({
    name: "Umbau Rathaus", offer_status_id: 1, employee_id: 5, company_id: 1,
    address_id: 2, contact_id: 21, ...extra,
  });

  test("mit eigener Adresse und passendem Kontakt", async () => {
    const sb = db();
    const o = await angebote.createOffer(sb, { tenantId: T, body: body() });
    expect(o).toMatchObject({ ABBR: "A-2026-005", ADDRESS_ID: 2, CONTACT_ID: 21, TENANT_ID: T });
  });

  test.each([
    ["fremde Adresse", { address_id: 50, contact_id: 51 }],
    ["Kontakt einer anderen Adresse", { contact_id: 11 }],
    ["Wahrscheinlichkeit 120", { probability: 120 }],
  ])("%s → 400, kein Angebot", async (_n, extra) => {
    const sb = db();
    await expect(angebote.createOffer(sb, { tenantId: T, body: body(extra) })).rejects.toMatchObject({ status: 400 });
    expect(sb._tables.OFFER).toHaveLength(2);
  });
});
