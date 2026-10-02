import type { CategoryInfo, LayoutOverride, PaymentMode, ThemeBlocks } from '@/api/documentTemplates'

/**
 * Bearbeitungsmodell für den Aufbau eines Belegs (Einstellungen → Dokumentvorlagen
 * → Aufbau, und je Projekt/Beleg im Rechnungsassistenten).
 *
 * Gerendert wird ausschließlich am Server (services/documentLayout.js →
 * resolveLayout); dieses Modul zeigt nur an, was eine Ebene über den
 * darunterliegenden ergibt, und erzeugt beim Ändern die Abweichung für genau
 * diese Ebene. Die Regeln entsprechen dem Server: Briefkopf zuerst,
 * Pflichtbausteine nicht ausblendbar, eine Ebene mit `hidden`/`pageBreaks`
 * ersetzt die Menge der vorigen, `order` setzt Ungenanntes hinten an.
 */

export interface LayoutEntry {
  key:       string
  kind:      'block' | 'text'
  label:     string
  locked:    boolean
  fixed:     boolean
  hidden:    boolean
  pageBreak: boolean
  text?:     string
}

export interface LayoutState {
  entries:     LayoutEntry[]
  payment:     PaymentMode
  introText:   string | null
  closingText: string | null
}

export const TEXT_KEY = /^text:[a-z0-9]{1,24}$/

export function effectiveLayout(cat: CategoryInfo, levels: (LayoutOverride | undefined | null)[]): LayoutState {
  const blocks = new Map(cat.body.map(b => [b.key, b]))
  let order = cat.body.map(b => b.key)
  let hidden = new Set(cat.defaults.hidden)
  let pageBreaks = new Set<string>()
  const texts: Record<string, string> = {}
  let payment: PaymentMode = cat.defaults.payment
  let introText: string | null = null
  let closingText: string | null = null

  for (const o of levels) {
    if (!o) continue
    for (const [k, v] of Object.entries(o.texts ?? {})) if (TEXT_KEY.test(k) && typeof v === 'string') texts[k] = v
    const known = (k: string) => blocks.has(k) || k in texts
    if (o.order) {
      const next = [...new Set(o.order.filter(known))]
      order = [...next, ...order.filter(k => !next.includes(k))]
    }
    if (o.hidden) hidden = new Set(o.hidden.filter(k => blocks.has(k) && !blocks.get(k)!.locked))
    if (o.pageBreaks) pageBreaks = new Set(o.pageBreaks.filter(k => known(k) && k !== 'letterhead'))
    if (o.payment) payment = o.payment
    if (o.introText !== undefined) introText = o.introText
    if (o.closingText !== undefined) closingText = o.closingText
  }

  order = order.filter(k => blocks.has(k) || k in texts)
  order = ['letterhead', ...order.filter(k => k !== 'letterhead')].filter(k => blocks.has(k) || k in texts)

  const entries: LayoutEntry[] = order.map(k => {
    if (k in texts) return { key: k, kind: 'text', label: 'Eigener Textblock', locked: false, fixed: false, hidden: false, pageBreak: pageBreaks.has(k), text: texts[k] }
    const b = blocks.get(k)!
    return { key: k, kind: 'block', label: b.label, locked: b.locked, fixed: b.fixed, hidden: hidden.has(k), pageBreak: pageBreaks.has(k) }
  })
  return { entries, payment, introText, closingText }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const sameSet = (a: string[], b: string[]) => sameList([...a].sort(), [...b].sort())

/**
 * Die Abweichung einer Ebene: nur, was sich gegenüber `base` (dem Stand ohne
 * diese Ebene) unterscheidet. Ohne `base` die vollständige Beschreibung.
 * Nur so erbt eine Ebene später geänderte Einstellungen darunter — wer im
 * Projekt nur die Anrede ausblendet, bekommt eine neue Reihenfolge der
 * Firmenvorlage trotzdem mit.
 */
export function toOverride(state: LayoutState, base?: LayoutState): LayoutOverride {
  const order = state.entries.map(e => e.key)
  const hidden = state.entries.filter(e => e.kind === 'block' && e.hidden).map(e => e.key)
  const pageBreaks = state.entries.filter(e => e.pageBreak).map(e => e.key)
  const texts: Record<string, string> = {}
  for (const e of state.entries) if (e.kind === 'text') texts[e.key] = e.text ?? ''

  const o: LayoutOverride = {}
  if (!base || !sameList(order, base.entries.map(e => e.key))) o.order = order
  if (!base || !sameSet(hidden, base.entries.filter(e => e.kind === 'block' && e.hidden).map(e => e.key))) o.hidden = hidden
  if (!base || !sameSet(pageBreaks, base.entries.filter(e => e.pageBreak).map(e => e.key))) o.pageBreaks = pageBreaks
  if (!base || state.payment !== base.payment) o.payment = state.payment
  const baseTexts = Object.fromEntries((base?.entries ?? []).filter(e => e.kind === 'text').map(e => [e.key, e.text ?? '']))
  if (Object.keys(texts).length && (!base || Object.entries(texts).some(([k, v]) => baseTexts[k] !== v))) o.texts = texts
  if (state.introText !== null && state.introText !== base?.introText) o.introText = state.introText
  if (state.closingText !== null && state.closingText !== base?.closingText) o.closingText = state.closingText
  return o
}

/** Weicht der Stand von `base` ab? */
export function differs(state: LayoutState, base: LayoutState): boolean {
  return Object.keys(toOverride(state, base)).length > 0
}

/** Kategorie samt Vorfahren, die eigene zuerst (wie documentLayout.categoryChain). */
export function chainOf(categories: CategoryInfo[], key: string): CategoryInfo[] {
  const byKey = new Map(categories.map(c => [c.key, c]))
  const out: CategoryInfo[] = []
  let c = byKey.get(key)
  while (c && !out.includes(c)) { out.push(c); c = c.parent ? byKey.get(c.parent) : undefined }
  return out
}

/**
 * Die Ebenen der Firmenvorlage für eine Kategorie, in Anwendungsreihenfolge
 * (Vorfahren zuerst). Wie am Server (documentContext): eine Kategorie mit
 * eigenem Zahlungs-Standard erbt den Zahlungshinweis nicht.
 */
export function templateLevels(categories: CategoryInfo[], key: string, bodyByCategory: Record<string, LayoutOverride> | undefined, includeOwn = true): LayoutOverride[] {
  const chain = chainOf(categories, key)
  const ownPayment = chain[0] && chain[0].defaults.payment !== 'auto'
  const levels: LayoutOverride[] = []
  for (const c of [...chain].reverse()) {
    if (c.key === key && !includeOwn) continue
    const o = bodyByCategory?.[c.key]
    if (!o) continue
    if (c.key !== key && ownPayment) {
      const rest = { ...o }
      delete rest.payment
      levels.push(rest)
    } else levels.push(o)
  }
  return levels
}

/** Verschiebt einen Eintrag; der Briefkopf bleibt vorn. */
export function moveEntry(state: LayoutState, from: number, to: number): LayoutState {
  const entries = [...state.entries]
  const min = entries[0]?.fixed ? 1 : 0
  if (from < min || to < min || from >= entries.length || to >= entries.length || from === to) return state
  const [e] = entries.splice(from, 1)
  entries.splice(to, 0, e)
  return { ...state, entries }
}

export function updateEntry(state: LayoutState, key: string, patch: Partial<LayoutEntry>): LayoutState {
  return {
    ...state,
    entries: state.entries.map(e => {
      if (e.key !== key) return e
      const next = { ...e, ...patch }
      if (next.locked) next.hidden = false
      if (next.fixed) next.pageBreak = false
      return next
    }),
  }
}

/** Fügt einen eigenen Textblock nach `afterKey` ein (sonst ans Ende). */
export function addText(state: LayoutState, text = '', afterKey?: string): { state: LayoutState; key: string } {
  const used = new Set(state.entries.map(e => e.key))
  let key = ''
  do { key = 'text:' + Math.random().toString(36).slice(2, 10) } while (used.has(key))
  const entry: LayoutEntry = { key, kind: 'text', label: 'Eigener Textblock', locked: false, fixed: false, hidden: false, pageBreak: false, text }
  const at = afterKey ? state.entries.findIndex(e => e.key === afterKey) + 1 : state.entries.length
  const entries = [...state.entries]
  entries.splice(Math.max(1, at || state.entries.length), 0, entry)
  return { state: { ...state, entries }, key }
}

export function removeEntry(state: LayoutState, key: string): LayoutState {
  return { ...state, entries: state.entries.filter(e => !(e.key === key && e.kind === 'text')) }
}

/** Reihenfolge der Anhänge einer Kategorie: gespeicherte zuerst, dann der Rest. */
export function appendixOrder(available: string[], blocks: ThemeBlocks | undefined): string[] {
  const ord = Array.isArray(blocks?.order) ? blocks!.order : []
  return [...ord.filter(k => available.includes(k)), ...available.filter(k => !ord.includes(k))]
}
