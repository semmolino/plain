import { test, expect, type Page } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Uebersicht (UI-Pilot 2026-09): das Wichtigste oben (Jetzt wichtig, Zeit
 * buchen, Schnellzugriff), anklickbare Kennzahlen, eindeutige Kacheln,
 * Schnellzugriff-Links mit Ziel, Ansicht per Auswahlfeld.
 */

async function setup(page: Page, opts: Parameters<typeof mockPilot>[1] = {}, welcomeDismissed = true) {
  await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
  if (welcomeDismissed) await page.addInitScript(() => localStorage.setItem('plansimple.welcome_dismissed_1', '1'))
  await mockPilot(page, opts)
  await page.goto('/')
  await page.getByRole('heading', { level: 1, name: 'Übersicht' }).waitFor()
}

const vh = (page: Page) => page.viewportSize()!.height

test.describe('Übersicht', () => {
  test('„Jetzt wichtig" und „Zeit buchen" liegen über dem Falz', async ({ page }, info) => {
    await setup(page)
    const attn = page.getByRole('region', { name: /Jetzt wichtig/ })
    const time = page.getByRole('region', { name: 'Zeit buchen' })
    // Vier Hinweise, darunter die Monatsrunde Leistungsstände (Runde 2)
    await expect(attn.getByRole('link')).toHaveCount(4)
    for (const r of [attn, time]) {
      const box = await r.boundingBox()
      expect(box!.y).toBeLessThan(vh(page))
    }
    if (info.project.name === 'desktop') {
      // Erste Kennzahl ohne Scrollen sichtbar (vorher: unter Einfuehrung und acht Karten).
      const kpi = await page.locator('.dash-kpis .kpi-card').first().boundingBox()
      expect(kpi!.y + 40).toBeLessThan(vh(page))
    } else {
      const cta = await time.getByRole('button', { name: 'Zeit buchen' }).boundingBox()
      expect(cta!.y + cta!.height).toBeLessThan(vh(page) - 58)
      expect(cta!.height).toBeGreaterThanOrEqual(44)
      // Gegen die Geraetebreite messen: waechst die Seite, waechst am Handy
    // auch window.innerWidth mit, und der Vergleich damit sieht nichts.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
      expect(overflow).toBeLessThanOrEqual(2)
    }
  })

  test('„Zeit buchen" in der Karte öffnet den Dialog, „Nochmal buchen" belegt vor', async ({ page }) => {
    await setup(page)
    const time = page.getByRole('region', { name: 'Zeit buchen' })
    await time.getByRole('button', { name: /LP5\.1/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Zeit buchen' })
    await expect(dialog.getByLabel('Leistung*')).toHaveValue('107')
  })

  test('Controller: keine doppelten Kacheln, Mahnaktionen führen zu den Mahnungen', async ({ page }) => {
    await setup(page, { role: 'controller' })
    // Die Kennzahlen kommen nach der Ueberschrift — erst warten, dann lesen
    // (allInnerTexts wartet nicht und las unter Last eine leere Liste).
    const kpiLabels = page.locator('.dash-kpis .kpi-label')
    await expect(kpiLabels.nth(3)).toBeVisible()
    const labels = await kpiLabels.allInnerTexts()
    expect(labels.length).toBeGreaterThan(3)
    expect(new Set(labels.map(l => l.trim().toLowerCase())).size).toBe(labels.length)
    await page.getByRole('region', { name: /Jetzt wichtig/ }).getByRole('link', { name: /Mahnaktionen fällig/ }).click()
    await expect(page).toHaveURL(/\/rechnungen\?tab=mahnungen/)
    await expect(page.getByRole('tab', { name: 'Mahnungen' })).toHaveAttribute('aria-selected', 'true')
  })

  test('Kennzahl „Aktive Projekte" führt zur Projektliste', async ({ page }) => {
    await setup(page)
    await page.getByRole('link', { name: /Aktive Projekte/ }).click()
    await expect(page).toHaveURL(/\/projekte$/)
  })

  test('Schnellzugriff: jeder Eintrag hat ein Ziel', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Ziele sind geraeteunabhaengig')
    await setup(page)
    const quick = () => page.getByRole('region', { name: 'Schnellzugriff' })
    const cases: [RegExp, RegExp, (p: Page) => Promise<void>][] = [
      [/P-2024-001/,   /\/projekte\?projectId=1&tab=struktur/, async p => { await expect(p.getByRole('heading', { level: 1 })).toContainText('Neubau Kindertagesstätte') }],
      [/RE-2026-0052/, /\/rechnungen$/,                         async p => { await expect(p.getByPlaceholder(/Suchen/).first()).toHaveValue('RE-2026-0052') }],
      [/A-2025-016/,   /\/angebote$/,                           async () => {}],
      [/Wohnbau Süd/,  /\/adressen/,                            async () => {}],
      [/1\. Mahnung/,  /\/rechnungen/,                          async p => { await expect(p.getByRole('tab', { name: 'Mahnungen' })).toHaveAttribute('aria-selected', 'true') }],
    ]
    for (const [label, url, check] of cases) {
      await page.goto('/')
      await quick().getByRole('button', { name: label }).first().click()
      await expect(page).toHaveURL(url)
      await check(page)
    }
    // Vorher: ?selected= / ?pp= / ?mahnung= — Parameter, die keine Seite las.
  })

  test('Ansicht per Auswahlfeld, Einführung über ⋯', async ({ page }) => {
    await setup(page)
    await expect(page.getByText('Einrichtungs-Checkliste findest du')).toHaveCount(0)
    await page.getByLabel('Ansicht').selectOption('controller')
    await expect(page.locator('.dash-kpis').getByText('Mahnaktionen fällig')).toBeVisible()
    await page.getByRole('button', { name: 'Weitere Aktionen' }).click()
    await page.getByRole('menuitem', { name: 'Einführung anzeigen' }).click()
    await expect(page.getByRole('heading', { name: 'Willkommen!' })).toBeVisible()
    // Du statt Sie, und kein zweiter gefuellter Knopf neben „Zeit buchen".
    await expect(page.getByRole('button', { name: 'Verstanden' })).toHaveClass(/btn-secondary/)
    await expect(page.locator('.dash-page')).not.toContainText(/\bSie\b|\bIhre\b/)
  })

  test('ohne Buchungsrecht keine Zeit-Karte, das Band schließt die Lücke', async ({ page }) => {
    await setup(page, { permissions: ['dashboard.view', 'dashboard.view_switch', 'invoices.view'] })
    await expect(page.getByRole('region', { name: 'Zeit buchen' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: /Jetzt wichtig/ })).toBeVisible()
  })
})
