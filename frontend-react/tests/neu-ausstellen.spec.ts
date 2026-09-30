import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Stornieren und neu ausstellen (Migration 0180).
 *
 * Vorher: stornieren, danach die Rechnung im Assistenten von vorn anlegen —
 * und die Zahlungen entweder mit dem Storno löschen und neu erfassen oder am
 * stornierten Original stehen lassen. Jetzt legt der Storno auf Wunsch gleich
 * den Entwurf an; die Zahlungen gehen beim Buchen mit.
 */

function capture(page: Page, method: string, re: RegExp) {
  const hits: Request[] = []
  page.on('request', r => { if (r.method() === method && re.test(r.url())) hits.push(r) })
  return hits
}

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

const RECHNUNG = {
  ID: 100, INVOICE_NUMBER: 'R-2026-0100', INVOICE_DATE: '2026-09-01', DUE_DATE: '2026-09-30',
  TOTAL_AMOUNT_NET: 1000, TAX_AMOUNT_NET: 190, TOTAL_AMOUNT_GROSS: 1190, STATUS_ID: 2,
  PROJECT_ID: 1, CONTRACT_ID: 1, VAT_PERCENT: 19, PROJECT: 'P-2024-001', CONTRACT: 'Vertrag 1',
  CONTACT: 'A. Ansprechpartner', CONTACT_MAIL: 'kontakt@kunde.de', ADDRESS_NAME_1: 'Wohnbau Süd GmbH',
  AMOUNT_PAYED_GROSS: 500, AMOUNT_ADJUSTED_GROSS: 0, OPEN_AMOUNT_GROSS: 690,
  COMMENT: null, INVOICE_TYPE: 'rechnung', CANCELS_INVOICE_ID: null,
  TOTAL_DISCOUNTS: 0, CASH_DISCOUNT: 0, DISCOUNT_1_PERCENT: 0, DISCOUNT_2_PERCENT: 0,
  DISCOUNT_1_REASON: null, DISCOUNT_2_REASON: null, CASH_DISCOUNT_PERCENT: 0, CASH_DISCOUNT_DAYS: 0,
}

async function oeffneStorno(page: Page, permissions?: string[]) {
  await mockPilot(page, permissions ? { permissions } : {})
  await page.route(/\/api\/v1\/invoices(\?|$)/, r => r.fulfill(json({ data: [RECHNUNG] })))
  await page.route(/\/api\/v1\/partial-payments(\?|$)/, r => r.fulfill(json({ data: [] })))
  await page.route(/\/api\/v1\/payments(\?|$)/, r => r.fulfill(json({ data: [
    { ID: 1, INVOICE_ID: 100, AMOUNT_PAYED_GROSS: 500, PAYMENT_DATE: '2026-09-10' },
  ] })))
  await page.route(/\/api\/v1\/invoices\/100\/reissue(\?|$)/, r => r.fulfill(json({
    storno_id: 101, draft_id: 102, kind: 'INVOICE', invoice_type: 'rechnung', payments_pending: 1,
  })))
  await page.goto('/rechnungen')
  await page.getByRole('row', { name: /R-2026-0100/ }).getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Storno' }).or(page.getByRole('button', { name: 'Storno' })).first().click()
  const dialog = page.getByRole('dialog', { name: /Storno – R-2026-0100/ })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Stornieren und neu ausstellen', () => {
  test.skip(({ isMobile }) => !!isMobile, 'Aktionsmenü der Tabellenzeile — am Handy eigene Karte')

  test('ein Klick: Storno, Entwurf öffnet sich, Zahlungen gehen beim Buchen mit', async ({ page }) => {
    const reissues = capture(page, 'POST', /\/api\/v1\/invoices\/100\/reissue/)
    const cancels  = capture(page, 'POST', /\/api\/v1\/invoices\/100\/cancel/)
    const dialog = await oeffneStorno(page)

    await expect(dialog).toContainText('1 Zahlung(en) über 500,00')
    await expect(dialog).toContainText('Die Zahlungen gehen beim Buchen auf die neue Rechnung über.')
    await dialog.getByRole('button', { name: 'Stornieren und neu ausstellen' }).click()

    await expect(page.locator('.toast-message')
      .filter({ hasText: /R-2026-0100 storniert\. Neuer Entwurf angelegt – 1 Zahlung\(en\) gehen beim Buchen über\./ })).toBeVisible()
    await expect(page).toHaveURL(/draftId=102/)
    expect(reissues).toHaveLength(1)
    expect(cancels).toHaveLength(0)
  })

  test('ohne Recht, Einzelrechnungen anzulegen: nur die bisherigen Storno-Wege', async ({ page }) => {
    const dialog = await oeffneStorno(page, ['invoices.view', 'invoices.cancel', 'payments.view'])
    await expect(dialog.getByRole('button', { name: 'Nur stornieren' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Stornieren und neu ausstellen' })).toHaveCount(0)
  })
})
