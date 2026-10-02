"use strict";

// Der PDF-Renderer laeuft auf dem Server und rendert HTML mit Daten des
// Mandanten. Bis 10/2026 lief er mit JavaScript und offenem Netz: jedes
// url(...) oder <img src="http://…"> war eine Anfrage AUS dem Container.
// Dieser Test haelt einen echten HTTP-Server bereit und prueft, dass ihn
// keine Form von Verweis mehr erreicht — und dass eingebettete Inhalte
// (data:-URIs fuer Logo, Schriften, GiroCode) weiter wirken.

const http = require("http");
const { renderHtmlToPdf } = require("../services_pdf_render");
const { fontFaceCss } = require("../services_theme_fonts");

jest.setTimeout(60_000);

let server, base, hits;

beforeAll(async () => {
  hits = [];
  server = http.createServer((req, res) => { hits.push(req.url); res.end("x"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  const { chromium } = require("playwright-chromium");
  void chromium; // Browser schliesst mit dem Prozess
});

it("setzt keine einzige Netzwerkanfrage ab", async () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="${base}/link.css">
    <style>
      @import url("${base}/import.css");
      @font-face { font-family: X; src: url("${base}/font.woff2"); }
      body { background: url("${base}/bg.png"); font-family: X; }
    </style>
    <meta http-equiv="refresh" content="0;url=${base}/refresh">
  </head><body>
    <img src="${base}/img.png">
    <iframe src="${base}/frame"></iframe>
    <object data="${base}/object"></object>
    <script>fetch("${base}/script")</script>
    <p>Rechnung</p>
  </body></html>`;
  const pdf = await renderHtmlToPdf({ html });
  expect(pdf.length).toBeGreaterThan(1000);
  expect(hits).toEqual([]);
});

it("eingebettete Schriften wirken weiter (data:-URI ist kein Netz)", async () => {
  const html = `<!doctype html><html><head><style>${fontFaceCss("inter")}
    body { font-family: "Inter", sans-serif; }</style></head><body><p>Rechnung</p></body></html>`;
  const pdf = await renderHtmlToPdf({ html });
  expect(Buffer.from(pdf).toString("latin1")).toMatch(/Inter/);
  expect(hits).toEqual([]);
});
