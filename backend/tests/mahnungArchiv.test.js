"use strict";

// Versandte Mahnungen werden archiviert (Migration 0183). Vorher erzeugte jeder
// Abruf die Mahnung neu — mit heutigem Datum und heutigem Betrag. Eine Kopie
// des verschickten Briefs (§ 257 HGB) gab es nicht.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");

const mockStore = new Map();
const mockFail = { put: false, mail: false, render: false };
const mockMails = [];

jest.mock("../services/objectStorage", () => ({
  put: async (key, buffer) => { if (mockFail.put) throw new Error("Speicher weg"); mockStore.set(key, Buffer.from(buffer)); },
  getBuffer: async (key) => mockStore.get(key) ?? null,
  getStream: async (key) => (mockStore.has(key) ? { stream: null } : null),
  exists: async (key) => mockStore.has(key),
  remove: async (key) => { mockStore.delete(key); },
}));
jest.mock("../services_pdf_render", () => ({
  renderMahnungPdf: async (_sb, { mahnstufe }) => {
    if (mockFail.render) throw new Error("Renderer kaputt");
    return Buffer.from(`%PDF Mahnstufe ${mahnstufe}`);
  },
}));
jest.mock("../services/emailService", () => ({
  ...jest.requireActual("../services/emailService"),
  sendMail: async (m) => { if (mockFail.mail) throw new Error("SMTP weg"); mockMails.push(m); },
}));
jest.mock("../services/emailTemplates", () => ({
  composeMahnungEmail: async () => ({ to: "kunde@example.org", subject: "Mahnung", body: "Hallo <b>Kunde</b> & Co" }),
}));

const svc = require("../services/mahnungenService");

const T = 1;

function fixture() {
  return makeFakeSupabase({
    INVOICE: [{ ID: 50, TENANT_ID: T, COMPANY_ID: 7 }],
    MAHNUNG: [{ ID: 9, TENANT_ID: T, INVOICE_ID: 50, PP_ID: null, MAHNSTUFE: 2 }],
    MAHNUNG_SETTINGS: [{ ID: 1, TENANT_ID: T, MAHNSTUFE: 2, FEE: 5, LABEL: "1. Mahnung" }],
    MAHNUNG_HISTORY: [],
    ASSET: [],
  });
}
const rows = async (sb, table) => (await sb.from(table).select("*")).data;

beforeEach(() => { mockStore.clear(); mockMails.length = 0; Object.assign(mockFail, { put: false, mail: false, render: false }); });

describe("Mahnung versenden", () => {
  it("archiviert das verschickte PDF und verweist am Verlauf darauf", async () => {
    const sb = fixture();
    await svc.sendMahnungEmail(sb, { mahnungId: 9, tenantId: T, employeeId: 3 });

    const [asset] = await rows(sb, "ASSET");
    expect(asset).toMatchObject({ ASSET_TYPE: "PDF_DUNNING", COMPANY_ID: 7, MIME_TYPE: "application/pdf" });
    expect(mockStore.get(asset.STORAGE_KEY).toString()).toBe("%PDF Mahnstufe 2");

    const [hist] = await rows(sb, "MAHNUNG_HISTORY");
    expect(hist).toMatchObject({ EMAIL_SENT: true, PDF_ASSET_ID: asset.ID, FEE_AMOUNT: 5 });
    // Verschickt wurde genau das archivierte PDF.
    expect(mockMails[0].attachments[0].content.toString()).toBe("%PDF Mahnstufe 2");
  });

  it("der Mailtext wird in der HTML-Fassung nicht zu Markup", async () => {
    await svc.sendMahnungEmail(fixture(), { mahnungId: 9, tenantId: T });
    expect(mockMails[0].html).toContain("Hallo &lt;b&gt;Kunde&lt;/b&gt; &amp; Co");
    expect(mockMails[0].text).toBe("Hallo <b>Kunde</b> & Co");
  });

  it("ohne Ablage keine Mahnung: scheitert das Archiv, geht nichts raus", async () => {
    mockFail.put = true;
    const sb = fixture();
    await expect(svc.sendMahnungEmail(sb, { mahnungId: 9, tenantId: T })).rejects.toThrow();
    expect(mockMails).toHaveLength(0);
    expect(await rows(sb, "MAHNUNG_HISTORY")).toHaveLength(0);
  });

  it("scheitert der Versand, bleibt keine Kopie eines nie verschickten Briefs liegen", async () => {
    mockFail.mail = true;
    const sb = fixture();
    await expect(svc.sendMahnungEmail(sb, { mahnungId: 9, tenantId: T })).rejects.toThrow("SMTP weg");
    expect(await rows(sb, "ASSET")).toHaveLength(0);
    expect(mockStore.size).toBe(0);
    expect(await rows(sb, "MAHNUNG_HISTORY")).toHaveLength(0);
  });
});

describe("Mahnstufe setzen", () => {
  it("legt die Ausfertigung dieser Stufe als Kopie ab", async () => {
    const sb = fixture();
    await svc.upsertMahnung(sb, { body: { invoice_id: 50, mahnstufe: 3 }, tenantId: T, employeeId: 3 });
    const [hist] = await rows(sb, "MAHNUNG_HISTORY");
    expect(hist).toMatchObject({ MAHNSTUFE: 3, EMAIL_SENT: false });
    expect(hist.PDF_ASSET_ID).toBeTruthy();
  });

  it("ein Fehler beim PDF kippt das Setzen der Stufe nicht", async () => {
    mockFail.render = true;
    const sb = fixture();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await svc.upsertMahnung(sb, { body: { invoice_id: 50, mahnstufe: 3 }, tenantId: T });
    warn.mockRestore();
    const [m] = await rows(sb, "MAHNUNG");
    expect(m.MAHNSTUFE).toBe(3);
    expect((await rows(sb, "MAHNUNG_HISTORY"))[0].PDF_ASSET_ID ?? null).toBeNull();
  });
});

describe("archiviertes PDF abrufen", () => {
  it("nur im eigenen Mandanten und nur, wenn es eine Kopie gibt", async () => {
    const sb = fixture();
    await svc.sendMahnungEmail(sb, { mahnungId: 9, tenantId: T });
    const [hist] = await rows(sb, "MAHNUNG_HISTORY");

    await expect(svc.getHistoryPdfAsset(sb, { historyId: hist.ID, tenantId: T })).resolves.toMatchObject({ assetId: hist.PDF_ASSET_ID });
    await expect(svc.getHistoryPdfAsset(sb, { historyId: hist.ID, tenantId: 2 })).rejects.toMatchObject({ status: 404 });

    await sb.from("MAHNUNG_HISTORY").insert({ TENANT_ID: T, MAHNUNG_ID: 9, MAHNSTUFE: 1, EMAIL_SENT: true, FEE_AMOUNT: 0 });
    const alt = (await rows(sb, "MAHNUNG_HISTORY")).find((h) => !h.PDF_ASSET_ID);
    await expect(svc.getHistoryPdfAsset(sb, { historyId: alt.ID, tenantId: T })).rejects.toMatchObject({ status: 404 });
  });
});
