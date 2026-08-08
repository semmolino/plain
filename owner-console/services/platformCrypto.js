"use strict";

/**
 * AES-256-GCM Ver-/Entschluesselung fuer PLATFORM_EMAIL_SETTINGS.SMTP_PASS_ENC.
 * Format: "iv:tag:ciphertext" (alle base64). Schluessel kommt ausschliesslich
 * aus der ENV-Variable PLATFORM_ENC_KEY (32 Byte, base64) — wird NIE in der DB
 * gespeichert oder geloggt. Muss in Owner-Konsole UND Backend identisch gesetzt
 * sein (siehe backend/services/platformCrypto.js, das nur entschluesselt).
 */

const crypto = require("crypto");

function getKey() {
  const raw = process.env.PLATFORM_ENC_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

function isConfigured() {
  return !!getKey();
}

function encrypt(plaintext) {
  const key = getKey();
  if (!key) throw { status: 503, message: "PLATFORM_ENC_KEY ist nicht (korrekt) gesetzt — Verschluesselung nicht moeglich." };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

function decrypt(blob) {
  const key = getKey();
  if (!key) throw { status: 503, message: "PLATFORM_ENC_KEY ist nicht (korrekt) gesetzt — Entschluesselung nicht moeglich." };
  const [ivB64, tagB64, dataB64] = String(blob || "").split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw { status: 500, message: "Ungueltiges verschluesseltes Format." };
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

module.exports = { isConfigured, encrypt, decrypt };
