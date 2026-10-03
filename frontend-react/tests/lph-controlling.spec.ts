import { test, expect, type Page } from '@playwright/test'
import { mockGroups } from './fixtures/gesamtprojektData'

/**
 * LPH-Controlling (Leistungsphasen über mehrere Projekte): Filter nach
 * Leistungsbild und Projektmerkmalen, Kennzahl-Auswahl, Ampel nach den
 * Schwellen des Büros. Gerechnet wird im Browser (`lphMatrixCalc.ts`) —
 * der Server liefert nur Rohsummen.
 */

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

const noHorizontalScroll = (page: Page) => page.evaluate(() =>
  document.documentElement.scrollWidth <= window.innerWidth + 2)

const project = (PROJECT_ID: number, ABBR: string, NAME: string, STATUS: string) =>
  ({ PROJECT_ID, ABBR, NAME, STATUS, TYPE: null, DEPARTMENT: null, MANAGER: 'AB', CLIENT: null, GROUP_NAME: null })
const fact = (PROJECT_ID: number, LB: string, PHASE: string, h: number, e: number, hours: number, c: number) =>
  ({ PROJECT_ID, LB, ZONE: 'III', PHASE, HONORAR_NET: h, EARNED_VALUE_NET: e, HOURS_TOTAL: hours, COST_TOTAL: c })

/** Zwei Leistungsbilder mit einer „LPH 3", die nicht dasselbe ist. */
const MIXED = {
  leistungsbilder: [
    { key: 'Bebauungsplan', label: 'Bebauungsplan', phases: [
      { key: 'LPH 3', name: 'Plan zur Beschlussfassung', hoaiPercent: 10, sort: 3 },
    ] },
    { key: 'Gebäude', label: 'Gebäude', phases: [
      { key: 'LPH 2', name: 'Vorplanung', hoaiPercent: 7, sort: 2 },
      { key: 'LPH 3', name: 'Entwurfsplanung', hoaiPercent: 15, sort: 3 },
    ] },
  ],
  projects: [
    project(1, 'P-2024-001', 'Neubau Kita', 'abgeschlossen'),
    project(2, 'P-2024-002', 'Umbau Rathaus', 'laufend'),
    project(3, 'P-2024-003', 'B-Plan Nord', 'laufend'),
  ],
  facts: [
    fact(1, 'Gebäude', 'LPH 2', 10_000, 10_000, 100, 8_000),
    // Kostenquote 130 % → „Handlungsbedarf" bei den Standardschwellen
    fact(1, 'Gebäude', 'LPH 3', 30_000, 30_000, 300, 39_000),
    fact(2, 'Gebäude', 'LPH 3', 20_000, 10_000, 100, 6_000),
    fact(3, 'Bebauungsplan', 'LPH 3', 8_000, 4_000, 50, 2_000),
  ],
}

async function open(page: Page) {
  await mockGroups(page)
  // Später registriert gewinnt — überschreibt die Matrix aus mockGroups.
  await page.route(/\/api\/v1\/reports\/phases\/matrix(\?|$)/, r => r.fulfill(json({ data: MIXED, meta: null })))
  await page.goto('/projekte?groupId=5&tab=leistungsphasen')
  await expect(page.getByRole('heading', { name: 'Leistungsphasen im Gesamtprojekt' })).toBeVisible()
}

test.describe('LPH-Controlling', () => {
  test('gemischte Leistungsbilder: Hinweis, und ein Klick wählt eines', async ({ page }) => {
    await open(page)
    const hint = page.getByText(/2 Leistungsbilder zusammen/)
    await expect(hint).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'LPH 3' }).first())
      .toHaveAttribute('title', /Gebäude: Entwurfsplanung[\s\S]*Bebauungsplan: Plan zur Beschlussfassung|Bebauungsplan: Plan zur Beschlussfassung[\s\S]*Gebäude: Entwurfsplanung/)

    await page.locator('.lph-mixed').getByRole('button', { name: 'Gebäude' }).click()
    await expect(hint).toBeHidden()
    await expect(page.getByRole('row', { name: /^P-2024-003/ })).toHaveCount(0)
    // Mit einem Leistungsbild: Phasenname und HOAI-Gewichtung
    await expect(page.getByRole('row', { name: /^LPH 3 Entwurfsplanung/ })).toContainText('15,0 %')
    await expect(page.getByRole('columnheader', { name: 'HOAI-Anteil' })).toBeVisible()
    expect(await noHorizontalScroll(page)).toBe(true)
  })

  test('Ampel nach Kostenquote, Kennzahl umschaltbar', async ({ page }) => {
    await open(page)
    const row = page.getByRole('row', { name: /^P-2024-001/ })
    await expect(row.locator('.lph-cell--critical').first()).toContainText('Handlungsbedarf')
    await page.getByLabel('Kennzahl').selectOption('leistung_h')
    await expect(row).toContainText('€/h')
  })

  test('Suche ohne Treffer: Hinweis und Zurücksetzen', async ({ page }) => {
    await open(page)
    await page.getByRole('searchbox', { name: 'Projekt suchen' }).fill('gibt es nicht')
    await expect(page.getByText('Keine Leistungsphasen passen zu Suche und Filtern.')).toBeVisible()
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click()
    await expect(page.getByRole('row', { name: /^P-2024-002/ })).toBeVisible()
  })
})
