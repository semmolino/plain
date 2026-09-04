"use strict";

/**
 * Tests zu Befund N6 des Sicherheitsaudits vom 2026-09-03.
 *
 * Der Login-Limiter zaehlt pro IP. Ein Angriff, der ueber viele Adressen auf
 * EIN Konto zielt, laeuft daran vorbei. Die Bremse hier zaehlt pro Konto —
 * und sperrt bewusst nicht, weil eine Sperre selbst ein Angriffsweg waere.
 */

// NODE_ENV=test macht bremsen()/registriereFehlversuch() zu No-Ops, damit die
// uebrigen Tests nicht warten. Fuer diese Datei wird das aufgehoben: geprueft
// werden soll das echte Verhalten.
const ALTES_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = "development";
// eslint-disable-next-line
const attempts = require("../middleware/loginAttempts");
process.env.NODE_ENV = ALTES_ENV;

const { verzoegerungFuer, registriereFehlversuch, loescheFehlversuche, _versuche, _konstanten } = attempts;
const { FREIVERSUCHE, STUFE_MS, MAX_VERZOEGERUNG_MS } = _konstanten;

const KONTO = "chef@buero.de";

describe("Fehlversuchsbremse je Konto", () => {
  beforeEach(() => _versuche.clear());

  it("bremst nicht, wer sich ein paar Mal vertippt", () => {
    for (let i = 0; i < FREIVERSUCHE; i++) registriereFehlversuch(KONTO);
    expect(verzoegerungFuer(KONTO)).toBe(0);
  });

  it("bremst ab dem Versuch nach den Freiversuchen", () => {
    for (let i = 0; i < FREIVERSUCHE + 1; i++) registriereFehlversuch(KONTO);
    expect(verzoegerungFuer(KONTO)).toBe(STUFE_MS);
  });

  it("waechst mit jedem weiteren Fehlversuch", () => {
    for (let i = 0; i < FREIVERSUCHE + 3; i++) registriereFehlversuch(KONTO);
    expect(verzoegerungFuer(KONTO)).toBe(3 * STUFE_MS);
  });

  it("hat einen Deckel — ein Handler soll nicht ewig offen liegen", () => {
    for (let i = 0; i < 500; i++) registriereFehlversuch(KONTO);
    expect(verzoegerungFuer(KONTO)).toBe(MAX_VERZOEGERUNG_MS);
  });

  it("sperrt NIE aus: die Verzoegerung bleibt endlich", () => {
    // Der Kern der Entwurfsentscheidung. Wer die Adresse der Geschaeftsleitung
    // kennt, darf sie nicht aus dem eigenen System aussperren koennen.
    for (let i = 0; i < 10_000; i++) registriereFehlversuch(KONTO);
    const ms = verzoegerungFuer(KONTO);
    expect(ms).toBeLessThanOrEqual(MAX_VERZOEGERUNG_MS);
    expect(Number.isFinite(ms)).toBe(true);
  });

  it("ein erfolgreicher Login hebt die Bremse sofort auf", () => {
    for (let i = 0; i < FREIVERSUCHE + 5; i++) registriereFehlversuch(KONTO);
    expect(verzoegerungFuer(KONTO)).toBeGreaterThan(0);
    loescheFehlversuche(KONTO);
    expect(verzoegerungFuer(KONTO)).toBe(0);
  });

  it("zaehlt Schreibweisen derselben Adresse zusammen", () => {
    for (let i = 0; i < FREIVERSUCHE + 1; i++) registriereFehlversuch("  Chef@Buero.DE ");
    expect(verzoegerungFuer(KONTO)).toBe(STUFE_MS);
  });

  it("trifft nur das angegriffene Konto, nicht die Kollegen", () => {
    for (let i = 0; i < FREIVERSUCHE + 5; i++) registriereFehlversuch(KONTO);
    expect(verzoegerungFuer("kollege@buero.de")).toBe(0);
  });

  it("vergisst nach Ablauf des Fensters", () => {
    for (let i = 0; i < FREIVERSUCHE + 2; i++) registriereFehlversuch(KONTO);
    const e = _versuche.get(KONTO);
    e.resetAt = Date.now() - 1; // Fenster künstlich abgelaufen
    expect(verzoegerungFuer(KONTO)).toBe(0);
  });

  it("kommt mit leerer Eingabe zurecht", () => {
    expect(verzoegerungFuer(undefined)).toBe(0);
    expect(() => registriereFehlversuch(null)).not.toThrow();
  });
});
