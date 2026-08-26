"use strict";

// S2 (Audit 25.08.2026) — der Test, den das Audit als ersten sinnvollen nennt.
//
// Alle anderen E-Rechnungs-Tests bauen ihr Fixture von Hand in der Sprache des
// Validators. Genau daran ist N1 so lange unentdeckt geblieben: der Validator
// las `l.name` und `t.netTotal`, das Datenmodell lieferte `description` und
// `totals.lineTotal` — die Vorpruefung schlug fuer JEDE echte Rechnung fehl,
// waehrend die Testsuite gruen war.
//
// Dieser Test schliesst die Luecke: er laesst `loadInvoiceData` gegen ein
// Fixture laufen und steckt DEREN Ergebnis in `validateEInvoiceData`. Ein
// Feldname, den nur eine der beiden Seiten kennt, faellt hier sofort auf.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { loadInvoiceData } = require("../services_einvoice_data");
const { validateEInvoiceData } = require("../services_einvoice_validator");

const TENANT = 1;
const INVOICE_ID = 500;

// Ein vollstaendig gepflegter Beleg: Firma mit IBAN, USt-IdNr und Steuernummer,
// Mitarbeiter mit Telefon und Mail, Rechnungsadresse mit PLZ und Ort.
// Nichts davon ist Zierrat — jedes Feld haengt an einer Validator-Regel.
function fixture(overrides = {}) {
  const invoice = Object.assign({
    ID: INVOICE_ID,
    TENANT_ID: TENANT,
    STATUS_ID: 2,
    INVOICE_NUMBER: "RG-2026-0042",
    INVOICE_DATE: "2026-06-09",
    INVOICE_TYPE: "rechnung",
    INVOICE_ADDRESS_ID: 900,
    COMPANY_ID: 10,
    EMPLOYEE_ID: 20,
    CONTRACT_ID: 30,
    PROJECT_ID: 40,
    CURRENCY_ID: null,
    VAT_PERCENT: 19,
    VAT_CATEGORY: "S",

    // Verkaeufer, im Beleg denormalisiert
    COMPANY_NAME_1: "Architektur GmbH",
    "COMPANY_TAX-ID": "DE123456789",
    COMPANY_TAX_NUMBER: "143/815/09321",
    COMPANY_IBAN: "DE02120300000000202051",
    COMPANY_BIC: "BYLADEM1001",

    // Verkaeufer-Ansprechpartner (BG-6)
    EMPLOYEE: "S. Messina",
    EMPLOYEE_PHONE: "+49 89 1234567",
    EMPLOYEE_MAIL: "info@example.de",

    // Kaeufer
    ADDRESS_NAME_1: "Bauherr AG",
    ADDRESS_COUNTRY: "DE",
    ADDRESS_VAT_ID: "DE987654321",

    BUYER_REFERENCE: "04011000-1234512345-06",

    TOTAL_AMOUNT_NET: 4500,
    TAX_AMOUNT_NET: 855,
    TOTAL_AMOUNT_GROSS: 5355,
  }, overrides.invoice || {});

  const company = Object.assign({
    ID: 10, TENANT_ID: TENANT,
    COMPANY_NAME_1: "Architektur GmbH",
    STREET: "Hauptstr. 1", POST_CODE: "80331", CITY: "München",
    COUNTRY_ID: 1,
    IBAN: "DE02120300000000202051", BIC: "BYLADEM1001",
  }, overrides.company || {});

  const address = Object.assign({
    ID: 900, TENANT_ID: TENANT,
    ADDRESS_NAME_1: "Bauherr AG",
    STREET: "Bauplatz 9", POST_CODE: "10115", CITY: "Berlin",
    COUNTRY_ID: 1,
    VAT_ID: "DE987654321",
  }, overrides.address || {});

  return makeFakeSupabase({
    INVOICE: [invoice],
    COMPANY: [company],
    ADDRESS: [address],
    EMPLOYEE: [{
      ID: 20, TENANT_ID: TENANT,
      FIRST_NAME: "Simon", LAST_NAME: "Messina",
      PHONE: "+49 89 1234567", MAIL: "info@example.de",
    }],
    COUNTRY: [{ ID: 1, NAME_SHORT: "DE" }],
    CONTRACT: [{ ID: 30, TENANT_ID: TENANT, SE_LEGAL_REFERENCE: null }],
    INVOICE_STRUCTURE: [
      { ID: 1, TENANT_ID: TENANT, INVOICE_ID: INVOICE_ID, STRUCTURE_ID: 700, AMOUNT_NET: 3000, AMOUNT_EXTRAS_NET: 0 },
      { ID: 2, TENANT_ID: TENANT, INVOICE_ID: INVOICE_ID, STRUCTURE_ID: 701, AMOUNT_NET: 1500, AMOUNT_EXTRAS_NET: 0 },
    ],
    PROJECT_STRUCTURE: [
      { ID: 700, TENANT_ID: TENANT, NAME_SHORT: "LPH 1", NAME_LONG: "Grundlagenermittlung", BILLING_TYPE_ID: 1 },
      { ID: 701, TENANT_ID: TENANT, NAME_SHORT: "LPH 2", NAME_LONG: "Vorplanung", BILLING_TYPE_ID: 1 },
    ],
    INVOICE_DEDUCTION: [],
    PARTIAL_PAYMENT: [],
    TEC: [],
  });
}

const load = (supabase) => loadInvoiceData(supabase, INVOICE_ID, "INVOICE", TENANT);

describe("loadInvoiceData → validateEInvoiceData (S2)", () => {
  it("ein vollstaendig gepflegter Beleg laeuft ohne einen einzigen Fehler durch", async () => {
    const data = await load(fixture());
    const r = validateEInvoiceData(data);

    // Die eigentliche Zusicherung. Schlaegt sie fehl, liest eine Validator-Regel
    // ein Feld, das loadInvoiceData nicht liefert (oder anders nennt) -- genau
    // der Fehler N1. Die Meldungen mit ausgeben, sonst raet man beim Debuggen.
    expect(r.errors.map(e => `${e.code}/${e.btField}: ${e.message}`)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("liefert die Feldnamen, die der Validator liest", async () => {
    const data = await load(fixture());

    // Festgeschriebener Vertrag zwischen beiden Modulen. Wird hier etwas
    // umbenannt, muss die Umbenennung bewusst durch diesen Test.
    expect(data.lines.length).toBe(2);
    expect(data.lines[0]).toHaveProperty("description");
    expect(data.lines[0]).toHaveProperty("lineTotal");
    expect(data.lines[0]).toHaveProperty("vatCategory");
    expect(data.totals).toHaveProperty("lineTotal");
    expect(data.totals).toHaveProperty("taxBasis");
    expect(data.totals).toHaveProperty("grandTotal");
    expect(data.totals).toHaveProperty("duePayable");
    for (const f of ["name", "city", "postCode", "countryId", "vatId", "taxId",
                     "iban", "contactName", "contactPhone", "contactEmail"]) {
      expect(data.seller).toHaveProperty(f);
    }
    for (const f of ["name", "city", "postCode", "countryId", "vatId"]) {
      expect(data.buyer).toHaveProperty(f);
    }
  });

  it("rechnet die Positionssumme aus den echten Strukturzeilen", async () => {
    const data = await load(fixture());
    expect(data.totals.lineTotal).toBe(4500);
    expect(data.lines.map(l => l.lineTotal)).toEqual([3000, 1500]);
  });

  // Die Gegenprobe: das Fixture muss die Regeln auch AUSLOESEN koennen. Ohne
  // diese Faelle wuerde der Test oben auch dann gruen bleiben, wenn der
  // Validator gar nichts mehr prueft.

  it("meldet die fehlende IBAN aus echten Belegdaten (N6)", async () => {
    const supabase = fixture({
      invoice: { COMPANY_IBAN: "" },
      company: { IBAN: "" },
    });
    const r = validateEInvoiceData(await load(supabase));
    expect(r.errors.some(e => e.btField === "BT-84")).toBe(true);
  });

  it("meldet die fehlende Telefonnummer des Ansprechpartners (N7)", async () => {
    // Die Nummer hat zwei Quellen: das Belegfeld EMPLOYEE_PHONE und als
    // Fallback der EMPLOYEE-Datensatz. Nur wenn beide leer sind, fehlt sie
    // wirklich -- deshalb hier ohne EMPLOYEE_ID.
    const data = await load(fixture({ invoice: { EMPLOYEE_PHONE: "", EMPLOYEE_ID: null } }));
    expect(validateEInvoiceData(data).errors.some(e => e.btField === "BT-42")).toBe(true);
  });

  it("nutzt den EMPLOYEE-Datensatz als Fallback fuer die Telefonnummer", async () => {
    // Belegfeld leer, Mitarbeiterstammdaten gepflegt -> kein Fehler.
    const data = await load(fixture({ invoice: { EMPLOYEE_PHONE: "", EMPLOYEE_MAIL: "" } }));
    expect(data.seller.contactPhone).toBe("+49 89 1234567");
    expect(validateEInvoiceData(data).errors.some(e => e.btField === "BT-42")).toBe(false);
  });

  it("meldet die fehlende Verkaeufer-PLZ (N8)", async () => {
    const supabase = fixture({ company: { POST_CODE: "" } });
    const r = validateEInvoiceData(await load(supabase));
    expect(r.errors.some(e => e.btField === "BT-38")).toBe(true);
  });
});

// ── N14: leere Belegspalte darf den Rueckgriff auf die Stammdaten nicht
//         aushebeln. Gefunden durch den Test oben, siehe Audit N14.

describe("Rueckgriff auf Stammdaten bei leerer Belegspalte (N14)", () => {
  const leer = (feld) => fixture({ invoice: { [feld]: "" } });

  it("nimmt die IBAN der Firma, wenn die Belegspalte leer ist", async () => {
    const data = await load(leer("COMPANY_IBAN"));
    expect(data.seller.iban).toBe("DE02120300000000202051");
    expect(validateEInvoiceData(data).errors.some(e => e.btField === "BT-84")).toBe(false);
  });

  it("nimmt Name, Strasse, PLZ und Ort der Firma", async () => {
    const data = await load(fixture({
      invoice: { COMPANY_NAME_1: "", COMPANY_STREET: "", COMPANY_POST_CODE: "", COMPANY_CITY: "" },
    }));
    expect(data.seller.name).toBe("Architektur GmbH");
    expect(data.seller.street).toBe("Hauptstr. 1");
    expect(data.seller.postCode).toBe("80331");
    expect(data.seller.city).toBe("München");
  });

  it("nimmt PLZ und Ort der Adresse fuer den Kaeufer", async () => {
    const data = await load(fixture({ invoice: { ADDRESS_POST_CODE: "", ADDRESS_CITY: "" } }));
    expect(data.buyer.postCode).toBe("10115");
    expect(data.buyer.city).toBe("Berlin");
  });

  it("faellt auch ueber reine Leerzeichen hinweg zurueck", async () => {
    const data = await load(leer("COMPANY_IBAN"));
    const data2 = await load(fixture({ invoice: { COMPANY_IBAN: "   " } }));
    expect(data2.seller.iban).toBe(data.seller.iban);
  });

  it("laesst den Belegwert weiterhin gewinnen, wenn er gefuellt ist", async () => {
    // Der Beleg friert den Stand zum Buchungszeitpunkt ein -- eine spaetere
    // Aenderung der Stammdaten darf ihn nicht ueberschreiben.
    const data = await load(fixture({ invoice: { COMPANY_IBAN: "DE99500105175473478604" } }));
    expect(data.seller.iban).toBe("DE99500105175473478604");
  });
});
