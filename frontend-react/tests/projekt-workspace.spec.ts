import { test, expect } from '@playwright/test'
import { hideDevtools } from './fixtures/demoData'
import { mockPilot } from './fixtures/pilotData'

/**
 * Projekt-Arbeitsbereich (UI-Pilot 2026-09): URL als Zustand, ein Kopf statt
 * drei Leisten, Speichern mit Aenderungszaehler und Rueckfrage.
 */

test.describe('Projekt-Arbeitsbereich', () => {
  test('Projekt ohne Tab landet in der Struktur und behaelt die URL', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1')
    await hideDevtools(page)
    await expect(page).toHaveURL(/projectId=1&tab=struktur/)
    await expect(page.locator('h1')).toContainText('Neubau Kindertagesstätte')
    await expect(page.locator('.proj-jump-bar')).toHaveCount(0)
    await expect(page.locator('.project-context-strip')).toHaveCount(0)
  })

  test('Tabwechsel steht in der URL, Zurück geht zum vorigen Tab', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Reiterleiste auf dem Handy hat „Mehr"')
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    await page.getByRole('tab', { name: 'Buchungen' }).click()
    await expect(page).toHaveURL(/tab=buchungen/)
    await page.goBack()
    await expect(page).toHaveURL(/tab=struktur/)
    await expect(page.getByRole('tab', { name: 'Struktur' })).toHaveAttribute('aria-selected', 'true')
  })

  test('Benachrichtigungslink ohne Projekt nimmt das zuletzt geoeffnete', async ({ page }) => {
    await mockPilot(page)
    await page.addInitScript(() => localStorage.setItem('projekte-selected-pid', '1'))
    await page.goto('/projekte?tab=buchungen')
    await expect(page).toHaveURL(/projectId=1&tab=buchungen/)
  })

  test('Kopf zeigt Kennzahlen – ohne Report-Recht entfallen sie', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    await expect(page.locator('.pw-kpis').first()).toContainText('Honorar')
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await mockPilot(page, { headerForbidden: true })
    await page.reload()
    await expect(page.locator('h1')).toContainText('Neubau Kindertagesstätte')
    await expect(page.locator('.pw-kpis')).toHaveCount(0)
  })

  test('Änderung wird gezählt, Strg+S speichert genau das geänderte Element', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Inline-Bearbeitung ist Desktop')
    await mockPilot(page)
    const patches: string[] = []
    page.on('request', r => { if (r.method() === 'PATCH' && /projekte\/structure\/\d+/.test(r.url())) patches.push(r.url()) })
    await page.goto('/projekte?projectId=1&tab=struktur')
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await expect(bar).toContainText('Alle Änderungen gespeichert')
    await expect(bar.getByRole('button', { name: /Speichern/ })).toBeDisabled()

    await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Grundlagenermittlung und Bestand')
    await expect(bar).toContainText('1 Element geändert')

    // Zuruecktippen auf den alten Wert ist keine Aenderung mehr.
    await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Grundlagenermittlung')
    await expect(bar).toContainText('Alle Änderungen gespeichert')

    await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Grundlagenermittlung und Bestand')
    await page.keyboard.press('Control+s')
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0]).toMatch(/structure\/102/)
  })

  test('Tabwechsel mit offenen Änderungen fragt nach', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Inline-Bearbeitung ist Desktop')
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Geändert')
    await page.getByRole('tab', { name: 'Buchungen' }).click()

    const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page).toHaveURL(/tab=struktur/)

    await page.getByRole('tab', { name: 'Buchungen' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Verwerfen' }).click()
    await expect(page).toHaveURL(/tab=buchungen/)
  })

  test('Handy: kein Seitwaerts-Scrollen der Seite, Bottom-Nav sichtbar', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile')
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    // Runde 2: am Handy eine Baumliste statt der Tabelle
    await page.locator('.sxm-list').waitFor()
    // Gegen die Geraetebreite messen: waechst die Seite, waechst am Handy
    // auch window.innerWidth mit, und der Vergleich damit sieht nichts.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)
    await expect(page.locator('.bottom-nav')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Weitere Bereiche des Projekts' })).toBeAttached()
  })

  test('Projektname ist der Umschalter: Suchen, Pfeiltasten, Enter', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=leistungsstand')
    const title = page.getByRole('button', { name: /Neubau Kindertagesstätte.*Projekt wechseln/ })
    await title.click()
    // Desktop: Aufklapper unter dem Namen, Handy: eigenes Blatt — beide als Dialog benannt.
    const box = page.getByRole('dialog', { name: 'Projekt wechseln' })
    const search = box.getByRole('combobox', { name: 'Projekt suchen …' })
    await expect(search).toBeFocused()
    // Leer statt mit dem aktuellen Namen — man will suchen, nicht löschen.
    await expect(search).toHaveValue('')
    await search.fill('P-2024-004')
    await search.press('ArrowDown')
    await expect(box.getByRole('option', { selected: true })).toContainText('P-2024-004')
    await search.press('Enter')
    // Der Reiter bleibt beim Wechsel erhalten.
    await expect(page).toHaveURL(/projectId=4&tab=leistungsstand/)
  })

  test('Strg+K öffnet den Umschalter, Esc schließt und gibt den Fokus zurück', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tastatur')
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    await page.locator('h1').waitFor()
    await page.keyboard.press('Control+k')
    const box = page.getByRole('dialog', { name: 'Projekt wechseln' })
    await expect(box.getByRole('combobox')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Projekt wechseln/ })).toBeFocused()
  })
})
