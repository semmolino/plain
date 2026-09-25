"use strict";

// UI-Pilot Runde 2: der Schlussrechnungs-Assistent merkt sich im Entwurf,
// welche Sicherheitseinbehalte aufgeloest werden sollen (Migration 0171).
// Vorher ging die Auswahl erst beim Buchen an den Server; ein fortgesetzter
// Entwurf hatte wieder alle vorgewaehlt.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { patchInvoice } = require("../services/invoices");

const TENANT = 1;
const current = { ID: 7, STATUS_ID: 1, TOTAL_AMOUNT_NET: 1000, VAT_PERCENT: 19 };

function fixture() {
  return makeFakeSupabase({
    INVOICE: [{ ID: 7, TENANT_ID: TENANT, STATUS_ID: 1, INVOICE_TYPE: "schlussrechnung", SE_RELEASE_ADVANCE_IDS: null }],
  });
}

async function row(sb) {
  const { data } = await sb.from("INVOICE").select("*").eq("ID", 7).maybeSingle();
  return data;
}

describe("patchInvoice: SE-Auswahl im Entwurf", () => {
  it("speichert die gewaehlten Abschlaege als Zahlen, ohne Dubletten und Unsinn", async () => {
    const sb = fixture();
    await patchInvoice(sb, { id: 7, body: { se_release_advance_ids: ["3", 3, 5, "x", -1, 0] }, currentInv: current });
    expect((await row(sb)).SE_RELEASE_ADVANCE_IDS).toEqual([3, 5]);
  });

  it("eine leere Liste heisst: nichts aufloesen — sie bleibt leer, nicht NULL", async () => {
    const sb = fixture();
    await patchInvoice(sb, { id: 7, body: { se_release_advance_ids: [] }, currentInv: current });
    expect((await row(sb)).SE_RELEASE_ADVANCE_IDS).toEqual([]);
  });

  it("null setzt zurueck auf „nie gewaehlt“ (dann gilt wieder: alle)", async () => {
    const sb = fixture();
    await patchInvoice(sb, { id: 7, body: { se_release_advance_ids: [4] }, currentInv: current });
    await patchInvoice(sb, { id: 7, body: { se_release_advance_ids: null }, currentInv: current });
    expect((await row(sb)).SE_RELEASE_ADVANCE_IDS).toBeNull();
  });

  it("ohne das Feld bleibt die gespeicherte Auswahl stehen", async () => {
    const sb = fixture();
    await patchInvoice(sb, { id: 7, body: { se_release_advance_ids: [4] }, currentInv: current });
    await patchInvoice(sb, { id: 7, body: { comment: "x" }, currentInv: current });
    expect((await row(sb)).SE_RELEASE_ADVANCE_IDS).toEqual([4]);
  });
});
