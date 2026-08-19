"use strict";

// ============================================================================
// Anmeldung mit mehrdeutiger E-Mail-Adresse.
//
// HINTERGRUND
//   EMPLOYEE.MAIL hat keinen Unique-Index, und die Dublettenpruefung beim
//   Anlegen wirkt nur INNERHALB eines Mandanten. Dieselbe Adresse in zwei
//   Bueros ist also erlaubt und kommt im Alltag vor — insbesondere, wenn ein
//   Administrator zum Ausprobieren einen Mitarbeiter mit seiner eigenen
//   Adresse anlegt.
//
//   Der Login benutzte dafuer .maybeSingle(). Das liefert bei zwei Treffern
//   keinen zweiten Datensatz, sondern einen FEHLER — und der landete in
//   derselben Antwort wie "Benutzer unbekannt". Der Betroffene setzte sein
//   Passwort ueber den Einladungslink, bekam "Passwort gespeichert" und wurde
//   danach mit "E-Mail oder Passwort falsch" abgewiesen, egal was er eingab.
//
//   Entschieden wird jetzt ueber das Passwort: wer hier ankommt, kennt es
//   ohnehin, es ist also kein Orakel.
// ============================================================================

const express = require("express");
const bcrypt = require("bcryptjs");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-nur-fuer-jest";

const makeAuthRouter = require("../routes/auth");

async function login(supabase, body) {
  const app = express();
  app.use(express.json());
  app.use("/auth", makeAuthRouter(supabase));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

const hash = (pw) => bcrypt.hashSync(pw, 4); // niedrige Runden: Testlaufzeit

function mitarbeiter(over = {}) {
  return {
    ID: 1, SHORT_NAME: "AB", FIRST_NAME: "Anna", LAST_NAME: "Beispiel",
    PASSWORD: hash("geheim-1234"), TENANT_ID: 1, MAIL: "anna@buero.de",
    ACTIVE: 1, DASHBOARD_ROLE: null, ...over,
  };
}

describe("POST /auth/login", () => {
  it("meldet bei eindeutiger Adresse normal an", async () => {
    const db = makeFakeSupabase({
      EMPLOYEE: [mitarbeiter()],
      COMPANY: [{ ID: 1, TENANT_ID: 1, COMPANY_NAME_1: "Büro Nord" }],
    });
    const res = await login(db, { email: "anna@buero.de", password: "geheim-1234" });
    expect(res.status).toBe(200);
    expect(res.body.employee_id).toBe(1);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it("findet das richtige Konto, wenn dieselbe Adresse in zwei Mandanten existiert", async () => {
    const db = makeFakeSupabase({
      EMPLOYEE: [
        mitarbeiter({ ID: 1, TENANT_ID: 1, PASSWORD: hash("passwort-buero-a") }),
        mitarbeiter({ ID: 2, TENANT_ID: 2, PASSWORD: hash("passwort-buero-b") }),
      ],
      COMPANY: [
        { ID: 1, TENANT_ID: 1, COMPANY_NAME_1: "Büro A" },
        { ID: 2, TENANT_ID: 2, COMPANY_NAME_1: "Büro B" },
      ],
    });

    const a = await login(db, { email: "anna@buero.de", password: "passwort-buero-a" });
    expect(a.status).toBe(200);
    expect(a.body.tenant_id).toBe(1);

    const b = await login(db, { email: "anna@buero.de", password: "passwort-buero-b" });
    expect(b.status).toBe(200);
    expect(b.body.tenant_id).toBe(2);
  });

  it("weist ab, wenn die Adresse doppelt ist und kein Passwort passt", async () => {
    const db = makeFakeSupabase({
      EMPLOYEE: [
        mitarbeiter({ ID: 1, TENANT_ID: 1, PASSWORD: hash("passwort-buero-a") }),
        mitarbeiter({ ID: 2, TENANT_ID: 2, PASSWORD: hash("passwort-buero-b") }),
      ],
    });
    const res = await login(db, { email: "anna@buero.de", password: "falsch-falsch" });
    expect(res.status).toBe(401);
  });

  it("meldet ehrlich, wenn Adresse UND Passwort in mehreren Konten gleich sind", async () => {
    const gleich = hash("dasselbe-1234");
    const db = makeFakeSupabase({
      EMPLOYEE: [
        mitarbeiter({ ID: 1, TENANT_ID: 1, PASSWORD: gleich }),
        mitarbeiter({ ID: 2, TENANT_ID: 2, PASSWORD: gleich }),
      ],
    });
    const res = await login(db, { email: "anna@buero.de", password: "dasselbe-1234" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/mehreren Konten/i);
  });

  it("laesst niemanden ohne gesetztes Passwort herein (frisch eingeladenes Konto)", async () => {
    const db = makeFakeSupabase({ EMPLOYEE: [mitarbeiter({ PASSWORD: null })] });
    for (const pw of ["", "irgendwas", "null"]) {
      const res = await login(db, { email: "anna@buero.de", password: pw });
      expect(res.status).toBe(401);
    }
  });

  it("weist ein inaktives Konto mit eigenem Hinweis ab", async () => {
    const db = makeFakeSupabase({ EMPLOYEE: [mitarbeiter({ ACTIVE: 2 })] });
    const res = await login(db, { email: "anna@buero.de", password: "geheim-1234" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/inaktiv/i);
  });

  it("ignoriert Gross-/Kleinschreibung der Adresse", async () => {
    const db = makeFakeSupabase({
      EMPLOYEE: [mitarbeiter()],
      COMPANY: [{ ID: 1, TENANT_ID: 1, COMPANY_NAME_1: "Büro Nord" }],
    });
    const res = await login(db, { email: "Anna@Buero.DE", password: "geheim-1234" });
    expect(res.status).toBe(200);
  });

  it("laesst kein Wildcard-Muster als Adresse durch", async () => {
    const db = makeFakeSupabase({ EMPLOYEE: [mitarbeiter()] });
    for (const muster of ["anna@%", "anna@*", "%@buero.de", "*"]) {
      const res = await login(db, { email: muster, password: "geheim-1234" });
      expect(res.status).toBe(401);
    }
  });
});
