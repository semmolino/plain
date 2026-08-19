"use strict";

// Die BCC-Kopie geht an eine Adresse, die der Empfaenger NICHT sieht. Zwei
// Fehler waeren teuer und still: eine Kopie, die ausbleibt (der Nutzer merkt
// erst Wochen spaeter, dass er keinen Nachweis hat), und eine Kopie an einem
// Mail-Typ, der sie nicht bekommen darf (Passwort-Reset). Beides ist hier
// festgenagelt.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");

// nodemailer vor dem Laden des Service ersetzen: der Test prueft, was in die
// Transport-Schicht gereicht wird, nicht ob ein SMTP-Server antwortet.
const gesendet = [];
jest.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: async (msg) => { gesendet.push(msg); return { messageId: "test" }; },
  }),
}));

// Plattform-SMTP kommt sonst aus der DB (Owner-Konsole) — hier fest verdrahtet.
jest.mock("../services/platformEmailSettings", () => ({
  getSettings: async () => ({
    host: "smtp.example.test", port: 465, secure: true,
    user: "u", pass: "p", from: "system@example.test", fromName: "plan&simple",
  }),
  invalidate: () => {},
}));

const { sendMail } = require("../services/emailService");

function db(row) {
  return makeFakeSupabase({ TENANT_EMAIL_SETTINGS: row ? [row] : [] });
}

const MIT_BCC = {
  TENANT_ID: 1, ENABLED: false, SMTP_FROM: null, FROM_NAME: null,
  REPLY_TO: null, BCC_TO: "buero@example.test",
};

beforeEach(() => { gesendet.length = 0; });

test("Belegversand geht zusaetzlich als BCC an die Kopie-Adresse", async () => {
  await sendMail({
    supabase: db(MIT_BCC), tenantId: 1, copyToTenant: true,
    to: "kunde@example.test", subject: "Rechnung", text: "…",
  });
  expect(gesendet).toHaveLength(1);
  expect(gesendet[0].bcc).toBe("buero@example.test");
  // Der Kunde bleibt der einzige sichtbare Empfaenger.
  expect(gesendet[0].to).toBe("kunde@example.test");
});

test("Kopie gilt auch ohne aktivierte eigene Absenderidentitaet", async () => {
  // ENABLED steuert nur die Absenderadresse. Haenge die Kopie daran, bekaeme
  // niemand mit System-Absender je einen Nachweis.
  await sendMail({
    supabase: db(MIT_BCC), tenantId: 1, copyToTenant: true,
    to: "kunde@example.test", subject: "Rechnung", text: "…",
  });
  expect(gesendet[0].from).toBe('"plan&simple" <system@example.test>');
  expect(gesendet[0].bcc).toBe("buero@example.test");
});

test("Mails ohne copyToTenant bekommen keine Kopie (z.B. Passwort-Reset)", async () => {
  await sendMail({
    supabase: db(MIT_BCC), tenantId: 1,
    to: "mitarbeiter@example.test", subject: "Passwort zuruecksetzen", text: "…",
  });
  expect(gesendet[0].bcc).toBeUndefined();
});

test("ohne hinterlegte Kopie-Adresse bleibt BCC leer", async () => {
  await sendMail({
    supabase: db({ ...MIT_BCC, BCC_TO: null }), tenantId: 1, copyToTenant: true,
    to: "kunde@example.test", subject: "Rechnung", text: "…",
  });
  expect(gesendet[0].bcc).toBeUndefined();
});

test("ungueltige Kopie-Adresse wird beim Speichern abgelehnt", async () => {
  const { saveSettings } = require("../services/emailSettingsService");
  await expect(
    saveSettings(db(null), { tenantId: 1, body: { bcc_to: "kein-mail" } }),
  ).rejects.toMatchObject({ status: 400 });
});
