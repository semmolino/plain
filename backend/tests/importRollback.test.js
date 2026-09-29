"use strict";

// Import-Rücknahme (UI-Pilot Runde 11): erst prüfen, dann ändern; bricht es
// unterwegs ab, steht der Stapel auf „teilweise zurückgesetzt" und lässt sich
// erneut zurücksetzen.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { rollback } = require("../services/importService");

const T = 1;

function employeeBatch(extra = {}) {
  return {
    IMPORT_BATCH: [{
      ID: 5, TENANT_ID: T, DOMAIN: "employee", STATUS: "committed",
      SUMMARY_JSON: { undo: [{ table: "EMPLOYEE", id: 1, before: { PHONE: "0751 1" } }] },
    }],
    EMPLOYEE: [
      { ID: 1, TENANT_ID: T, ABBR: "SM", PHONE: "0751 NEU" },                          // zusammengeführt
      { ID: 20, TENANT_ID: T, ABBR: "NE", IMPORT_BATCH_ID: 5, SUPERVISOR_ID: null },    // importiert
      { ID: 21, TENANT_ID: T, ABBR: "OK", IMPORT_BATCH_ID: 5, SUPERVISOR_ID: 20 },
      { ID: 3, TENANT_ID: T, ABBR: "LH", SUPERVISOR_ID: 21 },
    ],
    EMPLOYEE_ROLE: [
      { EMPLOYEE_ID: 20, ROLE_ID: 3, IMPORT_BATCH_ID: 5 },
      { EMPLOYEE_ID: 21, ROLE_ID: 2 },                        // später von Hand vergeben
      { EMPLOYEE_ID: 3, ROLE_ID: 3, ASSIGNED_BY: 20 },
      { EMPLOYEE_ID: 1, ROLE_ID: 2, IMPORT_BATCH_ID: 5 },     // beim Zusammenführen dazugekommen
    ],
    EMPLOYEE_COST_RATE: [
      { ID: 1, TENANT_ID: T, EMPLOYEE_ID: 20, COST_RATE: 50, VALID_FROM: "2026-01-01", IMPORT_BATCH_ID: 5 },
      { ID: 2, TENANT_ID: T, EMPLOYEE_ID: 21, COST_RATE: 52, VALID_FROM: "2026-06-01" },  // von Hand
      { ID: 3, TENANT_ID: T, EMPLOYEE_ID: 3, COST_RATE: 49, VALID_FROM: "2026-01-01" },
    ],
    EMPLOYEE_WORK_MODEL: [], VACATION_ENTITLEMENT: [{ ID: 1, TENANT_ID: T, EMPLOYEE_ID: 21, YEAR: 2026, DAYS_ENTITLED: 30 }],
    EMPLOYEE_MONTH_CLOSE: [], DEPARTMENT: [],
    PROJECT: [], BOOKING: [], EMPLOYEE2PROJECT: [], ABSENCE: [],
    OFFER: [], INVOICE: [], ADVANCE_INVOICE: [], MAHNUNG: [], NACHTRAG: [],
    ...extra,
  };
}

describe("Rücknahme eines Mitarbeiter-Imports", () => {
  test("ein Angebot am importierten Mitarbeiter blockiert — vor jeder Änderung", async () => {
    const sb = makeFakeSupabase(employeeBatch({ OFFER: [{ ID: 9, TENANT_ID: T, EMPLOYEE_ID: 20 }] }));
    await expect(rollback({ batchId: 5, supabase: sb, tenantId: T })).rejects.toMatchObject({ status: 409 });
    expect(sb._tables.EMPLOYEE.find(e => e.ID === 1).PHONE).toBe("0751 NEU");   // nicht zurückgeschrieben
    expect(sb._tables.EMPLOYEE_ROLE).toHaveLength(4);
    expect(sb._tables.IMPORT_BATCH[0].STATUS).toBe("committed");
  });

  test("räumt auch von Hand Ergänztes ab und löst Verweise", async () => {
    const sb = makeFakeSupabase(employeeBatch());
    const r = await rollback({ batchId: 5, supabase: sb, tenantId: T });
    expect(r).toMatchObject({ rolledBack: true, deleted: 2, restored: 1 });
    expect(sb._tables.EMPLOYEE.map(e => e.ID).sort()).toEqual([1, 3]);
    expect(sb._tables.EMPLOYEE.find(e => e.ID === 1).PHONE).toBe("0751 1");
    expect(sb._tables.EMPLOYEE.find(e => e.ID === 3).SUPERVISOR_ID).toBeNull();
    expect(sb._tables.EMPLOYEE_ROLE).toEqual([{ EMPLOYEE_ID: 3, ROLE_ID: 3, ASSIGNED_BY: null }]);
    expect(sb._tables.EMPLOYEE_COST_RATE.map(x => x.ID)).toEqual([3]);
    expect(sb._tables.VACATION_ENTITLEMENT).toHaveLength(0);
    expect(sb._tables.IMPORT_BATCH[0].STATUS).toBe("rolled_back");
  });

  test("Abbruch unterwegs → „teilweise zurückgesetzt“, ein zweiter Versuch setzt fort", async () => {
    const sb = makeFakeSupabase(employeeBatch());
    const from = sb.from.bind(sb);
    let fail = true;
    sb.from = (t) => {
      const b = from(t);
      if (t !== "EMPLOYEE") return b;
      const del = b.delete.bind(b);
      b.delete = (...a) => {
        if (!fail) return del(...a);
        fail = false;
        const err = { then: (ok) => Promise.resolve({ data: null, error: { message: "Fremdschlüssel" } }).then(ok) };
        const chain = new Proxy(err, { get: (o, k) => (k === "then" ? o.then : () => chain) });
        return chain;
      };
      return b;
    };
    await expect(rollback({ batchId: 5, supabase: sb, tenantId: T })).rejects.toMatchObject({ status: 500, message: expect.stringMatching(/teilweise zurückgesetzt/) });
    expect(sb._tables.IMPORT_BATCH[0].STATUS).toBe("rollback_partial");
    expect(sb._tables.IMPORT_BATCH[0].SUMMARY_JSON.rollbackError).toMatch(/Fremdschlüssel/);

    const r = await rollback({ batchId: 5, supabase: sb, tenantId: T });
    expect(r.rolledBack).toBe(true);
    expect(sb._tables.EMPLOYEE.map(e => e.ID).sort()).toEqual([1, 3]);
    expect(sb._tables.IMPORT_BATCH[0].STATUS).toBe("rolled_back");
  });

  test("zurückgesetzt bleibt zurückgesetzt", async () => {
    const sb = makeFakeSupabase(employeeBatch());
    sb._tables.IMPORT_BATCH[0].STATUS = "rolled_back";
    await expect(rollback({ batchId: 5, supabase: sb, tenantId: T })).rejects.toMatchObject({ status: 400 });
  });
});

describe("Rücknahme mit Zusammenführung (allgemeiner Weg)", () => {
  test("Blocker verhindert auch das Zurückschreiben zusammengeführter Adressen", async () => {
    const sb = makeFakeSupabase({
      IMPORT_BATCH: [{ ID: 6, TENANT_ID: T, DOMAIN: "address", STATUS: "committed",
        SUMMARY_JSON: { undo: [{ table: "ADDRESS", id: 1, before: { CITY: "Alt" } }] } }],
      ADDRESS: [{ ID: 1, TENANT_ID: T, CITY: "Neu" }, { ID: 2, TENANT_ID: T, IMPORT_BATCH_ID: 6 }],
      PROJECT: [{ ID: 4, TENANT_ID: T, ADDRESS_ID: 2 }], CONTACTS: [],
    });
    await expect(rollback({ batchId: 6, supabase: sb, tenantId: T })).rejects.toMatchObject({ status: 409 });
    expect(sb._tables.ADDRESS.find(a => a.ID === 1).CITY).toBe("Neu");
    expect(sb._tables.IMPORT_BATCH[0].STATUS).toBe("committed");
  });
});
