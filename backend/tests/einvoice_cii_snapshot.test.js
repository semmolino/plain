"use strict";

// R6 (Audit 25.08.2026): Beim Buchen wurde nur die UBL-Fassung eingefroren.
// Der CII-Endpunkt prueft auf DOCUMENT_XML_PROFILE === 'zugferd-*', gesetzt
// wurde dort aber immer 'xrechnung-ubl' -- die Bedingung traf nie zu. Das
// Hybrid-PDF hatte gar keine Snapshot-Pruefung.
//
// Folge: CII und Hybrid-PDF wurden bei JEDEM Abruf neu erzeugt. Jede Korrektur
// an den Buildern veraenderte damit rueckwirkend das Dokument bereits
// gebuchter Belege, waehrend deren UBL unveraendert blieb.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");

// Der Speicher wird im Test durch eine Map ersetzt -- objectStorage schreibt
// sonst gegen S3 bzw. die Platte.
const mockStore = new Map();
jest.mock("../services/objectStorage", () => ({
  put: async (key, buffer) => { mockStore.set(key, Buffer.from(buffer)); return { key }; },
  getBuffer: async (key) => mockStore.get(key) ?? null,
  getStream: async (key) => (mockStore.has(key) ? { stream: null } : null),
  exists: async (key) => mockStore.has(key),
  remove: async (key) => { mockStore.delete(key); },
}));

const { freezeCiiSnapshot, CII_SNAPSHOT_PROFILE_KEY } = require("../services/einvoiceSnapshot");
const { readXmlAssetString } = require("../services/generatedAssets");

const TENANT = 1;
const INVOICE_ID = 500;

function fixture() {
  return makeFakeSupabase({
    INVOICE: [{
      ID: INVOICE_ID, TENANT_ID: TENANT, STATUS_ID: 2,
      INVOICE_NUMBER: "RG-2026-0042", INVOICE_DATE: "2026-06-09",
      INVOICE_TYPE: "rechnung", INVOICE_ADDRESS_ID: 900,
      COMPANY_ID: 10, EMPLOYEE_ID: 20, CONTRACT_ID: 30, PROJECT_ID: 40,
      VAT_PERCENT: 19, VAT_CATEGORY: "S",
      COMPANY_NAME_1: "Architektur GmbH",
      "COMPANY_TAX-ID": "DE123456789", COMPANY_TAX_NUMBER: "143/815/09321",
      COMPANY_IBAN: "DE02120300000000202051",
      EMPLOYEE: "S. Messina", EMPLOYEE_PHONE: "+49 89 1234567", EMPLOYEE_MAIL: "info@example.de",
      ADDRESS_NAME_1: "Bauherr AG", ADDRESS_COUNTRY: "DE", ADDRESS_VAT_ID: "DE987654321",
      BUYER_REFERENCE: "04011000-1234512345-06",
      TOTAL_AMOUNT_NET: 4500, TAX_AMOUNT_NET: 855, TOTAL_AMOUNT_GROSS: 5355,
      DOCUMENT_XML_ASSET_ID: 77, DOCUMENT_XML_PROFILE: "xrechnung-ubl",
      DOCUMENT_XML_CII_ASSET_ID: null, DOCUMENT_XML_CII_PROFILE: null,
    }],
    COMPANY: [{
      ID: 10, TENANT_ID: TENANT, COMPANY_NAME_1: "Architektur GmbH",
      STREET: "Hauptstr. 1", POST_CODE: "80331", CITY: "München", COUNTRY_ID: 1,
      IBAN: "DE02120300000000202051",
    }],
    ADDRESS: [{
      ID: 900, TENANT_ID: TENANT, ADDRESS_NAME_1: "Bauherr AG",
      STREET: "Bauplatz 9", POST_CODE: "10115", CITY: "Berlin", COUNTRY_ID: 1,
      VAT_ID: "DE987654321",
    }],
    EMPLOYEE: [{ ID: 20, TENANT_ID: TENANT, FIRST_NAME: "Simon", LAST_NAME: "Messina" }],
    COUNTRY: [{ ID: 1, NAME_SHORT: "DE" }],
    CONTRACT: [{ ID: 30, TENANT_ID: TENANT }],
    INVOICE_STRUCTURE: [
      { ID: 1, TENANT_ID: TENANT, INVOICE_ID: INVOICE_ID, STRUCTURE_ID: 700, AMOUNT_NET: 4500, AMOUNT_EXTRAS_NET: 0 },
    ],
    PROJECT_STRUCTURE: [
      { ID: 700, TENANT_ID: TENANT, NAME_SHORT: "LPH 1", NAME_LONG: "Grundlagenermittlung", BILLING_TYPE_ID: 1 },
    ],
    INVOICE_DEDUCTION: [], PARTIAL_PAYMENT: [], TEC: [], ASSET: [],
  });
}

const freeze = (supabase) => freezeCiiSnapshot(supabase, {
  docType: "INVOICE", docId: INVOICE_ID, tenantId: TENANT,
  companyId: 10, fileBase: "ZUGFeRD_RG-2026-0042",
});

const invoiceRow = async (supabase) => {
  const { data } = await supabase.from("INVOICE").select("*").eq("ID", INVOICE_ID).maybeSingle();
  return data;
};

beforeEach(() => mockStore.clear());

describe("freezeCiiSnapshot (R6)", () => {
  it("legt die CII-Fassung ab und traegt sie in die eigenen Spalten ein", async () => {
    const supabase = fixture();
    const result = await freeze(supabase);

    expect(result).not.toBeNull();
    expect(result.profile).toBe(CII_SNAPSHOT_PROFILE_KEY);

    const row = await invoiceRow(supabase);
    expect(row.DOCUMENT_XML_CII_ASSET_ID).toBe(result.assetId);
    expect(row.DOCUMENT_XML_CII_PROFILE).toBe("zugferd-en16931");
    expect(row.DOCUMENT_XML_CII_RENDERED_AT).toBeTruthy();
  });

  it("laesst die UBL-Spalten unangetastet", async () => {
    const supabase = fixture();
    await freeze(supabase);
    const row = await invoiceRow(supabase);
    // Beide Fassungen nebeneinander, keine ueberschreibt die andere.
    expect(row.DOCUMENT_XML_ASSET_ID).toBe(77);
    expect(row.DOCUMENT_XML_PROFILE).toBe("xrechnung-ubl");
  });

  it("speichert echtes CII, nicht UBL", async () => {
    const supabase = fixture();
    const { assetId } = await freeze(supabase);
    const xml = await readXmlAssetString({ supabase, assetId, tenantId: TENANT });

    expect(xml).toContain("rsm:CrossIndustryInvoice");
    expect(xml).not.toContain("<Invoice");
    expect(xml).toContain("RG-2026-0042");
  });

  // Der eigentliche Zweck: das Dokument darf sich nicht mehr aendern.
  it("liefert nach dem Einfrieren denselben Inhalt, egal wie oft gelesen wird", async () => {
    const supabase = fixture();
    const { assetId } = await freeze(supabase);

    const a = await readXmlAssetString({ supabase, assetId, tenantId: TENANT });
    const b = await readXmlAssetString({ supabase, assetId, tenantId: TENANT });
    expect(b).toBe(a);
  });

  it("aendert den Snapshot nicht, wenn sich die Belegdaten spaeter aendern", async () => {
    const supabase = fixture();
    const { assetId } = await freeze(supabase);
    const vorher = await readXmlAssetString({ supabase, assetId, tenantId: TENANT });

    // Nach dem Buchen greift jemand in die Daten -- der eingefrorene Beleg
    // darf davon nichts mitbekommen.
    await supabase.from("INVOICE")
      .update({ COMPANY_NAME_1: "Ganz andere GmbH", TOTAL_AMOUNT_NET: 99999 })
      .eq("ID", INVOICE_ID);

    const nachher = await readXmlAssetString({ supabase, assetId, tenantId: TENANT });
    expect(nachher).toBe(vorher);
    expect(nachher).toContain("Architektur GmbH");
    expect(nachher).not.toContain("Ganz andere GmbH");
  });

  it("gibt null zurueck statt zu werfen, wenn der Beleg nicht ladbar ist", async () => {
    const supabase = makeFakeSupabase({ INVOICE: [], ASSET: [] });
    await expect(freeze(supabase)).resolves.toBeNull();
  });
});

describe("readXmlAssetString", () => {
  it("gibt null zurueck, wenn keine Asset-Id uebergeben wird", async () => {
    expect(await readXmlAssetString({ supabase: fixture(), assetId: null, tenantId: TENANT })).toBeNull();
  });

  it("gibt null zurueck, wenn die Datei fehlt -- der Aufrufer faellt dann live zurueck", async () => {
    const supabase = fixture();
    const { assetId } = await freeze(supabase);
    mockStore.clear();   // Datei weg, Zeile bleibt
    expect(await readXmlAssetString({ supabase, assetId, tenantId: TENANT })).toBeNull();
  });
});
