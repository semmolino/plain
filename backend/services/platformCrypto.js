"use strict";

/**
 * Entschluesselt Blobs, die von der Owner-Konsole mit AES-256-GCM verschluesselt
 * wurden (siehe owner-console/services/platformCrypto.js — gleiches Format,
 * gleicher Schluessel). Nur Lesezugriff: das Backend verschluesselt nichts,
 * die Verwaltung passiert ausschliesslich in der Owner-Konsole.
 *
 * PLATFORM_ENC_KEY muss in Backend UND Owner-Konsole identisch gesetzt sein
 * (32 Byte, base64 — z.B. `openssl rand -base64 32`).
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

/** @param {string} blob Format "iv:tag:ciphertext" (alle base64). */
function decrypt(blob) {
  const key = getKey();
  if (!key) throw { status: 503, message: "PLATFORM_ENC_KEY ist nicht (korrekt) gesetzt." };
  const [ivB64, tagB64, dataB64] = String(blob || "").split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw { status: 500, message: "Ungueltiges verschluesseltes Format." };
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

module.exports = { isConfigured, decrypt };
