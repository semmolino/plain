import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Zahlung erfassen und Rest ausbuchen (Forderungsminderung, Migration 0177).
 *
 * Vorher: zahlte der Kunde weniger und das Büro akzeptierte das, ging das nur
 * über Storno plus neue Rechnung — sonst blieb der Rest für immer offen und
 * wurde gemahnt.
 */

function capture(page: Page, method: string, re: RegExp) {
  const hits: Request[] = []
  page.on('request', r => { if (r.method() === method && re.test(r.url())) hits.push(r) })
  return hits
}

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

function beleg(extra: Record<string, unknown> = {}) {
  return {
    ID: 100, INVOICE_NUMBER: 'R-2026-0100', INVOICE_DATE: '2026-09-01', DUE_DATE: '2026-09-30',
    TOTAL_AMOUNT_NET: 1000, TAX_AMOUNT_NET: 190, TOTAL_AMOUNT_GROSS: 1190, STATUS_ID: 2,
    PROJECT_ID: 1, CONTRACT_ID: 1, VAT_PERCENT: 19, PROJECT: 'P-2024-001', CONTRACT: 'Vertrag 1',
    CONTACT: 'A. Ansprechpartner', CONTACT_MAIL: 'kontakt@kunde.de', ADDRESS_NAME_1: 'Wohnbau Süd GmbH',
    AMOUNT_PAYED_GROSS: 0, AMOUNT_ADJUSTED_GROSS: 0, OPEN_AMOUNT_GROSS: 1190,
    COMMENT: null, INVOICE_TYPE: 'rechnung', CANCELS_INVOICE_ID: null,
    TOTAL_DISCOUNTS: 0, CASH_DISCOUNT: 0, DISCOUNT_1_PERCENT: 0, DISCOUNT_2_PERCENT: 0,
    DISCOUNT_1_REASON: null, DISCOUNT_2_REASON: null,
    CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14,
    ...extra,
  }
}

async function oeffneZahlung(page: Page, extra: Record<string, unknown> = {}) {
  await mockPilot(page)
  await page.route(/\/api\/v1\/invoices(\?|$)/, r => r.fulfill(json({ data: [beleg(extra)] })))
  await page.route(/\/api\/v1\/partial-payments(\?|$)/, r => r.fulfill(json({ data: [] })))
  await page.route(/\/api\/v1\/payments(\?|$)/, r =>
    r.request().method() === 'POST' ? r.fulfill(json({ success: true, id: 1 })) : r.fulfill(json({ data: [] })))
  await page.route(/\/api\/v1\/payments\/adjustments(\?|$)/, r =>
    r.request().method() === 'POST' ? r.fulfill(json({ data: { ID: 9 } })) : r.fulfill(json({ data: [] })))
  await page.goto('/rechnungen')
  await page.getByRole('row', { name: /R-2026-0100/ }).getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Zahlung erfassen' }).or(page.getByRole('button', { name: 'Zahlung erfassen' })).first().click()
  const dialog = page.getByRole('dialog', { name: /Zahlung erfassen – R-2026-0100/ })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Zahlung erfassen — Rest ausbuchen', () => {
  test.skip(({ isMobile }) => !!isMobile, 'Aktionsmenü der Tabellenzeile — am Handy eigene Karte')

  test('Teilzahlung plus wieder abrechenbare Kürzung in einem Schritt', async ({ page }) => {
    const pays = capture(page, 'POST', /\/api\/v1\/payments(\?|$)/)
    const adjs = capture(page, 'POST', /\/api\/v1\/payments\/adjustments(\?|$)/)
    const dialog = await oeffneZahlung(page)

    await dialog.getByLabel('Betrag brutto (€)').fill('1000')
    await expect(dialog.getByText(/Nach dieser Zahlung bleiben 190,00/)).toBeVisible()
    await dialog.getByRole('checkbox', { name: /Rest von 190,00.*ausbuchen/ }).check()
    await expect(dialog.getByLabel('Grund*')).toHaveValue('kuerzung')
    await dialog.getByRole('checkbox', { name: /Wieder abrechenbar/ }).check()
    await dialog.getByLabel('Begründung').fill('Leistungsstand LPH 5 bestritten')
    await dialog.getByRole('button', { name: 'Speichern' }).click()

    await expect(dialog.getByText('der Beleg ist erledigt', { exact: false })).toBeVisible()
    expect(pays[0].postDataJSON()).toMatchObject({ invoice_id: 100, amount_payed_gross: 1000 })
    expect(adjs[0].postDataJSON()).toMatchObject({
      invoice_id: 100, amount_gross: 190, reason: 'kuerzung', rebillable: true,
      comment: 'Leistungsstand LPH 5 bestritten',
    })
  })

  test('Skontozahlung bucht die Differenz mit Grund Skonto aus', async ({ page }) => {
    const adjs = capture(page, 'POST', /\/api\/v1\/payments\/adjustments(\?|$)/)
    const dialog = await oeffneZahlung(page)
    await dialog.getByRole('button', { name: /abzgl\. 2 % Skonto/ }).click()
    await expect(dialog.getByLabel('Betrag brutto (€)')).toHaveValue('1166.2')
    await expect(dialog.getByLabel('Grund*')).toHaveValue('skonto')
    // Skonto mindert endgültig — „wieder abrechenbar" gibt es nur bei Kürzung.
    await expect(dialog.getByRole('checkbox', { name: /Wieder abrechenbar/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => adjs.length).toBe(1)
    expect(adjs[0].postDataJSON()).toMatchObject({ amount_gross: 23.8, reason: 'skonto', rebillable: false })
  })

  test('nur ausbuchen, ohne Zahlung', async ({ page }) => {
    const pays = capture(page, 'POST', /\/api\/v1\/payments(\?|$)/)
    const adjs = capture(page, 'POST', /\/api\/v1\/payments\/adjustments(\?|$)/)
    const dialog = await oeffneZahlung(page)
    await dialog.getByRole('checkbox', { name: /Offenen Betrag von 1\.190,00.*ausbuchen/ }).check()
    await dialog.getByLabel('Grund*').selectOption('ausfall')
    await dialog.getByRole('button', { name: 'Ausbuchen' }).click()
    await expect.poll(() => adjs.length).toBe(1)
    expect(pays).toHaveLength(0)
    expect(adjs[0].postDataJSON()).toMatchObject({ amount_gross: 1190, reason: 'ausfall', rebillable: false })
  })

  test('Überzahlung nur mit Bestätigung', async ({ page }) => {
    const pays = capture(page, 'POST', /\/api\/v1\/payments(\?|$)/)
    const dialog = await oeffneZahlung(page)
    await dialog.getByLabel('Betrag brutto (€)').fill('1500')
    // Mehr als offen: kein „Rest ausbuchen", stattdessen die Rückfrage
    await expect(dialog.getByRole('checkbox', { name: /ausbuchen/ })).toHaveCount(0)
    const bestaetigen = dialog.getByRole('checkbox', { name: /310,00.*als Überzahlung trotzdem erfassen/ })
    await expect(bestaetigen).toBeVisible()
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(dialog).toContainText('Bitte bestätigen, dass die Überzahlung so erfasst werden soll.')
    expect(pays).toHaveLength(0)

    await bestaetigen.check()
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => pays.length).toBe(1)
    expect(pays[0].postDataJSON()).toMatchObject({ amount_payed_gross: 1500, allow_overpayment: true })
  })

  test('nach einer Schlussrechnung kein „wieder abrechenbar"', async ({ page }) => {
    const dialog = await oeffneZahlung(page, { INVOICE_TYPE: 'schlussrechnung' })
    await dialog.getByRole('checkbox', { name: /Offenen Betrag.*ausbuchen/ }).check()
    await expect(dialog.getByLabel('Grund*')).toHaveValue('kuerzung')
    await expect(dialog.getByRole('checkbox', { name: /Wieder abrechenbar/ })).toHaveCount(0)
  })
})
