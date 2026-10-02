"use strict";

// THEME_JSON wurde ungeprueft gespeichert, und header.logoMaxHeightMm landete
// ungefiltert im <style> der Vorlagen — ein Weg, den Renderer auf dem Server
// Anfragen ins interne Netz schicken zu lassen (Vorlagen-Audit 10/2026).

const { sanitizeTheme } = require("../services_theme_schema");
const { defaultTheme } = require("../services_theme_defaults");
const { templateEnv } = require("../services_pdf_render");

describe("sanitizeTheme", () => {
  it("ohne Eingabe: der Standard", () => {
    const def = defaultTheme();
    const t = sanitizeTheme(undefined);
    expect(t.brand).toEqual(def.brand);
    expect(t.header).toEqual(def.header);
    expect(t.blocks.order).toEqual(def.blocks.order);
  });

  it("CSS im Zahlenfeld wird verworfen", () => {
    const t = sanitizeTheme({ header: { logoMaxHeightMm: "20mm;}body{background:url(http://127.0.0.1:3001/x)}" } });
    expect(t.header.logoMaxHeightMm).toBe(defaultTheme().header.logoMaxHeightMm);
  });

  it("Zahlen werden in den erlaubten Bereich gezogen", () => {
    expect(sanitizeTheme({ header: { logoMaxHeightMm: 500 } }).header.logoMaxHeightMm).toBe(40);
    expect(sanitizeTheme({ header: { logoMaxHeightMm: "14" } }).header.logoMaxHeightMm).toBe(14);
    expect(sanitizeTheme({ brand: { fontScale: 3 } }).brand.fontScale).toBe(1.15);
  });

  it("Farben nur als Hex, Aufzählungen nur aus der Liste", () => {
    const t = sanitizeTheme({
      brand: { accentColor: "red;background:url(x)", primaryColor: "#1E3A5F" },
      header: { logoPosition: "top;}" },
    });
    expect(t.brand.accentColor).toBe(defaultTheme().brand.accentColor);
    expect(t.brand.primaryColor).toBe("#1e3a5f");
    expect(t.header.logoPosition).toBe("right");
  });

  it("Schrift: Schlüssel bleibt, alter CSS-Stack wird übersetzt, Unbekanntes fällt zurück", () => {
    expect(sanitizeTheme({ brand: { fontFamily: "inter" } }).brand.fontFamily).toBe("inter");
    expect(sanitizeTheme({ brand: { fontFamily: "Georgia, serif" } }).brand.fontFamily).toBe("system-serif");
    expect(sanitizeTheme({ brand: { fontFamily: "Evil\"}body{" } }).brand.fontFamily).toBe("system-sans");
  });

  it("unbekannte Schlüssel fallen weg, Anhänge nur bekannte", () => {
    const t = sanitizeTheme({
      extra: { css: "x" }, header: { injected: "y" },
      blocks: { showTec: false, showEvil: true, order: ["showTec", "evil", "showTec"] },
      blocksByCategory: { invoice_rechnung: { showPayments: false }, fremd: { showTec: true } },
    });
    expect(t.extra).toBeUndefined();
    expect(t.header.injected).toBeUndefined();
    expect(t.blocks.showTec).toBe(false);
    expect(t.blocks.showEvil).toBeUndefined();
    expect(t.blocks.order).toEqual(["showTec"]);
    expect(Object.keys(t.blocksByCategory)).toEqual(["invoice_rechnung"]);
    expect(t.blocksByCategory.invoice_rechnung.showPayments).toBe(false);
  });

  it("das gerenderte CSS enthält den Angriff nicht mehr", () => {
    const theme = sanitizeTheme({ header: { logoMaxHeightMm: "20mm;}body{background:url(http://127.0.0.1:3001/x)}" } });
    const css = templateEnv().renderString("{{ (theme.header.logoMaxHeightMm or 20) }}mm", { theme });
    expect(css).toBe("20mm");
  });
});
