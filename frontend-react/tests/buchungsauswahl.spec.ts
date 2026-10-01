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

  test('Handy: kein Querscrollen mit allen Filtern', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile')
    await setup(page)
    await openBookings(page)
    await page.getByLabel(/Seit letzter Rechnung/).check()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)
  })
})
