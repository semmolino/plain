"use strict";

/**
 * Regressionstest zum Pentest-Befund vom 2026-08-06: ASSET-IDOR.
 *
 * Vier Codepfade luden Assets allein ueber die ID und lieferten deren Inhalt
 * aus — Avatar, Firmenlogo, Branding-Hero und E-Rechnungs-Anlage. Da ASSET.ID
 * fortlaufend vergeben wird, liess sich durch Hochzaehlen jede hochgeladene
 * Datei der Plattform abziehen.
 *
 * ASSET hat keine TENANT_ID; die Zugehoerigkeit laeuft ueber COMPANY_ID.
 * assetAccess loest das zentral auf — inklusive Mandanten mit MEHREREN Firmen,
 * die das aeltere resolveCompanyId (limit(1)) faelschlich abgewiesen haette.
 */

const { loadAssetForTenant, findAssetForTenant, companyIdsForTenant } =
  require("../services/assetAccess");

/**
 * Mandant 4 hat zwei Firmen (10, 11), Mandant 6 eine (20).
 * Assets: 100 -> Firma 10, 101 -> Firma 11 (beide Mandant 4), 200 -> Firma 20.
 */
function fakeSupabase() {
  const COMPANY = [
    { ID: 10, TENANT_ID: 4 },
    { ID: 11, TENANT_ID: 4 },
    { ID: 20, TENANT_ID: 6 },
  ];
  const ASSET = [
    { ID: 100, COMPANY_ID: 10, STORAGE_KEY: "a.png", MIME_TYPE: "image/png" },
    { ID: 101, COMPANY_ID: 11, STORAGE_KEY: "b.png", MIME_TYPE: "image/png" },
    { ID: 200, COMPANY_ID: 20, STORAGE_KEY: "c.png", MIME_TYPE: "image/png" },
  ];
  return {
    from(table) {
      const q = {
        _eq: {}, _in: null,
        select() { return q; },
        eq(col, val) { q._eq[col] = val; return q; },
        in(col, vals) { q._in = { col, vals: vals.map(String) }; return q; },
        // COMPANY-Abfrage wird direkt awaited (kein maybeSingle)
        then(resolve) {
          const rows = COMPANY.filter((r) => String(r.TENANT_ID) === String(q._eq.TENANT_ID));
          return Promise.resolve({ data: table === "COMPANY" ? rows : [], error: null }).then(resolve);
        },
        async maybeSingle() {
          const rows = table === "ASSET" ? ASSET : COMPANY;
          const hit = rows.find(
            (r) =>
              (q._eq.ID === undefined || String(r.ID) === String(q._eq.ID)) &&
              (!q._in || q._in.vals.includes(String(r[q._in.col])))
          );
          return { data: hit || null, error: null };
        },
      };
      return q;
    },
  };
}

const fehler = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

describe("assetAccess — Mandantentrennung ueber COMPANY_ID", () => {
  it("findet alle Firmen eines Mandanten, nicht nur die erste", async () => {
    // Der Kern des Fixes gegenueber resolveCompanyId mit limit(1).
    expect(await companyIdsForTenant(fakeSupabase(), 4)).toEqual([10, 11]);
  });

  it("liefert ein eigenes Asset der ersten Firma", async () => {
    const a = await loadAssetForTenant(fakeSupabase(), 100, 4);
    expect(a.ID).toBe(100);
  });

  it("liefert auch ein Asset der ZWEITEN Firma desselben Mandanten", async () => {
    const a = await loadAssetForTenant(fakeSupabase(), 101, 4);
    expect(a.ID).toBe(101);
  });

  it("verweigert ein Asset eines fremden Mandanten", async () => {
    const e = await fehler(() => loadAssetForTenant(fakeSupabase(), 200, 4));
    expect(e).toBeTruthy();
    expect(e.status).toBe(404);
  });

  it("antwortet bei fremdem und nicht existierendem Asset gleich", async () => {
    const fremd = await fehler(() => loadAssetForTenant(fakeSupabase(), 200, 4));
    const nichts = await fehler(() => loadAssetForTenant(fakeSupabase(), 999, 4));
    expect(fremd.status).toBe(nichts.status);
    expect(fremd.message).toBe(nichts.message);
  });

  it("verlangt tenantId (fail-closed)", async () => {
    const e = await fehler(() => loadAssetForTenant(fakeSupabase(), 100, undefined));
    expect(String(e.message)).toMatch(/tenantId ist erforderlich/);
  });

  it("findAssetForTenant liefert null statt zu werfen", async () => {
    expect(await findAssetForTenant(fakeSupabase(), 200, 4)).toBeNull();
    expect(await findAssetForTenant(fakeSupabase(), 100, 4)).not.toBeNull();
  });
});
