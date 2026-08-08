import { test, expect } from '@playwright/test'
import { mockDemo, hideDevtools } from './fixtures/demoData'

/**
 * Filter-Chips und Filterleiste.
 *
 * `FilterChip` lag frueher zehnmal lokal in den Seiten; seit der
 * Zusammenfuehrung haengen alle Listen an derselben Komponente — ein Fehler
 * hier trifft sie alle auf einmal. Der Test faehrt sie deshalb einmal
 * vollstaendig durch: Eingrenzen, Zaehler, Tastaturbedienung.
 */
test.describe('Filter-Chips', () => {
  test.beforeEach(async ({ page }) => {
    await mockDemo(page)
    await hideDevtools(page)
  })

  test('grenzt die Angebotsliste ein und zaehlt aktive Filter', async ({ page }) => {
    await page.goto('/angebote')
    const rows = page.locator('.master-table tbody tr')
    await expect(rows).toHaveCount(5)

    // Auf schmalen Geraeten liegen die Chips hinter dem Filter-Knopf. Der
    // steht erst, wenn die Liste geladen ist — sonst meldet isVisible()
    // faelschlich false und die Chips bleiben zu.
    const toggle = page.getByRole('button', { name: 'Filter', exact: true })
    if (await toggle.isVisible()) await toggle.click()

    await page.getByRole('button', { name: /^Status/ }).click()
    await page.getByRole('checkbox', { name: 'Angebot', exact: true }).check()
    await expect(rows).toHaveCount(2)
    await expect(page.getByRole('button', { name: /Status \(1\)/ })).toBeVisible()
  })

  test('Escape schliesst das Aufklappmenue und gibt den Fokus zurueck', async ({ page }) => {
    await page.goto('/angebote')

    // Erst wenn die Liste geladen ist, steht die Bedienleiste — sonst
    // meldet isVisible() faelschlich false und die Chips bleiben zu.
    await expect(page.locator('.master-table tbody tr').first()).toBeVisible()
    const toggle = page.getByRole('button', { name: 'Filter', exact: true })
    if (await toggle.isVisible()) await toggle.click()

    const chip = page.getByRole('button', { name: /^Status/ })
    await chip.click()
    await expect(page.locator('.filter-chip-dropdown')).toHaveCount(1)
    await expect(chip).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Escape')
    await expect(page.locator('.filter-chip-dropdown')).toHaveCount(0)
    // Der Fokus darf nicht ins Nichts fallen — sonst landet man per Tab
    // wieder am Seitenanfang.
    await expect(chip).toBeFocused()
  })

  test('Zuruecksetzen leert alle Filter der Seite', async ({ page }) => {
    await page.goto('/angebote')
    const rows = page.locator('.master-table tbody tr')

    // Erst wenn die Liste geladen ist, steht die Bedienleiste — sonst
    // meldet isVisible() faelschlich false und die Chips bleiben zu.
    await expect(page.locator('.master-table tbody tr').first()).toBeVisible()
    const toggle = page.getByRole('button', { name: 'Filter', exact: true })
    if (await toggle.isVisible()) await toggle.click()

    await page.getByRole('button', { name: /^Status/ }).click()
    await page.getByRole('checkbox', { name: 'Angebot', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(rows).toHaveCount(2)

    await page.getByRole('button', { name: /Zurücksetzen/ }).click()
    await expect(rows).toHaveCount(5)
  })
})
