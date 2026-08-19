"use strict";

// ============================================================================
// Freigabe von Vorschlaegen durch den Produkt-Sprecher (Migration 0132).
//
// Der wichtigste Punkt ist nicht der Knopf, sondern die Sperre: ein nicht
// freigegebener Vorschlag darf plan&simple nicht erreichen. Der Originaltext
// (TITLE/BODY) ist ein interner Text und kann Projekt-, Bauherren- oder
// Kollegennamen enthalten.
// ============================================================================

const express = require("express");
const makeServiceRouter = require("../routes/service");
const { makeFakeSupabase } = require("./helpers/fakeSupabase");

const TENANT = 1;
const SPRECHER = 7;
const MITARBEITER = 9;
const ADMIN = 3;

function buildApp(supabase, ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = ctx.tenantId ?? TENANT;
    req.employeeId = ctx.employeeId;
    req.permissions = new Set(ctx.permissions || ["service.suggestions.view"]);
    req.hasPermission = (k) => req.permissions.has(k);
    next();
  });
  app.use("/service", makeServiceRouter(supabase));
  return app;
}

async function call(supabase, ctx, method, path, body) {
  const server = buildApp(supabase, ctx).listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

// Der Produkt-Sprecher steht in TENANT_SETTINGS, nicht im Rechtekatalog.
const mitSprecher = (extra = {}) => makeFakeSupabase({
  TENANT_SETTINGS: [{ ID: 1, TENANT_ID: TENANT, KEY: "suggestion_delegate_employee_id", VALUE: String(SPRECHER) }],
  EMPLOYEE: [
    { ID: SPRECHER,    TENANT_ID: TENANT, SHORT_NAME: "SP", FIRST_NAME: "Sina",  LAST_NAME: "Sprecher" },
    { ID: MITARBEITER, TENANT_ID: TENANT, SHORT_NAME: "MA", FIRST_NAME: "Mark",  LAST_NAME: "Mitarbeit" },
    { ID: ADMIN,       TENANT_ID: TENANT, SHORT_NAME: "AD", FIRST_NAME: "Alex",  LAST_NAME: "Admin" },
  ],
  SUGGESTION: [],
  SUGGESTION_COMMENT: [],
  SUGGESTION_VOTE: [],
  ...extra,
});

const NEUER_VORSCHLAG = { title: "Sammelrechnung", body: "Mehrere Projekte in einer Rechnung", category: "rechnungen" };

describe("Einreichen", () => {
  it("legt den Vorschlag eines normalen Mitarbeiters als Entwurf an", async () => {
    const db = mitSprecher();
    const res = await call(db, { employeeId: MITARBEITER }, "POST", "/service/suggestions", NEUER_VORSCHLAG);
    expect(res.status).toBe(200);
    expect(res.body.org_state).toBe("draft");
    expect(db._tables.SUGGESTION[0].ORG_STATE).toBe("draft");
  });

  it("gibt den Vorschlag des Sprechers sofort frei — er waere sonst sein eigener Pruefer", async () => {
    const db = mitSprecher();
    const res = await call(db, { employeeId: SPRECHER }, "POST", "/service/suggestions", NEUER_VORSCHLAG);
    expect(res.body.org_state).toBe("released");
    expect(db._tables.SUGGESTION[0].ORG_RELEASED_BY).toBe(SPRECHER);
  });

  it("laesst den Vorschlag eines Administrators warten — Admin ist nicht Sprecher", async () => {
    const db = mitSprecher();
    const res = await call(
      db,
      { employeeId: ADMIN, permissions: ["service.suggestions.view", "service.suggestions.admin"] },
      "POST", "/service/suggestions", NEUER_VORSCHLAG
    );
    expect(res.body.org_state).toBe("draft");
  });
});

describe("Freigeben / Ablehnen", () => {
  const entwurf = () => mitSprecher({
    SUGGESTION: [{
      ID: 50, TENANT_ID: TENANT, EMPLOYEE_ID: MITARBEITER, TITLE: "T", BODY: "B",
      CATEGORY: "rechnungen", MODERATION_STATE: "pending", LIFECYCLE_STATUS: "new",
      ORG_STATE: "draft", VOTE_COUNT: 0,
    }],
  });

  it("weist einen normalen Mitarbeiter ab", async () => {
    const db = entwurf();
    const res = await call(db, { employeeId: MITARBEITER }, "POST", "/service/suggestions/50/release");
    expect(res.status).toBe(403);
    expect(db._tables.SUGGESTION[0].ORG_STATE).toBe("draft");
  });

  it("laesst den Sprecher freigeben", async () => {
    const db = entwurf();
    const res = await call(db, { employeeId: SPRECHER }, "POST", "/service/suggestions/50/release");
    expect(res.status).toBe(200);
    expect(db._tables.SUGGESTION[0].ORG_STATE).toBe("released");
    expect(db._tables.SUGGESTION[0].ORG_RELEASED_BY).toBe(SPRECHER);
  });

  it("laesst auch einen Administrator freigeben, damit nichts liegenbleibt", async () => {
    const db = entwurf();
    const res = await call(
      db,
      { employeeId: ADMIN, permissions: ["service.suggestions.view", "service.suggestions.admin"] },
      "POST", "/service/suggestions/50/release"
    );
    expect(res.status).toBe(200);
  });

  it("verlangt bei Ablehnung eine Begruendung", async () => {
    const db = entwurf();
    const ohne = await call(db, { employeeId: SPRECHER }, "POST", "/service/suggestions/50/reject", { reason: "  " });
    expect(ohne.status).toBe(400);
    expect(db._tables.SUGGESTION[0].ORG_STATE).toBe("draft");

    const mit = await call(db, { employeeId: SPRECHER }, "POST", "/service/suggestions/50/reject", { reason: "Deckt Funktion X ab" });
    expect(mit.status).toBe(200);
    expect(db._tables.SUGGESTION[0].ORG_STATE).toBe("rejected");
    expect(db._tables.SUGGESTION[0].ORG_DECIDE_REASON).toBe("Deckt Funktion X ab");
  });

  it("entscheidet nicht zweimal ueber denselben Vorschlag", async () => {
    const db = entwurf();
    await call(db, { employeeId: SPRECHER }, "POST", "/service/suggestions/50/release");
    const zweitens = await call(db, { employeeId: SPRECHER }, "POST", "/service/suggestions/50/reject", { reason: "doch nicht" });
    expect(zweitens.status).toBe(409);
    expect(db._tables.SUGGESTION[0].ORG_STATE).toBe("released");
  });

  it("weist ab, wer im fremden Mandanten gar kein Sprecher ist", async () => {
    const db = entwurf();
    // Der Sprecher von Mandant 1 ist in Mandant 2 niemand — die Rolle haengt
    // am Mandanten, nicht an der Person.
    const res = await call(db, { employeeId: SPRECHER, tenantId: 2 }, "POST", "/service/suggestions/50/release");
    expect(res.status).toBe(403);
    expect(db._tables.SUGGESTION[0].ORG_STATE).toBe("draft");
  });

  it("greift auch dann nicht auf fremde Vorschlaege durch, wenn die Befugnis stimmt", async () => {
    const db = entwurf();
    // Administrator eines ANDEREN Mandanten: kommt an darfFreigeben() vorbei,
    // scheitert aber am .eq("TENANT_ID") beim Laden. Das ist die eigentliche
    // Mandantengrenze — die Befugnis allein reicht nicht.
    const res = await call(
      db,
      { employeeId: ADMIN, tenantId: 2, permissions: ["service.suggestions.view", "service.suggestions.admin"] },
      "POST", "/service/suggestions/50/release"
    );
    expect(res.status).toBe(404);
    expect(db._tables.SUGGESTION[0].ORG_STATE).toBe("draft");
  });
});

describe("Sichtbarkeit", () => {
  const gemischt = () => mitSprecher({
    SUGGESTION: [
      { ID: 60, TENANT_ID: TENANT, EMPLOYEE_ID: MITARBEITER, TITLE: "Entwurf", BODY: "B",
        MODERATION_STATE: "pending", LIFECYCLE_STATUS: "new", ORG_STATE: "draft", VOTE_COUNT: 0 },
      { ID: 61, TENANT_ID: TENANT, EMPLOYEE_ID: MITARBEITER, TITLE: "Abgelehnt", BODY: "B",
        MODERATION_STATE: "pending", LIFECYCLE_STATUS: "new", ORG_STATE: "rejected",
        ORG_RELEASED_BY: SPRECHER, ORG_DECIDE_REASON: "Deckt Funktion X ab", VOTE_COUNT: 0 },
    ],
  });

  it("zeigt dem Einreicher Stand und Begruendung", async () => {
    const db = gemischt();
    const res = await call(db, { employeeId: MITARBEITER }, "GET", "/service/suggestions/mine");
    expect(res.status).toBe(200);
    expect(res.body.can_release).toBe(false);

    const abgelehnt = res.body.data.find((r) => r.id === 61);
    expect(abgelehnt.org_state).toBe("rejected");
    expect(abgelehnt.org_decide_reason).toBe("Deckt Funktion X ab");
    // Wer entschieden hat, gehoert dazu — sonst ist der Vorschlag "einfach weg".
    expect(abgelehnt.org_decided_by).toBe("Sina Sprecher");
  });

  it("meldet dem Sprecher, dass er freigeben darf", async () => {
    const db = gemischt();
    const res = await call(db, { employeeId: SPRECHER }, "GET", "/service/suggestions/mine");
    expect(res.body.can_release).toBe(true);
    expect(res.body.org_view).toBe(true);
  });

  it("haelt Entwuerfe aus dem oeffentlichen Portal heraus", async () => {
    const db = gemischt();
    const res = await call(db, { employeeId: MITARBEITER }, "GET", "/service/suggestions/board");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("behandelt Bestandszeilen ohne ORG_STATE als freigegeben", async () => {
    const db = mitSprecher({
      SUGGESTION: [{ ID: 70, TENANT_ID: TENANT, EMPLOYEE_ID: MITARBEITER, TITLE: "Alt", BODY: "B",
        MODERATION_STATE: "pending", LIFECYCLE_STATUS: "new", VOTE_COUNT: 0 }],
    });
    const res = await call(db, { employeeId: MITARBEITER }, "GET", "/service/suggestions/mine");
    expect(res.body.data[0].org_state).toBe("released");
  });
});
