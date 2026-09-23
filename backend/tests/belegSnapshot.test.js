"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Der Stammdaten-Abzug eines Belegs.
//
// Ein Beleg friert Firma, Mitarbeiter, Rechnungsadresse und Ansprechpartner so
// ein, wie sie am Tag der Rechnung aussahen — eine Rechnung von 2019 darf
// nicht die Adresse von heute zeigen.
//
// Der Abzug haengt an (Firma, Mitarbeiter, Vertrag), nicht am einzelnen Beleg:
// alle Belege desselben Vertrags tragen denselben. Genau deshalb kann der
// gebuendelte Import ihn einmal bauen und hineinspreizen, statt ihn je Beleg
// mit 14 Abfragen neu zu erfragen.
//
// Diese Tests halten die Spaltennamen fest. Ein Tippfehler darin ist im
// Betrieb ein 500er, im Code aber unsichtbar.
// ─────────────────────────────────────────────────────────────────────────────

const { belegSnapshot } = require("../services/belegSnapshot");

const basis = {
  tenantId: 7, projectId: 1, contractId: 31, companyId: 3, employeeId: 99,
  company: {
    COMPANY_NAME_1: "Architekten GmbH", STREET: "Hauptstr. 1", POST_CODE: "48431",
    CITY: "Rheine", IBAN: "DE02", BIC: "GENO", "TAX-ID": "DE123", "CREDITOR-ID": "CR-1",
  },
  companyCountryLong: "Deutschland",
  employee: { ABBR: "FH", FIRST_NAME: " Frank ", LAST_NAME: " Haus ", MAIL: "f@h.de", MOBILE: "0170" },
  employeeSalutation: "Herr",
  contract: { CURRENCY_ID: 1, VAT_CATEGORY: "AE", VAT_EXEMPTION_REASON_TEXT: "§13b UStG" },
  address: { ADDRESS_NAME_1: "Stadt Musterhausen", STREET: "Rathaus 1", CUSTOMER_NUMBER: "D-42", BUYER_REFERENCE: "991-123" },
  addressCountryShort: "DE", addressId: 11,
  contact: { FIRST_NAME: "Anna", LAST_NAME: "Meier", EMAIL: "a@m.de" },
  contactSalutation: "Frau", contactId: 21,
  vatId: 5, vatPercent: 19, paymentMeansId: 58,
};

describe("belegSnapshot", () => {
  it("friert Firma, Mitarbeiter, Adresse und Kontakt ein", () => {
    const r = belegSnapshot(basis);
    expect(r.COMPANY_NAME_1).toBe("Architekten GmbH");
    expect(r.COMPANY_COUNTRY).toBe("Deutschland");
    expect(r.ADDRESS_NAME_1).toBe("Stadt Musterhausen");
    expect(r.ADDRESS_COUNTRY).toBe("DE");
    expect(r.CONTACT).toBe("Anna Meier");
    expect(r.CONTACT_SALUTATION).toBe("Frau");
  });

  // Die beiden Spalten mit Bindestrich sind der haeufigste Tippfehler — sie
  // muessen in jeder Abfrage gequotet werden.
  it("traegt die Spalten mit Bindestrich richtig", () => {
    const r = belegSnapshot(basis);
    expect(r["COMPANY_TAX-ID"]).toBe("DE123");
    expect(r["COMPANY_CREDITOR-ID"]).toBe("CR-1");
  });

  it("setzt den Mitarbeiter als Kürzel plus Name zusammen und trimmt", () => {
    expect(belegSnapshot(basis).EMPLOYEE).toBe("FH: Frank Haus");
  });

  // Genau zwei Spalten unterscheiden sich zwischen den Belegarten. Wer sie
  // verwechselt, schreibt in eine Spalte, die es in der Tabelle nicht gibt.
  it("benennt Adresse und Kontakt je nach Belegart", () => {
    const rechnung = belegSnapshot({ ...basis, kind: "invoice" });
    expect(rechnung.INVOICE_ADDRESS_ID).toBe(11);
    expect(rechnung.INVOICE_CONTACT_ID).toBe(21);
    expect(rechnung).not.toHaveProperty("ADVANCE_INVOICE_ADDRESS_ID");

    const abschlag = belegSnapshot({ ...basis, kind: "advance" });
    expect(abschlag.ADVANCE_INVOICE_ADDRESS_ID).toBe(11);
    expect(abschlag.ADVANCE_INVOICE_CONTACT_ID).toBe(21);
    expect(abschlag).not.toHaveProperty("INVOICE_ADDRESS_ID");
  });

  // Die Abschlagsrechnung ist eine eigene Tabelle und hat keine Typspalte.
  it("gibt der Abschlagsrechnung keine Belegart", () => {
    expect(belegSnapshot({ ...basis, kind: "invoice", invoiceType: "schlussrechnung" }).INVOICE_TYPE)
      .toBe("schlussrechnung");
    expect(belegSnapshot({ ...basis, kind: "advance" })).not.toHaveProperty("INVOICE_TYPE");
  });

  it("nimmt die Steuerkategorie vom Vertrag", () => {
    const r = belegSnapshot(basis);
    expect(r.VAT_CATEGORY).toBe("AE");
    expect(r.VAT_EXEMPTION_REASON_TEXT).toBe("§13b UStG");
  });

  it("faellt bei fehlender Steuerkategorie auf den Regelsatz zurück", () => {
    expect(belegSnapshot({ ...basis, contract: {} }).VAT_CATEGORY).toBe("S");
  });

  it("legt den Beleg als Entwurf an", () => {
    expect(belegSnapshot(basis).STATUS_ID).toBe(1);
  });

  // TENANT_ID gehoert in JEDE Nutzlast — RLS prueft WITH CHECK gegen die
  // vorgeschlagene Zeile, nicht gegen die gespeicherte.
  it("traegt den Mandanten", () => {
    expect(belegSnapshot(basis).TENANT_ID).toBe(7);
  });

  it("verträgt fehlende Stammdaten ohne zu werfen", () => {
    const r = belegSnapshot({ tenantId: 7, projectId: 1, contractId: 31 });
    expect(r.COMPANY_NAME_1).toBeNull();
    expect(r.EMPLOYEE).toBe(":");
    expect(r.TENANT_ID).toBe(7);
  });
});
