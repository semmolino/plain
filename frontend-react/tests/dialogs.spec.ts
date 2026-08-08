import { test, expect } from '@playwright/test'
import { mockDemo, hideDevtools } from './fixtures/demoData'

/**
 * Dialog-Fusszeilen.
 *
 * Die Reihenfolge war im Produkt uneinheitlich: ConfirmModal (die Fusszeile,
 * die man am haeufigsten sieht) setzte Abbrechen links, 13 andere Dialoge
 * genau umgekehrt. Seit der Zusammenfuehrung auf `DialogFooter` gilt
 * ueberall: Abbrechen links, Hauptaktion rechts.
 */
test.describe('Dialog-Fusszeile', () => {
  test.beforeEach(async ({ page }) => {
    await mockDemo(page)
    await hideDevtools(page)
    await page.goto('/adressen')
    await page.locator('.master-table tbody tr').first().waitFor()
    await page.getByRole('button', { name: /Neu|anlegen/ }).first().click()
    await page.locator('.modal-actions').waitFor()
  })

  test('Abbrechen steht links von der Hauptaktion', async ({ page }) => {
    const cancel  = page.locator('.modal-actions button', { hasText: /Abbrechen|Schließen/ })
    const primary = page.locator('.modal-actions button.btn-primary')

    const cx = (await cancel.boundingBox())!.x
    const px = (await primary.boundingBox())!.x
    expect(cx).toBeLessThan(px)
  })

  test('beide Knoepfe sind gleich hoch', async ({ page }) => {
    const boxes = await page.locator('.modal-actions button').evaluateAll(
      els => els.map(e => Math.round(e.getBoundingClientRect().height)))
    expect(new Set(boxes).size).toBe(1)
  })
})

test.describe('Dialog-Fusszeile auf dem Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'nur schmale Viewports')

  test('Knoepfe erreichen 44px Hoehe', async ({ page }) => {
    await mockDemo(page)
    await hideDevtools(page)
    await page.goto('/adressen')
    await page.locator('.master-table tbody tr').first().waitFor()
    await page.getByRole('button', { name: /Neu|anlegen/ }).first().click()
    await page.locator('.modal-actions').waitFor()

    const heights = await page.locator('.modal-actions button').evaluateAll(
      els => els.map(e => e.getBoundingClientRect().height))
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44)
  })
})
