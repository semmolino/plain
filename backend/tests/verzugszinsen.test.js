"use strict";

// Verzugszinsen und -pauschale in Mahnungen (§ 288 BGB, Migration 0186).

const path = require("path");
const { verzugszinsen, verzugspauschale } = require("../services/verzugszinsen");
const { normalize } = require("../services/tenantDefaults");
const { defaultStufeLabel } = require("../services/mahnstufen");
const { templateEnv, documentContext } = require("../services_pdf_render");
const { sampleViewModel } = require("../services/documentSamples");
const { sanitizeTheme } = require("../services_theme_schema");

describe("Berechnung", () => {
  it("Unternehmer: Basiszinssatz + 9 Prozentpunkte, act/365, ab dem Tag nach Fälligkeit", () => {
    // 12.000 € × 10,27 % × 30/365 = 101,29 €
    expect(verzugszinsen({ open: 12000, dueDate: "2026-10-01", today: "2026-10-31", basePercent: 1.27, consumer: false }))
      .toEqual({ amount: 101.29, ratePercent: 10.27, points: 9, days: 30 });
  });

  it("Verbraucher: + 5 Prozentpunkte und keine Pauschale", () => {
    expect(verzugszinsen({ open: 12000, dueDate: "2026-10-01", today: "2026-10-31", basePercent: 1.27, consumer: true }))
      .toMatchObject({ ratePercent: 6.27, points: 5 });
    expect(verzugspauschale({ consumer: true })).toBe(0);
    expect(verzugspauschale({ consumer: false })).toBe(40);
  });

  it("ohne Basiszinssatz, ohne Verzug oder ohne offenen Betrag: keine Zinsen", () => {
    expect(verzugszinsen({ open: 1000, dueDate: "2026-10-01", today: "2026-10-31", basePercent: null })).toBeNull();
    expect(verzugszinsen({ open: 1000, dueDate: "2026-10-31", today: "2026-10-31", basePercent: 1.27 })).toBeNull();
    expect(verzugszinsen({ open: 0, dueDate: "2026-10-01", today: "2026-10-31", basePercent: 1.27 })).toBeNull();
  });
});

describe("Einstellungen", () => {
  it("Basiszinssatz darf negativ sein, das Datum muss eins sein", async () => {
    expect(await normalize(null, 1, "dunning_base_rate_percent", "-0,88")).toBe("-0.88");
    expect(await normalize(null, 1, "dunning_base_rate_since", "2026-07-01")).toBe("2026-07-01");
    await expect(normalize(null, 1, "dunning_base_rate_since", "1.7.2026")).rejects.toMatchObject({ status: 400 });
  });

  it("Mahnstufen-Bezeichnungen aus einer Quelle", () => {
    expect(defaultStufeLabel(1)).toBe("Zahlungserinnerung");
    expect(defaultStufeLabel(4)).toBe("3. Mahnung");
  });
});

describe("Mahnung", () => {
  it("weist Zinsen samt Rechenweg und die Pauschale aus", () => {
    const vm = sampleViewModel("mahnung");
    Object.assign(vm, {
      interest: { amount: 101.26, ratePercent: 10.27, points: 9, days: 30 },
      baseRate: { percent: 1.27, since: "2026-07-01" },
      flatFee: 40,
    });
    const html = templateEnv().render(path.join("modern_a", "mahnung.njk"),
      documentContext({ category: "mahnung", vm, theme: sanitizeTheme({}) }));
    expect(html).toContain("Verzugszinsen 10,27&nbsp;% p.&nbsp;a. für 30 Tage");
    expect(html).toContain("Basiszinssatz 1,27&nbsp;% (seit 01.07.2026) zzgl. 9 Prozentpunkte, § 288 BGB");
    expect(html).toMatch(/101,26\s€/);
    expect(html).toContain("Verzugspauschale nach § 288 Abs. 5 BGB");
  });
});
