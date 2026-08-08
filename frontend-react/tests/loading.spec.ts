import { test, expect } from '@playwright/test'
import { mockDemo, hideDevtools } from './fixtures/demoData'

/**
 * Ladezustaende.
 *
 * Vorher zeigten alle Listen nur eine 13px-Zeile „Laden …" links oben in
 * einer rund 500px hohen leeren Flaeche, und die Trefferzahl behauptete
 * dabei „0 Einträge" — auf langsamer Verbindung liest sich das wie
 * „keine Daten".
 */
test.describe('Ladezustand', () => {
  test.beforeEach(async ({ page }) => {
    await mockDemo(page)
    await hideDevtools(page)
    await page.route(/\/api\/v1\/(invoices|angebote|projekte\/list)/, async route => {
      await new Promise(r => setTimeout(r, 1500))
      await route.fallback()
    })
  })

  test('Rechnungsliste zeigt Platzhalterzeilen statt einer leeren Flaeche', async ({ page }) => {
    await page.goto('/rechnungen')
    await expect(page.locator('.skeleton-row').first()).toBeVisible()
    // …und raeumt sie wieder ab, sobald die Daten da sind.
    await expect(page.locator('.master-table tbody tr').first()).toBeVisible({ timeout: 8000 })
    await expect(page.locator('.skeleton-row')).toHaveCount(0)
  })

  test('Trefferzahl behauptet waehrend des Ladens keine Null', async ({ page }) => {
    await page.goto('/rechnungen')
    await expect(page.locator('.list-info')).toHaveText('… Einträge')
    await expect(page.locator('.master-table tbody tr').first()).toBeVisible({ timeout: 8000 })
    await expect(page.locator('.list-info')).not.toHaveText('… Einträge')
  })

  test('Ladezustand wird Screenreadern angesagt', async ({ page }) => {
    await page.goto('/angebote')
    const status = page.locator('[role="status"][aria-busy="true"]')
    await expect(status).toBeVisible()
    await expect(status).toContainText('wird geladen')
  })
})
