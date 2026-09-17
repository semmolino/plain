"use strict";

// Web-Push: was der Versand zurueckmeldet.
//
// Der Anlass fuer diese Tests: der Test-Knopf im Profil meldete "verschickt",
// sobald ein Geraet registriert war — auch dann, wenn der Push-Dienst jede
// Zustellung abgelehnt hatte. Gezaehlt wurden naemlich die uebrig gebliebenen
// Registrierungen, und entfernt werden nur die mit 404/410. Eine Ablehnung mit
// 403 (VAPID-Token abgelehnt) liess die Zeile stehen und sah damit aus wie ein
// Erfolg. Genau der Fall — Schluessel gesetzt, Geraet registriert, trotzdem
// keine Zustellung — ist der, den man sucht.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");

// web-push wird in push.js lazy geladen; der Mock muss deshalb vor dem
// erstmaligen require stehen.
const mockSendNotification = jest.fn();
jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args) => mockSendNotification(...args),
}));

const ENDPOINT = "https://web.push.apple.com/QWxsZXMga2xhcg/sehr-geheimer-pfad";

function ladePush() {
  jest.resetModules();
  process.env.VAPID_PUBLIC_KEY  = "testschluessel-oeffentlich";
  process.env.VAPID_PRIVATE_KEY = "testschluessel-privat";
  return require("../services/push");
}

function fakeMitGeraet(extra = {}) {
  return makeFakeSupabase({
    PUSH_SUBSCRIPTION: [{
      ID: 1, TENANT_ID: 7, USER_ID: "42",
      ENDPOINT, P256DH: "p", AUTH: "a",
      USER_AGENT: null, CREATED_AT: "2026-09-01T10:00:00Z", LAST_USED_AT: null,
      ...extra,
    }],
  }, { strictSchema: true });
}

beforeEach(() => {
  mockSendNotification.mockReset();
  delete process.env.VAPID_SUBJECT;
});

describe("sendTestPush — meldet, was die Push-Dienste geantwortet haben", () => {
  test("abgelehnt mit 403: kein Erfolg, Grund und Dienst stehen in der Antwort", async () => {
    const push = ladePush();
    const sb = fakeMitGeraet();
    mockSendNotification.mockRejectedValue(
      Object.assign(new Error("Received unexpected response code"), {
        statusCode: 403,
        body: "BadJwtToken\nweitere Zeilen, die niemanden interessieren",
      }),
    );

    const r = await push.sendTestPush(sb, { tenantId: 7, userId: 42 });

    expect(r.zugestellt).toBe(0);
    expect(r.devices).toBe(1);
    expect(r.fehler).toHaveLength(1);
    expect(r.fehler[0].code).toBe(403);
    expect(r.fehler[0].dienst).toBe("web.push.apple.com");
    // Nur die erste Zeile der Dienst-Antwort - dort steht der Grund.
    expect(r.fehler[0].meldung).toBe("BadJwtToken");
  });

  test("abgelehnt mit 403: die Registrierung bleibt bestehen", async () => {
    const push = ladePush();
    const sb = fakeMitGeraet();
    mockSendNotification.mockRejectedValue(Object.assign(new Error("nope"), { statusCode: 403 }));

    await push.sendTestPush(sb, { tenantId: 7, userId: 42 });

    // Nicht entfernen: der Endpoint ist gueltig, abgelehnt wurde unser Token.
    // Wer hier aufraeumt, loescht dem Nutzer bei jedem Fehlversuch das Geraet.
    const { data } = await sb.from("PUSH_SUBSCRIPTION").select("ID").eq("ID", 1);
    expect(data).toHaveLength(1);
  });

  test("der volle Endpoint taucht in der Antwort nicht auf — nur der Host", async () => {
    const push = ladePush();
    const sb = fakeMitGeraet();
    mockSendNotification.mockRejectedValue(Object.assign(new Error("x"), { statusCode: 400 }));

    const r = await push.sendTestPush(sb, { tenantId: 7, userId: 42 });

    // Der Pfad hinter dem Host IST das Zustellgeheimnis: wer ihn hat, kann dem
    // Geraet Benachrichtigungen schicken. Er gehoert in keine Fehlermeldung.
    expect(JSON.stringify(r)).not.toContain("sehr-geheimer-pfad");
    expect(r.fehler[0].dienst).toBe("web.push.apple.com");
  });

  test("abgelaufen (410): Zeile wird entfernt und als abgelaufen gemeldet", async () => {
    const push = ladePush();
    const sb = fakeMitGeraet();
    mockSendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));

    const r = await push.sendTestPush(sb, { tenantId: 7, userId: 42 });

    expect(r.abgelaufen).toBe(1);
    expect(r.fehler).toHaveLength(0);   // kein Fehler, das Geraet ist schlicht weg
    const { data } = await sb.from("PUSH_SUBSCRIPTION").select("ID").eq("ID", 1);
    expect(data).toHaveLength(0);
  });

  test("angenommen: zugestellt zaehlt hoch und LAST_USED_AT wird gesetzt", async () => {
    const push = ladePush();
    const sb = fakeMitGeraet();
    mockSendNotification.mockResolvedValue({ statusCode: 201 });

    const r = await push.sendTestPush(sb, { tenantId: 7, userId: 42 });

    expect(r.zugestellt).toBe(1);
    expect(r.fehler).toHaveLength(0);
    const { data } = await sb.from("PUSH_SUBSCRIPTION").select("LAST_USED_AT").eq("ID", 1);
    expect(data[0].LAST_USED_AT).toBeTruthy();
  });

  test("ohne registriertes Geraet: klare Ansage statt leerem Erfolg", async () => {
    const push = ladePush();
    const sb = makeFakeSupabase({ PUSH_SUBSCRIPTION: [] }, { strictSchema: true });

    await expect(push.sendTestPush(sb, { tenantId: 7, userId: 42 }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe("getSubject — die Absenderkennung im VAPID-Token", () => {
  test("ohne VAPID_SUBJECT wird der eingebaute Standard als solcher ausgewiesen", () => {
    const push = ladePush();
    const s = push.getSubject();
    // Der Standardwert zeigt auf eine Domain, die uns nicht gehoeren muss.
    // Apple lehnt Tokens mit unbrauchbarem Subject ab - deshalb muss sichtbar
    // sein, dass hier niemand etwas gesetzt hat.
    expect(s.ausStandard).toBe(true);
  });

  test("mit gesetztem VAPID_SUBJECT gilt dieser Wert", () => {
    process.env.VAPID_SUBJECT = "mailto:info@example.org";
    const push = ladePush();
    expect(push.getSubject()).toEqual({ wert: "mailto:info@example.org", ausStandard: false });
  });
});

describe("sendPushForNotification — wenn kein Geraet gefunden wird", () => {
  test("nennt die gesuchte USER_ID und wie viele Geraete der Mandant hat", async () => {
    const push = ladePush();
    // Im Mandanten ist ein Geraet registriert — aber fuer eine andere Person.
    // Genau dieser Fall sieht aus wie „Push kaputt", ist aber eine ID, die
    // nicht zusammenpasst. Ohne die Gegenprobe war er nicht zu unterscheiden.
    const sb = fakeMitGeraet({ USER_ID: "99" });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await push.sendPushForNotification(sb, {
      tenantId: 7, userId: 42, title: "Leistungsstaende erfassen",
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
    const meldung = warn.mock.calls.map(c => c.join(" ")).join("\n");
    expect(meldung).toContain("USER_ID=42");
    expect(meldung).toContain("im Mandanten registriert: 1");
    warn.mockRestore();
  });

  test("mandantenweite Benachrichtigung: die Meldung sagt das auch so", async () => {
    const push = ladePush();
    const sb = makeFakeSupabase({ PUSH_SUBSCRIPTION: [] }, { strictSchema: true });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await push.sendPushForNotification(sb, {
      tenantId: 7, userId: null, title: "Wartungsfenster",
    });

    const meldung = warn.mock.calls.map(c => c.join(" ")).join("\n");
    expect(meldung).toContain("mandantenweit");
    warn.mockRestore();
  });
});

describe("ohne VAPID-Schluessel", () => {
  test("sendPushForNotification bleibt folgenlos, meldet sich aber im Protokoll", async () => {
    jest.resetModules();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const push = require("../services/push");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await push.sendPushForNotification(fakeMitGeraet(), {
      tenantId: 7, userId: 42, title: "Rechnung faellig",
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
    // Der stille No-Op war die Ursache dafuer, dass ein nicht konfigurierter
    // Server von einem funktionierenden nicht zu unterscheiden war.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("VAPID"));
    warn.mockRestore();
  });
});
