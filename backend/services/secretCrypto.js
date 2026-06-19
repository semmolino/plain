"use strict";

/**
 * secretCrypto — authentifizierte Verschluesselung fuer at-rest Secrets
 * (aktuell: per-Tenant SMTP-Passwoerter in TENANT_EMAIL_SETTINGS).
 *
 * Verfahren: AES-256-GCM (vertraulich + integritaetsgeschuetzt via Auth-Tag).
 * Schluessel: ENV-Variable EMAIL_ENC_KEY, 32 Byte als base64.
 *   Erzeugen z.B. mit:  openssl rand -base64 32
 *
 * BEWUSST KEIN Hardcoded-Fallback (vgl. JWT_SECRET-Gap in CLAUDE.md): fehlt der
 * Schluessel, schlaegt das Speichern/Lesen mit klarer Meldung fehl, statt ein
 * vermeintlich-sicheres aber knackbares Default zu verwenden.
 *
 * Blob-Format (alles base64, mit ":" getrennt):  iv:authTag:ciphertext
 */

const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM-Standard

/** @returns {Buffer|null} 32-Byte-Key oder null, wenn ENV nicht gesetzt. */
function getKey() {
  const b64 = process.env.EMAIL_ENC_KEY;
  if (!b64) return null;
  let key;
  try {
    key = Buffer.from(b64, "base64");
  } catch {
    throw { status: 500, message: "EMAIL_ENC_KEY ist kein gueltiges base64." };
  }
  if (key.length !== 32) {
    throw { status: 500, message: "EMAIL_ENC_KEY muss 32 Byte (base64) lang sein. Erzeugen: openssl rand -base64 32" };
  }
  return key;
}

/** @returns {boolean} true, wenn ein gueltiger Schluessel konfiguriert ist. */
function isConfigured() {
  try { return getKey() !== null; }
  catch { return false; }
}

function requireKey() {
  const key = getKey();
  if (!key) {
    throw { status: 503, message: "EMAIL_ENC_KEY ist nicht gesetzt — SMTP-Passwort kann nicht sicher gespeichert werden. Bitte ENV-Variable in Railway setzen (openssl rand -base64 32)." };
  }
  return key;
}

/**
 * Verschluesselt einen Klartext-String.
 * @param {string} plaintext
 * @returns {string} Blob "iv:tag:ciphertext" (base64-Teile)
 */
function encrypt(plaintext) {
  const key = requireKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/**
 * Entschluesselt einen mit encrypt() erzeugten Blob.
 * @param {string} blob
 * @returns {string} Klartext
 */
function decrypt(blob) {
  const key = requireKey();
  if (typeof blob !== "string" || blob.split(":").length !== 3) {
    throw { status: 500, message: "Verschluesseltes Secret hat ein unerwartetes Format." };
  }
  const [ivB64, tagB64, dataB64] = blob.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    // Auth-Tag passt nicht: falscher Key oder manipulierte Daten.
    throw { status: 500, message: "SMTP-Passwort konnte nicht entschluesselt werden (Schluessel geaendert?)." };
  }
}

module.exports = { encrypt, decrypt, isConfigured };
