"use strict";

// pwdFingerprint ist die One-Time-Bindung des Passwort-Reset-Tokens an den
// aktuellen Passwort-Hash (Replay-/Wiederverwendungsschutz).
const { _pwdFingerprint } = require("../routes/auth");

describe("pwdFingerprint (Passwort-Reset One-Time-Schutz)", () => {
  it("ist deterministisch für denselben Hash", () => {
    expect(_pwdFingerprint("$2a$10$abcdef")).toBe(_pwdFingerprint("$2a$10$abcdef"));
  });

  it("ändert sich, wenn sich das Passwort ändert -> alter Reset-Link wird ungültig", () => {
    const before = _pwdFingerprint("$2a$10$oldhash");
    const after = _pwdFingerprint("$2a$10$newhash");
    expect(before).not.toBe(after);
  });

  it("behandelt null (kein Passwort gesetzt) stabil und gibt einen String zurück", () => {
    expect(_pwdFingerprint(null)).toBe(_pwdFingerprint(""));
    expect(typeof _pwdFingerprint(null)).toBe("string");
    expect(_pwdFingerprint(null).length).toBe(16);
  });
});
