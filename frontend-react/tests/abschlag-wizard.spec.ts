import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Abschlagsrechnung (UI-Pilot 2026-09): Einstieg ueber „+ Neue Rechnung",
 * sprechende Schritte, feste Aktionsleiste, Buchen nur mit Recht und nach
 * Rueckfrage — und die beiden Datenverlust-Fehler von vorher: Neuladen
 * loeschte den Entwurf, Fortsetzen ueberschrieb die E-Rechnungsfelder.
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

async function startNew(page: Page) {
  await page.goto('/rechnungen?tab=abschlag')
  await page.locator('#pp-project').fill('P-2024')
  await page.locator('.autocomplete-item').first().click()
  await expect(page.locator('#pp-contract-ro')).toHaveValue(/V-2024-001/)
}

const bar = (page: Page) => page.getByRole('region', { name: 'Seitenaktionen' })

test.describe('Abschlagsrechnung', () => {
  test('„Neue Rechnung" zeigt nur erlaubte Arten, eine einzige öffnet direkt', async ({ page }) => {
    await setup(page, { permissions: ['invoices.view', 'invoices.create_partial', 'invoices.create_single'] })
    await page.goto('/rechnungen')
    await page.getByRole('button', { name: /Neue Rechnung/ }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText([/Abschlagsrechnung/, /Einzelrechnung/])
    // Vorher standen die Assistenten als Tabs neben der Liste.
    await expect(page.getByRole('tab', { name: /Abschlagsrechnungen|Einzelrechnung/ })).toHaveCount(0)

    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await setup(page, { permissions: ['invoices.view', 'invoices.create_partial'] })
    await page.goto('/rechnungen')
    await page.getByRole('button', { name: 'Abschlagsrechnung' }).click()
    await expect(page).toHaveURL(/tab=abschlag/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Neue Abschlagsrechnung')
  })

  test('Schritte, Aktionsleiste und Entwurf in der URL', async ({ page }, info) => {
    await setup(page)
    await startNew(page)
    await expect(page.locator('.wizard-step, .wizard-steps-mobile-label').filter({ visible: true }).first())
      .toContainText(/Projekt & Vertrag/)
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(page).toHaveURL(/draftId=501/)
    await expect(page.getByLabel('Rechnungsdatum')).toBeVisible()

    if (info.project.name === 'desktop') {
      // Links was abbricht, rechts was weiterfuehrt — die Hauptaktion zuletzt.
      await expect(bar(page).getByRole('button')).toHaveText(['Abbrechen', /Zurück/, 'Entwurf speichern', /Weiter/])
      await expect(page.locator('.wizard-step')).toHaveText(['Projekt & Vertrag', 'Rechnungsdaten', 'Beträge', 'Prüfen & buchen'])
    } else {
      await expect(page.locator('.wizard-steps-mobile-label')).toHaveText('Schritt 2 von 4 · Rechnungsdaten')
      await expect(bar(page).getByRole('button')).toHaveText(['', /Zurück/, /Weiter/])
    }
  })

  test('Neuladen löscht den Entwurf nicht und setzt ihn fort', async ({ page }) => {
    await setup(page)
    const deletes = capture(page, 'DELETE', /partial-payments\/\d+/)
    await startNew(page)
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(page).toHaveURL(/draftId=501/)
    page.on('dialog', d => void d.accept())
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Abschlagsrechnung (Entwurf) bearbeiten')
    await expect(page.getByLabel('Käuferreferenz / Leitweg-ID')).toHaveValue('04011000-12345-34')
    expect(deletes).toHaveLength(0)
  })

  test('Fortsetzen behält Rechnungsdaten und E-Rechnungsfelder', async ({ page }) => {
    await setup(page)
    const patches = capture(page, 'PATCH', /partial-payments\/501(\?|$)/)
    await page.goto('/rechnungen?tab=abschlag&draftId=501')
    await expect(page.getByLabel('Rechnungsdatum')).toHaveValue('2026-09-20')
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(page.locator('#pppf')).toBeVisible()
    expect(patches).toHaveLength(1)
    // Vorher: heutiges Datum und leere Leitweg-ID/Bestellnummer im PATCH.
    expect(patches[0].postDataJSON()).toMatchObject({
      advance_invoice_date: '2026-09-20', due_date: '2026-10-20',
      billing_period_start: '2026-08-01', comment: '7. Abschlagsrechnung gemäß Zahlungsplan',
      buyer_reference: '04011000-12345-34', buyer_order_reference: 'BE-2024-0815',
      payment_means_id: 2,
    })
  })

  test('Aktionsleiste bleibt bei 40 Buchungen sichtbar', async ({ page }) => {
    await setup(page)
    await page.goto('/rechnungen?tab=abschlag&draftId=501')
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await page.locator('table').first().waitFor()
    const box = await bar(page).boundingBox()
    const vh = page.viewportSize()!.height
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1)
    expect(box!.y).toBeGreaterThan(vh / 2)
  })

  test('Buchen nur nach Rückfrage, genau einmal, danach zur Liste', async ({ page }) => {
    await setup(page)
    const books = capture(page, 'POST', /partial-payments\/501\/book/)
    await page.goto('/rechnungen?tab=abschlag&draftId=501')
    // Fortgesetzt beginnt in Schritt 2 — zweimal Weiter bis „Prüfen & buchen".
    for (let i = 0; i < 2; i++) {
      await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
      await page.waitForTimeout(150)
    }
    await bar(page).getByRole('button', { name: 'Jetzt buchen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Abschlagsrechnung buchen?' })
    await expect(dialog).toContainText('unveränderlich')
    expect(books).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Jetzt buchen' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rechnungen')
    await expect(page.getByRole('status').filter({ hasText: 'Abschlagsrechnung gebucht' })).toHaveCount(1)
    expect(books).toHaveLength(1)
  })

  test('ohne invoices.book kein „Jetzt buchen", ohne PDF-Recht keine Vorschau', async ({ page }) => {
    await setup(page, { permissions: ['invoices.view', 'invoices.create_partial'] })
    await page.goto('/rechnungen?tab=abschlag&draftId=501')
    // Fortgesetzt beginnt in Schritt 2 — zweimal Weiter bis „Prüfen & buchen".
    for (let i = 0; i < 2; i++) {
      await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
      await page.waitForTimeout(150)
    }
    await expect(page.getByText('Nachlässe, Skonto und Sicherheitseinbehalt')).toBeVisible()
    await expect(page.getByRole('button', { name: /Jetzt buchen/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /PDF-Vorschau/ })).toHaveCount(0)
    await expect(bar(page).getByRole('button', { name: 'Entwurf speichern' })).toBeVisible()
  })

  test('Abbrechen bei neuem Entwurf fragt, ob er bleiben soll', async ({ page }, info) => {
    await setup(page)
    const deletes = capture(page, 'DELETE', /partial-payments\/\d+/)
    await startNew(page)
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(page).toHaveURL(/draftId=501/)
    if (info.project.name === 'mobile') {
      await bar(page).getByRole('button', { name: 'Weitere Aktionen' }).click()
      const menu = page.getByRole('menu')
      // Das Menue klappt ueber der Leiste auf, nicht hinter die Bottom-Nav.
      const box = await menu.boundingBox()
      expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      await menu.getByRole('menuitem', { name: 'Abbrechen' }).click()
    } else {
      await bar(page).getByRole('button', { name: 'Abbrechen' }).click()
    }
    const dialog = page.getByRole('dialog', { name: 'Assistent verlassen?' })
    await expect(dialog.locator('.modal-actions button')).toHaveText(['Entwurf löschen', 'Weiter bearbeiten', 'Entwurf behalten'])
    await dialog.getByRole('button', { name: 'Entwurf behalten' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rechnungen')
    expect(deletes).toHaveLength(0)
  })

  test('Handy: kein Querscrollen, Menü „Neue Rechnung" bleibt im Bild', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile')
    await setup(page)
    await page.goto('/rechnungen')
    await page.getByRole('button', { name: /Neue Rechnung/ }).click()
    const box = await page.getByRole('menu').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await page.keyboard.press('Escape')
    await startNew(page)
    // Gegen die Geraetebreite messen: waechst die Seite, waechst am Handy
    // auch window.innerWidth mit, und der Vergleich damit sieht nichts.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)
  })
})
