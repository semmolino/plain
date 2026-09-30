import type { Page, Route } from '@playwright/test'
import { mockPilot } from './pilotData'

/**
 * Gesamtprojekte (Migration 0181): Gruppe 5 „Kita Sonnenblume" mit den
 * Projekten 1 und 2, Projekt 3 und 4 ohne Gesamtprojekt. `partial` = der
 * Nutzer sieht im Reporting nur Projekt 1 (Scope-Hinweis „1 von 2").
 */

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

export const GROUP = {
  ID: 5, ABBR: 'GP-2024-01', NAME: 'Kita Sonnenblume (Gesamtvorhaben)',
  ADDRESS_ID: 1, ADDRESS_NAME: 'Stadt Ravensburg', MANAGER_ID: 1, MANAGER_NAME: 'Michael Messina',
  NOTES: 'Stufe 1: LPH 1–4\nStufe 2: LPH 5–8', PROJECT_IDS: [1, 2], PROJECT_COUNT: 2,
}

const GROUPED: Record<number, { PROJECT_GROUP_ID: number; GROUP_ABBR: string; GROUP_NAME: string }> = {
  1: { PROJECT_GROUP_ID: 5, GROUP_ABBR: GROUP.ABBR, GROUP_NAME: GROUP.NAME },
  2: { PROJECT_GROUP_ID: 5, GROUP_ABBR: GROUP.ABBR, GROUP_NAME: GROUP.NAME },
}

const PROJECT_ROWS = [
  ['P-2024-001', 'Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1', 'Laufend', 'M. Messina', 'Stadt Ravensburg'],
  ['P-2024-002', 'Sanierung Altbau Bahnhofstraße 14', 'Laufend', 'T. Kern', 'Wohnbau Süd GmbH'],
  ['P-2024-003', 'Umbau Verwaltungsgebäude Nordflügel', 'Pausiert', 'M. Messina', 'Kreissparkasse'],
  ['P-2024-004', 'Erweiterung Produktionshalle Werk II', 'Laufend', 'S. Braun', 'Mechanik Weber KG'],
].map(([abbr, name, status, mgr, addr], i) => ({
  ID: i + 1, ABBR: abbr, NAME: name,
  PROJECT_STATUS_ID: 2, PROJECT_TYPE_ID: 1, PROJECT_MANAGER_ID: 1, DEPARTMENT_ID: 1,
  ADDRESS_ID: i + 1, CONTACT_ID: 1, IS_INTERNAL: false,
  STATUS_NAME: status, TYPE_NAME: 'Neubau', MANAGER_NAME: mgr, ADDRESS_NAME: addr,
  CONTACT_NAME: 'A. Ansprechpartner', DEPARTMENT_NAME: 'Hochbau',
  PROJECT_GROUP_ID: null as number | null, GROUP_ABBR: '', GROUP_NAME: '',
  ...GROUPED[i + 1],
}))

/** Report-Zeile je Projekt (Form von VW_REPORT_PROJECT_DETAIL). */
const reportRow = (p: typeof PROJECT_ROWS[number], budget: number, ls: number, billed: number, cost: number) => ({
  PROJECT_ID: p.ID, ABBR: p.ABBR, NAME: p.NAME,
  PROJECT_STATUS_ID: 2, PROJECT_STATUS_NAME_SHORT: p.STATUS_NAME,
  PROJECT_TYPE_ID: 1, PROJECT_TYPE_NAME_SHORT: 'Neubau',
  PROJECT_MANAGER_ID: 1, PROJECT_MANAGER_DISPLAY: p.MANAGER_NAME,
  ADDRESS_ID: p.ADDRESS_ID, ADDRESS_NAME: p.ADDRESS_NAME, COMPANY_ID: 1, COMPANY_NAME: 'Messina Architekten GmbH',
  DEPARTMENT_ID: 1, DEPARTMENT_NAME: 'Hochbau',
  BUDGET_TOTAL_NET: budget, LEISTUNGSSTAND_VALUE: ls, LEISTUNGSSTAND_PERCENT: (ls / budget) * 100,
  HOURS_TOTAL: 100, COST_TOTAL: cost, COST_RATIO: cost / ls,
  REMAINING_BUDGET_NET: budget - ls, BILLED_NET_TOTAL: billed, OPEN_NET_TOTAL: ls - billed,
  PAYED_NET_TOTAL: billed, SALES_TOTAL: 0, QTY_EXT_TOTAL: 0,
  PROJECT_GROUP_ID: p.PROJECT_GROUP_ID, GROUP_ABBR: p.GROUP_ABBR || null, GROUP_NAME: p.GROUP_NAME || null,
})

const REPORT_ROWS = [
  reportRow(PROJECT_ROWS[0], 400_000, 200_000, 150_000, 120_000),
  reportRow(PROJECT_ROWS[1], 100_000, 90_000, 60_000, 50_000),
  reportRow(PROJECT_ROWS[2], 80_000, 20_000, 10_000, 15_000),
]

const TOTALS = {
  PROJECT_COUNT: 2, BUDGET_TOTAL_NET: 500_000, LEISTUNGSSTAND_VALUE: 290_000, LEISTUNGSSTAND_PERCENT: 58,
  HOURS_TOTAL: 200, COST_TOTAL: 170_000, COST_RATIO: 170_000 / 290_000, REMAINING_BUDGET_NET: 210_000,
  BILLED_NET_TOTAL: 210_000, OPEN_NET_TOTAL: 80_000, PAYED_NET_TOTAL: 210_000, SALES_TOTAL: 0, QTY_EXT_TOTAL: 0,
}

export interface Calls {
  patches: unknown[]; deletes: number; puts: unknown[]; posts: unknown[]
  /** Stufe 2: Beauftragen, Kopieren (Folgeprojekt), Neuanlage, Matrix-Abfragen */
  converts: Record<string, unknown>[]; copies: Record<string, unknown>[]; creates: Record<string, unknown>[]; matrixUrls: string[]
}

/** Leistungsphasen der Gruppe: LPH 1–4 im ersten, LPH 5 im zweiten Vertrag. */
const cell = (h: number, e: number, c: number) => ({
  HONORAR_NET: h, EARNED_VALUE_NET: e, HOURS_TOTAL: c / 60, COST_TOTAL: c,
  LEISTUNGSSTAND_PERCENT: h ? (e / h) * 100 : null, KOSTENQUOTE: e ? c / e : null, DB: e - c, ampel: 'gruen',
})
const MATRIX = {
  phases: [{ num: 1, label: 'LPH 1' }, { num: 4, label: 'LPH 4' }, { num: 5, label: 'LPH 5' }],
  projects: [
    { PROJECT_ID: 1, ABBR: 'P-2024-001', NAME: 'Neubau Kita, LPH 1–4', cells: { 1: cell(20_000, 20_000, 9_000), 4: cell(30_000, 30_000, 12_000) }, total: cell(50_000, 50_000, 21_000) },
    { PROJECT_ID: 2, ABBR: 'P-2024-002', NAME: 'Neubau Kita, LPH 5–8', cells: { 5: cell(80_000, 8_000, 3_000) }, total: cell(80_000, 8_000, 3_000) },
  ],
  byPhase: [
    { num: 1, label: 'LPH 1', ...cell(20_000, 20_000, 9_000), HOURS_SHARE: 40, HONORAR_SHARE: 15 },
    { num: 4, label: 'LPH 4', ...cell(30_000, 30_000, 12_000), HOURS_SHARE: 50, HONORAR_SHARE: 23 },
    { num: 5, label: 'LPH 5', ...cell(80_000, 8_000, 3_000), HOURS_SHARE: 10, HONORAR_SHARE: 62 },
  ],
  totals: cell(130_000, 58_000, 24_000),
}

export async function mockGroups(page: Page, { partial = false, empty = false } = {}): Promise<Calls> {
  await mockPilot(page)
  const calls: Calls = { patches: [], deletes: 0, puts: [], posts: [], converts: [], copies: [], creates: [], matrixUrls: [] }
  const route = (re: string, h: (r: Route) => unknown) => page.route(new RegExp(`/api/v1/${re}(\\?|$)`), h)

  await route('projekte/list', r => r.fulfill(json({ data: PROJECT_ROWS })))
  await route('projekte/gruppen', r => {
    if (r.request().method() === 'POST') {
      calls.posts.push(r.request().postDataJSON())
      return r.fulfill(json({ data: { ...GROUP, ID: 6, NAME: r.request().postDataJSON().name, PROJECT_IDS: [], PROJECT_COUNT: 0, PROJECTS: [] }, moved: [] }, 201))
    }
    return r.fulfill(json({ data: empty ? [] : [GROUP] }))
  })
  await route('projekte/gruppen/5', r => {
    const m = r.request().method()
    if (m === 'DELETE') { calls.deletes++; return r.fulfill(json({ data: { deleted: true, unlinked: 2 } })) }
    if (m === 'PATCH') { calls.patches.push(r.request().postDataJSON()); return r.fulfill(json({ data: { ...GROUP, PROJECTS: [] } })) }
    return r.fulfill(json({ data: { ...GROUP, PROJECTS: [] } }))
  })
  await route('projekte/gruppen/5/projekte', r => {
    calls.puts.push(r.request().postDataJSON())
    return r.fulfill(json({ data: { ...GROUP, PROJECTS: [] }, added: 1, removed: 0, moved: [] }))
  })
  await route('projekte/1', r => {
    if (r.request().method() === 'PATCH') {
      calls.patches.push(r.request().postDataJSON())
      return r.fulfill(json({ data: PROJECT_ROWS[0] }))
    }
    return r.fallback()
  })
  await route('reports/groups/5/summary', r => r.fulfill(json({
    data: {
      group: { ID: 5, ABBR: GROUP.ABBR, NAME: GROUP.NAME },
      members: partial ? [REPORT_ROWS[0]] : REPORT_ROWS.slice(0, 2),
      totals: partial ? { ...TOTALS, PROJECT_COUNT: 1, BUDGET_TOTAL_NET: 400_000 } : TOTALS,
    },
    meta: { members_total: 2, members_visible: partial ? 1 : 2, scope: partial ? 'permission' : null },
  })))
  await route('reports/projects/list', r => r.fulfill(json({ data: REPORT_ROWS, meta: { total: 3, scope: null } })))

  // ── Stufe 2 ──
  await route('projekte/gruppen/5/nummer', r => r.fulfill(json({ data: { abbr: 'GP-2024-01-03' } })))
  await route('angebote/\\d+/convert', r => {
    calls.converts.push(r.request().postDataJSON())
    return r.fulfill(json({ data: { project: { ID: 9, ABBR: 'GP-2024-01-03' }, projectName: 'GP-2024-01-03' } }))
  })
  await route('projekte/\\d+/copy', r => {
    calls.copies.push(r.request().postDataJSON() ?? {})
    return r.fulfill(json({ data: { project: { ID: 9, ABBR: 'GP-2024-01-03' }, projectName: 'Neubau Kita (Kopie)' } }))
  })
  await route('projekte', r => {
    if (r.request().method() === 'GET') {
      // Kurzliste für die Projektwahl — mit Gesamtprojekt je Projekt
      return r.fulfill(json({ data: PROJECT_ROWS.map(p => ({ ID: p.ID, ABBR: p.ABBR, NAME: p.NAME, GROUP_NAME: p.GROUP_NAME || null })) }))
    }
    calls.creates.push(r.request().postDataJSON())
    return r.fulfill(json({ data: { ID: 9, ABBR: 'GP-2024-01-03' } }))
  })
  await route('reports/phases/matrix', r => {
    calls.matrixUrls.push(r.request().url())
    const grouped = r.request().url().includes('group_id=')
    return r.fulfill(json({ data: MATRIX, meta: grouped ? { members_total: 2, members_visible: 2 } : null }))
  })
  return calls
}
