import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Buchungsauswahl in den Rechnungsassistenten (hier am Abschlag, Entwurf 501
 * mit Leistungszeitraum 01.–31.08.2026): 0-Beträge in einem Rutsch,
 * „Alle Buchungen", „Nur sichtbare auswählen", „Seit letzter Rechnung" und
 * der Hinweis auf Buchungen außerhalb des Leistungszeitraums.
 */

const TEC = [
  { ID: 1, BOOKING_DATE: '2026-07-28', EMPLOYEE_SHORT_NAME: 'SM', POSTING_DESCRIPTION: 'Bestandsaufnahme',   HOURLY_RATE_TOTAL: 190, HOURS: 2,   STRUCTURE_ID: 2, STRUCTURE_LABEL: 'LP2 – Vorplanung', ASSIGNED: false },
  { ID: 2, BOOKING_DATE: '2026-08-05', EMPLOYEE_SHORT_NAME: 'SM', POSTING_DESCRIPTION: 'Abstimmung Kulanz',  HOURLY_RATE_TOTAL: 0,   HOURS: 1.5, STRUCTURE_ID: 2, STRUCTURE_LABEL: 'LP2 – Vorplanung', ASSIGNED: false },
  { ID: 3, BOOKING_DATE: '2026-08-12', EMPLOYEE_SHORT_NAME: 'AB', POSTING_DESCRIPTION: 'Entwurf Grundrisse', HOURLY_RATE_TOTAL: 285, HOURS: 3,   STRUCTURE_ID: 3, STRUCTURE_LABEL: 'LP3 – Entwurfsplanung', ASSIGNED: false },
  { ID: 4, BOOKING_DATE: '2026-08-20', EMPLOYEE_SHORT_NAME: 'AB', POSTING_DESCRIPTION: 'Rückfrage Statik',   HOURLY_RATE_TOTAL: 0,   HOURS: 0.5, STRUCTURE_ID: 3, STRUCTURE_LABEL: 'LP3 – Entwurfsplanung', ASSIGNED: false },
  { ID: 5, BOOKING_DATE: '2026-09-03', EMPLOYEE_SHORT_NAME: 'SM', POSTING_DESCRIPTION: 'Entwurf Schnitte',   HOURLY_RATE_TOTAL: 380, HOURS: 4,   STRUCTURE_ID: 3, STRUCTURE_LABEL: 'LP3 – Entwurfsplanung', ASSIGNED: false },
]
const LAST_INVOICE = { kind: 'abschlag', id: 499, number: 'AR-2026-006', date: '2026-08-05', period_end: '2026-07-31', since: '2026-07-31' }

async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
  await mockPilot(page)
  // Nach mockPilot registriert — die zuletzt angelegte Route gewinnt.
  await page.route(/\/api\/v1\/partial-payments\/\d+\/tec(\?|$)/, r => {
    if (r.request().method() === 'GET') {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: TEC, hasBt2: true, last_invoice: LAST_INVOICE }) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) })
  })
}

const bar = (page: Page) => page.getByRole('region', { name: 'Seitenaktionen' })
const summary = (page: Page) => page.locator('.ba-summary')

async function openBookings(page: Page) {
  await page.goto('/rechnungen?tab=abschlag&draftId=501')
  await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
  await expect(page.getByText('Buchungen zuweisen')).toBeVisible()
}

test.describe('Buchungsauswahl', () => {
  test('0-Beträge in einem Rutsch, „Alle" beachtet das, die Vorliebe bleibt', async ({ page }) => {
    await setup(page)
    await openBookings(page)
    await expect(summary(page)).toContainText('5 Buchungen')
    await expect(summary(page)).toContainText('5 ausgewählt')
    await expect(summary(page)).toContainText('11 h')
    await expect(summary(page)).toContainText(/855,00/)

    await page.getByLabel(/0-Beträge mitabrechnen/).uncheck()
    await expect(summary(page)).toContainText('3 ausgewählt')
    await expect(page.getByLabel('Alle Buchungen')).toBeChecked()

    await page.getByLabel('Alle Buchungen').uncheck()
    await expect(summary(page)).toContainText('0 ausgewählt')
    await page.getByLabel('Alle Buchungen').check()
    await expect(summary(page)).toContainText('3 ausgewählt')

    // Ein neuer Aufruf wählt 0-Beträge gar nicht erst vor.
    page.on('dialog', d => void d.accept())
    await page.reload()
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(summary(page)).toContainText('3 ausgewählt')
    await expect(page.getByLabel(/0-Beträge mitabrechnen/)).not.toBeChecked()
  })

  test('„Seit letzter Rechnung" blendet aus, „Nur sichtbare" übernimmt genau das', async ({ page }) => {
    await setup(page)
    await openBookings(page)
    const since = page.getByLabel(/Seit letzter Rechnung/)
    await expect(page.locator('label', { has: since })).toContainText('nach 31.07.2026')
    await since.check()
    await expect(summary(page)).toContainText('4 von 5 sichtbar')
    // Ausgeblendet, aber angehakt — wird mit abgerechnet, und das steht da.
    await expect(summary(page)).toContainText('davon 1 ausgeblendet')

    await page.getByRole('button', { name: 'Nur sichtbare auswählen' }).click()
    await expect(summary(page)).toContainText('4 ausgewählt')
    await expect(summary(page)).not.toContainText('ausgeblendet')

    // Gespeichert wird genau diese Auswahl.
    const posts: Request[] = []
    page.on('request', r => { if (r.method() === 'POST' && /partial-payments\/501\/tec/.test(r.url())) posts.push(r) })
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect.poll(() => posts.length).toBe(1)
    expect((posts[0].postDataJSON() as { ids_assign: number[] }).ids_assign.sort()).toEqual([2, 3, 4, 5])
  })

  test('Hinweis auf Buchungen außerhalb des Leistungszeitraums, Abwählen in einem Klick', async ({ page }) => {
    await setup(page)
    await openBookings(page)
    const warn = page.locator('.ba-warn')
    await expect(warn).toContainText('2 ausgewählte Buchungen liegen außerhalb des Leistungszeitraums (01.08.2026 – 31.08.2026)')
    await warn.getByRole('button', { name: 'Abwählen' }).click()
    await expect(warn).toHaveCount(0)
    await expect(summary(page)).toContainText('3 ausgewählt')

    await page.getByLabel(/Im Leistungszeitraum/).check()
    await expect(summary(page)).toContainText('3 von 5 sichtbar')
    await expect(summary(page)).not.toContainText('ausgeblendet')
  })

  test('Kopf-Häkchen zeigt „teils", Leistung als Filter, Suche wird nicht vererbt', async ({ page }) => {
    await setup(page)
    await openBookings(page)
    const head = page.getByLabel('Alle sichtbaren auswählen')
    await page.getByLabel(/Entwurf Grundrisse/).uncheck()
    await expect(head).not.toBeChecked()
    expect(await head.evaluate(el => (el as HTMLInputElement).indeterminate)).toBe(true)

    await expect(page.getByRole('button', { name: /Leistung/ })).toBeVisible()
    await expect(page.locator('.ba-structure').first()).toHaveText('LP2 – Vorplanung')

    await page.getByPlaceholder(/suchen/).fill('Statik')
    await expect(summary(page)).toContainText('1 von 5 sichtbar')
    page.on('dialog', d => void d.accept())
    await page.reload()
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(page.getByPlaceholder(/suchen/)).toHaveValue('')
    await expect(summary(page)).toContainText('5 Buchungen')
  })

  test('Sortieren über die Spaltenköpfe, per Maus und Tastatur, bleibt gemerkt', async ({ page }) => {
    await setup(page)
    await openBookings(page)
    const firstDesc = () => page.locator('.ba-table tbody tr').first().locator('td').nth(3)
    await expect(firstDesc()).toContainText('Bestandsaufnahme')      // Standard: Datum aufsteigend

    const betrag = page.getByRole('columnheader', { name: /Betrag/ })
    await betrag.click()
    await expect(betrag).toHaveAttribute('aria-sort', 'ascending')
    await expect(firstDesc()).toContainText('Abstimmung Kulanz')     // 0 € vor 190 €, gleich teuer → früheres Datum
    await betrag.press('Enter')
    await expect(betrag).toHaveAttribute('aria-sort', 'descending')
    await expect(firstDesc()).toContainText('Entwurf Schnitte')      // 380 €

    // Sortieren blendet nichts aus und ändert die Auswahl nicht.
    await expect(summary(page)).toContainText('5 Buchungen')
    await expect(summary(page)).toContainText('5 ausgewählt')

    page.on('dialog', d => void d.accept())
    await page.reload()
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(page.getByRole('columnheader', { name: /Betrag/ })).toHaveAttribute('aria-sort', 'descending')
  })

  test('Schlussrechnung: Buchungen der Positionen nach Aufwand, Abwählen mindert die Position', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
    await mockPilot(page)
    const phase = (ID: number, ABBR: string, NAME: string, bt: number, earned: number, ext: number, sel: boolean, FATHER_ID: number | null = 101) => ({
      ID, FATHER_ID, ABBR, NAME, BILLING_TYPE_ID: bt, EXTRAS_PERCENT: ext, REVENUE_COMPLETION: earned,
      EXTRAS_AMOUNT: earned * ext / 100, TOTAL_EARNED: earned * (1 + ext / 100), BILLED_FINAL: 0, ALREADY_BILLED: 0,
      AMOUNT_NET: null, AMOUNT_EXTRAS_NET: null, SELECTED: sel, CLOSED_BY_INVOICE_ID: null, CLOSED: false,
    })
    const PHASES = [
      phase(101, 'Gebäude', 'Objektplanung', 1, 0, 0, false, null),
      phase(102, 'LP1', 'Grundlagenermittlung', 1, 18_000, 0, true),
      phase(110, 'BL', 'Besondere Leistungen', 2, 1_000, 10, true),
      phase(111, 'NW', 'Nachweis Bauleitung', 2, 500, 0, false),
    ]
    const FINAL_TEC = [
      { ...TEC[2], ID: 21, STRUCTURE_ID: 110, STRUCTURE_LABEL: 'BL – Besondere Leistungen', POSTING_DESCRIPTION: 'Brandschutzkonzept', HOURLY_RATE_TOTAL: 200 },
      { ...TEC[2], ID: 22, STRUCTURE_ID: 110, STRUCTURE_LABEL: 'BL – Besondere Leistungen', POSTING_DESCRIPTION: 'Wärmeschutznachweis', HOURLY_RATE_TOTAL: 300 },
      { ...TEC[2], ID: 23, STRUCTURE_ID: 111, STRUCTURE_LABEL: 'NW – Nachweis Bauleitung', POSTING_DESCRIPTION: 'Baustellentermin', HOURLY_RATE_TOTAL: 500 },
    ]
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    await page.route(/\/api\/v1\/final-invoices\/701\/phases(\?|$)/, r => r.fulfill(json(r.request().method() === 'GET'
      ? { data: PHASES }
      : { ok: true, phaseTotal: 0, deductionsTotal: 0, totalNet: 0, vatPercent: 19, taxAmountNet: 0, totalGross: 0 })))
    await page.route(/\/api\/v1\/invoices\/701\/tec(\?|$)/, r => r.fulfill(json({ data: FINAL_TEC, hasBt2: true, last_invoice: null })))

    await page.goto('/rechnungen?tab=schluss&draftId=701')
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    const bl = page.getByRole('row', { name: /Besondere Leistungen abrechnen/ })
    await expect(bl).toContainText('1.100,00')
    // Nur die Buchungen der gewählten Positionen stehen zur Auswahl.
    await expect(summary(page)).toContainText('2 Buchungen')
    await expect(page.getByLabel(/Baustellentermin/)).toHaveCount(0)

    // Abwählen mindert die Position samt 10 % Nebenkosten.
    await page.getByLabel(/Brandschutzkonzept auswählen/).uncheck()
    await expect(bl).toContainText('880,00')

    // Eine Position dazunehmen wählt ihre Buchungen mit.
    await page.getByRole('checkbox', { name: /NW Nachweis Bauleitung abrechnen/ }).check()
    await expect(summary(page)).toContainText('3 Buchungen')
    await expect(summary(page)).toContainText('2 ausgewählt')

    const posts: Request[] = []
    page.on('request', r => { if (r.method() === 'POST' && /final-invoices\/701\/phases/.test(r.url())) posts.push(r) })
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect.poll(() => posts.length).toBe(1)
    const body = posts[0].postDataJSON() as { structure_ids: number[]; booking_ids: number[] }
    expect(body.structure_ids.sort()).toEqual([102, 110, 111])
    expect(body.booking_ids.sort()).toEqual([22, 23])
  })

  test('Handy: kein Querscrollen mit allen Filtern', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile')
    await setup(page)
    await openBookings(page)
    await page.getByLabel(/Seit letzter Rechnung/).check()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)
  })
})
