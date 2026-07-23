"use strict";

/**
 * Deterministischer Zufallsgenerator (mulberry32) + Komfort-Helfer.
 *
 * Ein fixer Seed liefert immer dieselbe Zahlenfolge → reproduzierbare Demo.
 * Für stabile Teil-Ströme (z. B. "pro Projekt") lässt sich mit `derive(label)`
 * ein eigener, ebenfalls deterministischer Sub-RNG ableiten.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Kleiner String-Hash (FNV-1a) für stabile Seed-Ableitung aus einem Label.
function hashStr(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function makeRng(seed) {
  const next = mulberry32(seed >>> 0);

  const api = {
    /** Float in [0,1). */
    next,
    /** Float in [min, max). */
    float(min, max) {
      return min + next() * (max - min);
    },
    /** Integer in [min, max] (inklusive). */
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },
    /** true mit Wahrscheinlichkeit p (0..1). */
    chance(p) {
      return next() < p;
    },
    /** Zufälliges Element aus einem Array. */
    pick(arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[Math.floor(next() * arr.length)];
    },
    /** Fisher-Yates-Shuffle (neue Kopie). */
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** Grob glockenförmiger Wert um mid (Mittel zweier Uniforms). */
    around(min, max) {
      const r = (next() + next()) / 2;
      return min + r * (max - min);
    },
    /** Eigener, deterministischer Sub-RNG für einen benannten Teilstrom. */
    derive(label) {
      return makeRng((seed ^ hashStr(label)) >>> 0);
    },
  };
  return api;
}

module.exports = { makeRng, hashStr };
