import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Einzelrechnung, Gutschrift und Schlussrechnung im Muster des
 * Abschlag-Assistenten (UI-Pilot Runde 2): sprechende Schritte, feste
 * Aktionsleiste, Buchen nur mit Recht und nach Rueckfrage, Fortsetzen
 * behaelt alle Felder — bei der Schlussrechnung auch die SE-Auswahl —,
 * PDF/XML speichern vorher die Nachlaesse, Zusammenfassung daneben.
 */

async function setup(page: Page, opts: Parameters<typeof mockPilot>[1] = {}) {
  await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
  await mockPilot(page, opts)
}

function capture(page: Page, method: string, re: RegExp) {
  const hits: Request[] = []
  page.on('request', r => { if (r.method() === method && re.test(r.url())) hits.push(r) })
  return hits
}

const bar = (page: Page) => page.getByRole('region', { name: 'Seitenaktionen' })
const weiter = (page: Page) => bar(page).getByRole('button', { name: 'Weiter', exact: true })

async function next(page: Page, times: number) {
  for (let i = 0; i < times; i++) {
    await weiter(page).click()
    await page.waitForTimeout(150)
  }
}

test.describe('Einzelrechnung und Gutschrift', () => {
  test('Einzelrechnung läuft im Assistenten-Muster: Schritte, Leiste, kein Sicherheitseinbehalt', async ({ page }, info) => {
    await setup(page)
    await page.goto('/rechnungen?tab=rechnung&draftId=601')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Einzelrechnung (Entwurf) bearbeiten')
    if (info.project.name === 'desktop') {
      await expect(page.locator('.wizard-step')).toHaveText(['Projekt & Vertrag', 'Rechnungsdaten', 'Beträge', 'Prüfen & buchen'])
      await expect(bar(page).getByRole('button')).toHaveText(['Abbrechen', /Zurück/, 'Entwurf speichern', /Weiter/])
    } else {
      await expect(page.locator('.wizard-steps-mobile-label')).toHaveText('Schritt 2 von 4 · Rechnungsdaten')
    }
    await next(page, 2)
    await expect(page.getByText('Nachlässe und Skonto', { exact: true })).toBeVisible()
    // Die Einzelrechnung hat keinen SE-Lebenszyklus — die Option fehlt.
    await expect(page.getByLabel('Sicherheitseinbehalt einbehalten')).toHaveCount(0)
  })

  test('Buchen nur nach Rückfrage, genau einmal, danach zur Liste', async ({ page }) => {
    await setup(page)
    const books = capture(page, 'POST', /\/invoices\/601\/book/)
    await page.goto('/rechnungen?tab=rechnung&draftId=601')
    await next(page, 2)
    await bar(page).getByRole('button', { name: 'Jetzt buchen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Rechnung buchen?' })
    await expect(dialog).toContainText('unveränderlich')
    expect(books).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Jetzt buchen' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rechnungen')
    expect(books).toHaveLength(1)
  })

  test('ohne invoices.book kein „Jetzt buchen", ohne Download-Rechte kein PDF/XML', async ({ page }) => {
    await setup(page, { permissions: ['invoices.view', 'invoices.create_single'] })
    const books = capture(page, 'POST', /\/invoices\/\d+\/book/)
    await page.goto('/rechnungen?tab=rechnung&draftId=601')
    await next(page, 2)
    await expect(page.getByText('Nachlässe und Skonto', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Jetzt buchen/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /PDF-Vorschau/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /E-Rechnung/ })).toHaveCount(0)
    await bar(page).getByRole('button', { name: 'Entwurf speichern' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Entwurf gespeichert' })).toHaveCount(1)
    expect(books).toHaveLength(0)
  })

  test('E-Rechnung speichert vorher die Nachlässe', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Menü-Knopf Desktop genügt')
    await setup(page)
    const order: string[] = []
    page.on('request', r => {
      if (r.method() === 'PATCH' && /\/invoices\/601(\?|$)/.test(r.url())) order.push(`patch:${JSON.stringify(r.postDataJSON())}`)
      if (r.method() === 'GET' && /\/invoices\/601\/einvoice/.test(r.url())) order.push('xml')
    })
    await page.route(/\/api\/v1\/invoices\/601\/einvoice/, r => r.fulfill({ status: 200, contentType: 'application/xml', body: '<Invoice/>' }))
    await page.goto('/rechnungen?tab=rechnung&draftId=601')
    await next(page, 2)
    await page.getByLabel('Skonto angeben').check()
    await page.locator('#pp-cd').fill('3')
    order.length = 0
    // Ans Ende scrollen wie ein Nutzer — sonst liegt der Knopf halb unter der
    // festen Aktionsleiste, und das Menue schliesst beim Nachscrollen.
    await page.locator('.app-main').evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.getByRole('button', { name: 'E-Rechnung', exact: true }).click()
    await page.getByRole('menuitem', { name: 'XRechnung (UBL)' }).click()
    await expect.poll(() => order.length).toBeGreaterThanOrEqual(2)
    // Vorher ging das XML ohne vorheriges Speichern raus — ohne das Skonto.
    expect(order[0]).toContain('"cash_discount_percent":3')
    expect(order[1]).toBe('xml')
  })

  test('Gutschrift nutzt denselben Assistenten und legt den Entwurf als Gutschrift an', async ({ page }) => {
    await setup(page)
    const inits = capture(page, 'POST', /\/invoices\/init/)
    await page.goto('/rechnungen?tab=gutschrift')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Neue Gutschrift')
    await page.locator('#pp-project').fill('P-2024')
    await page.locator('.autocomplete-item').first().click()
    await expect(page.locator('#pp-contract-ro')).toHaveValue(/V-2024-001/)
    await weiter(page).click()
    await expect(page).toHaveURL(/draftId=601/)
    expect(inits).toHaveLength(1)
    expect(inits[0].postDataJSON()).toMatchObject({ invoice_type: 'gutschrift', project_id: 1, contract_id: 11 })
  })
})

test.describe('Schlussrechnung', () => {
  test('Fortsetzen behält Rechnungsdaten und E-Rechnungsfelder', async ({ page }) => {
    await setup(page)
    const patches = capture(page, 'PATCH', /\/invoices\/701(\?|$)/)
    await page.goto('/rechnungen?tab=schluss&draftId=701')
    await expect(page.getByLabel('Rechnungsdatum')).toHaveValue('2026-09-22')
    await weiter(page).click()
    await expect(page.getByRole('checkbox', { name: /LP1 Grundlagenermittlung abrechnen/ })).toBeVisible()
    expect(patches).toHaveLength(1)
    expect(patches[0].postDataJSON()).toMatchObject({
      invoice_date: '2026-09-22', due_date: '2026-10-22', comment: 'Teilschlussrechnung LP1–LP4',
      buyer_reference: '04011000-12345-34', buyer_order_reference: 'BE-2024-0815', payment_means_id: 2,
    })
    // Die Auswahl der Positionen kommt vom Server (LP4 war nicht gewaehlt).
    await expect(page.getByRole('checkbox', { name: /LP3 Entwurfsplanung abrechnen/ })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: /LP4 Genehmigungsplanung abrechnen/ })).not.toBeChecked()
  })

  test('SE-Auswahl bleibt beim Fortsetzen erhalten und geht mit dem Buchen raus', async ({ page }) => {
    await setup(page)
    const books = capture(page, 'POST', /\/final-invoices\/701\/book/)
    const patches = capture(page, 'PATCH', /\/invoices\/701(\?|$)/)
    await page.goto('/rechnungen?tab=schluss&draftId=701')
    await next(page, 3)
    // Gespeichert war nur AR-2025-0058 — vorher waren beim Fortsetzen wieder alle gewaehlt.
    const se = page.getByRole('group', { name: /Sicherheitseinbehalte auflösen/ })
    await expect(se.getByRole('checkbox', { name: /AR-2025-0031/ })).not.toBeChecked()
    await expect(se.getByRole('checkbox', { name: /AR-2025-0058/ })).toBeChecked()
    await expect(se).toContainText('+ 4.849,25')

    await bar(page).getByRole('button', { name: 'Jetzt buchen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Schlussrechnung buchen?' })
    await expect(dialog).toContainText('als abgeschlossen')
    expect(books).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Jetzt buchen' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rechnungen')
    expect(books).toHaveLength(1)
    expect(books[0].postDataJSON()).toEqual({ release_partial_payment_ids: [512] })
    // Skonto aus dem Entwurf (2 %) und die SE-Auswahl gehen vorher in den Entwurf.
    expect(patches.at(-1)!.postDataJSON()).toMatchObject({ cash_discount_percent: 2, se_release_advance_ids: [512] })
    expect(patches.at(-1)!.postDataJSON()).not.toHaveProperty('se_percent')
  })

  test('ohne invoices.book nur Entwurf speichern — die SE-Auswahl wird mitgespeichert', async ({ page }) => {
    await setup(page, { permissions: ['invoices.view', 'invoices.create_final'] })
    const patches = capture(page, 'PATCH', /\/invoices\/701(\?|$)/)
    await page.goto('/rechnungen?tab=schluss&draftId=701')
    await next(page, 3)
    await expect(page.getByRole('button', { name: /Jetzt buchen/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /PDF-Vorschau/ })).toHaveCount(0)
    await page.getByRole('checkbox', { name: /AR-2025-0031/ }).check()
    await bar(page).getByRole('button', { name: 'Entwurf speichern' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Entwurf gespeichert' })).toHaveCount(1)
    expect(patches.at(-1)!.postDataJSON()).toMatchObject({ se_release_advance_ids: expect.arrayContaining([511, 512]) })
  })

  test('Zusammenfassung zeigt den Betrag — als Spalte am Desktop, als Zeile am Handy', async ({ page }, info) => {
    await setup(page)
    await page.goto('/rechnungen?tab=schluss&draftId=701')
    await next(page, 3)
    const vw = page.viewportSize()!.width
    if (vw >= 1200) {
      const col = page.getByRole('complementary', { name: 'Zusammenfassung' })
      await expect(col).toBeVisible()
      await expect(col).toContainText('Zahlungsbetrag')
      await expect(col).toContainText('P-2024-001')
    } else {
      const line = page.locator('.iw-sum-toggle')
      await expect(line).toBeVisible()
      await expect(line).toContainText(/Brutto .*€/)
      await expect(line).toHaveAttribute('aria-expanded', 'false')
      await line.click()
      await expect(page.locator('#iw-sum-details')).toContainText('Zahlungsbetrag')
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(overflow - vw, `Querscrollen bei ${info.project.name}`).toBeLessThanOrEqual(2)
  })
})

test.describe('Rückfrage bei offenen Eingaben im Assistenten', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Seitennavigation am Desktop')

  test('Seitennavigation fragt nach — „Speichern und wechseln" speichert den Schritt', async ({ page }) => {
    await setup(page)
    const patches = capture(page, 'PATCH', /\/invoices\/601(\?|$)/)
    await page.goto('/rechnungen?tab=rechnung&draftId=601')
    await page.getByLabel('Kommentar (erscheint auf der Rechnung)').fill('Nebenleistung Brandschutz, 2. Teil')
    await page.getByRole('navigation').getByRole('link', { name: 'Projekte' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dialog).toContainText('Rechnung (Entwurf)')
    await dialog.getByRole('button', { name: 'Speichern und wechseln' }).click()
    await expect(page).toHaveURL(/\/projekte/)
    expect(patches).toHaveLength(1)
    expect(patches[0].postDataJSON()).toMatchObject({ comment: 'Nebenleistung Brandschutz, 2. Teil' })
  })

  test('„Rechnungen" im Kopf fragt nach, ohne Eingabe nicht', async ({ page }) => {
    await setup(page)
    await page.goto('/rechnungen?tab=schluss&draftId=701')
    await page.getByLabel('Rechnungsdatum').waitFor()
    // Ohne Eingabe: direkt zur Liste
    await page.getByRole('button', { name: 'Rechnungen', exact: true }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rechnungen')

    await page.goto('/rechnungen?tab=schluss&draftId=701')
    await page.getByLabel('Rechnungsdatum').fill('2026-09-23')
    await page.getByRole('button', { name: 'Rechnungen', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dialog).toContainText('Schlussrechnung (Entwurf)')
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByLabel('Rechnungsdatum')).toHaveValue('2026-09-23')
  })
})

