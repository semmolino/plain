"use strict";

// Vertrag laden (Reiter „Verträge", Runde 6): die USt-Kategorie gehoert in die
// Antwort. Fehlte sie, zeigte das Formular „Standard" und schrieb das beim
// naechsten Speichern zurueck — ein Vertrag nach §13b wurde still zum
// Regelsatz, und jede neue Rechnung daraus wies Umsatzsteuer aus.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const projekte = require("../services/projekte");

const T = 7;

function db() {
  return makeFakeSupabase({
    CONTRACT: [
      // fremder Mandant, gleiche Projektnummer
      { ID: 1, TENANT_ID: 99, PROJECT_ID: 5, ABBR: "FREMD", NAME: "fremd", VAT_CATEGORY: "S" },
      { ID: 3, TENANT_ID: T, PROJECT_ID: 5, ABBR: "V-2", NAME: "Nachtrag", VAT_CATEGORY: "S" },
      { ID: 2, TENANT_ID: T, PROJECT_ID: 5, ABBR: "V-1", NAME: "Hauptauftrag", INVOICE_ADDRESS_ID: 9,
        VAT_CATEGORY: "AE", VAT_EXEMPTION_REASON_CODE: "VATEX-EU-AE", VAT_EXEMPTION_REASON_TEXT: "Steuerschuldnerschaft des Leistungsempfängers",
        SE_ENABLED: true, SE_PERCENT: 5, SE_BASIS: "NETTO" },
    ],
    ADDRESS: [{ ID: 9, TENANT_ID: T, ADDRESS_NAME_1: "Stadt Musterstadt" }],
  });
}

describe("getContractByProject", () => {
  test("liefert USt-Kategorie und Begruendung mit", async () => {
    const c = await projekte.getContractByProject(db(), { projectId: 5, tenantId: T });
    expect(c).toMatchObject({
      ID: 2, VAT_CATEGORY: "AE", VAT_EXEMPTION_REASON_CODE: "VATEX-EU-AE",
      VAT_EXEMPTION_REASON_TEXT: "Steuerschuldnerschaft des Leistungsempfängers",
      SE_ENABLED: true, SE_PERCENT: 5, SE_BASIS: "NETTO",
      INVOICE_ADDRESS_NAME: "Stadt Musterstadt",
    });
  });

  test("nur der eigene Mandant, und immer derselbe (aeltester) Vertrag", async () => {
    const c = await projekte.getContractByProject(db(), { projectId: 5, tenantId: T });
    expect(c.ID).toBe(2);
    const none = await projekte.getContractByProject(db(), { projectId: 5, tenantId: 42 });
    expect(none).toBeNull();
  });
});
