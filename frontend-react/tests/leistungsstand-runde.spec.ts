import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Leistungsstände (UI-Pilot Runde 2): Monatsrunde auf der Projektliste und
 * der Reiter im Projekt — beide mit Stichtag, nur Geändertes wird gespeichert.
 */

function capture(page: Page, re: RegExp, method = 'POST') {
  const hits: Request[] = []
  page.on('request', r => { if (r.method() === method && re.test(r.url())) hits.push(r) })
  return hits
}

async function setup(page: Page, opts: Parameters<typeof mockPilot>[1] = {}) {
  await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
  await mockPilot(page, opts)
}

const desktopOnly = (name: string) => test.skip(name !== 'desktop', 'Zwei Spalten gibt es nur am Desktop')

test.describe('Monatsrunde', () => {
  test('Speichern & nächstes: nur Geändertes, mit Stichtag, springt weiter', async ({ page }, info) => {
    desktopOnly(info.project.name)
    await setup(page)
    const posts = capture(page, /\/projekte\/\d+\/leistungsstand(\?|$)/)
    await page.goto('/projekte?tab=leistungsstaende')
    await expect(page.getByRole('tab', { name: 'Leistungsstände' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('2 von 5 erledigt')).toBeVisible()

    // Ohne Wahl: erstes offenes Projekt
    const editor = page.getByRole('region', { name: /P-2024-001/ })
    await expect(editor).toContainText('Stand zum 31.08.2026')

    const lp51 = page.getByLabel(/Neuer Stand LP5\.1 /)
    await lp51.fill('85')
    await lp51.press('Enter')
    await expect(page.getByLabel(/Neuer Stand LP5\.2 /)).toBeFocused()
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await expect(bar).toContainText('1 Element geändert')

    await bar.getByRole('button', { name: 'Speichern & nächstes' }).click()
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0].url()).toMatch(/projekte\/1\/leistungsstand/)
    expect(posts[0].postDataJSON()).toEqual({
      updates: [{ structure_id: 107, revenue_completion_percent: 85 }], as_of_date: '2026-08-31',
    })

    // Weiter zum nächsten offenen Projekt; das gespeicherte ist erledigt
    await expect(page.getByRole('region', { name: /P-2024-004/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /P-2024-001/ })).toContainText('erledigt')
    await expect(page.getByText('3 von 5 erledigt')).toBeVisible()
    const saved = page.getByRole('status').filter({ hasText: 'gespeichert' })
    await expect(saved).toContainText('abrechenbar')
    await expect(saved.getByRole('link', { name: 'Abschlag erstellen' })).toHaveAttribute('href', '/rechnungen?tab=abschlag&projectId=1')
  })

  test('Unverändert bestätigen und Überspringen', async ({ page }, info) => {
    desktopOnly(info.project.name)
    await setup(page)
    const posts = capture(page, /\/projekte\/\d+\/leistungsstand(\?|$)/)
    await page.goto('/projekte?tab=leistungsstaende')
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await bar.getByRole('button', { name: 'Überspringen' }).click()
    await expect(page.getByRole('region', { name: /P-2024-004/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /P-2024-001/ })).toContainText('übersprungen')

    await bar.getByRole('button', { name: 'Unverändert bestätigen' }).click()
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0].postDataJSON()).toMatchObject({ updates: [], confirm_unchanged: true, as_of_date: '2026-08-31' })
    // Übersprungenes kommt erst nach den übrigen offenen dran
    await expect(page.getByRole('region', { name: /P-2025-014/ })).toBeVisible()
  })

  test('Warnungen, Sperre und ungültige Eingabe', async ({ page }, info) => {
    desktopOnly(info.project.name)
    await setup(page)
    await page.goto('/projekte?tab=leistungsstaende')
    const table = page.locator('.lr-table')
    await page.getByLabel(/Neuer Stand LP5\.2 /).fill('60')
    await expect(table).toContainText('Weniger als bisher (70')
    await expect(table).toContainText('Weniger als schon abgerechnet')

    // BL4 hat einen Stand zum 15.09. — zum 31.08. gesperrt
    await expect(page.getByLabel(/Neuer Stand BL4 /)).toHaveCount(0)
    await expect(table).toContainText('Stand 15.09.')

    await page.getByLabel(/Neuer Stand LP6 /).fill('120')
    await expect(page.getByRole('alert').filter({ hasText: 'Nur 0 bis 100 %' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speichern & nächstes' })).toBeDisabled()
  })

  test('Projektwechsel mit offenen Änderungen fragt nach', async ({ page }, info) => {
    desktopOnly(info.project.name)
    await setup(page)
    await page.goto('/projekte?tab=leistungsstaende')
    await page.getByLabel(/Neuer Stand LP6 /).fill('55')
    await page.getByRole('button', { name: /P-2025-014/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByLabel(/Neuer Stand LP6 /)).toHaveValue('55')
  })

  test('„Alle laufenden" zeigt das ganze Büro', async ({ page }) => {
    await setup(page)
    await page.goto('/projekte?tab=leistungsstaende')
    await page.getByRole('button', { name: 'Alle laufenden' }).click()
    await expect(page.getByText('3 von 7 erledigt')).toBeVisible()
    await expect(page.getByRole('button', { name: /P-2024-002/ })).toBeVisible()
  })

  test('alter Erinnerungs-Link landet in der Monatsrunde', async ({ page }) => {
    await setup(page)
    await page.goto('/projekte?tab=leistungsstand&filter=mine')
    await expect(page).toHaveURL(/tab=leistungsstaende/)
    await expect(page.getByText(/von 5 erledigt/)).toBeVisible()
  })

  test('Handy: Liste, dann Eingabe als eigene Ansicht, zurück', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile')
    await setup(page)
    await page.goto('/projekte?tab=leistungsstaende')
    await page.getByRole('button', { name: /P-2024-001/ }).click()
    await expect(page.locator('.lr-table')).toBeVisible()
    await expect(page.locator('.lsr-list')).toHaveCount(0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)
    const input = page.getByLabel(/Neuer Stand LP6 /)
    const box = await input.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await input.fill('55')
    const primary = page.getByRole('button', { name: 'Speichern & nächstes' })
    await primary.click({ trial: true })
    await page.getByRole('button', { name: 'Alle Projekte' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Verwerfen' }).click()
    await expect(page.locator('.lsr-list')).toBeVisible()
  })
})

test.describe('Leistungsstände im Projekt', () => {
  test('Stichtag vorbelegt mit heute, Strg+S speichert nur Geändertes', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tastatur')
    await setup(page)
    const posts = capture(page, /\/projekte\/1\/leistungsstand(\?|$)/)
    await page.goto('/projekte?projectId=1&tab=leistungsstand')
    await expect(page.getByLabel('Stand zum')).toHaveValue('2026-09-24')
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await expect(bar.getByRole('button', { name: 'Speichern' })).toBeDisabled()
    await page.getByLabel(/Neuer Stand LP7 /).fill('35,5')
    await expect(bar).toContainText('1 Element geändert')
    await page.keyboard.press('Control+s')
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0].postDataJSON()).toEqual({
      updates: [{ structure_id: 111, revenue_completion_percent: 35.5 }], as_of_date: '2026-09-24',
    })
    await expect(page.getByText('1 Element gespeichert — Stand zum 24.09.2026.')).toBeVisible()
  })

  test('früherer Stichtag sperrt Elemente, die schon einen späteren Stand haben', async ({ page }) => {
    await setup(page)
    await page.goto('/projekte?projectId=1&tab=leistungsstand')
    await expect(page.getByLabel(/Neuer Stand BL4 /)).toBeVisible()
    await page.getByLabel('Stand zum').fill('2026-08-31')
    await expect(page.getByLabel(/Neuer Stand BL4 /)).toHaveCount(0)
    await expect(page.getByText('1 Element hat schon einen späteren Stand')).toBeVisible()
  })

  test('ohne Bearbeiten-Recht: keine Eingabefelder, keine Aktionsleiste', async ({ page }) => {
    await setup(page, { permissions: ['projects.view', 'projects.performance.view', 'projects.structure.view'] })
    await page.goto('/projekte?projectId=1&tab=leistungsstand')
    await expect(page.locator('.lr-table')).toBeVisible()
    await expect(page.locator('.lr-input')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Seitenaktionen' })).toHaveCount(0)
  })
})

test('Übersicht Projektleitung: Hinweis auf die Monatsrunde', async ({ page }) => {
  await setup(page, { role: 'bereichsleiter' })
  await page.goto('/')
  const link = page.getByRole('link', { name: /Leistungsstände August: 3 von 5 offen/ })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', '/projekte?tab=leistungsstaende')
})
