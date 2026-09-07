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
 * Vier Pruefungen:
 *   1. var(--x) ohne Definition in globals.css
 *   2. className="…" ohne passende Regel in globals.css
 *   3. WCAG-AA-Kontrast fuer jedes auswaehlbare Theme
 *   4. Farbabstand der Diagrammreihen bei Farbfehlsichtigkeit
 *
 * Aufruf:  npm run check:design        (Fehler -> Exit 1)
 *          npm run check:design -- -v  (zusaetzlich Details)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS_PATH = join(ROOT, 'src/styles/globals.css')
const css = readFileSync(CSS_PATH, 'utf8')
const verbose = process.argv.includes('-v')

const problems = []
const warnings = []
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
  // Vorschau-Themes der neuen Markenpalette. Sie stehen in der Auswahl und
  // muessen deshalb dieselben Schwellen halten wie alles andere — ein Theme,
  // das nur „zum Ansehen" da ist, wird trotzdem benutzt.
  ['trust', '[data-theme="trust"]'],
  ['trust-dark', '[data-theme="trust-dark"]'],
  ['petrol', '[data-theme="petrol"]'],
]

/*
 * Alle Tokens eines Themes — gemergt ueber JEDEN Regelkopf, in dessen
 * Selektorliste dieser Selektor steht, in Dokumentreihenfolge.
 *
 * Vorher nahm die Funktion `css.indexOf(sel)`, also den ERSTEN Treffer. Das
 * ging gut, solange jedes Theme genau einen Block hatte. Sobald ein Theme
 * aber auf einem anderen aufsetzt — `[data-theme="dark"], [data-theme="x"]`
 * fuer den gemeinsamen Satz plus ein eigener Block mit den Abweichungen —
 * fand die Funktion den gemeinsamen Block und die Abweichungen nie. Geprueft
 * wurden dann die Werte des FALSCHEN Themes, und zwar lautlos: es kam ja eine
 * plausible Zahl heraus. Genau so hat `trust-dark` beim ersten Lauf die Werte
 * von `dark` gemeldet.
 */
function block(sel) {
  const o = {}
  let from = 0
  for (;;) {
    const i = css.indexOf(sel, from); if (i < 0) return o
    from = i + sel.length
    const brace = css.indexOf('{', from); if (brace < 0) return o
    // Nur echte Regelkoepfe: zwischen Selektor und "{" darf nur Leerraum oder
    // ein weiterer [data-theme="…"] hinter einem Komma stehen. Damit fallen
    // Nachfahren-Selektoren (`[data-theme="dark"] .status-badge`) und
    // Erwaehnungen in Kommentaren heraus.
    if (!/^(\s*,\s*\[data-theme="[\w-]+"\])*\s*$/.test(css.slice(from, brace))) continue
    const e = css.indexOf('\n}', brace)
    for (const line of css.slice(brace + 1, e < 0 ? css.length : e).split(/\r?\n/)) {
      const m = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/); if (m) o[m[1]] = m[2].trim()
    }
    from = e < 0 ? css.length : e
  }
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

  // Zebrastreifen: --surface-2 ist der Grund JEDER zweiten Tabellenzeile, und
  // dort steht Akzenttext (verlinkte Projekt-/Rechnungsnummern). Diese Zeile
  // fehlte — vier Themes lagen dadurch unbemerkt zwischen 4.14 und 4.18.
  const surface2 = hex2rgb(t['--surface-2'])
  if (surface2) checks.push(['--accent als Text auf --surface-2',
    ratio(resolve(t['--accent'], surface2), surface2), 4.5])

  // Statusfarben werden nicht nur als Flaeche, sondern auch als Textfarbe
  // benutzt (Betraege, Badges, Meldungstexte) — geprueft wurde bisher nur
  // die Schrift AUF der Flaeche, nicht die Farbe selbst als Schrift.
  for (const tok of ['--success', '--danger', '--warning', '--info', '--accent2']) {
    if (t[tok]) checks.push([`${tok} als Text`, onBoth(tok), 4.5])
  }

  // Controlling-Ampel: ausschliesslich Textfarben, und sie stehen genauso auf
  // dem Zebrastreifen wie auf der Karte. Sie werden in keinem Branchen-Theme
  // ueberschrieben — genau deshalb muessen sie ueberall tragen.
  for (const tok of ['--kpi-good', '--kpi-plan', '--kpi-watch', '--kpi-critical']) {
    if (!t[tok]) { note('Token', `${tok} fehlt im Theme ${name}`); continue }
    checks.push([`${tok} als Text`, onBoth(tok), 4.5])
    if (surface2) checks.push([`${tok} auf --surface-2`,
      ratio(resolve(t[tok], surface2), surface2), 4.5])
  }

  // Navigation liegt auf --chrome, NICHT auf --surface. Diese Zeilen fehlten
  // zunaechst; axe hat die Luecke im gerenderten Bild gefunden — die
  // Nav-Beschriftungen lagen in allen sieben Themes zwischen 2.59 und 3.35.
  //
  // --nav-inactive verlangt 7:1 und nicht 4.5:1, und das ist kein Uebereifer:
  // Nach der ersten Korrektur lagen ALLE sieben Themes zwischen 4.61 und 4.68
  // — also exakt auf die AA-Schwelle getrimmt. Im Produkt war der inaktive
  // Navigationstext trotzdem schwer zu lesen. 4.5:1 ist die Untergrenze fuer
  // Fliesstext, kein Ziel fuer 11–13-px-Label auf dunklem Grund. Wer den Wert
  // hier senkt, holt sich den Befund zurueck.
  const chrome = hex2rgb(t['--chrome'])
  const NAV_MIN = { '--nav-inactive': 7 }
  for (const tok of ['--nav-inactive', '--nav-active', '--chrome-icon', '--chrome-text']) {
    const c = resolve(t[tok], chrome)
    if (c) checks.push([`${tok} auf --chrome`, ratio(c, chrome), NAV_MIN[tok] ?? 4.5])
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

// ── 3a. Hartkodierte Farben ───────────────────────────────────────────────
/*
 * Der UX-Audit 08/2026 zaehlte 812 hartkodierte Hex-Werte, im September waren
 * es noch 226. Sie folgen keinem der sieben Themes: im Dark-Theme lag
 * `#374151` bei 1.65:1 — praktisch unsichtbar.
 *
 * Es gibt drei legitime Ausnahmen, und nur drei:
 *   1. Canvas — Chart.js versteht `var(--token)` nicht (theme/chartTheme.ts).
 *   2. Werte, die GESPEICHERT oder ins PDF gerendert werden: Farbwaehler,
 *      Vorlagen-Akzente. Dort ist eine CSS-Variable schlicht kein Farbwert.
 *   3. Vorschauen von gedrucktem Papier — die sind bewusst papierweiss und
 *      duerfen im Dark-Theme nicht mitkippen.
 * Alles andere gehoert an ein Token. Wer eine Ausnahme braucht, traegt die
 * Datei hier ein UND schreibt daneben, welcher der drei Faelle es ist.
 */
const COLOR_EXEMPT = new Map([
  ['src/theme/chartTheme.ts',                      'Canvas: Chart.js kennt keine CSS-Variablen'],
  ['src/components/layout/ThemeOptions.tsx',       'Vorschau-Swatches zeigen die Themes selbst'],
  ['src/api/documentTemplates.ts',                 'PDF-Vorlagen: Werte landen im Dokument'],
  ['src/pages/admin/DokumentvorlagenSection.tsx',  'PDF-Akzentpalette + Papier-Vorschau + srcdoc'],
  ['src/pages/admin/RollenSection.tsx',            'Vorgabefarbe einer Rolle, wird gespeichert'],
  ['src/pages/admin/AbwesenheitsartenSection.tsx', 'Vorgabefarbe einer Abwesenheitsart, wird gespeichert'],
])
for (const f of sources) {
  const rel = f.replace(ROOT + '/', '').replace(/\\/g, '/')
  if (COLOR_EXEMPT.has(rel)) continue
  const text = stripComments(readFileSync(f, 'utf8'))
  const hits = [...new Set([...text.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0]))]
  if (hits.length) {
    note('Farbe', `${rel}: ${hits.length} hartkodierte Farbe(n) (${hits.slice(0, 4).join(', ')}`
      + `${hits.length > 4 ? ', …' : ''}) — Token aus globals.css verwenden`)
  }
}

// ── 3b. Eigene Waehrungsformatierer ───────────────────────────────────────
/*
 * Es gab 28 eigene `fmtEur`-Definitionen in 27 Dateien und 36 eigene
 * Intl-Instanzen — fast alle gleich, ein paar minimal verschieden. Genau
 * diese Streuung war der Grund, warum die Konvention „rote Zahlen" im ganzen
 * Produkt an EINER Stelle umgesetzt war: Es gab keinen gemeinsamen Ort, an
 * den man sie haette schreiben koennen. Jetzt gibt es utils/money.tsx.
 */
const MONEY_MODULE = 'src/utils/money.tsx'
for (const f of sources) {
  const rel = f.replace(ROOT + '/', '').replace(/\\/g, '/')
  if (rel === MONEY_MODULE) continue
  const text = stripComments(readFileSync(f, 'utf8'))
  if (/new Intl\.NumberFormat\([^)]*currency/s.test(text)
    || /toLocaleString\([^)]*currency/s.test(text)) {
    note('Geld', `${rel}: eigener Waehrungsformatierer — stattdessen `
      + 'fmtEur/fmtEur0/money aus @/utils/money verwenden')
  }
}

// ── 3c. CSS-Variablen auf dem Canvas ──────────────────────────────────────
/*
 * Der Umkehrfall von 3a und der teuerste Fehler der Umstellung: Chart.js
 * zeichnet auf ein <canvas>, und dort ist `var(--token)` KEIN gueltiger
 * Farbwert. Der Browser meldet das nicht — er nimmt Schwarz.
 *
 * Genau so wurden im Projektverlauf aus fuenf farbigen Linien fuenf schwarze.
 * Der Typecheck sah nichts (es ist ein string), die Kontrastpruefung sah
 * nichts (die liest CSS), und die Hex-Regel aus 3a hat die Umschreibung sogar
 * VERLANGT. Deshalb diese Gegenprobe: in Diagrammdateien gehoeren Farben aus
 * useChartTheme()/useSeriesColors(), die die Tokens zur Laufzeit aufloesen.
 */
const CANVAS_KEYS = [
  'borderColor', 'backgroundColor', 'pointBackgroundColor', 'pointBorderColor',
  'pointHoverBackgroundColor', 'pointHoverBorderColor', 'hoverBackgroundColor',
  'hoverBorderColor', 'titleColor', 'bodyColor', 'footerColor', 'tickColor',
  'multiKeyBackground', 'color',
]
/** Entfernt `style={{ … }}`-Bloecke: dort ist `var(--token)` richtig. */
function stripInlineStyles(text) {
  let out = '', i = 0
  for (;;) {
    const at = text.indexOf('style={{', i)
    if (at < 0) return out + text.slice(i)
    out += text.slice(i, at)
    let depth = 0, j = at + 'style='.length
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}' && --depth === 0) { j++; break }
    }
    i = j
  }
}
const CANVAS_RE = new RegExp(String.raw`\b(${CANVAS_KEYS.join('|')})\s*:[^,\n}]*var\(--`, 'g')
for (const f of sources) {
  const rel = f.replace(ROOT + '/', '').replace(/\\/g, '/')
  const raw = readFileSync(f, 'utf8')
  if (!/from ['"](react-chartjs-2|chart\.js)['"]/.test(raw)) continue
  const text = stripInlineStyles(stripComments(raw))
  const hits = [...new Set([...text.matchAll(CANVAS_RE)].map(m => m[0].trim()))]
  if (hits.length) {
    note('Canvas', `${rel}: ${hits.length} CSS-Variable(n) als Diagrammfarbe `
      + `(${hits.slice(0, 3).join(' | ')}${hits.length > 3 ? ' | …' : ''}) — `
      + 'Chart.js zeichnet das schwarz; useChartTheme()/useSeriesColors() verwenden')
  }
}

// ── 4. Diagrammreihen bei Farbfehlsichtigkeit ─────────────────────────────
/*
 * Die Serienfarben liegen als JS-Konstanten in src/theme/chartTheme.ts, weil
 * Chart.js auf ein <canvas> zeichnet und dort kein var(--token) versteht. Sie
 * entgehen damit jeder CSS-Pruefung.
 *
 * Der Satz davor war Tailwind-Vollton und bei Rot-Gruen-Schwaeche unbrauchbar:
 * "Deckungsbeitrag" (#3b82f6) und "Stunden" (#8b5cf6) lagen bei Deuteranopie
 * bei dE=1.1 — also identisch. Beide stehen im Reporting im selben Diagramm.
 * Simulation nach Vienot, Brettel & Mollon (1999), Abstand als CIE76-dE.
 * Konzept: docs/FARBKONZEPT_2026-09.md §5.
 */
const MIN_DE = 15

const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const toGam = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const mul = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])
const RGB2LMS = [[0.31399022, 0.63951294, 0.04649755], [0.15537241, 0.75789446, 0.08670142], [0.01775239, 0.10944209, 0.87256922]]
const LMS2RGB = [[5.47221206, -4.6419601, 0.16963708], [-1.1252419, 2.29317094, -0.1678952], [0.02980165, -0.19318073, 1.16364789]]
const CVD = {
  Protanopie:   [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  Deuteranopie: [[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]],
}
const simulate = (rgb, kind) => mul(LMS2RGB, mul(CVD[kind], mul(RGB2LMS, rgb.map(toLin)))).map(toGam)

function toLab(rgb) {
  const [r, g, b] = rgb.map(toLin)
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116
  const [fx, fy, fz] = [f(X), f(Y), f(Z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
const deltaE = (p, q) => { const a = toLab(p), b = toLab(q)
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) }

const chartSrc = readFileSync(join(ROOT, 'src/theme/chartTheme.ts'), 'utf8')
const seriesMatch = /const SERIES\s*=\s*\[([\s\S]*?)\]/.exec(chartSrc)
if (!seriesMatch) {
  note('Diagramm', 'SERIES nicht in chartTheme.ts gefunden')
} else {
  const list = [...seriesMatch[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map(x => x[1])

  for (const kind of ['Normalsicht', ...Object.keys(CVD)]) {
    let worst = { d: Infinity }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [p, q] = [i, j].map(k => kind === 'Normalsicht'
        ? hex2rgb(list[k]) : simulate(hex2rgb(list[k]), kind))
      const d = deltaE(p, q)
      if (d < worst.d) worst = { d, a: list[i], b: list[j] }
    }
    if (worst.d < MIN_DE) {
      note('Diagramm', `SERIES bei ${kind}: ${worst.a} und ${worst.b} `
        + `liegen bei dE=${worst.d.toFixed(1)} (Ziel ${MIN_DE})`)
    } else if (verbose) {
      console.log(`  ok  ${'SERIES'.padEnd(18)} ${kind.padEnd(30)} dE=${worst.d.toFixed(1)}`)
    }
  }

  // Derselbe Satz steht auf hellem UND dunklem Grund (es gibt nur einen).
  // 3:1 ist die Schwelle fuer grafische Objekte. Das ist hier bewusst eine
  // WARNUNG und kein Fehler: Abdunkeln bis 3:1 zieht alle Reihen auf ein
  // Helligkeitsband, und genau ueber Helligkeit trennt Okabe-Ito — gemessen
  // faellt der Deuteranopie-Abstand dabei von 16.2 auf 4.3. Der Kompromiss
  // waere also schlechter als das Problem. Ausgleich am Verwendungsort:
  // Flaechen mit 1px Rand in --surface, Linien mit borderWidth >= 3.
  for (const ground of ['#ffffff', '#1c1c21']) {
    const thin = list.filter(c => ratio(hex2rgb(c), hex2rgb(ground)) < 3)
    if (thin.length) warnings.push('Diagramm: SERIES unter 3:1 auf '
      + `${ground} (${thin.join(', ')}) — nur als Flaeche mit Rand oder als `
      + 'Linie ab 3px verwenden, NICHT abdunkeln (siehe Kommentar im Skript)')
  }
}

// ── Ergebnis ──────────────────────────────────────────────────────────────
for (const w of warnings) console.warn('  ! ' + w)
if (warnings.length) console.warn('')

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
