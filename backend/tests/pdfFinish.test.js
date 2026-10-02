"use strict";

// Seitenaufbau der Briefe (Vorlagen-Plan Stufe 4): Schema, CSS fuer Stile und
// DIN 5008, PDF-Nachbearbeitung (Briefpapier, Falzmarken, Folgeseitenkopf).

const { PDFDocument, PDFRawStream, decodePDFRawStream, StandardFonts, rgb } = require("pdf-lib");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { sanitizeTheme } = require("../services_theme_schema");
const { layoutCss, readableFooter } = require("../services_theme_styles");

async function contentPdf(pages = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]).drawText(`Seite ${i + 1}`, { x: 70, y: 700, size: 12, font });
  return Buffer.from(await doc.save());
}
async function letterheadPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawRectangle({ x: 0, y: 780, width: 595, height: 60, color: rgb(0.2, 0.4, 0.8) });
  return Buffer.from(await doc.save());
}
const contentsOf = (page) => page.node.normalizedEntries().Contents;
/** Entpackte Inhaltsstroeme einer Seite, in Zeichenreihenfolge. */
function streams(doc, page) {
  return contentsOf(page).asArray().map((ref) => {
    const st = doc.context.lookup(ref);
    return st instanceof PDFRawStream
      ? Buffer.from(decodePDFRawStream(st).decode()).toString("latin1")
      : st.getContentsString();
  })
    // pdf-lib klammert beim Lesen die vorhandenen Stroeme mit q … Q ein
    .filter((s) => !/^\s*[qQ]\s*$/.test(s));
}

describe("Schema", () => {
  it("Standard ist das bisherige Aussehen", () => {
    const t = sanitizeTheme({});
    expect(t.layout).toEqual({ style: "standard", din: "none", foldMarks: false, followHeader: false });
    expect(t.letterhead).toEqual({ assetId: null, pages: "first", hideFooter: false });
  });

  it("nur bekannte Werte; Briefpapier nur als positive ganze Zahl", () => {
    const t = sanitizeTheme({
      layout: { style: "barock", din: "C", foldMarks: "ja", followHeader: true },
      letterhead: { assetId: "5", pages: "jede", hideFooter: true },
    });
    expect(t.layout).toEqual({ style: "standard", din: "none", foldMarks: false, followHeader: true });
    expect(t.letterhead).toEqual({ assetId: null, pages: "first", hideFooter: true });
    expect(sanitizeTheme({ letterhead: { assetId: 7 } }).letterhead.assetId).toBe(7);
    expect(sanitizeTheme({ letterhead: { assetId: -1 } }).letterhead.assetId).toBeNull();
  });
});

describe("CSS für Stil und DIN 5008", () => {
  it("Standard ohne DIN: kein zusätzliches CSS (keine stille Umstellung)", () => {
    expect(layoutCss(sanitizeTheme({}))).toBe("");
    expect(readableFooter(sanitizeTheme({}))).toBe(false);
  });

  it("Stile setzen ihre Typografie, lesbare Fußzeile", () => {
    const klar = sanitizeTheme({ layout: { style: "klar" } });
    expect(layoutCss(klar)).toContain(".doc-title{ font-size:18pt");
    expect(layoutCss(klar)).toContain("tabular-nums");
    expect(readableFooter(klar)).toBe(true);
  });

  it("Form B: Anschriftzone ab 62,7 mm, Infoblock ab 50 mm, Logo gekappt", () => {
    const css = layoutCss(sanitizeTheme({ layout: { din: "B" }, header: { logoMaxHeightMm: 40 } }));
    // Inhalt beginnt 14 mm unter dem Blattrand: Anschriftfeld 45 mm → 31 mm
    expect(css).toContain(".logo-area{ height:31mm;");
    expect(css).toContain("margin:13.7mm 0 0 0");          // Ruecksendeangabe direkt ueber der Anschriftzone
    expect(css).toContain(".meta-col{ margin-top:-12.7mm; }"); // 62,7 − 50
    expect(css).toContain(".logo-area img{ max-height:27mm; }");
  });

  it("Form A liegt 18 mm höher", () => {
    expect(layoutCss(sanitizeTheme({ layout: { din: "A" } }))).toContain(".logo-area{ height:13mm;");
  });
});

describe("PDF-Nachbearbeitung", () => {
  const { finishPdf } = require("../services/pdfFinish");

  it("ohne Optionen unverändert", async () => {
    const pdf = await contentPdf();
    expect(await finishPdf(pdf, {})).toBe(pdf);
  });

  it("Briefpapier liegt UNTER dem Inhalt, nur auf Seite 1", async () => {
    const out = await PDFDocument.load(await finishPdf(await contentPdf(), { letterhead: { bytes: await letterheadPdf(), pages: "first" } }));
    const [p1, p2] = out.getPages();
    // als ERSTER Inhaltsstrom, also vor dem Text der Seite
    expect(streams(out, p1)[0]).toMatch(/\/PsLetterhead\S* Do/);
    expect(streams(out, p1).slice(1).join("")).not.toContain("PsLetterhead");
    expect(streams(out, p2).join("")).not.toContain("PsLetterhead");
  });

  it("„alle Seiten“ legt es überall unter; Folgeseitenkopf nur ab Seite 2; Falzmarken nur auf Seite 1", async () => {
    // Der Kopf kommt als eigene Seite (im Betrieb aus Chromium, Schrift eingebettet)
    const out = await PDFDocument.load(await finishPdf(await contentPdf(3), {
      letterhead: { bytes: await letterheadPdf(), pages: "all" },
      followHeaderPdf: async () => contentPdf(1),
      foldMarks: { din: "B" },
    }));
    const pages = out.getPages().map((p) => streams(out, p));
    for (const ps of pages) expect(ps[0]).toMatch(/\/PsLetterhead\S* Do/);
    const header = (ps) => (ps.join("\n").match(/\/EmbeddedPdfPage\S* Do/g) || []).length;
    expect(header(pages[0])).toBe(0);
    expect(header(pages[1])).toBe(1);
    expect(header(pages[2])).toBe(1);
    // drei Linien (zwei Falz-, eine Lochmarke) auf Seite 1, keine danach
    const lines = (ps) => (ps.join("\n").match(/ l\n/g) || []).length;
    expect(lines(pages[0])).toBe(3);
    expect(lines(pages[1])).toBe(0);
  });

  it("einseitiger Beleg: der Folgeseitenkopf wird gar nicht erst gerendert", async () => {
    const render = jest.fn(async () => contentPdf(1));
    await finishPdf(await contentPdf(1), { followHeaderPdf: render });
    expect(render).not.toHaveBeenCalled();
  });

  it("ein kaputtes Briefpapier verhindert den Beleg nicht", async () => {
    const pdf = await contentPdf(1);
    const out = await finishPdf(pdf, { letterhead: { bytes: Buffer.from("%PDF-kaputt"), pages: "first" } });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

describe("Briefpapier laden", () => {
  afterEach(() => { jest.resetModules(); jest.dontMock("../services/objectStorage"); });

  const db = () => makeFakeSupabase({
    COMPANY: [{ ID: 10, TENANT_ID: 1 }, { ID: 20, TENANT_ID: 2 }],
    ASSET: [
      { ID: 5, COMPANY_ID: 10, MIME_TYPE: "application/pdf", STORAGE_KEY: "k/lh.pdf" },
      { ID: 6, COMPANY_ID: 10, MIME_TYPE: "image/png", STORAGE_KEY: "k/logo.png" },
      { ID: 7, COMPANY_ID: 20, MIME_TYPE: "application/pdf", STORAGE_KEY: "k/fremd.pdf" },
    ],
  });

  it("nur eigenes PDF; fremdes Asset und Bild: ohne Briefpapier", async () => {
    jest.resetModules();
    jest.doMock("../services/objectStorage", () => ({ getBuffer: async () => Buffer.from("%PDF-1.7 …") }));
    const { loadLetterhead, finishOptions } = require("../services/pdfFinish");
    expect(await loadLetterhead({ supabase: db(), tenantId: 1, assetId: 5 })).toBeInstanceOf(Buffer);
    expect(await loadLetterhead({ supabase: db(), tenantId: 1, assetId: 6 })).toBeNull();
    expect(await loadLetterhead({ supabase: db(), tenantId: 1, assetId: 7 })).toBeNull();

    const theme = sanitizeTheme({ letterhead: { assetId: 7, hideFooter: true }, layout: { followHeader: true } });
    const opts = await finishOptions({ supabase: db(), tenantId: 1, theme, follow: "Rechnung 1" });
    // ohne Briefpapier bleibt die Fusszeile, auch wenn „weglassen" gewaehlt ist
    expect(opts).toMatchObject({ letterhead: null, hideFooter: false, followHeader: "Rechnung 1", foldMarks: null });
  });
});
