import type { Page } from '@playwright/test'

/**
 * Realistische Beispieldaten fuer visuelle Pruefungen.
 *
 * Die uebrigen Specs mocken alles auf `{ data: [] }` — damit rendern Listen
 * und Dashboard nur ihren Leerzustand, und Dichte, Spaltenbreiten oder
 * Umbrueche lassen sich gar nicht beurteilen. Diese Fixture liefert daher
 * plausible Buerodaten (lange Projektnamen, grosse Betraege, Umlaute).
 */

const AUTH = {
  state: {
    token: 'test-token', employeeId: 1, tenantId: 1,
    shortName: 'SM', email: 'simon@buero.de', companyName: 'Messina Architekten GmbH',
  },
  version: 0,
}

const PROJECTS = [
  ['P-2024-001', 'Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1', 'Laufend', 'Neubau', 'M. Messina', 'Stadt Ravensburg'],
  ['P-2024-002', 'Sanierung Altbau Bahnhofstraße 14', 'Laufend', 'Sanierung', 'T. Kern', 'Wohnbau Süd GmbH'],
  ['P-2024-003', 'Umbau Verwaltungsgebäude Nordflügel', 'Pausiert', 'Umbau', 'M. Messina', 'Kreissparkasse'],
  ['P-2024-004', 'Erweiterung Produktionshalle Werk II', 'Laufend', 'Neubau', 'S. Braun', 'Mechanik Weber KG'],
  ['P-2025-011', 'Machbarkeitsstudie Quartier Westufer', 'Angebot', 'Studie', 'T. Kern', 'Stadt Friedrichshafen'],
  ['P-2025-012', 'Innenausbau Praxisräume Dr. Hoffmann', 'Laufend', 'Innenausbau', 'S. Braun', 'Dr. med. Hoffmann'],
  ['P-2023-088', 'Wohnanlage Seeblick, Haus A–C', 'Abgeschlossen', 'Neubau', 'M. Messina', 'Seeblick Immobilien AG'],
  ['P-2025-014', 'Brandschutzertüchtigung Schulzentrum', 'Laufend', 'Sanierung', 'T. Kern', 'Landkreis Bodenseekreis'],
]

const projects = PROJECTS.map(([short, long, status, typ, mgr, addr], i) => ({
  ID: i + 1,
  NAME_SHORT: short, NAME_LONG: long,
  PROJECT_STATUS_ID: i % 4 + 1, PROJECT_TYPE_ID: i % 5 + 1,
  PROJECT_MANAGER_ID: i % 3 + 1, DEPARTMENT_ID: 1,
  ADDRESS_ID: i + 1, CONTACT_ID: i + 1, IS_INTERNAL: false,
  STATUS_NAME: status, TYPE_NAME: typ, MANAGER_NAME: mgr,
  ADDRESS_NAME: addr, CONTACT_NAME: 'A. Ansprechpartner', DEPARTMENT_NAME: 'Hochbau',
}))

const INVOICES = [
  ['RE-2025-0041', '2025-07-02', '2025-08-01', 112_400,  1, 'Abschlag'],
  ['RE-2025-0042', '2025-07-08', '2025-08-07',  38_900.5, 2, 'Abschlag'],
  ['RE-2025-0043', '2025-07-15', '2025-07-29',   4_250,   3, 'Schluss'],
  ['RE-2025-0044', '2025-07-21', '2025-08-20', 268_000,   1, 'Abschlag'],
  ['RE-2025-0045', '2025-07-28', '2025-08-27',   1_980.4, 2, 'Schluss'],
  ['RE-2025-0046', '2025-08-01', '2025-08-31',  57_300,   4, 'Abschlag'],
]

const invoices = INVOICES.map(([nr, date, due, net, status, typ], i) => ({
  ID: i + 1,
  INVOICE_NUMBER: nr as string, INVOICE_DATE: date as string, DUE_DATE: due as string,
  TOTAL_AMOUNT_NET: net as number,
  TAX_AMOUNT_NET: Math.round((net as number) * 0.19 * 100) / 100,
  TOTAL_AMOUNT_GROSS: Math.round((net as number) * 1.19 * 100) / 100,
  STATUS_ID: status as number,
  PROJECT_ID: (i % projects.length) + 1, CONTRACT_ID: 1, VAT_PERCENT: 19,
  PROJECT: projects[i % projects.length].NAME_SHORT + ' ' + projects[i % projects.length].NAME_LONG,
  CONTRACT: 'Vertrag ' + (i + 1),
  CONTACT: 'A. Ansprechpartner', CONTACT_MAIL: 'kontakt@kunde.de',
  ADDRESS_NAME_1: projects[i % projects.length].ADDRESS_NAME,
  AMOUNT_PAYED_GROSS: i % 3 === 0 ? Math.round((net as number) * 1.19 * 100) / 100 : 0,
  COMMENT: null, INVOICE_TYPE: typ as string, CANCELS_INVOICE_ID: null,
  TOTAL_DISCOUNTS: 0, CASH_DISCOUNT: 0,
  DISCOUNT_1_PERCENT: 0, DISCOUNT_2_PERCENT: 0,
  DISCOUNT_1_REASON: null, DISCOUNT_2_REASON: null,
  CASH_DISCOUNT_PERCENT: 0, CASH_DISCOUNT_DAYS: 0,
}))

const addresses = PROJECTS.map(([, , , , , addr], i) => ({
  ID: i + 1, NAME_1: addr, NAME_2: '', STREET: 'Musterweg ' + (i + 3),
  ZIP: String(88000 + i), CITY: ['Ravensburg', 'Friedrichshafen', 'Weingarten'][i % 3],
  COUNTRY: 'DE', EMAIL: 'info@kunde-' + i + '.de', PHONE: '0751 12345-' + i,
  CATEGORY_NAME: i % 2 ? 'Bauherr' : 'Fachplaner', IS_ACTIVE: true,
}))

const named = (n: string[]) => n.map((name, i) => ({ ID: i + 1, NAME: name, NAME_SHORT: name, NAME_LONG: name }))

/** Registriert Auth + Beispieldaten. Reihenfolge wie in den anderen Specs:
 *  Catch-All zuerst, spezifische Routen danach. */
export async function mockDemo(page: Page) {
  await page.addInitScript(a => { localStorage.setItem('plain_auth', JSON.stringify(a)) }, AUTH)

  const j = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('/api/v1/**', r => r.fulfill(j({ data: [] })))

  // WICHTIG: alle Muster auf /api/v1/ verankern. Ein loses /\/adressen/ faengt
  // sonst auch die Seiten-Navigation ab und liefert JSON statt der App.
  const routes: Array<[string, unknown]> = [
    ['auth/me',              { employee_id: 1, tenant_id: 1, email: 'simon@buero.de', short_name: 'SM', company_name: 'Messina Architekten GmbH' }],
    ['permissions/me',       { keys: [], unrestricted: true }],
    ['license/me',           { unrestricted: true, plan_id: null, state: null, capabilities: [], limits: {} }],
    ['projekte/list',        { data: projects }],
    ['projekte/statuses',    { data: named(['Angebot', 'Laufend', 'Pausiert', 'Abgeschlossen']) }],
    ['projekte/types',       { data: named(['Neubau', 'Sanierung', 'Umbau', 'Studie', 'Innenausbau']) }],
    ['projekte/managers',    { data: named(['M. Messina', 'T. Kern', 'S. Braun']) }],
    ['projekte/departments', { data: named(['Hochbau', 'Tiefbau']) }],
    ['invoices',             { data: invoices }],
    ['adressen',             { data: addresses }],
  ]
  for (const [path, body] of routes) {
    await page.route(new RegExp(`/api/v1/${path}(\\?|$)`), r => r.fulfill(j(body)))
  }
}

/** Blendet das Dev-Overlay der React-Query-Devtools aus (in Produktion nicht vorhanden). */
export async function hideDevtools(page: Page) {
  await page.addStyleTag({ content: '.tsqd-parent-container { display: none !important }' })
}
