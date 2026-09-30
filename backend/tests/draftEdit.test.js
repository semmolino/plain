"use strict";

// UI-Pilot Runde 3: ein Rechnungsentwurf laesst sich mit dem Anlege-Recht
// seiner Belegart bearbeiten, nicht nur mit invoices.edit. Gebuchte Belege
// und fremde Belegarten bleiben gesperrt.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { requireDraftEdit } = require("../middleware/draftEdit");

const TENANT = 1;

function fixture() {
  return makeFakeSupabase({
    INVOICE: [
      { ID: 10, TENANT_ID: TENANT, STATUS_ID: 1, INVOICE_TYPE: "rechnung" },
      { ID: 11, TENANT_ID: TENANT, STATUS_ID: 1, INVOICE_TYPE: "schlussrechnung" },
      { ID: 12, TENANT_ID: TENANT, STATUS_ID: 1, INVOICE_TYPE: "gutschrift" },
      { ID: 13, TENANT_ID: TENANT, STATUS_ID: 2, INVOICE_TYPE: "rechnung" },   // gebucht
      { ID: 14, TENANT_ID: 2,      STATUS_ID: 1, INVOICE_TYPE: "rechnung" },   // anderer Mandant
      { ID: 15, TENANT_ID: TENANT, STATUS_ID: 1, INVOICE_TYPE: "teilschlussrechnung" },
      { ID: 16, TENANT_ID: TENANT, STATUS_ID: 1, INVOICE_TYPE: null },
    ],
    ADVANCE_INVOICE: [
      { ID: 20, TENANT_ID: TENANT, STATUS_ID: 1 },
      { ID: 21, TENANT_ID: TENANT, STATUS_ID: 2 },
    ],
  });
}

async function run(table, id, perms) {
  const mw = requireDraftEdit(fixture(), table);
  const req = { params: { id: String(id) }, tenantId: TENANT, permissions: new Set(perms) };
  let status = null, body = null, passed = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  await mw(req, res, () => { passed = true; });
  return { passed, status, body };
}

describe("requireDraftEdit", () => {
  it("invoices.edit geht wie bisher durch — auch bei gebuchten Belegen", async () => {
    expect((await run("INVOICE", 13, ["invoices.edit"])).passed).toBe(true);
  });

  it("Anlege-Recht der Belegart reicht fuer einen Entwurf", async () => {
    expect((await run("INVOICE", 10, ["invoices.create_single"])).passed).toBe(true);
    expect((await run("INVOICE", 16, ["invoices.create_single"])).passed).toBe(true);   // ohne Art = Einzelrechnung
    expect((await run("INVOICE", 11, ["invoices.create_final"])).passed).toBe(true);
    expect((await run("INVOICE", 15, ["invoices.create_final"])).passed).toBe(true);
    expect((await run("INVOICE", 12, ["invoices.create_credit"])).passed).toBe(true);
    expect((await run("ADVANCE_INVOICE", 20, ["invoices.create_partial"])).passed).toBe(true);
  });

  it("ein Anlege-Recht einer anderen Art reicht nicht", async () => {
    const r = await run("INVOICE", 11, ["invoices.create_single", "invoices.create_credit"]);
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
    expect((await run("ADVANCE_INVOICE", 20, ["invoices.create_single"])).passed).toBe(false);
  });

  it("ein gebuchter Beleg braucht weiter invoices.edit", async () => {
    expect((await run("INVOICE", 13, ["invoices.create_single"])).status).toBe(403);
    expect((await run("ADVANCE_INVOICE", 21, ["invoices.create_partial"])).status).toBe(403);
  });

  it("fremde oder unbekannte Belege: 403 wie ein fehlendes Recht, nichts verraten", async () => {
    const fremd = await run("INVOICE", 14, ["invoices.create_single"]);
    const fehlt = await run("INVOICE", 999, ["invoices.create_single"]);
    expect(fremd.status).toBe(403);
    expect(fehlt.status).toBe(403);
    expect(fremd.body).toEqual(fehlt.body);
    expect(fremd.body.error).toMatch(/invoices\.edit/);
  });

  it("ungueltige ID: 403 ohne Datenbankabfrage", async () => {
    expect((await run("INVOICE", "abc", ["invoices.create_single"])).status).toBe(403);
  });
});
