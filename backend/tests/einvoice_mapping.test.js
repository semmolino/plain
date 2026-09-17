"use strict";

/**
 * Das Netz unter der BT-Registry.
 *
 * Die frühere Mapping-Tabelle (`backend/config/Mapping BT.xlsx`) hatte kein
 * solches Netz — sie konnte beliebig weit von der Wirklichkeit abweichen, ohne
 * dass irgendetwas rot wurde. Deshalb prüfen diese Tests nicht die Tabelle
 * gegen sich selbst, sondern gegen die tatsächlich erzeugten Dokumente.
 */

const fs = require("fs");

const registry = require("../einvoice/btRegistry");
const codelists = require("../einvoice/codelists");
const profiles = require("../einvoice/profiles");
const { runRegistryCheck, renderReferencePaths } = require("../einvoice/registryCheck");
const docGen = require("../einvoice/generateMappingDoc");
const { leafPaths } = require("../einvoice/xmlPaths");
const { referenceInvoiceData, referenceDocuments } = require("../einvoice/referenceDocument");
const { generateCiiXml } = require("../services_einvoice_cii");
const { generateUblXml } = require("../services_einvoice_ubl");

const norm = (s) => s.replace(/\r\n/g, "\n");

describe("BT-Registry — Drift-Check", () => {
  const result = runRegistryCheck();

  it("meldet keinen Fehler", () => {
    if (result.errors.length) console.error("Drift:\n" + result.errors.join("\n"));
    expect(result.errors).toEqual([]);
  });

  it("prüft mehr als ein Dutzend Felder (der Check läuft wirklich)", () => {
    // Ohne diese Zusicherung könnte der Check stillschweigend leer laufen und
    // wäre trotzdem grün — der Fehlermodus, den die Excel hatte.
    expect(result.stats.emitted).toBeGreaterThan(50);
    expect(result.stats.ciiBlattpfade).toBeGreaterThan(50);
    expect(result.stats.ublBlattpfade).toBeGreaterThan(50);
  });
});

describe("BT-Registry — Integrität", () => {
  it("jede Kennung ist eindeutig", () => {
    const ids = registry.all().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("jedes ausgegebene Feld nennt mindestens einen XML-Pfad und seine Herkunft", () => {
    for (const e of registry.emitted()) {
      expect(`${e.id}: ${e.cii || e.ubl}`).not.toMatch(/: null$/);
      expect(typeof e.source).toBe("string");
    }
  });

  it("jedes Feld ohne Pfad ist als nicht ausgegeben gekennzeichnet", () => {
    for (const e of registry.all()) {
      if (!e.cii && !e.ubl) expect(e.status).not.toBe("emitted");
    }
  });

  it("jedes geladene, aber ungenutzte Feld ist begründet", () => {
    // Genau diese drei Felder hat das Audit als Befund S3 geführt. Sie
    // verschweigen heißt: der nächste Leser hält sie für ausgegeben.
    const unused = registry.all().filter((e) => e.status === "loaded-unused");
    expect(unused.length).toBeGreaterThan(0);
    for (const e of unused) expect(typeof e.note).toBe("string");
  });
});

describe("Erzeugte Mapping-Doku ist aktuell", () => {
  it("docs/EINVOICE_BT_MAPPING.md stimmt mit der Registry überein (sonst: npm run einvoice:gen)", () => {
    const onDisk = norm(fs.readFileSync(docGen.DOC_PATH, "utf8"));
    expect(onDisk).toBe(norm(docGen.build()));
  });
});

describe("Codelisten", () => {
  it("Belegart: Abschlag heißt in CII 875 und in UBL 326", () => {
    const args = { docType: "ADVANCE_INVOICE", invoiceType: "partial_payment" };
    expect(codelists.documentTypeCode({ ...args, syntax: "CII" })).toBe("875");
    expect(codelists.documentTypeCode({ ...args, syntax: "UBL" })).toBe("326");
  });

  it("Belegart: Schlussrechnung nur in CII als 877, in UBL als 380", () => {
    const args = { docType: "INVOICE", invoiceType: "schlussrechnung" };
    expect(codelists.documentTypeCode({ ...args, syntax: "CII" })).toBe("877");
    expect(codelists.documentTypeCode({ ...args, syntax: "UBL" })).toBe("380");
  });

  it("Belegart: Storno schlägt jede andere Einordnung", () => {
    for (const syntax of ["CII", "UBL"]) {
      expect(codelists.documentTypeCode({
        docType: "ADVANCE_INVOICE", invoiceType: "partial_payment", isCancellation: true, syntax,
      })).toBe("384");
      expect(codelists.documentTypeCode({
        docType: "INVOICE", invoiceType: "schlussrechnung", isCancellation: true, syntax,
      })).toBe("384");
    }
  });

  it("jeder erzeugte Belegartcode ist in seiner Syntax zulässig", () => {
    const faelle = [
      { docType: "INVOICE", invoiceType: "rechnung" },
      { docType: "INVOICE", invoiceType: "schlussrechnung" },
      { docType: "INVOICE", invoiceType: "teilschlussrechnung" },
      { docType: "INVOICE", invoiceType: "gutschrift" },
      { docType: "INVOICE", invoiceType: "stornorechnung" },
      { docType: "ADVANCE_INVOICE", invoiceType: "partial_payment" },
      { docType: "ADVANCE_INVOICE", invoiceType: "stornorechnung", isCancellation: true },
    ];
    for (const f of faelle) {
      for (const syntax of ["CII", "UBL"]) {
        const code = codelists.documentTypeCode({ ...f, syntax });
        expect(`${f.invoiceType}/${syntax}/${code}`)
          .toBe(`${f.invoiceType}/${syntax}/${codelists.isValidDocumentTypeCode(code, syntax) ? code : "UNZULAESSIG"}`);
      }
    }
  });

  it("Steuerkategorie: Unbekanntes fällt auf S bzw. Z zurück, nicht durch", () => {
    expect(codelists.normalizeVatCategory("xyz", 19)).toBe("S");
    expect(codelists.normalizeVatCategory("", 0)).toBe("Z");
    expect(codelists.normalizeVatCategory("ae", 0)).toBe("AE");
  });

  it("jede Kategorie außer S verlangt den Steuersatz 0", () => {
    for (const c of Object.values(codelists.UNTDID_5305)) {
      expect(`${c.code}:${c.zeroRate}`).toBe(`${c.code}:${c.code !== "S"}`);
    }
  });

  it("jede Kategorie mit Befreiungspflicht hat einen Standardtext und eine Regel", () => {
    for (const c of Object.values(codelists.UNTDID_5305)) {
      if (!c.requiresReason) continue;
      expect(typeof c.defaultReasonDe).toBe("string");
      expect(c.reasonRule).toMatch(/^BR-/);
    }
  });

  it("Z verlangt bewusst keinen Befreiungsgrund", () => {
    expect(codelists.UNTDID_5305.Z.requiresReason).toBe(false);
    expect(codelists.defaultExemptionReason("Z")).toBeNull();
  });
});

describe("Profile", () => {
  it("jedes CII-Profil hat eine Kennung, ein unbekanntes wirft", () => {
    for (const key of Object.keys(profiles.CII_PROFILES)) {
      expect(profiles.ciiProfile(key).id).toMatch(/^urn:/);
    }
    expect(() => profiles.ciiProfile("GIBTSNICHT")).toThrow(/Unknown CII profile/);
  });

  it("XRechnung und Peppol tragen verschiedene CustomizationIDs, aber dieselbe ProfileID (S6)", () => {
    const x = profiles.ublFlavor("XRECHNUNG");
    const p = profiles.ublFlavor("PEPPOL");
    expect(x.customizationId).not.toBe(p.customizationId);
    expect(x.profileId).toBe(p.profileId);
  });
});

describe("Die Registry beschreibt das Dokument, das wirklich rausgeht", () => {
  const data = referenceInvoiceData();
  const cii = generateCiiXml(data, profiles.CII_DEFAULT_PROFILE);
  const ubl = generateUblXml(data);

  it("BT-11 (Projektreferenz) steht an dem Pfad, den die Registry nennt", () => {
    // Stellvertretend für das Prinzip, und mit Bedacht dieses Feld: BT-11 war
    // monatelang geladen und wurde nie ausgegeben, ohne dass die Excel etwas
    // gemerkt hätte.
    const e = registry.get("BT-11");
    const wert = (xml, pfad) => leafPaths(xml).find((l) => l.path === pfad)?.value;
    expect(wert(cii, e.cii)).toBe(data.projectNumber);
    expect(wert(ubl, e.ubl)).toBe(data.projectNumber);
  });

  it("kein ausgegebenes Feld verweist auf ein Element, das es nicht gibt", () => {
    const { ciiPaths, ublPaths } = renderReferencePaths();
    const fehlend = registry.emitted().flatMap((e) => [
      e.cii && !ciiPaths.has(e.cii) ? `${e.id} (CII)` : null,
      e.ubl && !ublPaths.has(e.ubl) ? `${e.id} (UBL)` : null,
    ].filter(Boolean));
    expect(fehlend).toEqual([]);
  });

  it("kein Element im Dokument bleibt ohne Eintrag", () => {
    const { ciiPaths, ublPaths } = renderReferencePaths();
    const claimed = new Set([
      ...registry.all().flatMap((e) => [e.cii, e.ubl].filter(Boolean)),
      ...registry.structuralPaths().map((s) => s.path),
    ]);
    expect([...ciiPaths, ...ublPaths].filter((p) => !claimed.has(p))).toEqual([]);
  });
});

describe("Musterbelege", () => {
  it("decken den Regelsteuersatz und eine steuerbefreite Kategorie ab", () => {
    const kategorien = referenceDocuments().map((d) => d.data.vatBreakdown[0].category);
    expect(kategorien).toContain("S");
    expect(kategorien.some((c) => c !== "S")).toBe(true);
  });

  it("der Reverse-Charge-Beleg trägt Befreiungsgrund in Text und Code", () => {
    const rc = referenceDocuments().find((d) => d.data.vatBreakdown[0].category === "AE");
    const ubl = generateUblXml(rc.data);
    expect(ubl).toContain("<cbc:TaxExemptionReasonCode>");
    expect(ubl).toContain("§13b UStG");
  });
});
