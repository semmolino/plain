"use strict";

// A2 (Audit 25.08.2026): getPhases rechnete die schon fakturierten Betraege aus
// den Rohdaten neu, savePhases nahm die gecachte Spalte PROJECT_STRUCTURE.INVOICED.
// Wich der Cache ab, zeigte der Vorschlag einen Betrag und fakturiert wurde ein
// anderer — ohne Warnung. Diese Tests halten fest, dass beide dasselbe rechnen.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { getPhases, savePhases } = require("../services/finalInvoices");

const TENANT = 1;
const CONTRACT = 10;
const DRAFT = 1;      // die Schlussrechnung im Entwurf
const BOOKED = 2;     // eine frueher gebuchte Schlussrechnung
const STRUCT = 500;

// REVENUE_COMPLETION 100.000, EXTRAS 0. Real fakturiert sind 30.000 ueber die
// gebuchte Rechnung 2. `cachedInvoiced` ist der Wert, der in der Spalte steht.
function fixture({ cachedInvoiced }) {
  return makeFakeSupabase({
    INVOICE: [
      { ID: DRAFT,  TENANT_ID: TENANT, STATUS_ID: 1, PROJECT_ID: 100, CONTRACT_ID: CONTRACT, INVOICE_TYPE: "schlussrechnung", VAT_PERCENT: 19 },
      { ID: BOOKED, TENANT_ID: TENANT, STATUS_ID: 2, PROJECT_ID: 100, CONTRACT_ID: CONTRACT, INVOICE_TYPE: "schlussrechnung", VAT_PERCENT: 19 },
    ],
    INVOICE_STRUCTURE: [
      { ID: 1, TENANT_ID: TENANT, INVOICE_ID: BOOKED, STRUCTURE_ID: STRUCT, AMOUNT_NET: 30000, AMOUNT_EXTRAS_NET: 0 },
    ],
    INVOICE_DEDUCTION: [],
    PARTIAL_PAYMENT: [],
    PARTIAL_PAYMENT_STRUCTURE: [],
    PROJECT_STRUCTURE: [
      {
        ID: STRUCT, TENANT_ID: TENANT, PROJECT_ID: 100, CONTRACT_ID: CONTRACT,
        NAME_SHORT: "LPH 1-9", NAME_LONG: "Gebaeude", BILLING_TYPE_ID: 1,
        REVENUE_COMPLETION: 100000, EXTRAS_PERCENT: 0,
        PARTIAL_PAYMENTS: 0, INVOICED: cachedInvoiced,
        CLOSED_BY_INVOICE_ID: null, FATHER_ID: null,
      },
    ],
  });
}

async function savedAmount(supabase) {
  await savePhases(supabase, { id: DRAFT, tenantId: TENANT, structureIds: [STRUCT] });
  const { data } = await supabase
    .from("INVOICE_STRUCTURE").select("AMOUNT_NET, AMOUNT_EXTRAS_NET").eq("INVOICE_ID", DRAFT);
  return (data || []).reduce((s, r) => s + Number(r.AMOUNT_NET) + Number(r.AMOUNT_EXTRAS_NET), 0);
}

describe("finalInvoices — Vorschlag und Speichern rechnen gleich (A2)", () => {
  it("zieht bei gedriftetem Cache trotzdem die real fakturierten 30.000 ab", async () => {
    // Der Kern des Befunds: die Spalte steht auf 0, real fakturiert sind 30.000.
    const supabase = fixture({ cachedInvoiced: 0 });

    const phases = await getPhases(supabase, { id: DRAFT, tenantId: TENANT });
    expect(phases).toHaveLength(1);
    expect(phases[0].BILLED_FINAL).toBe(30000);

    // Vorher standen hier 100.000 — 30.000 davon waren schon fakturiert.
    expect(await savedAmount(supabase)).toBe(70000);
  });

  it("liefert bei sauberem Cache unveraendert denselben Betrag", async () => {
    const supabase = fixture({ cachedInvoiced: 30000 });

    const phases = await getPhases(supabase, { id: DRAFT, tenantId: TENANT });
    expect(phases[0].BILLED_FINAL).toBe(30000);
    expect(await savedAmount(supabase)).toBe(70000);
  });

  it("Vorschlag und Speichern stimmen ueberein, egal was im Cache steht", async () => {
    for (const cachedInvoiced of [0, 15000, 30000, 99999]) {
      const supabase = fixture({ cachedInvoiced });
      const phases = await getPhases(supabase, { id: DRAFT, tenantId: TENANT });
      const vorschlag = phases[0].TOTAL_EARNED - phases[0].BILLED_FINAL;
      expect(await savedAmount(supabase)).toBe(vorschlag);
    }
  });
});
