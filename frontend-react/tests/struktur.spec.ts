import { test, expect, type Page } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Projektstruktur, Runde 2: eine Spalte „Element" mit Auf-/Zuklappen, beide
 * Dichten ohne Querscrollen bei 1280 px, am Handy Baumliste + Blatt.
 */

async function open(page: Page, density?: 'compact' | 'comfortable') {
  if (density) await page.addInitScript(v => localStorage.setItem('plain:filt:v2:1:ui.density', JSON.stringify(v)), density)
  await mockPilot(page)
  await page.goto('/projekte?projectId=1&tab=struktur')
}

test.describe('Struktur am Desktop', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Tabelle nur am Desktop')

  for (const d of ['comfortable', 'compact'] as const) {
    test(`Dichte ${d}: kein Querscrollen bei 1280 px`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await open(page, d)
      await page.locator('.sx-table').waitFor()
      const { table, box } = await page.evaluate(() => {
        const t = document.querySelector('.sx-table') as HTMLElement
        return { table: t.scrollWidth, box: (t.closest('.list-section') as HTMLElement).clientWidth }
      })
      expect(table).toBeLessThanOrEqual(box + 1)
      // „inkl. Zuschl." nur kompakt; luftig steht die Aufteilung im Tooltip
      const inkl = page.getByRole('columnheader', { name: /inkl\. Zuschl/ })
      await expect(inkl).toHaveCount(d === 'compact' ? 1 : 0)
    })
  }

  test('Kürzel und Bezeichnung in einer Spalte, Zuklappen blendet Unterelemente aus', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('columnheader', { name: /^Element/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Kürzel' })).toHaveCount(0)
    await expect(page.locator('input[aria-label="Kürzel"][value="LP5.1"]')).toBeVisible()
    await page.getByRole('button', { name: 'LP5 zuklappen' }).click()
    await expect(page.locator('input[aria-label="Kürzel"][value="LP5.1"]')).toHaveCount(0)
    await expect(page.getByText('3 ausgeblendet')).toBeVisible()
    await page.getByRole('button', { name: 'LP5 aufklappen' }).click()
    await expect(page.locator('input[aria-label="Kürzel"][value="LP5.1"]')).toBeVisible()
    await page.getByRole('button', { name: 'Alle Ebenen zuklappen' }).click()
    await expect(page.locator('input[aria-label="Kürzel"][value="LP1"]')).toHaveCount(0)
  })

  test('Filtern zeigt Treffer auch unter zugeklappten Vätern', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Alle Ebenen zuklappen' }).click()
    await page.getByRole('searchbox', { name: 'Elemente filtern' }).fill('Rohbau')
    await expect(page.locator('input[aria-label="Kürzel"][value="LP5.1"]')).toBeVisible()
  })
})

test.describe('Struktur am Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'nur schmale Viewports')

  test('Baumliste, Blatt speichert genau ein Element', async ({ page }) => {
    const patches: { url: string; body: unknown }[] = []
    page.on('request', r => { if (r.method() === 'PATCH' && /projekte\/structure\/\d+/.test(r.url())) patches.push({ url: r.url(), body: r.postDataJSON() }) })
    await open(page)
    const list = page.getByRole('list', { name: 'Elemente der Projektstruktur' })
    await expect(list).toBeVisible()
    await expect(page.locator('.sx-table')).toHaveCount(0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)

    await list.getByRole('button', { name: /^LP2 Vorplanung bearbeiten/ }).click()
    const sheet = page.getByRole('dialog', { name: /LP2 · Vorplanung/ })
    await expect(sheet.getByRole('button', { name: 'Speichern' })).toBeDisabled()
    await sheet.getByLabel('Nebenkosten %').fill('6')
    await sheet.getByRole('button', { name: 'Speichern' }).click()
    await expect(sheet).toBeHidden()
    expect(patches).toHaveLength(1)
    expect(patches[0].url).toMatch(/structure\/103/)
    expect(patches[0].body).toEqual({ EXTRAS_PERCENT: 6 })
  })

  test('Zuklappen in der Liste, Ziele mindestens 44 px', async ({ page }) => {
    await open(page)
    const list = page.getByRole('list', { name: 'Elemente der Projektstruktur' })
    await list.getByRole('button', { name: 'LP5 zuklappen' }).click()
    await expect(list.getByRole('button', { name: /^LP5\.1 / })).toHaveCount(0)
    for (const h of await list.locator('button').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) {
      expect(h).toBeGreaterThanOrEqual(44)
    }
  })
})
