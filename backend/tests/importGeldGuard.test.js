"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Die Beleg- und Zahlungs-Domänen brauchen mehr als `import.manage`.
//
// `import.manage` heisst "darf Altbestand einspielen" und liegt bei Inhaber
// und Administrator. Ein Beleg-Import erzeugt daraus aber Forderungen,
// Umsatzzahlen und die Grundlage des Mahnwesens. Dafuer verlangt der Import
// zusaetzlich das Recht, das in der Anwendung denselben Schritt erlaubt:
// `invoices.book` bzw. `payments.create`.
//
// Struktureller Test wie in routes_gates.test.js: er faellt auch dann auf,
// wenn jemand SPAETER eine gelderzeugende Domaene ergaenzt und das Zusatzrecht
// vergisst — und genau so entstehen solche Luecken.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const { DOMAINS } = require("../services/importService");

const QUELLE = fs.readFileSync(path.join(__dirname, "..", "routes", "import.js"), "utf8");

/** Domaenen, die gebuchte Gelddaten erzeugen — hier gepflegt, nicht geraten. */
const GELD_DOMAENEN = ["opening_balance", "open_items", "document_payments"];

describe("Zusatzrecht fuer gelderzeugende Import-Domaenen", () => {
  it("fuehrt jede Geld-Domäne in ZUSATZRECHT", () => {
    const block = QUELLE.match(/const ZUSATZRECHT = \{([\s\S]*?)\};/);
    expect(block).toBeTruthy();
    for (const d of GELD_DOMAENEN) {
      expect(block[1]).toContain(d);
    }
  });

  it("verlangt bestehende Rechte, kein neu erfundenes", () => {
    const block = QUELLE.match(/const ZUSATZRECHT = \{([\s\S]*?)\};/)[1];
    // invoices.book und payments.create gibt es im Katalog (0062/0063) und
    // sie haengen an einer Rechnungs-Capability. Ein neues Recht ohne
    // Zuordnung im Lizenz-Manifest wuerde in JEDEM Tarif wirken.
    expect(block).toContain("invoices.book");
    expect(block).toContain("payments.create");
    expect(block).not.toContain("import.finance");
  });

  it("haengt den Guard an Vorschau und Commit", () => {
    for (const pfad of ["/:domain/preview", "/:domain/commit"]) {
      const zeile = QUELLE.split(/\r?\n/).find((z) => z.includes(pfad));
      expect(zeile).toBeTruthy();
      expect(zeile).toContain("geldGuard");
    }
  });

  // Beim Ruecksetzen steht die Domaene nicht im Pfad, sondern im Stapel. Ohne
  // eigene Pruefung duerfte jemand Umsatzzahlen LOESCHEN, die er nicht setzen
  // darf.
  it("prueft auch beim Zuruecksetzen", () => {
    const zeile = QUELLE.split(/\r?\n/).find((z) => z.includes("/batches/:id/rollback"));
    expect(zeile).toContain("geldGuardAusStapel");
  });

  it("nennt nur Domänen, die es wirklich gibt", () => {
    // document_payments entsteht noch — die uebrigen muessen registriert sein.
    for (const d of GELD_DOMAENEN.filter((x) => x !== "document_payments")) {
      expect(Object.keys(DOMAINS)).toContain(d);
    }
  });
});
