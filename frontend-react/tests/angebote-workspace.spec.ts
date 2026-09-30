import { test, expect } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Angebote als Arbeitsbereich (nach Runde 3) — wie die Projekte: Liste als
 * Startseite, ein Angebot mit eigenem Kopf und Reitern, Zustand in der URL.
 * Vorher waren Liste, Struktur und Kalkulationen gleichrangige Modul-Reiter,
 * und welches Angebot die Struktur zeigte, stand im localStorage.
 */

test.describe('Angebots-Arbeitsbereich', () => {
  test('Zeile öffnet das Angebot, die URL trägt es, Zurück führt zur Liste', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/angebote')
    await page.getByRole('link', { name: 'A-2025-014' }).or(page.getByRole('button', { name: 'A-2025-014' })).first().click()
    await expect(page).toHaveURL(/\/angebote\?offerId=1&tab=struktur/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Neubau Kindertagesstätte Sonnenblume')
    await expect(page.locator('.page-header-eyebrow')).toContainText('A-2025-014')
    await expect(page.locator('.page-header-eyebrow')).toContainText('Angebot')
    await page.getByRole('button', { name: 'Angebote', exact: true }).click()
    await expect(page).toHaveURL(/\/angebote$/)
  })

  test('alter Reiter „hoai" und Navigations-State landen in der URL', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/angebote?offerId=1&tab=hoai')
    await expect(page).toHaveURL(/offerId=1&tab=kalkulationen/)
    await expect(page.getByRole('tab', { name: 'Kalkulationen' })).toHaveAttribute('aria-selected', 'true')
    // Einstieg wie aus der Adresse/Kalkulation: state { offerId }
    await page.evaluate(() => {
      window.history.pushState({ usr: { offerId: 3 }, key: 'x', idx: 1 }, '', '/angebote')
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    })
    await expect(page).toHaveURL(/offerId=3&tab=struktur/)
  })

  test('Kopf: Kennzahlen, PDF, Beauftragt, Menü', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Aktionen im Kopf am Desktop')
    await mockPilot(page)
    await page.goto('/angebote?offerId=1&tab=struktur')
    const kpis = page.locator('.pw-kpis')
    await expect(kpis).toContainText('Angebotssumme')
    await expect(kpis).toContainText('78 %')
    await expect(page.getByRole('button', { name: 'PDF' })).toBeVisible()
    await page.getByRole('button', { name: /Beauftragt/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Weitere Aktionen zum Angebot' }).click()
    for (const name of ['Angebotsdaten bearbeiten', 'Angebot kopieren', 'Als abgelehnt markieren', 'Angebot löschen']) {
      await expect(page.getByRole('menuitem', { name })).toBeVisible()
    }
    await page.getByRole('menuitem', { name: 'Angebotsdaten bearbeiten' }).click()
    await expect(page).toHaveURL(/tab=daten/)
    // Die Aktionen stehen im Kopf — im Reiter nicht noch einmal
    await expect(page.getByRole('button', { name: 'PDF öffnen' })).toHaveCount(0)
  })

  test('beauftragtes Angebot: kein „Beauftragt", dafür Projekt und Auftragsbestätigung', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Aktionen im Kopf am Desktop')
    await mockPilot(page)
    await page.goto('/angebote?offerId=2&tab=struktur')
    await expect(page.locator('.page-header-eyebrow')).toContainText('Projekt')
    await expect(page.getByRole('button', { name: /Beauftragt …/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Weitere Aktionen zum Angebot' }).click()
    await expect(page.getByRole('menuitem', { name: 'Auftragsbestätigung (PDF)' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Zum Projekt/ })).toBeVisible()
  })

  test('Name ist der Umschalter, Strg+K öffnet ihn, Esc schließt', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tastatur am Desktop')
    await mockPilot(page)
    await page.goto('/angebote?offerId=1&tab=struktur')
    await page.locator('.sx-table').waitFor()
    await page.keyboard.press('Control+k')
    const search = page.getByRole('combobox', { name: 'Angebot suchen …' })
    await expect(search).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)
    await page.locator('.pw-title-btn').click()
    await search.fill('Machbarkeit')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/offerId=3&tab=struktur/)
  })

  test('Handy: kein Seitwärts-Scrollen, Umschalter als Blatt', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'nur Handy')
    await mockPilot(page)
    await page.goto('/angebote?offerId=1&tab=struktur')
    await page.getByRole('list', { name: 'Elemente der Angebotsstruktur' }).waitFor()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)
    await page.locator('.pw-title-btn').click()
    await expect(page.getByRole('dialog', { name: 'Angebot wechseln' })).toBeVisible()
  })
})
