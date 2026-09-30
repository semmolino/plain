"use strict";

// Zahlung erfassen (routes/payments.js):
// - Ueberzahlung nur mit Bestaetigung (docs/RECHNUNGSKUERZUNGEN_ANALYSE.md,
//   Nebenbefund 4). Vorher nahm der Endpunkt jeden Betrag > 0, der offene
//   Betrag wurde still negativ.
// - Bei Reverse-Charge/steuerfrei ist die ganze Zahlung Entgelt (Nebenbefund 7).
//   Vorher wurden auch dort 19 % Steuer herausgerechnet.

const express = require("express");
const makeRouter = require("../routes/payments");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");

const T = 1;

function welt(invoice = {}) {
  return makeFakeSupabase({
    INVOICE: [{ ID: 600, TENANT_ID: T, STATUS_ID: 2, INVOICE_TYPE: "rechnung", PROJECT_ID: 40, CONTRACT_ID: 30,
      VAT_ID: 1, VAT_PERCENT: 19, VAT_CATEGORY: "S", INVOICE_DATE: "2026-09-01",
      TOTAL_AMOUNT_NET: 1000, TAX_AMOUNT_NET: 190, TOTAL_AMOUNT_GROSS: 1190, ...invoice }],
    INVOICE_STRUCTURE: [{ ID: 1, TENANT_ID: T, INVOICE_ID: 600, STRUCTURE_ID: 500, AMOUNT_NET: 1000, AMOUNT_EXTRAS_NET: 0 }],
    PROJECT: [{ ID: 40, TENANT_ID: T, PAYED: 0 }],
    PROJECT_STRUCTURE: [{ ID: 500, TENANT_ID: T, FATHER_ID: null, PAYED: 0 }],
    VAT: [{ ID: 1, VAT_PERCENT: 19 }],
    PAYMENT: [], PAYMENT_STRUCTURE: [], RECEIVABLE_ADJUSTMENT: [], PROJECT_PROGRESS: [], ADVANCE_INVOICE: [],
  });
}

async function post(supabase, body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    req.permissions = new Set(["payments.create", "payments.view", "payments.delete"]);
    req.hasPermission = (k) => req.permissions.has(k);
    next();
  });
  app.use("/payments", makeRouter(supabase));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/payments`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

const zahlung = (extra = {}) => ({ invoice_id: 600, amount_payed_gross: 1300, payment_date: "2026-09-20", ...extra });

describe("Überzahlung", () => {
  test("mehr als offen ohne Bestätigung: 409, nichts gespeichert", async () => {
    const db = welt();
    const r = await post(db, zahlung());
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "OVERPAYMENT", open_amount: 1190 });
    expect(r.body.error).toMatch(/1\.190,00\s€ um 110,00\s€/);
    expect(db._tables.PAYMENT).toHaveLength(0);
  });

  test("mit Bestätigung wird sie erfasst", async () => {
    const db = welt();
    const r = await post(db, zahlung({ allow_overpayment: true }));
    expect(r.status).toBe(200);
    expect(db._tables.PAYMENT).toEqual([expect.objectContaining({ AMOUNT_PAYED_GROSS: 1300, AMOUNT_PAYED_NET: 1092.44 })]);
  });

  test("bis zum offenen Betrag wie bisher", async () => {
    const db = welt();
    expect((await post(db, zahlung({ amount_payed_gross: 1190 }))).status).toBe(200);
    // danach ist nichts mehr offen — jede weitere Zahlung ist eine Überzahlung
    const r = await post(db, zahlung({ amount_payed_gross: 10 }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/bereits vollständig erledigt/);
  });
});

describe("Zahlung bei Reverse-Charge", () => {
  test("ganze Zahlung ist Entgelt, keine Steuer herausgerechnet", async () => {
    const db = welt({ VAT_CATEGORY: "AE", TAX_AMOUNT_NET: 0, TOTAL_AMOUNT_GROSS: 1000 });
    const r = await post(db, zahlung({ amount_payed_gross: 1000 }));
    expect(r.status).toBe(200);
    expect(db._tables.PAYMENT[0]).toMatchObject({ AMOUNT_PAYED_NET: 1000, AMOUNT_PAYED_VAT: 0 });
  });
});
