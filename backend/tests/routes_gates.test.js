"use strict";

/**
 * Regressionstest zu den Pentest-Befunden vom 2026-08-06: ungegatete
 * mutierende Endpunkte.
 *
 * Statt jede Route einzeln aufzurufen, wird hier die Quelldatei geprueft:
 * traegt jeder mutierende Endpunkt ein requirePermission? Das ist bewusst ein
 * struktureller Test — er faellt auch dann auf, wenn jemand SPAETER eine neue
 * Route ohne Gate ergaenzt, und genau so sind die Luecken entstanden.
 *
 * Betroffen waren:
 *   • die fuenf /timer/*-Endpunkte in routes/buchungen.js, waehrend ihre
 *     Zwillinge direkt darueber (POST /, PATCH /:id, DELETE /:id) gegatet sind
 *   • alle fuenf Endpunkte in routes/budgetWarnings.js — die Datei importierte
 *     requirePermission nicht einmal
 */

const fs = require("fs");
const path = require("path");

const ROUTES_DIR = path.join(__dirname, "..", "routes");

/** Liest eine Routendatei und liefert ihre Zeilen mit Router-Aufrufen. */
function routerZeilen(datei) {
  const inhalt = fs.readFileSync(path.join(ROUTES_DIR, datei), "utf8");
  return inhalt
    .split(/\r?\n/)
    .map((zeile, i) => ({ nr: i + 1, text: zeile.trim() }))
    .filter((z) => /^router\.(post|put|patch|delete)\s*\(/.test(z.text));
}

/**
 * Gilt eine Zeile als abgesichert?
 * Entweder ein requirePermission/requireAnyPermission direkt an der Route,
 * oder ein dokumentierter Ausnahmefall (self-scoped, siehe Kommentar dort).
 */
function abgesichert(text) {
  return /require(Any)?Permission\s*\(/.test(text);
}

describe("Routen-Gates", () => {
  describe.each([
    ["buchungen.js",      ["/timer/draft", "/timer/confirm", "/timer/draft/:id"]],
    ["budgetWarnings.js", ["/projects/:projectId/mute", "/projects/:projectId/rules", "/rules/:ruleId"]],
  ])("%s", (datei, pflichtPfade) => {
    it("alle mutierenden Endpunkte tragen ein Permission-Gate", () => {
      const ungegatet = routerZeilen(datei)
        .filter((z) => !abgesichert(z.text))
        // Bewusste Ausnahmen: self-scoped Endpunkte, die nur eigene Daten
        // schreiben und im Code als solche kommentiert sind.
        .filter((z) => !/text-snippets|\/me\//.test(z.text));

      expect(ungegatet.map((z) => `${datei}:${z.nr} ${z.text.slice(0, 60)}`)).toEqual([]);
    });

    it.each(pflichtPfade)("Endpunkt %s ist gegatet", (pfad) => {
      const treffer = routerZeilen(datei).filter((z) => z.text.includes(`'${pfad}'`) || z.text.includes(`"${pfad}"`));
      expect(treffer.length).toBeGreaterThan(0);
      for (const z of treffer) expect(abgesichert(z.text)).toBe(true);
    });
  });
});
