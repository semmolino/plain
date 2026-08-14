"use strict";

/**
 * Regressionstest zum Pentest-Befund vom 2026-08-06:
 * "Rechnungs-PDF wird ohne Mandantenpruefung gerendert".
 *
 * Der Renderer leitete den Mandanten frueher aus dem geladenen Datensatz ab
 * (`docMeta?.TENANT_ID`) statt aus der Sitzung des Aufrufers. Die Pruefung
 * bestaetigte damit nur, dass ein fremder Beleg zu seinem eigenen Mandanten
 * gehoert — sie war wirkungslos. Zusammen mit dem `?preview=1`-Zweig im
 * Controller liess sich jedes Rechnungs-PDF der Plattform abrufen.
 *
 * Diese Tests halten drei Eigenschaften fest:
 *   1. tenantId ist Pflicht — ein vergessener Aufrufer bekommt einen Fehler
 *   2. ein fremder Mandant bekommt "nicht gefunden", keine Daten
 *   3. die Antwort verraet nicht, ob der Beleg ueberhaupt existiert
 */

const { renderDocumentPdf, renderMahnungPdf } = require("../services_pdf_render");

/** Minimaler Supabase-Nachbau: kennt genau eine Rechnung (ID 1, Mandant 4). */
function fakeSupabase() {
  const ROWS = [{ ID: 1, TENANT_ID: 4, COMPANY_ID: 10 }];
  return {
    from() {
      const q = {
        _eq: {},
        select() { return q; },
        eq(col, val) { q._eq[col] = val; return q; },
        // Kettenglieder, die spaetere Aufrufe erwarten. Ohne sie protokolliert
        // der Renderer Warnungen, die mit dem Testgegenstand nichts zu tun haben.
        order() { return q; },
        limit() { return q; },
        in() { return q; },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
        async maybeSingle() {
          const hit = ROWS.find(
            (r) =>
              (q._eq.ID === undefined || String(r.ID) === String(q._eq.ID)) &&
              (q._eq.TENANT_ID === undefined || String(r.TENANT_ID) === String(q._eq.TENANT_ID))
          );
          return { data: hit || null, error: null };
        },
      };
      return q;
    },
  };
}

const render = (args) =>
  renderDocumentPdf({ supabase: fakeSupabase(), docType: "INVOICE", ...args });

describe("renderDocumentPdf — Mandantentrennung", () => {
  it("verlangt tenantId", async () => {
    await expect(render({ docId: 1 })).rejects.toThrow(/tenantId ist erforderlich/);
  });

  it("verlangt tenantId auch bei null", async () => {
    await expect(render({ docId: 1, tenantId: null })).rejects.toThrow(/tenantId ist erforderlich/);
  });

  it("verweigert einen Beleg aus einem fremden Mandanten", async () => {
    await expect(render({ docId: 1, tenantId: 6 })).rejects.toThrow(/nicht gefunden/);
  });

  it("antwortet bei fremdem und bei nicht existierendem Beleg gleich", async () => {
    // Sonst liesse sich ueber die Fehlermeldung ermitteln, welche Beleg-IDs
    // in anderen Mandanten existieren.
    const fremd = await render({ docId: 1, tenantId: 6 }).catch((e) => e.message);
    const gibtsNicht = await render({ docId: 999, tenantId: 4 }).catch((e) => e.message);
    expect(fremd).toBe(gibtsNicht);
  });

  it("laesst den eigenen Mandanten die Mandantenpruefung passieren", async () => {
    // Der Aufruf scheitert danach an fehlenden Stammdaten im Nachbau — das ist
    // erwartet. Entscheidend ist, dass er NICHT an der Mandantenpruefung
    // scheitert.
    const msg = await render({ docId: 1, tenantId: 4 }).catch((e) => e.message);
    expect(msg).not.toMatch(/tenantId ist erforderlich/);
    expect(msg).not.toMatch(/nicht gefunden/);
  });
});

/**
 * Die Wache oben kam mit der Pentest-Haertung dazu, und jeder Aufrufer von
 * buildPdfViewModel wurde nachgezogen — einer nicht: renderMahnungPdf reichte
 * tenantId zwar an die Logo-Aufloesung weiter, aber nicht an das Belegmodell.
 * Damit war die PDF-Ausgabe fuer Mahnungen vollstaendig ausgefallen, waehrend
 * Liste, Statistik und Versand weiter funktionierten — der Ausfall sah deshalb
 * nach einem Anzeigefehler aus.
 *
 * Diese Tests halten fest, dass renderMahnungPdf denselben Vertrag erfuellt.
 */
describe("renderMahnungPdf — Mandantentrennung", () => {
  const mahnung = (args) =>
    renderMahnungPdf(fakeSupabase(), { invoiceId: 1, mahnstufe: 1, ...args });

  it("reicht tenantId bis zum Belegmodell durch", async () => {
    // Ohne die Weitergabe scheiterte JEDER Aufruf hier — auch der mit gueltigem
    // Mandanten. Genau das war der Fehler.
    const msg = await mahnung({ tenantId: 4 }).catch((e) => e.message);
    expect(msg).not.toMatch(/tenantId ist erforderlich/);
  });

  it("verlangt tenantId", async () => {
    await expect(mahnung({ tenantId: undefined })).rejects.toThrow(/tenantId ist erforderlich/);
  });

  it("verweigert eine Mahnung zu einem fremden Beleg", async () => {
    await expect(mahnung({ tenantId: 6 })).rejects.toThrow(/nicht gefunden/);
  });

  it("verlangt einen Beleg", async () => {
    await expect(mahnung({ invoiceId: null, ppId: null, tenantId: 4 }))
      .rejects.toMatchObject({ status: 400 });
  });
});
