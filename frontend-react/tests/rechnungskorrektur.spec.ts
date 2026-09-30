import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Rechnungskorrektur statt „Gutschrift" (Migration 0179).
 *
 * Vorher war die Gutschrift eine Einzelrechnung mit anderem Typcode: ohne
 * Bezug auf das Original, mit positiven Beträgen, als Forderung im
 * Mahnwesen. Jetzt beginnt jede Korrektur beim Original — aus der Liste
 * („⋯ → Rechnung korrigieren") oder über „Neue Rechnung" mit Auswahl —, der
 * Grund ist Pflicht und steht auf dem Beleg.
 */

function capture(page: Page, method: string, re: RegExp) {
  const hits: Request[] = []
  page.on('request', r => { if (r.method() === method && re.test(r.url())) hits.push(r) })
  return hits
}

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

const RECHNUNG = {
  ID: 100, INVOICE_NUMBER: 'R-2026-0100', INVOICE_DATE: '2026-09-01', DUE_DATE: '2026-09-30',
  TOTAL_AMOUNT_NET: 10000, TAX_AMOUNT_NET: 1900, TOTAL_AMOUNT_GROSS: 11900, STATUS_ID: 2,
  PROJECT_ID: 1, CONTRACT_ID: 1, VAT_PERCENT: 19, PROJECT: 'P-2024-001', CONTRACT: 'Vertrag 1',
  CONTACT: 'A. Ansprechpartner', CONTACT_MAIL: 'kontakt@kunde.de', ADDRESS_NAME_1: 'Wohnbau Süd GmbH',
  AMOUNT_PAYED_GROSS: 0, AMOUNT_ADJUSTED_GROSS: 0, OPEN_AMOUNT_GROSS: 11900,
  COMMENT: null, INVOICE_TYPE: 'rechnung', CANCELS_INVOICE_ID: null,
  TOTAL_DISCOUNTS: 0, CASH_DISCOUNT: 0, DISCOUNT_1_PERCENT: 0, DISCOUNT_2_PERCENT: 0,
  DISCOUNT_1_REASON: null, DISCOUNT_2_REASON: null, CASH_DISCOUNT_PERCENT: 0, CASH_DISCOUNT_DAYS: 0,
}

const BASIS = {
  original: { kind: 'INVOICE', id: 100, number: 'R-2026-0100', date: '2026-09-01', invoiceType: 'rechnung', vatPercent: 19 },
  rows: [
    { STRUCTURE_ID: 500, ABBR: 'LPH 5', NAME: 'Ausführungsplanung', BILLED_NET: 6000, CORRECTED_NET: 0, MAX_NET: 6000, DRAFT_NET: null },
    { STRUCTURE_ID: 501, ABBR: 'LPH 6', NAME: 'Vergabe', BILLED_NET: 4000, CORRECTED_NET: 1000, MAX_NET: 3000, DRAFT_NET: null },
  ],
}

async function setup(page: Page) {
  await mockPilot(page)
  await page.route(/\/api\/v1\/invoices(\?|$)/, r => r.fulfill(json({ data: [RECHNUNG] })))
  await page.route(/\/api\/v1\/partial-payments(\?|$)/, r => r.fulfill(json({ data: [] })))
  await page.route(/\/api\/v1\/invoices\/correction-basis(\?|$)/, r => r.fulfill(json({ data: BASIS })))
  await page.route(/\/api\/v1\/invoices\/corrections(\?|$)/, r =>
    r.fulfill(json({ id: 777, total_amount_net: -1500, tax_amount_net: -285, total_amount_gross: -1785 })))
  await page.route(/\/api\/v1\/invoices\/777\/book(\?|$)/, r => r.fulfill(json({ success: true, number: 'R-2026-0101' })))
}

test.describe('Rechnungskorrektur', () => {
  test('aus der Liste: Minderung je Element, Grund Pflicht, dann buchen', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'Aktionsmenü der Tabellenzeile — am Handy eigene Karte')
    await setup(page)
    const saves = capture(page, 'POST', /\/api\/v1\/invoices\/corrections(\?|$)/)
    const books = capture(page, 'POST', /\/api\/v1\/invoices\/777\/book/)
    await page.goto('/rechnungen')
    await page.getByRole('row', { name: /R-2026-0100/ }).getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Rechnung korrigieren' }).or(page.getByRole('button', { name: 'Rechnung korrigieren' })).first().click()

    const dialog = page.getByRole('dialog', { name: /Rechnung korrigieren – R-2026-0100/ })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Minderung netto LPH 6').fill('1500')
    await dialog.getByLabel('Minderung netto LPH 6').blur()
    await expect(dialog).toContainText('1.785,00')                        // brutto, 19 %

    await dialog.getByRole('button', { name: 'Korrektur buchen' }).click()
    await expect(dialog).toContainText('Bitte den Grund der Korrektur angeben')
    expect(saves).toHaveLength(0)

    await dialog.getByLabel(/Grund der Korrektur/).fill('Aufmaß LPH 6 berichtigt')
    await dialog.getByRole('button', { name: 'Korrektur buchen' }).click()
    await expect(dialog).toBeHidden()
    expect(saves[0].postDataJSON()).toMatchObject({
      invoice_id: 100, reason: 'Aufmaß LPH 6 berichtigt',
      rows: [{ structure_id: 501, amount_net: 1500 }],
    })
    expect(books).toHaveLength(1)
  })

  test('mehr als noch korrigierbar wird vor dem Senden abgelehnt', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'Aktionsmenü der Tabellenzeile — am Handy eigene Karte')
    await setup(page)
    const saves = capture(page, 'POST', /\/api\/v1\/invoices\/corrections(\?|$)/)
    await page.goto('/rechnungen')
    await page.getByRole('row', { name: /R-2026-0100/ }).getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Rechnung korrigieren' }).or(page.getByRole('button', { name: 'Rechnung korrigieren' })).first().click()
    const dialog = page.getByRole('dialog', { name: /Rechnung korrigieren/ })
    await dialog.getByLabel('Minderung netto LPH 6').fill('3500')
    await dialog.getByLabel(/Grund der Korrektur/).fill('zu viel')
    await dialog.getByRole('button', { name: 'Entwurf speichern' }).click()
    await expect(dialog).toContainText('höchstens 3.000,00')
    expect(saves).toHaveLength(0)
  })

  test('über „Neue Rechnung": erst das Original wählen', async ({ page }) => {
    await setup(page)
    await page.goto('/rechnungen?tab=gutschrift')
    const dialog = page.getByRole('dialog', { name: 'Rechnung korrigieren' })
    await expect(dialog.getByRole('button', { name: 'Korrektur buchen' })).toHaveCount(0)
    await expect(dialog.locator('#kd-original option', { hasText: 'R-2026-0100' })).toHaveCount(1)
    await dialog.getByLabel('Welche Rechnung wird korrigiert?*').selectOption('invoice:100')
    await expect(dialog.getByLabel('Minderung netto LPH 5')).toBeVisible()
  })
})
