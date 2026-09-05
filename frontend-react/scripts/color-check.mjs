#!/usr/bin/env node
/**
 * Kontrast- und Farbfehlsichtigkeits-Pruefung fuer die Design-Tokens.
 *
 * Warum als Skript und nicht als Playwright-Test: die Tokens sind reines CSS,
 * fuer die Pruefung braucht es keinen Browser. Das Skript liest globals.css,
 * loest je Theme die Token-Werte auf (inkl. rgba-Ueberlagerung auf dem
 * jeweiligen Untergrund) und rechnet die Paare durch, die im Konzept als
 * verbindlich festgehalten sind (docs/FARBKONZEPT_2026-09.md, §7).
 *
 *   node scripts/color-check.mjs            # alle Themes
 *   node scripts/color-check.mjs dark       # nur ein Theme
 *   node scripts/color-check.mjs --series   # zusaetzlich die Diagrammfarben
 *
 * Exit-Code 1, sobald ein Paar unter seiner Schwelle liegt.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS  = join(HERE, '..', 'src', 'styles', 'globals.css')

/* ── Farbmathematik ──────────────────────────────────────────────────────── */

function parseColor(s) {
  const v = String(s).trim()
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
    return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)).concat(1)
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(v)
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
  return null
}

/** Halbtransparente Farbe auf einem deckenden Untergrund zusammenrechnen. */
const flatten = (fg, bg) => fg[3] >= 1 ? fg : fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1)

const toLinear = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const luminance = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

function contrast(fg, bg) {
  const b = bg.slice(0, 3).concat(1)
  const f = flatten(fg, b)
  const [l1, l2] = [luminance(f), luminance(b)]
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/* ── globals.css einlesen ────────────────────────────────────────────────── */

/**
 * Liefert { themeName: { '--token': 'wert' } }. ':root' heisst hier 'light',
 * jedes Theme erbt die :root-Werte und ueberschreibt nur, was es selbst setzt —
 * genau wie die Kaskade im Browser.
 */
function readThemes(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const themes = {}
  const re = /(^|\})\s*(:root|\[data-theme=[^{]*)\{([^}]*)\}/g
  let m
  while ((m = re.exec(stripped)) !== null) {
    const decls = {}
    for (const d of m[3].split(';')) {
      const i = d.indexOf(':')
      if (i < 0) continue
      const k = d.slice(0, i).trim()
      if (k.startsWith('--')) decls[k] = d.slice(i + 1).trim()
    }
    if (!Object.keys(decls).length) continue
    const names = m[2] === ':root'
      ? ['light']
      : [...m[2].matchAll(/\[data-theme="([^"]+)"\]/g)].map(x => x[1])
    for (const n of names) themes[n] = { ...(themes[n] || {}), ...decls }
  }
  const base = themes.light || {}
  for (const n of Object.keys(themes)) if (n !== 'light') themes[n] = { ...base, ...themes[n] }
  return themes
}

/** Token aufloesen, inkl. einfacher var(--x)-Ketten. */
function resolve(tokens, name, depth = 0) {
  const raw = tokens[name]
  if (raw === undefined || depth > 8) return null
  const v = raw.trim()
  const m = /^var\(\s*(--[\w-]+)/.exec(v)
  if (m) return resolve(tokens, m[1], depth + 1)
  return parseColor(v)
}

/* ── Die verbindlichen Paare ─────────────────────────────────────────────── */

/** [Vordergrund, Hintergrund, Schwelle, Beschreibung] */
const PAIRS = [
  ['--text',   '--surface',   4.5, 'Fliesstext auf Karte'],
  ['--text',   '--bg',        4.5, 'Fliesstext auf Seitengrund'],
  ['--text-2', '--surface',   4.5, 'Sekundaertext auf Karte'],
  ['--text-2', '--bg',        4.5, 'Sekundaertext auf Seitengrund'],
  ['--text-3', '--surface',   4.5, 'Tertiaertext auf Karte'],
  ['--text-3', '--bg',        4.5, 'Tertiaertext auf Seitengrund'],
  ['--text-4', '--surface',   3.0, 'Platzhalter/UI (nur 3:1 gefordert)'],
  ['--accent', '--surface',   4.5, 'Akzent als Text auf Karte'],
  ['--accent', '--bg',        4.5, 'Akzent als Text auf Seitengrund'],
  ['--accent', '--surface-2', 4.5, 'Akzent als Text auf Zebrastreifen'],
  ['--accent-fg',    '--accent',  4.5, 'Schrift auf Akzentflaeche'],
  ['--btn-fg',       '--btn',     4.5, 'Schrift auf Primaerknopf'],
  ['--cta-fg',       '--cta',     4.5, 'Schrift auf CTA'],
  ['--chrome-text',  '--chrome',  4.5, 'Kopfzeilentext'],
  ['--chrome-icon',  '--chrome',  3.0, 'Kopfzeilen-Icon (UI, 3:1)'],
  ['--nav-active',   '--chrome',  4.5, 'aktiver Navigationseintrag'],
  ['--nav-inactive', '--chrome',  4.5, 'inaktiver Navigationseintrag'],
  ['--success', '--surface', 4.5, 'Erfolgstext'],
  ['--danger',  '--surface', 4.5, 'Fehlertext'],
  ['--warning', '--surface', 4.5, 'Warntext'],
  ['--info',    '--surface', 4.5, 'Infotext'],
  ['--accent2', '--surface', 4.5, 'Zweitakzent als Text'],
  ['--success-fg', '--success', 4.5, 'Schrift auf Erfolgsflaeche'],
  ['--danger-fg',  '--danger',  4.5, 'Schrift auf Fehlerflaeche'],
  ['--warning-fg', '--warning', 4.5, 'Schrift auf Warnflaeche'],
  ['--notif-badge-fg', '--notif-badge', 4.5, 'Zaehler im Glockensymbol'],
]

/* ── Farbfehlsichtigkeit (Vienot 1999) ───────────────────────────────────── */

const gammaToLinear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const linearToGamma = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const mul = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])
const RGB2LMS = [[0.31399022, 0.63951294, 0.04649755], [0.15537241, 0.75789446, 0.08670142], [0.01775239, 0.10944209, 0.87256922]]
const LMS2RGB = [[5.47221206, -4.6419601, 0.16963708], [-1.1252419, 2.29317094, -0.1678952], [0.02980165, -0.19318073, 1.16364789]]
const CVD = {
  Protanopie:  [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  Deuteranopie:[[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]],
  Tritanopie:  [[1, 0, 0], [0, 1, 0], [-0.86744736, 1.86727089, 0]],
}
const simulate = (rgb, kind) =>
  mul(LMS2RGB, mul(CVD[kind], mul(RGB2LMS, rgb.slice(0, 3).map(gammaToLinear)))).map(linearToGamma)

function toLab(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map(gammaToLinear)
  let X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722
  let Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const fx = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
  const [a, y, c] = [fx(X), fx(Y), fx(Z)]
  return [116 * y - 16, 500 * (a - y), 200 * (y - c)]
}
const deltaE = (p, q) => { const A = toLab(p), B = toLab(q); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) }

/**
 * Serienfarben der Diagramme. Muessen hier gespiegelt werden, weil sie in
 * src/theme/chartTheme.ts als JS-Konstanten liegen (Chart.js zeichnet auf
 * Canvas und versteht dort kein var(--token)).
 *
 * Schwelle 15 dE: darunter sind zwei Reihen in einem gestapelten Balken
 * nicht mehr sicher zu trennen.
 */
const SERIES_MIN_DE = 15

function readSeries() {
  const src = readFileSync(join(HERE, '..', 'src', 'theme', 'chartTheme.ts'), 'utf8')
  const out = {}
  for (const key of ['SERIES_LIGHT', 'SERIES_DARK']) {
    const m = new RegExp(key + `\\s*=\\s*\\[([^\\]]*)\\]`).exec(src)
    if (m) out[key] = [...m[1].matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map(x => x[1])
  }
  return out
}

/* ── Ausfuehrung ─────────────────────────────────────────────────────────── */

const args      = process.argv.slice(2)
const wantSeries = args.includes('--series')
const only      = args.filter(a => !a.startsWith('--'))

const themes = readThemes(readFileSync(CSS, 'utf8'))
const names  = only.length ? only : Object.keys(themes)
let failures = 0

for (const name of names) {
  const tokens = themes[name]
  if (!tokens) { console.error(`Theme "${name}" gibt es nicht in globals.css`); failures++; continue }
  const rows = []
  for (const [fgName, bgName, min, label] of PAIRS) {
    const bg = resolve(tokens, bgName)
    const fg = resolve(tokens, fgName)
    if (!bg || !fg) continue                       // Token im Theme nicht gesetzt
    const c = contrast(fg, bg)
    if (c < min) { rows.push(`  ✗ ${c.toFixed(2)} < ${min}  ${fgName} auf ${bgName} — ${label}`); failures++ }
  }
  console.log(rows.length ? `${name}: ${rows.length} Verstoss/Verstoesse` : `${name}: ok`)
  rows.forEach(r => console.log(r))
}

if (wantSeries) {
  const series = readSeries()
  const grounds = { SERIES_LIGHT: '#ffffff', SERIES_DARK: '#1c1c21' }
  for (const [key, list] of Object.entries(series)) {
    console.log(`\n${key} (${list.length} Reihen)`)
    for (const kind of ['Normalsicht', ...Object.keys(CVD)]) {
      const sim = list.map(c => kind === 'Normalsicht' ? parseColor(c) : simulate(parseColor(c), kind))
      let worst = { d: Infinity }
      for (let i = 0; i < sim.length; i++) for (let j = i + 1; j < sim.length; j++) {
        const d = deltaE(sim[i], sim[j])
        if (d < worst.d) worst = { d, a: list[i], b: list[j] }
      }
      const bad = worst.d < SERIES_MIN_DE
      if (bad) failures++
      console.log(`  ${bad ? '✗' : '✓'} ${kind.padEnd(13)} kleinster Abstand dE=${worst.d.toFixed(1)} (${worst.a} / ${worst.b})`)
    }
    const thin = list.filter(c => contrast(parseColor(c), parseColor(grounds[key])) < 3)
    if (thin.length) console.log(`  ⚠ unter 3:1 auf ${grounds[key]} — nur als Flaeche mit Rand, nicht als 1px-Linie: ${thin.join(', ')}`)
  }
}

if (failures) { console.error(`\n${failures} Verstoss/Verstoesse.`); process.exit(1) }
console.log('\nAlles innerhalb der Schwellen.')
