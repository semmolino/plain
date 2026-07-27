"use strict";

/**
 * Katalog-Leser der Owner-Konsole.
 *
 * Ab dem Capability-Management ist die DATENBANK (LICENSE_MODULE,
 * LICENSE_CAPABILITY) die editierbare Quelle für den Katalog — anlegen,
 * umbenennen (Label), umgruppieren, sortieren, löschen ohne Deploy.
 *
 * Das Code-Manifest bleibt:
 *   - Seed (0070b) für eine frische DB,
 *   - Fallback, solange die DB-Tabellen leer/fehlen (Soft-Fail),
 *   - Vertrag für Code-Gates: jeder im Code via requireFeature/HasFeature
 *     genutzte Key MUSS weiter im Manifest stehen (Drift-Check erzwingt das).
 *
 * `inManifest` markiert je Capability, ob sie auch im Code-Manifest steht — die
 * Lösch-Logik nutzt das zusammen mit den Code-Fundstellen (gateUsage), um das
 * Entfernen code-referenzierter Capabilities zu verhindern.
 */

const path = require("path");
const registry = require(path.join(__dirname, "..", "..", "backend", "licensing", "registry"));
const { scanFeatureGateUsage } = require(path.join(__dirname, "..", "..", "backend", "licensing", "driftCheck"));
const { supabase } = require("./db");

const TTL_MS = 15_000;
let cache = { exp: 0, data: null };

// Code-Scan (Feature-Gates) ist teurer -> länger cachen.
const GATE_TTL_MS = 5 * 60_000;
let gateCache = { exp: 0, value: null };

function isMissing(err) {
  return err && /relation .* does not exist|Could not find the table/i.test(err.message || "");
}

function manifestFallback() {
  const manifestModuleKeys = new Set(registry.getModules().map((m) => m.key));
  return {
    fromDb: false,
    manifestModuleKeys,
    modules: registry.getModules().map((m) => ({
      key: m.key, labelDe: m.labelDe, position: m.position || 0, inManifest: true,
    })),
    capabilities: registry.getCapabilities().map((c, i) => ({
      key: c.key, module: c.module, labelDe: c.labelDe, type: c.type, unit: c.unit || null,
      position: (i + 1) * 10, inManifest: true,
    })),
  };
}

/** Liest den Katalog (DB, sonst Manifest-Fallback). Gecacht. */
async function readCatalog() {
  const now = Date.now();
  if (cache.data && cache.exp > now) return cache.data;

  const manifestCapKeys = new Set(registry.allCapabilityKeys());
  const manifestModuleKeys = new Set(registry.getModules().map((m) => m.key));

  let mods, caps;
  try {
    const [rm, rc] = await Promise.all([
      supabase.from("LICENSE_MODULE").select("KEY, LABEL_DE, POSITION"),
      supabase.from("LICENSE_CAPABILITY").select("KEY, MODULE_KEY, LABEL_DE, TYPE, UNIT, POSITION"),
    ]);
    if ((rm.error && isMissing(rm.error)) || (rc.error && isMissing(rc.error))) {
      const fb = manifestFallback();
      cache = { exp: now + TTL_MS, data: fb };
      return fb;
    }
    if (rm.error) throw rm.error;
    if (rc.error) throw rc.error;
    mods = rm.data || [];
    caps = rc.data || [];
  } catch (e) {
    console.warn("[catalog] DB-Lesen fehlgeschlagen, Manifest-Fallback:", e?.message || e);
    const fb = manifestFallback();
    cache = { exp: now + TTL_MS, data: fb };
    return fb;
  }

  // DB leer (0070b noch nicht eingespielt) -> Manifest-Fallback.
  if (caps.length === 0) {
    const fb = manifestFallback();
    cache = { exp: now + TTL_MS, data: fb };
    return fb;
  }

  const data = {
    fromDb: true,
    manifestModuleKeys,
    modules: mods
      .map((m) => ({ key: m.KEY, labelDe: m.LABEL_DE, position: m.POSITION || 0, inManifest: manifestModuleKeys.has(m.KEY) }))
      .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key)),
    capabilities: caps
      .map((c) => ({
        key: c.KEY, module: c.MODULE_KEY, labelDe: c.LABEL_DE, type: c.TYPE, unit: c.UNIT || null,
        position: c.POSITION || 0, inManifest: manifestCapKeys.has(c.KEY),
      }))
      .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key)),
  };
  cache = { exp: now + TTL_MS, data };
  return data;
}

function invalidate() {
  cache = { exp: 0, data: null };
}

/** Feature-Gate-Fundstellen je Capability-Key (Code-Scan, länger gecacht). */
function gateUsage() {
  const now = Date.now();
  if (gateCache.value && gateCache.exp > now) return gateCache.value;
  let value = {};
  try {
    value = Object.fromEntries(scanFeatureGateUsage());
  } catch (e) {
    console.warn("[catalog] Code-Scan fehlgeschlagen:", e?.message || e);
  }
  gateCache = { exp: now + GATE_TTL_MS, value };
  return value;
}

/** Sync-Form für Aufrufer, die schon `readCatalog()` geladen haben. */
function findCapability(catalog, key) {
  return catalog.capabilities.find((c) => c.key === key) || null;
}

/** Eine Capability aus dem (DB-)Katalog holen. null = unbekannt. */
async function getCapability(key) {
  const cat = await readCatalog();
  return findCapability(cat, key);
}

/** Alle Capability-Keys des (DB-)Katalogs. */
async function allCapabilityKeys() {
  const cat = await readCatalog();
  return cat.capabilities.map((c) => c.key);
}

module.exports = {
  readCatalog, invalidate, gateUsage, findCapability, manifestFallback,
  getCapability, allCapabilityKeys,
};
