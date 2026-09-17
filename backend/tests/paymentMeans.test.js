"use strict";

/**
 * Zahlungsart (BT-81) — globaler Katalog seit Migration 0163.
 *
 * WARUM ES DIESEN TEST GIBT
 *   Die Tabelle war bis 09/2026 wirkungslos: kein Auswahlfeld, kein PDF, und
 *   die E-Rechnung schrieb den Code fest als "58". Der einzige Schreibpfad
 *   uebernahm `payment_means_id` ungeprueft aus dem Request. Jetzt haengt am
 *   Wert das erzeugte XML — also muss geprueft sein, dass ein unbekannter Wert
 *   abgewiesen wird und ein fehlender Wert dasselbe XML wie bisher ergibt.
 */

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const {
  assertPaymentMeans,
  defaultPaymentMeansId,
  paymentMeansForEinvoice,
  SETTINGS_KEY,
} = require("../services/paymentMeans");
const { validateEInvoiceData } = require("../services_einvoice_validator");
const { referenceInvoiceData } = require("../einvoice/referenceDocument");

const TENANT = 4;

/** Der Katalog, wie ihn Migration 0163 hinterlaesst. */
function fixture(settings = []) {
  return makeFakeSupabase({
    PAYMENT_MEANS: [
      { ID: 1,  ABBR: "58", NAME: "SEPA-Überweisung" },
      { ID: 30, ABBR: "30", NAME: "Überweisung" },
      { ID: 59, ABBR: "59", NAME: "SEPA-Lastschrift" },
    ],
    TENANT_SETTINGS: settings,
  });
}

describe("Zahlungsart pruefen", () => {
  test("eine Zeile aus dem Katalog wird angenommen", async () => {
    await expect(assertPaymentMeans(fixture(), 30)).resolves.toBe(30);
  });

  test("eine unbekannte ID ist ein 400er, kein Fremdschluesselfehler", async () => {
    // Vorher lief der Wert bis in den INSERT durch und kam als 500 heraus.
    await expect(assertPaymentMeans(fixture(), 4711))
      .rejects.toMatchObject({ status: 400, message: "Unbekannte Zahlungsart" });
  });

  test("kein Wert ist ein 400er", async () => {
    await expect(assertPaymentMeans(fixture(), null))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe("Vorbelegung", () => {
  test("ungepflegt heisst null — kein stillschweigend gesetzter Wert", async () => {
    await expect(defaultPaymentMeansId(fixture(), TENANT)).resolves.toBeNull();
  });

  test("gepflegt und gueltig liefert die ID", async () => {
    const db = fixture([{ TENANT_ID: TENANT, KEY: SETTINGS_KEY, VALUE: "30" }]);
    await expect(defaultPaymentMeansId(db, TENANT)).resolves.toBe(30);
  });

  test("zeigt die Vorbelegung ins Leere, wird sie nicht uebernommen", async () => {
    // Kann passieren, wenn ein Katalogeintrag per Migration verschwindet.
    const db = fixture([{ TENANT_ID: TENANT, KEY: SETTINGS_KEY, VALUE: "999" }]);
    await expect(defaultPaymentMeansId(db, TENANT)).resolves.toBeNull();
  });
});

describe("Aufloesung fuer die E-Rechnung", () => {
  test("ohne Zuordnung bleibt es beim bisherigen Code 58", async () => {
    // Das ist der Grund, warum die 20 Bestandsbelege unveraendert bleiben.
    await expect(paymentMeansForEinvoice(fixture(), null))
      .resolves.toEqual({ code: "58", name: null });
  });

  test("mit Zuordnung kommen Code und Bezeichnung aus dem Katalog", async () => {
    await expect(paymentMeansForEinvoice(fixture(), 30))
      .resolves.toEqual({ code: "30", name: "Überweisung" });
  });

  test("ein Kuerzel ausserhalb UNTDID 4461 faellt auf 58 zurueck", async () => {
    const db = makeFakeSupabase({ PAYMENT_MEANS: [{ ID: 7, ABBR: "XYZ", NAME: "Krypto" }] });
    await expect(paymentMeansForEinvoice(db, 7))
      .resolves.toEqual({ code: "58", name: null });
  });
});

describe("Validator: nur ausgebbare Zahlungsarten", () => {
  const mitCode = (code) => ({ ...referenceInvoiceData(), paymentMeansCode: code });
  const befund = (data) =>
    validateEInvoiceData(data).errors.find((e) => e.code === "BR-DE-PM");

  test("SEPA-Ueberweisung und Ueberweisung gehen durch", () => {
    expect(befund(mitCode("58"))).toBeUndefined();
    expect(befund(mitCode("30"))).toBeUndefined();
  });

  test("SEPA-Lastschrift wird abgewiesen — BG-19 fehlt", () => {
    // Ohne diese Regel entstuende ein XML mit TypeCode 59 und ohne
    // Mandatsreferenz: beim Empfaenger eine harte Abweisung.
    const b = befund(mitCode("59"));
    expect(b).toBeTruthy();
    expect(b.btField).toBe("BT-81");
    expect(b.message).toMatch(/SEPA-Lastschrift/);
  });
});
