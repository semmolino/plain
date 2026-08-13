"use strict";

// Prueft die Client-Fabrik aus backend/db.js.
//
// Der heikle Teil ist der Proxy: die 36 Router bekommen EIN Objekt beim Start,
// das pro Aufruf einen anderen Client bedienen muss. Geht dabei die Bindung
// verloren, bricht supabase-js an einer Stelle, die mit db.js nichts mehr zu
// tun zu haben scheint. Deshalb wird hier nicht nur geprueft, welcher Client
// gewaehlt wird, sondern auch, dass eine echte Abfragekette daraus entsteht.
//
// Es laeuft kein PostgREST mit — geprueft wird, was ohne Netz pruefbar ist:
// Auswahl des Geltungsbereichs und die Claims im signierten Token.

const jwt = require("jsonwebtoken");

const BASIS = {
  SUPABASE_URL: "https://beispiel.supabase.co",
  SUPABASE_SERVICE_KEY: "service-key-attrappe",
  PGRST_JWT_SECRET: "test-geheimnis-lang-genug",
};

function ladeMit(env) {
  jest.resetModules();
  process.env = { ...process.env, ...BASIS, ...env };
  return require("../db");
}

const alteEnv = { ...process.env };
afterEach(() => { process.env = { ...alteEnv }; jest.resetModules(); });

// Das Token steckt im Client — supabase-js legt den uebergebenen Schluessel
// als supabaseKey ab. Darueber kommen wir an die Claims, ohne PostgREST.
function claimsVon(client) {
  return jwt.decode(client.supabaseKey);
}

describe("ohne POSTGREST_URL — unveraendertes Verhalten", () => {
  it("meldet den Supabase-Weg", () => {
    expect(ladeMit({ POSTGREST_URL: "" }).mode()).toBe("supabase");
  });

  it("liefert einen benutzbaren Client ohne jeden Kontext", () => {
    const { db } = ladeMit({ POSTGREST_URL: "" });
    // Genau das taten die Hintergrund-Checker bisher: einfach zugreifen.
    const abfrage = db.from("PROJECT").select("ID");
    expect(typeof abfrage.eq).toBe("function");
  });

  it("verlangt kein PGRST_JWT_SECRET", () => {
    const m = ladeMit({ POSTGREST_URL: "", PGRST_JWT_SECRET: "" });
    expect(() => m.assertConfigured()).not.toThrow();
  });
});

describe("mit POSTGREST_URL", () => {
  const MIT = { POSTGREST_URL: "http://127.0.0.1:3001" };

  it("meldet den PostgREST-Weg", () => {
    expect(ladeMit(MIT).mode()).toBe("postgrest");
  });

  it("verlangt PGRST_JWT_SECRET", () => {
    const m = ladeMit({ ...MIT, PGRST_JWT_SECRET: "" });
    expect(() => m.assertConfigured()).toThrow(/PGRST_JWT_SECRET/);
  });

  it("gibt dem Request den Mandanten als Claim mit", (done) => {
    const { db, tenantScope } = ladeMit(MIT);
    tenantScope({ tenantId: 4 }, null, () => {
      expect(claimsVon(db)).toMatchObject({ tenant_id: 4 });
      // Bewusst KEIN role-Claim: PostgREST wuerde daraufhin SET LOCAL ROLE
      // versuchen, und die Rolle gibt es auf Scalingo nicht — der
      // Datenbankbenutzer hat kein CREATEROLE.
      expect(claimsVon(db).role).toBeUndefined();
      done();
    });
  });

  it("trennt zwei Mandanten sauber, auch verschachtelt", (done) => {
    const { db, tenantScope } = ladeMit(MIT);
    tenantScope({ tenantId: 4 }, null, () => {
      expect(claimsVon(db).tenant_id).toBe(4);
      tenantScope({ tenantId: 9 }, null, () => {
        expect(claimsVon(db).tenant_id).toBe(9);
      });
      // Nach dem inneren Bereich muss wieder Mandant 4 gelten — sonst
      // leckte ein Nebenlauf den Mandanten in den umgebenden Request.
      expect(claimsVon(db).tenant_id).toBe(4);
      done();
    });
  });

  it("setzt bei runAsSystem den Systemanspruch statt eines Mandanten", () => {
    const { db, runAsSystem } = ladeMit(MIT);
    runAsSystem(() => {
      const c = claimsVon(db);
      expect(c.sys).toBe("true");
      expect(c.tenant_id).toBeUndefined();
    });
  });

  // Der wichtigste Test: was passiert, wenn der Kontext fehlt. Frueher lief
  // derselbe Fehler mit Service-Key-Rechten weiter und sah alle Mandanten.
  it("faellt ohne Kontext auf einen Client OHNE Mandanten zurueck", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = ladeMit(MIT);
    const c = claimsVon(db);
    expect(c.tenant_id).toBeUndefined();
    expect(c.sys).toBeUndefined();
    expect(c.role).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ausserhalb eines Request"));
    warn.mockRestore();
  });

  it("laesst den Kontext in Timer hineintragen (die Checker haengen daran)", (done) => {
    const { db, runAsSystem } = ladeMit(MIT);
    runAsSystem(() => {
      setTimeout(() => {
        expect(claimsVon(db).sys).toBe("true");
        done();
      }, 1);
    });
  });

  it("erzeugt aus dem Stellvertreter eine echte Abfragekette", (done) => {
    const { db, tenantScope } = ladeMit(MIT);
    tenantScope({ tenantId: 4 }, null, () => {
      const abfrage = db.from("PROJECT").select("ID").eq("TENANT_ID", 4);
      expect(typeof abfrage.then).toBe("function");  // thenable, also absendbar
      done();
    });
  });

  it("reicht oeffentliche Routen ohne Mandanten einfach durch", (done) => {
    const { tenantScope } = ladeMit(MIT);
    tenantScope({}, null, done);   // kein tenantId -> next() ohne Kontext
  });

  // Ohne systemScope landet der Login im claimlosen Rueckfall und findet den
  // Benutzer nicht — ohne dass irgendwo ein Fehler auftaucht. Er muss
  // mandantenuebergreifend suchen duerfen: die E-Mail ist der einzige
  // Anhaltspunkt, der Mandant ergibt sich erst aus dem Fund.
  it("gibt oeffentlichen Routern per systemScope Systemzugriff", (done) => {
    const { db, systemScope } = ladeMit(MIT);
    systemScope({}, null, () => {
      expect(claimsVon(db).sys).toBe("true");
      done();
    });
  });
});
