#!/usr/bin/env node
/**
 * Prueft das Design-System auf Fehler, die im Browser still verschwinden.
 *
 * Hintergrund: Im UX-Audit vom August 2026 fanden sich rund 20 Defekte
 * dieser Art — im Code benutzte CSS-Variablen und Klassen, die es nirgends
 * gab. Ohne Fallback verwirft der Browser die ganze Deklaration; Fehler-
 * meldungen waren dadurch nicht rot, der Bestaetigen-Knopf im Loeschdialog
 * sah aus wie „Abbrechen", und Seitentitel erbten den <h1>-Default des
 * Browsers. Nichts davon faellt beim Entwickeln auf.
 *
 * Drei Pruefungen:
 *   1. var(--x) ohne Definition in globals.css
 *   2. className="…" ohne passende Regel in globals.css
 *   3. WCAG-AA-Kontrast fuer jedes auswaehlbare Theme
 *
 * Aufruf:  npm run check:design        (Fehler -> Exit 1)
 *          npm run check:design -- -v  (zusaetzlich Details)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS_PATH = join(ROOT, 'src/styles/globals.css')
// skin.css gehoert dazu: die Design-Varianten definieren dort eigene Klassen
// und Tokens. Ohne diese Datei meldet die Pruefung sie als undefiniert,
// obwohl sie im Browser greifen — sie laedt in main.tsx nach globals.css.
const SKIN_PATH = join(ROOT, 'src/styles/skin.css')
const css = readFileSync(CSS_PATH, 'utf8')
  + (existsSync(SKIN_PATH) ? readFileSync(SKIN_PATH, 'utf8') : '')
const verbose = process.argv.includes('-v')

const problems = []
const note = (area, msg) => problems.push(`${area}: ${msg}`)

// ── Dateien einsammeln ────────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}
const sources = walk(join(ROOT, 'src'))

// ── 1. Undefinierte CSS-Variablen ─────────────────────────────────────────
const definedVars = new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(m => m[1]))
const usedVars = new Map()
const collectVars = (text, where) => {
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
    if (!usedVars.has(m[1])) usedVars.set(m[1], { count: 0, fallback: false, where })
    const e = usedVars.get(m[1]); e.count++; if (m[2]) e.fallback = true
  }
}
/** Kommentare entfernen — in Erklaertexten stehen Beispiele wie `var(--token)`. */
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

collectVars(stripComments(css), 'globals.css')
for (const f of sources) collectVars(stripComments(readFileSync(f, 'utf8')), f)

for (const [name, info] of usedVars) {
  if (definedVars.has(name)) continue
  note('Variable', `${name} wird ${info.count}x benutzt, ist aber nirgends definiert`
    + (info.fallback ? ' (mit Fallback — wirkt, folgt aber keinem Theme)' : ' — OHNE Fallback, die Deklaration wird verworfen'))
}

// ── 2. Undefinierte CSS-Klassen ───────────────────────────────────────────
const definedClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]))
/** Klassen, die absichtlich kein Stylesheet haben (Testhaken, Fremd-CSS). */
const IGNORED = new Set(['tsqd-parent-container', 'lucide'])
/**
 * Liefert die STATISCH bekannten Klassennamen eines className-Ausdrucks.
 *
 * Template-Literale werden an ihren `${…}`-Stellen zerlegt. Ein Fragment
 * direkt neben einer Interpolation ist unvollstaendig (`toast-` in
 * `toast-${type}`) und wird verworfen — sonst meldet die Pruefung Namen,
 * die es so nie gibt. Ebenso alles, was innerhalb der Interpolation steht.
 */
function staticClasses(raw, isTemplate) {
  if (!isTemplate) return raw.split(/\s+/).filter(Boolean)
  const out = []
  const parts = raw.split(/\$\{[^}]*\}/g)
  parts.forEach((chunk, i) => {
    const tokens = chunk.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return
    const endsAtInterpolation   = i < parts.length - 1 && !/\s$/.test(chunk)
    const startsAtInterpolation = i > 0 && !/^\s/.test(chunk)
    if (endsAtInterpolation)   tokens.pop()
    if (startsAtInterpolation) tokens.shift()
    out.push(...tokens)
  })
  return out
}

const usedClasses = new Map()
for (const f of sources) {
  const text = readFileSync(f, 'utf8')
  const rel = f.replace(ROOT + '\\', '').replace(ROOT + '/', '')
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? ''
    for (const c of staticClasses(raw, m[2] !== undefined)) {
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(c)) continue
      if (!usedClasses.has(c)) usedClasses.set(c, new Set())
      usedClasses.get(c).add(rel)
    }
  }
}
for (const [cls, files] of usedClasses) {
  if (definedClasses.has(cls) || IGNORED.has(cls)) continue
  note('Klasse', `.${cls} wird in ${files.size} Datei(en) benutzt, hat aber keine Regel `
    + `(faellt auf Browser-Defaults zurueck) — z. B. ${[...files][0]}`)
}

// ── 3. Kontrast je auswaehlbarem Theme ────────────────────────────────────
/** Muss zur Liste im ThemeSwitcher passen. */
const THEMES = [
  ['light', ':root'], ['dark', '[data-theme="dark"]'],
  ['architecture-foto', '[data-theme="architecture-foto"]'],
  ['civil-foto', '[data-theme="civil-foto"]'],
  ['urban-foto', '[data-theme="urban-foto"]'],
  ['tga-foto', '[data-theme="tga-foto"]'],
  ['structural-foto', '[data-theme="structural-foto"]'],
]

function block(sel) {
  const i = css.indexOf(sel); if (i < 0) return {}
  const s = css.indexOf('{', i), e = css.indexOf('\n}', s)
  const o = {}
  for (const line of css.slice(s + 1, e).split(/\r?\n/)) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/); if (m) o[m[1]] = m[2].trim()
  }
  return o
}
const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join('')
  return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)) }
const lum = rgb => { const a = rgb.map(v => { v /= 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]; return (hi + 0.05) / (lo + 0.05) }
function resolve(value, bg) {
  const v = (value || '').trim()
  const m = v.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (m) { const c = [+m[1], +m[2], +m[3]], a = m[4] !== undefined ? +m[4] : 1
    return c.map((x, i) => Math.round(x * a + bg[i] * (1 - a))) }
  if (v.startsWith('#')) return hex2rgb(v)
  return null
}

const root = block(':root')
for (const [name, sel] of THEMES) {
  const t = { ...root, ...block(sel) }
  const surface = hex2rgb(t['--surface']), bg = hex2rgb(t['--bg'])
  const onBoth = tok => Math.min(
    ratio(resolve(t[tok], surface), surface),
    ratio(resolve(t[tok], bg), bg))

  const checks = [
    ['--text-2', onBoth('--text-2'), 4.5],
    ['--text-3', onBoth('--text-3'), 4.5],
    ['--text-4', onBoth('--text-4'), 3.0],
    ['--accent als Text', onBoth('--accent'), 4.5],
  ]

  // Navigation liegt auf --chrome, NICHT auf --surface. Diese Zeilen fehlten
  // zunaechst; axe hat die Luecke im gerenderten Bild gefunden — die
  // Nav-Beschriftungen lagen in allen sieben Themes zwischen 2.59 und 3.35.
  const chrome = hex2rgb(t['--chrome'])
  for (const tok of ['--nav-inactive', '--nav-active', '--chrome-icon', '--chrome-text']) {
    const c = resolve(t[tok], chrome)
    if (c) checks.push([`${tok} auf --chrome`, ratio(c, chrome), 4.5])
  }
  // Schrift auf farbigen Flaechen
  for (const [surfTok, fgTok] of [
    ['--btn', '--btn-fg'], ['--cta', '--cta-fg'], ['--accent', '--accent-fg'],
    ['--success', '--success-fg'], ['--danger', '--danger-fg'],
    ['--warning', '--warning-fg'], ['--info', '--info-fg'],
    ['--notif-badge', '--notif-badge-fg'],
  ]) {
    const s = resolve(t[surfTok], surface), f = resolve(t[fgTok], surface)
    if (s && f) checks.push([`${fgTok} auf ${surfTok}`, ratio(f, s), 4.5])
  }

  for (const [label, value, target] of checks) {
    if (value < target) note('Kontrast', `${name}: ${label} = ${value.toFixed(2)}:1 (Ziel ${target}:1)`)
    else if (verbose) console.log(`  ok  ${name.padEnd(18)} ${label.padEnd(30)} ${value.toFixed(2)}`)
  }
}

// ── Ergebnis ──────────────────────────────────────────────────────────────
if (problems.length === 0) {
  console.log(`Design-System in Ordnung — ${definedVars.size} Tokens, `
    + `${THEMES.length} Themes, ${usedClasses.size} Klassen geprueft.`)
  process.exit(0)
}
console.error(`\n${problems.length} Befund(e):\n`)
for (const p of problems) console.error('  ✗ ' + p)
console.error('\nHinweis: Nicht definierte Namen verschwinden im Browser lautlos —')
console.error('deshalb schlaegt diese Pruefung fehl statt nur zu warnen.\n')
process.exit(1)
