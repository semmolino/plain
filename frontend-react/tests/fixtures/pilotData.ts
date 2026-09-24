import type { Page, Route } from '@playwright/test'
import { mockDemo, type DemoOptions } from './demoData'

/**
 * Zusatzdaten fuer die Pilot-Ansichten (UI-Pilot 2026-09): Projekt-
 * Arbeitsbereich, Projektstruktur, Buchungen, Abschlagsrechnung und die
 * Uebersicht mit allen Kacheln.
 *
 * Warum eine eigene Datei: demoData.ts deckt die Listen ab. Die Pilot-
 * Ansichten brauchen Detaildaten, die zueinander passen muessen — die
 * Struktur rechnet Honorar + Zuschlaege + Nebenkosten nach, der Projektkopf
 * zeigt Summen daraus, die Buchungen haengen an Blaettern der Struktur. Hier
 * steht das an einer Stelle, damit Vorher- und Nachher-Bilder dieselbe
 * Datenlage zeigen.
 *
 * Wie in demoData.ts gilt: die Laenge der Werte ist Teil des Testfalls.
 * Lange Bezeichnungen, siebenstellige Betraege und tiefe Baeume sind Absicht.
 */

/** Stichtag aller Pilot-Daten. Ein Donnerstag. */
export const PILOT_TODAY = '2026-09-24'

const r2 = (n: number) => Math.round(n * 100) / 100

// ── Projektstruktur ──────────────────────────────────────────────────────────

type Surcharge = { label: string; pct: number; cumul?: boolean }
type NodeSpec = {
  id: number; father: number | null; abbr: string; name: string
  bt: 1 | 2; nk: number
  basis?: number            // Pauschal-Blatt: Honorar vor Zuschlaegen
  tec?: number              // Nachweis-Blatt: Summe der Buchungen
  surcharges?: Surcharge[]
  internal?: boolean
}

// HOAI-Objektplanung, 4.012.521,56 € Honorar ueber LP1–9 (Prozentsaetze nach
// § 34 HOAI), LP8 genau 1.284.006,90 € — derselbe Betrag wie die groesste
// Abschlagsrechnung in demoData.ts.
const SPECS: NodeSpec[] = [
  { id: 101, father: null, abbr: 'LPH',   name: 'Leistungsphasen HOAI § 34 Gebäude und Innenräume', bt: 1, nk: 5 },
  { id: 102, father: 101,  abbr: 'LP1',   name: 'Grundlagenermittlung',                bt: 1, nk: 5, basis: 80_250.43 },
  { id: 103, father: 101,  abbr: 'LP2',   name: 'Vorplanung',                          bt: 1, nk: 5, basis: 280_876.51 },
  { id: 104, father: 101,  abbr: 'LP3',   name: 'Entwurfsplanung',                     bt: 1, nk: 5, basis: 601_878.23 },
  { id: 105, father: 101,  abbr: 'LP4',   name: 'Genehmigungsplanung',                 bt: 1, nk: 5, basis: 120_375.65 },
  { id: 106, father: 101,  abbr: 'LP5',   name: 'Ausführungsplanung',                  bt: 1, nk: 5 },
  { id: 107, father: 106,  abbr: 'LP5.1', name: 'Ausführungsplanung Rohbau',           bt: 1, nk: 5, basis: 401_252.16 },
  { id: 108, father: 106,  abbr: 'LP5.2', name: 'Ausführungsplanung Ausbau inkl. Detailplanung Fassade und Sonnenschutz', bt: 1, nk: 5, basis: 451_408.68,
    surcharges: [{ label: 'Umbauzuschlag', pct: 20 }] },
  { id: 109, father: 106,  abbr: 'LP5.3', name: 'Werk- und Montageplanung prüfen',     bt: 1, nk: 5, basis: 150_469.55 },
  { id: 110, father: 101,  abbr: 'LP6',   name: 'Vorbereitung der Vergabe',            bt: 1, nk: 5, basis: 401_252.16 },
  { id: 111, father: 101,  abbr: 'LP7',   name: 'Mitwirkung bei der Vergabe',          bt: 1, nk: 5, basis: 160_500.86 },
  { id: 112, father: 101,  abbr: 'LP8',   name: 'Objektüberwachung – Bauüberwachung und Dokumentation', bt: 1, nk: 5 },
  { id: 113, father: 112,  abbr: 'LP8.1', name: 'Objektüberwachung Bauabschnitt 1 (Kita-Neubau mit Mensa)', bt: 1, nk: 5, basis: 1_027_205.52 },
  { id: 114, father: 112,  abbr: 'LP8.2', name: 'Objektüberwachung Außenanlagen',      bt: 1, nk: 5, basis: 192_601.04 },
  { id: 115, father: 112,  abbr: 'LP8.3', name: 'Dokumentation und Kostenfeststellung', bt: 1, nk: 5, basis: 64_200.34 },
  { id: 116, father: 101,  abbr: 'LP9',   name: 'Objektbetreuung',                     bt: 1, nk: 5, basis: 80_250.43 },
  { id: 117, father: null, abbr: 'BL',    name: 'Besondere Leistungen',                bt: 1, nk: 0 },
  { id: 118, father: 117,  abbr: 'BL1',   name: 'Brandschutzkonzept, Abstimmung mit Prüfsachverständigem', bt: 1, nk: 0, basis: 24_800 },
  { id: 119, father: 117,  abbr: 'BL2',   name: 'Bestandsaufnahme Nachbarbebauung',    bt: 1, nk: 0, basis: 6_400, internal: true },
  { id: 120, father: 117,  abbr: 'BL3',   name: 'Fördermittelantrag KfW-Effizienzhaus 40', bt: 1, nk: 0, basis: 12_500,
    surcharges: [{ label: 'Nachlass Rahmenvertrag', pct: -3 }] },
  { id: 121, father: 117,  abbr: 'BL4',   name: 'Farb- und Materialkonzept',           bt: 1, nk: 0, basis: 9_750 },
  { id: 122, father: null, abbr: 'NA',    name: 'Leistungen nach Aufwand',             bt: 2, nk: 0 },
  { id: 123, father: 122,  abbr: 'NA1',   name: 'Planungsänderungen auf Wunsch des Bauherrn', bt: 2, nk: 0, tec: 18_420.5 },
  { id: 124, father: 122,  abbr: 'NA2',   name: 'Zusätzliche Baubesprechungen',        bt: 2, nk: 0, tec: 7_860 },
]

function buildStructure() {
  const kids = new Map<number, NodeSpec[]>()
  for (const s of SPECS) if (s.father != null) kids.set(s.father, [...(kids.get(s.father) ?? []), s])
  const out = new Map<number, Record<string, unknown>>()

  function surchargeFields(list: Surcharge[] | undefined, base: number) {
    const f: Record<string, unknown> = {}
    let run = base, total = 0
    for (let i = 0; i < 3; i++) {
      const s = list?.[i]
      const eur = s ? r2((s.cumul === false ? base : run) * s.pct / 100) : null
      if (eur != null) { run += eur; total += eur }
      f[`SURCHARGE_${i + 1}_LABEL`] = s?.label ?? null
      f[`SURCHARGE_${i + 1}_PCT`]   = s?.pct ?? null
      f[`SURCHARGE_${i + 1}_EUR`]   = eur
      f[`SURCHARGE_${i + 1}_CUMUL`] = s?.cumul ?? true
    }
    return { fields: f, total: r2(total) }
  }

  function visit(s: NodeSpec, sort: number): { revenue: number; basis: number; tec: number } {
    const children = kids.get(s.id) ?? []
    let revenue: number, basis: number, tec = 0
    let sur: { fields: Record<string, unknown>; total: number }
    if (children.length) {
      let rs = 0, bs = 0
      children.forEach((c, i) => { const r = visit(c, i + 1); rs += r.revenue; bs += r.basis; tec += r.tec })
      sur = surchargeFields(s.surcharges, bs)
      revenue = r2(rs + sur.total); basis = r2(bs)
    } else {
      const b = s.bt === 2 ? (s.tec ?? 0) : (s.basis ?? 0)
      sur = surchargeFields(s.surcharges, b)
      revenue = r2(b + sur.total); basis = b; tec = s.tec ?? 0
    }
    out.set(s.id, {
      STRUCTURE_ID: s.id, PROJECT_ID: 1, FATHER_ID: s.father, SORT_ORDER: sort,
      ABBR: s.abbr, NAME: s.name, BILLING_TYPE_ID: s.bt,
      REVENUE: revenue, REVENUE_BASIS: basis,
      EXTRAS_PERCENT: s.nk, EXTRAS: r2(revenue * s.nk / 100),
      REVENUE_COMPLETION_PERCENT: 0, EXTRAS_COMPLETION_PERCENT: 0,
      REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
      TEC_SP_TOT_SUM: tec, IS_INTERNAL: !!s.internal,
      ...sur.fields, SURCHARGES_TOTAL: sur.total,
    })
    return { revenue, basis, tec }
  }
  SPECS.filter(s => s.father == null).forEach((s, i) => visit(s, i + 1))
  return SPECS.map(s => out.get(s.id)!)
}

export const STRUCTURE = buildStructure()
const STRUCT_BY_ID = new Map(STRUCTURE.map(n => [n.STRUCTURE_ID as number, n]))
const PROJECT_TOTAL = r2(STRUCTURE.filter(n => n.FATHER_ID == null).reduce((s, n) => s + (n.REVENUE as number), 0))

// ── Mitarbeiter ──────────────────────────────────────────────────────────────

export const EMPLOYEES = [
  { ID: 1, ABBR: 'SM', FIRST_NAME: 'Simon',   LAST_NAME: 'Messina' },
  { ID: 2, ABBR: 'TK', FIRST_NAME: 'Thomas',  LAST_NAME: 'Kern' },
  { ID: 3, ABBR: 'SB', FIRST_NAME: 'Sabine',  LAST_NAME: 'Braun-Hofmeister' },
  { ID: 4, ABBR: 'LH', FIRST_NAME: 'Lena',    LAST_NAME: 'Hartmann' },
  { ID: 5, ABBR: 'JW', FIRST_NAME: 'Jonas',   LAST_NAME: 'Wagner' },
  { ID: 6, ABBR: 'AK', FIRST_NAME: 'Aylin',   LAST_NAME: 'Kaya' },
  { ID: 7, ABBR: 'MR', FIRST_NAME: 'Martin',  LAST_NAME: 'Rieger' },
  { ID: 8, ABBR: 'CF', FIRST_NAME: 'Clara',   LAST_NAME: 'Fischer' },
  { ID: 9, ABBR: 'PZ', FIRST_NAME: 'Paul',    LAST_NAME: 'Zimmermann' },
]

// ── Buchungen (Projekt 1) ────────────────────────────────────────────────────

const TEXTS = [
  'Detailplanung Treppenhaus, Abstimmung mit Tragwerksplanung zu Deckendurchbrüchen',
  'Baustellenbegehung, Mängelliste Rohbau aktualisiert',
  'Leistungsverzeichnis Fassade überarbeitet',
  'Jour fixe mit Bauherr und Fachplanern, Protokoll erstellt und verteilt',
  'Werkplanung Fensteranschlüsse geprüft, Rückfragen an Metallbauer',
  'Planungsänderung Gruppenraum 3 nach Nutzerwunsch – Grundriss, Schnitt und Möblierung angepasst, Abstimmung mit Haustechnik zu verlegten Heizkörpern und Elektroauslässen',
  'Abrechnung Rohbau geprüft, Aufmaß kontrolliert',
  'Bemusterung Bodenbeläge mit Kita-Leitung',
]

function buildBookings() {
  const rows: Record<string, unknown>[] = []
  const leafIds = [107, 108, 113, 113, 114, 118, 123, 124]
  const rates: Record<number, [number, number]> = { 1: [115, 72], 2: [95, 58.4], 3: [95, 61], 4: [85, 49.5], 5: [85, 47], 6: [75, 42] }
  let id = 5001
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(2026, 6, 1))
    d.setUTCDate(d.getUTCDate() + Math.floor(i * 1.4))
    if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2)
    const emp = (i % 6) + 1
    const sid = leafIds[i % leafIds.length]
    const hours = [2, 3.5, 1.5, 6, 4, 2.75, 8, 0.5][i % 8]
    const [sp, cp] = rates[emp]
    const billed = d.getUTCMonth() === 6 && i % 3 !== 0
    rows.push({
      ID: id++, PROJECT_ID: 1, STRUCTURE_ID: sid, EMPLOYEE_ID: emp,
      BOOKING_DATE: d.toISOString().slice(0, 10), TIME_START: null, TIME_FINISH: null,
      QUANTITY_INT: hours, QUANTITY_EXT: i % 11 === 5 ? 0 : hours,
      COST_RATE: cp, COST_TOTAL: r2(hours * cp),
      HOURLY_RATE: sp, HOURLY_RATE_TOTAL: i % 11 === 5 ? 0 : r2(hours * sp),
      POSTING_DESCRIPTION: TEXTS[i % TEXTS.length],
      BOOKING_KIND: null, ENTRY_KIND: 'WORK', UNIT_LABEL: null, BOOKING_TYPE_ID: null,
      ADVANCE_INVOICE_ID: billed ? 9 : null, INVOICE_ID: null,
      EMPLOYEE: { ABBR: EMPLOYEES[emp - 1].ABBR },
    })
  }
  const extra = (o: Record<string, unknown>) => rows.push({
    ID: id++, PROJECT_ID: 1, EMPLOYEE_ID: 1, TIME_START: null, TIME_FINISH: null,
    QUANTITY_INT: 0, QUANTITY_EXT: 0, COST_RATE: 0, COST_TOTAL: 0, HOURLY_RATE: 0, HOURLY_RATE_TOTAL: 0,
    BOOKING_KIND: null, ENTRY_KIND: 'WORK', UNIT_LABEL: null, BOOKING_TYPE_ID: null,
    ADVANCE_INVOICE_ID: null, INVOICE_ID: null, EMPLOYEE: { ABBR: 'SM' }, ...o,
  })
  extra({ STRUCTURE_ID: null, BOOKING_DATE: '2026-09-22', QUANTITY_INT: 0.5, POSTING_DESCRIPTION: 'Pause', ENTRY_KIND: 'BREAK', TIME_START: '12:00:00', TIME_FINISH: '12:30:00' })
  extra({ STRUCTURE_ID: null, BOOKING_DATE: '2026-09-23', QUANTITY_INT: 0.75, POSTING_DESCRIPTION: 'Mittagspause', ENTRY_KIND: 'BREAK', EMPLOYEE_ID: 2, EMPLOYEE: { ABBR: 'TK' } })
  extra({ STRUCTURE_ID: 124, BOOKING_DATE: '2026-09-10', BOOKING_KIND: 'UNIT', QUANTITY_EXT: 1_240, UNIT_LABEL: 'm²', HOURLY_RATE: 2.4, HOURLY_RATE_TOTAL: 2_976, COST_RATE: 1.1, COST_TOTAL: 1_364, POSTING_DESCRIPTION: 'Aufmaß Bodenflächen EG/OG' })
  extra({ STRUCTURE_ID: 118, BOOKING_DATE: '2026-08-28', BOOKING_KIND: 'LUMP_COST', COST_TOTAL: 128_400, POSTING_DESCRIPTION: 'Fremdleistung Prüfstatik (Ingenieurbüro Weller)' })
  extra({ STRUCTURE_ID: 123, BOOKING_DATE: '2026-09-15', BOOKING_KIND: 'LUMP_REVENUE', HOURLY_RATE_TOTAL: 48_500, POSTING_DESCRIPTION: 'Pauschale Planungsänderung Mensa nach Nachtrag N-03' })
  return rows.sort((a, b) => String(a.BOOKING_DATE).localeCompare(String(b.BOOKING_DATE)))
}

export const BOOKINGS = buildBookings()

// ── Projektkopf / Report ─────────────────────────────────────────────────────

const HEADER = {
  PROJECT_ID: 1, ABBR: 'P-2024-001', NAME: 'Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1',
  PROJECT_STATUS_NAME_SHORT: 'Laufend', PROJECT_MANAGER_DISPLAY: 'M. Messina', COMPANY_NAME: 'Messina Architekten GmbH',
  BUDGET_TOTAL_NET: PROJECT_TOTAL,
  LEISTUNGSSTAND_PERCENT: 63.8, LEISTUNGSSTAND_VALUE: r2(PROJECT_TOTAL * 0.638),
  HOURS_TOTAL: 14_212.5, COST_TOTAL: 1_318_406.2, EARNED_VALUE_NET: r2(PROJECT_TOTAL * 0.638),
  COST_RATIO: 0.51, REMAINING_BUDGET_NET: r2(PROJECT_TOTAL * 0.362),
  BILLED_NET_TOTAL: 2_347_120.4, OPEN_NET_TOTAL: r2(PROJECT_TOTAL * 0.638 - 2_347_120.4),
  PAYED_NET_TOTAL: 2_104_880.15, SALES_TOTAL: 2_347_120.4, QTY_EXT_TOTAL: 13_980,
}

// ── Uebersicht ───────────────────────────────────────────────────────────────

const PROJ = [
  [1, 'P-2024-001', 'Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1', 'Laufend', 'M. Messina', PROJECT_TOTAL, 63.8, 0.51, 2_347_120.4],
  [2, 'P-2024-002', 'Sanierung Altbau Bahnhofstraße 14', 'Laufend', 'T. Kern', 386_400, 41.2, 0.93, 118_300],
  [3, 'P-2024-003', 'Umbau Verwaltungsgebäude Nordflügel', 'Pausiert', 'M. Messina', 212_950, 18.0, 1.12, 22_000],
  [4, 'P-2024-004', 'Erweiterung Produktionshalle Werk II', 'Laufend', 'S. Braun', 1_284_000, 72.5, 0.64, 802_600],
  [5, 'P-2025-011', 'Machbarkeitsstudie Quartier Westufer', 'Angebot', 'T. Kern', 48_600, 5.0, 0.2, 0],
  [6, 'P-2025-012', 'Innenausbau Praxisräume Dr. Hoffmann', 'Laufend', 'S. Braun', 94_300, 88.0, 0.81, 71_400],
  [8, 'P-2025-014', 'Brandschutzertüchtigung Schulzentrum', 'Laufend', 'T. Kern', 522_180, 33.5, 0.77, 98_700],
] as const

const dashProjects = PROJ.map(([id, abbr, name, st, pl, budget, ls, cr, billed]) => ({
  PROJECT_ID: id, ABBR: abbr, NAME: name, PROJECT_STATUS_ID: 2, PROJECT_STATUS_NAME_SHORT: st,
  PROJECT_MANAGER_ID: 1, PROJECT_MANAGER_DISPLAY: pl, DEPARTMENT_ID: 1, DEPARTMENT_NAME: 'Hochbau',
  BUDGET_TOTAL_NET: budget, LEISTUNGSSTAND_PERCENT: ls, LEISTUNGSSTAND_VALUE: r2(budget * ls / 100),
  HOURS_TOTAL: Math.round(budget / 110), COST_TOTAL: r2(budget * ls / 100 * cr), COST_RATIO: cr,
  REMAINING_BUDGET_NET: r2(budget * (1 - ls / 100)), BILLED_NET_TOTAL: billed,
  OPEN_NET_TOTAL: r2(budget * ls / 100 - billed), PAYED_NET_TOTAL: r2(billed * 0.9),
  SALES_TOTAL: billed, QTY_EXT_TOTAL: 0,
}))

const riskProjects = dashProjects.map((p, i) => ({
  ...p,
  ampel: (['gruen', 'orange', 'rot', 'gruen', 'gelb', 'orange', 'gelb'] as const)[i],
  flags: [[], ['Kostenquote über Plan'], ['Kosten über Leistungsstand', 'Pausiert seit 42 Tagen'], [], ['Kein Leistungsstand seit 60 Tagen'], ['Budget fast verbraucht'], ['Abrechnung überfällig']][i],
  db: r2(p.LEISTUNGSSTAND_VALUE - p.COST_TOTAL),
}))

const months12 = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 9 + i, 1))
  return d.toISOString().slice(0, 7)
})

function monthBalance() {
  const days = []
  for (let day = 1; day <= 30; day++) {
    const d = new Date(Date.UTC(2026, 8, day))
    const wd = d.getUTCDay()
    const date = d.toISOString().slice(0, 10)
    const work = wd >= 1 && wd <= 5
    const past = date < PILOT_TODAY
    const actual = !work || date > PILOT_TODAY ? 0 : date === PILOT_TODAY ? 3.5 : date === '2026-09-23' ? 0 : [8, 7.5, 8.25, 9, 6.5][day % 5]
    days.push({
      date, weekday: wd, required: work ? 8 : 0, actual, balance: work && (past || date === PILOT_TODAY) ? r2(actual - 8) : 0,
      isHoliday: false,
      bookings: actual > 0 ? [
        { id: day * 10, hours: r2(actual * 0.6), description: TEXTS[day % TEXTS.length], project: 'P-2024-001 Neubau Kindertagesstätte Sonnenblume', structure: 'LP5.2 Ausführungsplanung Ausbau', time_start: '08:00', time_finish: null, project_id: 1, structure_id: 108 },
        { id: day * 10 + 1, hours: r2(actual * 0.4), description: TEXTS[(day + 3) % TEXTS.length], project: 'P-2024-004 Erweiterung Produktionshalle Werk II', structure: 'LP8 Objektüberwachung', time_start: null, time_finish: null, project_id: 4, structure_id: 408 },
      ] : [],
    })
  }
  const req = days.filter(d => d.date <= PILOT_TODAY).reduce((s, d) => s + d.required, 0)
  const act = days.reduce((s, d) => s + d.actual, 0)
  return { year: 2026, month: 9, required: req, actual: r2(act), balance: r2(act - req), days }
}

// ── Abschlagsrechnung ────────────────────────────────────────────────────────

const PP_TEC = Array.from({ length: 40 }, (_, i) => ({
  ID: 7001 + i,
  BOOKING_DATE: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
  EMPLOYEE_SHORT_NAME: EMPLOYEES[i % 6].ABBR,
  POSTING_DESCRIPTION: TEXTS[i % TEXTS.length],
  HOURLY_RATE_TOTAL: r2([2, 3.5, 1.5, 6, 4][i % 5] * 95),
  ASSIGNED: false,
}))

const PROPOSAL = {
  performance_suggested: 258_609.09, performance_amount: 258_609.09,
  bookings_sum: r2(PP_TEC.reduce((s, t) => s + t.HOURLY_RATE_TOTAL, 0)),
  amount_net: 258_609.09, amount_extras_net: 12_930.45,
  total_amount_net: r2(258_609.09 + 12_930.45 + PP_TEC.reduce((s, t) => s + t.HOURLY_RATE_TOTAL, 0)),
  total_amount_gross: 0, vat_percent: 19,
}
PROPOSAL.total_amount_gross = r2(PROPOSAL.total_amount_net * 1.19)

const CONTRACTS = [
  { ID: 11, ABBR: 'V-2024-001', NAME: 'Generalplanervertrag Kita Sonnenblume – Objektplanung Gebäude LP1–9', PROJECT_ID: 1,
    CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14, SE_ENABLED: true, SE_PERCENT: 5, SE_BASIS: 'BRUTTO', SE_LEGAL_REFERENCE: '§ 17 VOB/B' },
]

// ── Registrierung ────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

export interface PilotOptions extends DemoOptions {
  /** Projektkopf-Report liefert 403 (Nutzer ohne reports.view). */
  headerForbidden?: boolean
}

/**
 * Registriert demoData + alle Pilot-Detaildaten. Reihenfolge wie ueberall:
 * mockDemo (Auffang-Mock zuerst), danach die spezifischen Routen — Playwright
 * nimmt die zuletzt registrierte passende Route.
 */
export async function mockPilot(page: Page, opts: PilotOptions = {}) {
  await mockDemo(page, opts)

  const get = async (re: string, body: unknown) => {
    await page.route(new RegExp(`/api/v1/${re}(\\?|$)`), r => r.fulfill(json(body)))
  }
  const byMethod = async (re: string, handlers: Partial<Record<string, (r: Route) => unknown>>) => {
    await page.route(new RegExp(`/api/v1/${re}(\\?|$)`), r => {
      const h = handlers[r.request().method()]
      return h ? h(r) : r.fulfill(json({ success: true }))
    })
  }

  const projectsShort = [
    { ID: 1, ABBR: 'P-2024-001', NAME: 'Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1' },
    { ID: 2, ABBR: 'P-2024-002', NAME: 'Sanierung Altbau Bahnhofstraße 14' },
    { ID: 3, ABBR: 'P-2024-003', NAME: 'Umbau Verwaltungsgebäude Nordflügel' },
    { ID: 4, ABBR: 'P-2024-004', NAME: 'Erweiterung Produktionshalle Werk II' },
    { ID: 6, ABBR: 'P-2025-012', NAME: 'Innenausbau Praxisräume Dr. Hoffmann' },
    { ID: 8, ABBR: 'P-2025-014', NAME: 'Brandschutzertüchtigung Schulzentrum' },
  ]

  // Projekte / Struktur / Buchungen
  await get('projekte', { data: projectsShort })
  await get('projekte/search', { data: projectsShort.map(p => ({ ...p, COMPANY_ID: 1 })) })
  await get('projekte/employees/active', { data: EMPLOYEES })
  await get('stammdaten/billing-types', { data: [
    { ID: 1, ABBR: 'Pauschal', NAME: 'Pauschalhonorar' },
    { ID: 2, ABBR: 'Nachweis', NAME: 'nach Aufwand' },
  ] })
  await get('projekte/\\d+', { data: {
    ID: 1, ABBR: 'P-2024-001', NAME: 'Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1',
    PROJECT_STATUS_ID: 2, PROJECT_TYPE_ID: 1, PROJECT_MANAGER_ID: 1, DEPARTMENT_ID: 1,
    ADDRESS_ID: 1, CONTACT_ID: 1, IS_INTERNAL: false,
    SURCHARGE_1_LABEL: null, SURCHARGE_1_PCT: null, SURCHARGE_1_EUR: null, SURCHARGE_1_CUMUL: true,
    SURCHARGE_2_LABEL: null, SURCHARGE_2_PCT: null, SURCHARGE_2_EUR: null, SURCHARGE_2_CUMUL: true,
    SURCHARGE_3_LABEL: null, SURCHARGE_3_PCT: null, SURCHARGE_3_EUR: null, SURCHARGE_3_CUMUL: true,
    SURCHARGES_TOTAL: 0,
  } })
  await byMethod('projekte/\\d+/structure', { GET: r => r.fulfill(json({ data: STRUCTURE })) })
  await byMethod('projekte/structure/\\d+', {
    PATCH: r => {
      const id = Number(r.request().url().match(/structure\/(\d+)/)?.[1])
      return r.fulfill(json({ data: STRUCT_BY_ID.get(id) ?? {} }))
    },
  })
  await get('projekte/\\d+/contract', { data: CONTRACTS[0] })
  await get('projekte/contracts/search', { data: CONTRACTS })
  await byMethod('buchungen/project/\\d+', { GET: r => r.fulfill(json({ data: BOOKINGS })) })
  await byMethod('buchungen', { POST: r => r.fulfill(json({ success: true })) })
  await get('employee2project/preset', { found: true, HOURLY_RATE: 95, ROLE_ID: 2, ROLE_ABBR: 'PL', ROLE_NAME: 'Projektleitung' })
  await get('mitarbeiter/\\d+/cp-rate', { data: { rate: 58.4, found: true } })
  await get('buchungen/workstart-status', { autoshowEnabled: false, hasBookingsToday: true, data: { autoshowEnabled: false, hasBookingsToday: true } })
  await get('buchungen/text-snippets', { data: [
    { ID: 1, KIND: 'WORK', TEXT: 'Jour fixe mit Bauherr, Protokoll' },
    { ID: 2, KIND: 'WORK', TEXT: 'Baustellenbegehung, Mängelliste' },
    { ID: 3, KIND: 'WORK', TEXT: 'Abstimmung Fachplaner' },
  ] })
  // Recents je nach ?type= — der Auffang-Mock lieferte sonst fuer jede Art
  // dieselben Eintraege, und „Zuletzt gebucht" zeigte Projekte als Leistungen.
  await page.route(/\/api\/v1\/recents(\?|$)/, r => {
    const type = new URL(r.request().url()).searchParams.get('type')
    if (type === 'project_structure') return r.fulfill(json({ data: [107, 108, 113, 114, 118, 123].map(id => STRUCT_BY_ID.get(id)!).map((n, i) => ({
      ID: 900 + i, ENTITY_TYPE: 'project_structure', ENTITY_ID: n.STRUCTURE_ID,
      LABEL: `${n.ABBR} ${n.NAME}`, META: { project_id: 1 },
      LAST_SEEN: `2026-09-2${3 - (i % 3)}T09:00:00Z`, VIEW_COUNT: 12 - i,
    })) }))
    if (type === 'project') return r.fulfill(json({ data: projectsShort.slice(0, 4).map((p, i) => ({
      ID: 950 + i, ENTITY_TYPE: 'project', ENTITY_ID: p.ID, LABEL: `${p.ABBR} · ${p.NAME}`, META: null,
      LAST_SEEN: `2026-09-2${4 - i}T09:00:00Z`, VIEW_COUNT: 20 - i,
    })) }))
    return r.fulfill(json({ data: [] }))
  })

  const reportHeader = opts.headerForbidden
    ? { status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Keine Berechtigung' }) }
    : json({ data: HEADER })
  await page.route(/\/api\/v1\/reports\/project\/\d+\/header(\?|$)/, r => r.fulfill(reportHeader))

  // Uebersicht
  await get('recents/dashboard', { data: [
    { ID: 1, ENTITY_TYPE: 'project', ENTITY_ID: 1, LABEL: 'P-2024-001 · Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1', META: null, LAST_SEEN: '2026-09-24T08:10:00Z', VIEW_COUNT: 31 },
    { ID: 2, ENTITY_TYPE: 'invoice', ENTITY_ID: 12, LABEL: 'RE-2026-0052 · Abschlagsrechnung', META: { number: 'RE-2026-0052' }, LAST_SEEN: '2026-09-23T16:40:00Z', VIEW_COUNT: 4 },
    { ID: 3, ENTITY_TYPE: 'offer', ENTITY_ID: 3, LABEL: 'A-2025-016 · Machbarkeitsstudie Quartier Westufer', META: null, LAST_SEEN: '2026-09-23T11:05:00Z', VIEW_COUNT: 6 },
    { ID: 4, ENTITY_TYPE: 'address', ENTITY_ID: 2, LABEL: 'Wohnbau Süd GmbH', META: null, LAST_SEEN: '2026-09-22T15:20:00Z', VIEW_COUNT: 3 },
    { ID: 5, ENTITY_TYPE: 'project', ENTITY_ID: 4, LABEL: 'P-2024-004 · Erweiterung Produktionshalle Werk II', META: null, LAST_SEEN: '2026-09-22T09:00:00Z', VIEW_COUNT: 18 },
    { ID: 6, ENTITY_TYPE: 'mahnung', ENTITY_ID: 8, LABEL: 'RE-2026-0048 · 1. Mahnung', META: { source_type: 'invoice' }, LAST_SEEN: '2026-09-21T10:30:00Z', VIEW_COUNT: 2 },
  ] })
  await get('stammdaten/setup-progress', { data: {
    admin: { steps: [
      { key: 'company', label: 'Firmendaten', hint: '', href: '/admin?tab=firma', done: true },
      { key: 'numbers', label: 'Nummernkreise', hint: '', href: '/admin?tab=nummern', done: true },
      { key: 'templates', label: 'Dokumentvorlagen', hint: '', href: '/admin?tab=vorlagen', done: false },
    ], done: 2, total: 3 },
    daten: { steps: [
      { key: 'address', label: 'Erste Adresse', hint: '', href: '/adressen', done: true },
      { key: 'project', label: 'Erstes Projekt', hint: '', href: '/projekte', done: true },
      { key: 'invoice', label: 'Erste Rechnung', hint: '', href: '/rechnungen', done: false },
    ], done: 2, total: 3 },
    total_done: 4, total_count: 6, all_done: false,
  } })
  await get('reports/dashboard/kpis', { data: {
    HONORAR_GESAMT: 6_160_951.1, LEISTUNGSSTAND_VALUE: 3_792_118.4, OFFENE_LEISTUNG: 331_998.0,
    STUNDEN_MONAT: 1_184.5, ABSCHLAGSRECHNUNGEN: 3_460_120.4, SCHLUSSGERECHNET: 412_880,
  } })
  await get('reports/dashboard/projects', { data: dashProjects })
  await get('reports/dashboard/by-status', { data: [
    { STATUS_NAME: 'Laufend', PROJECT_COUNT: 5 }, { STATUS_NAME: 'Pausiert', PROJECT_COUNT: 1 },
    { STATUS_NAME: 'Angebot', PROJECT_COUNT: 1 }, { STATUS_NAME: 'Abgeschlossen', PROJECT_COUNT: 1 },
  ] })
  await get('reports/dashboard/alerts', { data: [
    { severity: 'red',   type: 'overdue',  message: '4 Rechnungen überfällig (1.021.874,58 €)', count: 4, action_url: '/rechnungen' },
    { severity: 'amber', type: 'risk',     message: '2 Projekte mit Kosten über Leistungsstand', count: 2, action_url: '/projekte' },
    { severity: 'amber', type: 'progress', message: '3 Projekte ohne Leistungsstand seit 60 Tagen', count: 3, action_url: '/projekte?tab=leistungsstand' },
  ] })
  await get('reports/dashboard/risk-projects', { data: riskProjects })
  await get('reports/dashboard/billing-summary', { data: {
    projects: dashProjects.filter(p => p.OPEN_NET_TOTAL > 0).map(p => ({
      PROJECT_ID: p.PROJECT_ID, ABBR: p.ABBR, NAME: p.NAME, PROJECT_MANAGER_DISPLAY: p.PROJECT_MANAGER_DISPLAY, OPEN_NET_TOTAL: p.OPEN_NET_TOTAL,
    })),
    byPl: [{ name: 'M. Messina', total: 258_609.09, count: 1 }, { name: 'S. Braun', total: 128_864.4, count: 2 }, { name: 'T. Kern', total: 90_412.2, count: 2 }],
  } })
  await get('reports/dashboard/team-hours', { data: {
    months: months12,
    employees: EMPLOYEES.map((e, i) => ({ employee_id: e.ID, abbr: e.ABBR, total: 1_380 - i * 60,
      months: months12.map((m, j) => ({ month: m, hours: 110 + ((i + j) % 5) * 9 - i * 4 })) })),
  } })
  await get('reports/dashboard/open-invoices', { data: [
    { sourceType: 'invoice', sourceId: 12, number: 'RE-2026-0052', date: '2026-08-20', dueDate: '2026-09-19', addressName: 'Stadt Ravensburg', projectId: 1, openAmount: 1_527_968.21, daysOverdue: 5 },
    { sourceType: 'invoice', sourceId: 8, number: 'RE-2026-0048', date: '2026-08-07', dueDate: '2026-09-06', addressName: 'Mechanik Weber KG', projectId: 4, openAmount: 1_028_088.84, daysOverdue: 18 },
    { sourceType: 'pp', sourceId: 3, number: 'AR-2026-0017', date: '2026-07-30', dueDate: '2026-08-29', addressName: 'Wohnbau Süd GmbH', projectId: 2, openAmount: 46_291.6, daysOverdue: 26 },
    { sourceType: 'invoice', sourceId: 10, number: 'RE-2026-0050', date: '2026-08-14', dueDate: '2026-09-13', addressName: 'Dr. med. Hoffmann', projectId: 6, openAmount: 125_395.6, daysOverdue: 11 },
  ] })
  await get('reports/dashboard/overdue-invoices', { data: [
    { ID: 12, INVOICE_NUMBER: 'RE-2026-0052', INVOICE_DATE: '2026-08-20', DUE_DATE: '2026-09-19', TOTAL_AMOUNT_NET: 1_284_006.9, PROJECT_ID: 1, days_overdue: 5 },
    { ID: 8,  INVOICE_NUMBER: 'RE-2026-0048', INVOICE_DATE: '2026-08-07', DUE_DATE: '2026-09-06', TOTAL_AMOUNT_NET: 863_940.2, PROJECT_ID: 4, days_overdue: 18 },
    { ID: 10, INVOICE_NUMBER: 'RE-2026-0050', INVOICE_DATE: '2026-08-14', DUE_DATE: '2026-09-13', TOTAL_AMOUNT_NET: 105_374.45, PROJECT_ID: 6, days_overdue: 11 },
    { ID: 3,  INVOICE_NUMBER: 'RE-2026-0043', INVOICE_DATE: '2026-07-15', DUE_DATE: '2026-07-29', TOTAL_AMOUNT_NET: 4_250, PROJECT_ID: 3, days_overdue: 57 },
  ] })
  await get('mahnungen/stats', { data: {
    totalOpen: 9, totalClosed: 31, totalOverdue: 5, noDunningCount: 2, overdueActionsCount: 3, byStufe: { 1: 2, 2: 1 },
    suggestions: [
      { sourceType: 'invoice', sourceId: 3, number: 'RE-2026-0043', daysOverdue: 57, openAmount: 5_057.5, addressName1: 'Kreissparkasse', mahnstufe: 2, reason: 'action_due' },
      { sourceType: 'invoice', sourceId: 8, number: 'RE-2026-0048', daysOverdue: 18, openAmount: 1_028_088.84, addressName1: 'Mechanik Weber KG', mahnstufe: 0, reason: 'no_dunning' },
    ],
  } })
  await get('reports/dashboard/monthly', { data: months12.map((m, i) => ({ MONTH: m, HOURS_TOTAL: 1_100 + (i % 4) * 60, COST_TOTAL: 68_000 + (i % 4) * 3_500 })) })
  await get('reports/dashboard/open-se', { data: { totalOpen: 142_380.5, count: 6, byProject: [{ project_id: 1, abbr: 'P-2024-001', name: 'Neubau Kita', total: 117_356.02, count: 4 }] } })
  await get('reports/dashboard/arbzg-stats', { data: { warnWeek: 2, blockWeek: 0, over8hWeek: 5, warn30: 7, block30: 1, breakMissing30: 3, available: true } })
  await get('reports/dashboard/team-utilization', { data: EMPLOYEES.slice(0, 6).map((e, i) => ({ employee_id: e.ID, abbr: e.ABBR, hours_4weeks: 150 - i * 12 })) })
  await get('mitarbeiter/\\d+/balance', { data: monthBalance() })
  await get('mitarbeiter/me/balance', { data: monthBalance() })
  await get('mitarbeiter/\\d+/balance/running', { data: {
    totalBalance: 23.5,
    months: months12.map((m, i) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5)), required: 168, actual: 168 + ((i % 3) - 1) * 6, balance: ((i % 3) - 1) * 6, cumulative: 10 + i })),
  } })
  await get('mitarbeiter/me/streak', { data: { current_streak: 14, longest_streak: 31, today_booked: true } })

  // Abschlagsrechnung
  let ppPatched: Record<string, unknown> = {}
  await get('stammdaten/payment-means', { data: [
    { ID: 1, ABBR: '58', NAME: 'SEPA-Überweisung' }, { ID: 2, ABBR: '59', NAME: 'SEPA-Lastschrift' },
  ] })
  await byMethod('partial-payments/init', { POST: r => r.fulfill(json({ id: 501 })) })
  await byMethod('partial-payments/\\d+', {
    GET: r => r.fulfill(json({ data: { pp: {
      ID: 501, ADVANCE_INVOICE_NUMBER: null, ADVANCE_INVOICE_DATE: '2026-09-20', DUE_DATE: '2026-10-20',
      STATUS_ID: 1, PROJECT_ID: 1, CONTRACT_ID: 11,
      PROJECT: 'P-2024-001 Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1', CONTRACT: CONTRACTS[0].ABBR + ' ' + CONTRACTS[0].NAME,
      BILLING_PERIOD_START: '2026-08-01', BILLING_PERIOD_FINISH: '2026-08-31', COMMENT: '7. Abschlagsrechnung gemäß Zahlungsplan',
      BUYER_REFERENCE: '04011000-12345-34', BUYER_ORDER_REFERENCE: 'BE-2024-0815', BUYER_ACCOUNTING_REFERENCE: null,
      REMITTANCE_INFORMATION: null, VAT_CATEGORY: 'S', DISCOUNT_1_PERCENT: 0, DISCOUNT_2_PERCENT: 0,
      CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14, SE_PERCENT: 5, SE_BASIS: 'BRUTTO', ...ppPatched,
    } } })),
    PATCH: async r => { ppPatched = { ...ppPatched, ...(r.request().postDataJSON() ?? {}) }; return r.fulfill(json({ success: true })) },
    DELETE: r => r.fulfill(json({ ok: true })),
  })
  await get('partial-payments/\\d+/billing-proposal', { data: PROPOSAL })
  await byMethod('partial-payments/\\d+/performance', { PUT: r => r.fulfill(json({ data: PROPOSAL })) })
  await byMethod('partial-payments/\\d+/tec', {
    GET:  r => r.fulfill(json({ data: PP_TEC, hasBt2: true })),
    POST: r => r.fulfill(json({ data: PROPOSAL })),
  })
  await get('partial-payments/\\d+/attachments', { data: [] })
}
