"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Domäne "Zahlungseingänge" (09/2026)
//
// Der Belegimport kennt ein Feld „bereits bezahlt": EINE Zahlung je Beleg. Das
// genügt für den einfachen Fall und verliert alles andere — Teilzahlungen,
// einen zweiten Eingang, Skonto, und vor allem Zahlungen zu Belegen, die in
// einem FRÜHEREN Stapel oder in plan&simple selbst entstanden sind.
//
// Die Domäne legt keine Belege an: findet sie den Beleg nicht, ist das ein
// Fehler. Eine Zahlung ohne Forderung wäre eine Behauptung über Geld.
// ─────────────────────────────────────────────────────────────────────────────

const { commit, preview, rollback } = require("../services/importService");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { xlsxBuffer } = require("./helpers/sheetFixture");

const TENANT = 7;
const EMPLOYEE = 99;

const HEAD = [
  "Belegnummer", "Beleg-ID im Altsystem", "Projektnummer (Kontrolle)", "Zahlungsdatum",
  "Zahlbetrag brutto", "Skontoabzug brutto", "Verwendungszweck", "Bemerkung",
];
const row = (...cells) => { const r = [...cells]; while (r.length < HEAD.length) r.push(""); return r; };

/** Ein gebuchter Abschlag über 10.000 netto / 11.900 brutto auf Knoten 42. */
const seed = (extra = {}) => makeFakeSupabase({
  PROJECT: [{ ID: 1, TENANT_ID: TENANT, ABBR: "P-1", PAYED: 0 }],
  PROJECT_STRUCTURE: [
    { ID: 42, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, ABBR: "LP5", BILLING_TYPE_ID: 1, PAYED: 0 },
    { ID: 43, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: null, ABBR: "LP6", BILLING_TYPE_ID: 1, PAYED: 0 },
  ],
  ADVANCE_INVOICE: [{
    ID: 500, TENANT_ID: TENANT, PROJECT_ID: 1, CONTRACT_ID: 31, STATUS_ID: 2,
    ADVANCE_INVOICE_NUMBER: "AR-2025-007", LEGACY_REF: "wiko-4711",
    TOTAL_AMOUNT_GROSS: 11900, VAT_PERCENT: 19,
  }],
  ADVANCE_INVOICE_STRUCTURE: [
    { ID: 601, TENANT_ID: TENANT, ADVANCE_INVOICE_ID: 500, STRUCTURE_ID: 42, AMOUNT_NET: 6000, AMOUNT_EXTRAS_NET: 0 },
    { ID: 602, TENANT_ID: TENANT, ADVANCE_INVOICE_ID: 500, STRUCTURE_ID: 43, AMOUNT_NET: 4000, AMOUNT_EXTRAS_NET: 0 },
  ],
  INVOICE: [], INVOICE_STRUCTURE: [], PAYMENT: [], PAYMENT_STRUCTURE: [], PROJECT_PROGRESS: [],
  ...extra,
});

const lauf = async (zeilen, supabase) => commit({
  domainKey: "document_payments", buffer: await xlsxBuffer([HEAD, ...zeilen]),
  filename: "zahlungen.xlsx", mapping: null, supabase, tenantId: TENANT, employeeId: EMPLOYEE,
});
const vorschau = async (zeilen, supabase) => preview({
  domainKey: "document_payments", buffer: await xlsxBuffer([HEAD, ...zeilen]),
  filename: "zahlungen.xlsx", mapping: null, supabase, tenantId: TENANT,
});
const texte = (zeile) => zeile.messages.map((m) => m.text).join(" | ");
const knoten = (sb, id) => sb._tables.PROJECT_STRUCTURE.find((s) => s.ID === id);

describe("Zahlungseingänge", () => {
  it("schreibt Zahlung, Positionen und Projektstand", async () => {
    const sb = seed();
    await lauf([row("AR-2025-007", "", "", "20.12.2025", "11900")], sb);

    expect(sb._tables.PAYMENT).toHaveLength(1);
    expect(sb._tables.PAYMENT[0]).toMatchObject({
      ADVANCE_INVOICE_ID: 500, AMOUNT_PAYED_GROSS: 11900, AMOUNT_PAYED_NET: 10000,
      AMOUNT_PAYED_VAT: 1900, PAYMENT_DATE: "2025-12-20",
    });
    // Proportional zu den Positionen des BELEGS, nicht über die Knoten des Projekts.
    expect(sb._tables.PAYMENT_STRUCTURE.map((z) => z.AMOUNT_PAYED_NET).sort()).toEqual([4000, 6000]);
    expect(knoten(sb, 42).PAYED).toBe(6000);
    expect(sb._tables.PROJECT[0].PAYED).toBe(10000);
  });

  it("nimmt mehrere Teilzahlungen auf denselben Beleg", async () => {
    const sb = seed();
    await lauf([
      row("AR-2025-007", "", "", "20.12.2025", "5000"),
      row("AR-2025-007", "", "", "15.01.2026", "6900"),
    ], sb);

    expect(sb._tables.PAYMENT).toHaveLength(2);
    expect(sb._tables.PROJECT[0].PAYED).toBe(10000);
  });

  it("findet den Beleg auch über die Kennung aus dem Altsystem", async () => {
    const sb = seed();
    await lauf([row("", "wiko-4711", "", "20.12.2025", "11900")], sb);
    expect(sb._tables.PAYMENT[0].ADVANCE_INVOICE_ID).toBe(500);
  });

  // Der Kern der Prüfung: das fängt den doppelten Import derselben Datei
  // ebenso wie die Doppelerfassung über das Feld „bereits bezahlt".
  it("lehnt ab, wenn die Summe den Beleg übersteigt", async () => {
    const sb = seed();
    const pv = await vorschau([
      row("AR-2025-007", "", "", "20.12.2025", "8000"),
      row("AR-2025-007", "", "", "15.01.2026", "8000"),
    ], sb);

    expect(pv.summary.error).toBe(2);
    expect(texte(pv.rows[0])).toContain("11900.00");
  });

  it("rechnet bereits vorhandene Zahlungen mit", async () => {
    const sb = seed({ PAYMENT: [{ ID: 900, TENANT_ID: TENANT, ADVANCE_INVOICE_ID: 500, AMOUNT_PAYED_GROSS: 10000 }] });
    const pv = await vorschau([row("AR-2025-007", "", "", "20.12.2025", "5000")], sb);
    expect(pv.summary.error).toBe(1);
    expect(texte(pv.rows[0])).toContain("bereits");
  });

  it("lehnt eine Zahlung ohne Beleg ab, statt einen anzulegen", async () => {
    const pv = await vorschau([row("GIBTESNICHT", "", "", "20.12.2025", "100")], seed());
    expect(pv.summary.error).toBe(1);
    expect(texte(pv.rows[0])).toContain("nicht gefunden");
  });

  it("lehnt eine Zahlung auf einen Entwurf ab", async () => {
    const sb = seed();
    sb._tables.ADVANCE_INVOICE[0].STATUS_ID = 1;
    const pv = await vorschau([row("AR-2025-007", "", "", "20.12.2025", "100")], sb);
    expect(texte(pv.rows[0])).toContain("nicht gebucht");
  });

  it("warnt bei abweichender Projektnummer, hält aber nicht auf", async () => {
    const sb = seed();
    const pv = await vorschau([row("AR-2025-007", "", "P-FALSCH", "20.12.2025", "1000")], sb);
    expect(pv.summary.error).toBe(0);
    expect(texte(pv.rows[0])).toContain("es gilt der Beleg");
  });

  // Ohne eigene Zeile schließt der offene Posten nie auf null — der Beleg
  // bliebe für immer teilbezahlt stehen.
  it("bucht den Skontoabzug als eigene Zahlung", async () => {
    const sb = seed();
    await lauf([row("AR-2025-007", "", "", "20.12.2025", "11662", "238")], sb);

    expect(sb._tables.PAYMENT).toHaveLength(2);
    const skonto = sb._tables.PAYMENT.find((z) => /Skonto/.test(z.PURPOSE_OF_PAYMENT));
    expect(skonto.AMOUNT_PAYED_GROSS).toBe(238);
    expect(sb._tables.PROJECT[0].PAYED).toBe(10000);   // zusammen voll bezahlt
  });

  it("nimmt den Stapel restlos zurück", async () => {
    const sb = seed();
    const { batchId } = await lauf([row("AR-2025-007", "", "", "20.12.2025", "11900")], sb);
    expect(sb._tables.PAYMENT).toHaveLength(1);

    await rollback({ batchId, supabase: sb, tenantId: TENANT });

    expect(sb._tables.PAYMENT).toHaveLength(0);
    expect(sb._tables.PAYMENT_STRUCTURE).toHaveLength(0);
    expect(knoten(sb, 42).PAYED).toBe(0);
    expect(sb._tables.PROJECT[0].PAYED).toBe(0);
    // Der Beleg selbst bleibt — er stammt nicht aus diesem Stapel.
    expect(sb._tables.ADVANCE_INVOICE).toHaveLength(1);
  });

  it("meldet je Tabelle eine Zahl", async () => {
    const sb = seed();
    const res = await lauf([row("AR-2025-007", "", "", "20.12.2025", "11900")], sb);
    expect(res.belege).toMatchObject({ zahlungen: 1, positionen: 2, knoten: 2, projekte: 1 });
  });
});
