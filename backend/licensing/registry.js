"use strict";

/**
 * Licensing registry — lädt das Capability-Manifest und stellt abgeleitete
 * Lookups + Integritätsprüfung bereit. Wird von Drift-Check, Generatoren und
 * (ab L2) der licenseMiddleware genutzt.
 *
 * Reine Daten + Pure-Functions, kein DB- oder Express-Zugriff.
 */

const { modules, capabilities, SINCE } = require("./capabilities.manifest");

const VALID_TYPES = new Set(["boolean", "metered"]);
const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/; // modul.fähigkeit(.sub)

const moduleByKey = new Map(modules.map((m) => [m.key, m]));
const capabilityByKey = new Map(capabilities.map((c) => [c.key, c]));

function getModules() {
  return [...modules].sort((a, b) => (a.position || 0) - (b.position || 0));
}

function getCapabilities() {
  return [...capabilities];
}

function getCapabilitiesByModule(moduleKey) {
  return capabilities.filter((c) => c.module === moduleKey);
}

function getCapability(key) {
  return capabilityByKey.get(key) || null;
}

function allCapabilityKeys() {
  return capabilities.map((c) => c.key);
}

/** [{ capabilityKey, permissionKey }] — flach, für CAPABILITY_PERMISSION-Seed. */
function capabilityPermissionLinks() {
  const out = [];
  for (const c of capabilities) {
    for (const p of c.permissions || []) out.push({ capabilityKey: c.key, permissionKey: p });
  }
  return out;
}

/**
 * Validiert die innere Integrität des Manifests (ohne Code-/DB-Bezug).
 * @returns {{errors:string[], warnings:string[]}}
 */
function validateManifest() {
  const errors = [];
  const warnings = [];

  // Module: eindeutige Keys
  const seenModules = new Set();
  for (const m of modules) {
    if (!m.key || !m.labelDe) errors.push(`Modul ohne key/labelDe: ${JSON.stringify(m)}`);
    if (seenModules.has(m.key)) errors.push(`Doppelter Modul-Key: ${m.key}`);
    seenModules.add(m.key);
  }

  // Capabilities
  const seenCaps = new Set();
  for (const c of capabilities) {
    const id = c.key || "(ohne key)";
    if (!c.key) errors.push(`Capability ohne key: ${JSON.stringify(c)}`);
    else if (!KEY_RE.test(c.key)) errors.push(`Ungültiges Key-Format: ${c.key} (erwartet 'modul.fähigkeit')`);
    if (seenCaps.has(c.key)) errors.push(`Doppelter Capability-Key: ${c.key}`);
    seenCaps.add(c.key);

    if (!c.labelDe) errors.push(`Capability ${id} ohne labelDe`);
    if (!moduleByKey.has(c.module)) errors.push(`Capability ${id}: unbekanntes Modul '${c.module}'`);
    if (!VALID_TYPES.has(c.type)) errors.push(`Capability ${id}: ungültiger type '${c.type}'`);
    if (c.type === "metered" && !c.unit) errors.push(`Metered-Capability ${id} ohne 'unit'`);
    if (c.type === "boolean" && c.unit) warnings.push(`Boolean-Capability ${id} hat unnötiges 'unit'`);

    if (!Array.isArray(c.permissions)) {
      errors.push(`Capability ${id}: 'permissions' muss ein Array sein`);
    } else {
      const seenP = new Set();
      for (const p of c.permissions) {
        if (typeof p !== "string") errors.push(`Capability ${id}: Permission kein String: ${p}`);
        if (seenP.has(p)) warnings.push(`Capability ${id}: doppelte Permission ${p}`);
        seenP.add(p);
      }
    }
  }

  // Permission an höchstens einer Capability? (Mehrfach-Mapping ist erlaubt, aber meist ungewollt)
  const permToCaps = new Map();
  for (const { capabilityKey, permissionKey } of capabilityPermissionLinks()) {
    if (!permToCaps.has(permissionKey)) permToCaps.set(permissionKey, []);
    permToCaps.get(permissionKey).push(capabilityKey);
  }
  for (const [perm, caps] of permToCaps) {
    if (caps.length > 1) warnings.push(`Permission '${perm}' hängt an mehreren Capabilities: ${caps.join(", ")}`);
  }

  return { errors, warnings };
}

module.exports = {
  SINCE,
  getModules,
  getCapabilities,
  getCapabilitiesByModule,
  getCapability,
  allCapabilityKeys,
  capabilityPermissionLinks,
  validateManifest,
};
