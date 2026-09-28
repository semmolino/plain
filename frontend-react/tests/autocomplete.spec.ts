import { test, expect } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Adresssuche mit Tastatur (UI-Pilot Runde 7). Vorher ging die Trefferliste
 * nur mit der Maus: ↑/↓ taten nichts, Screenreader hörten keine Treffer, und
 * wer sich vertippte, sah eine leere Stelle statt „Keine Treffer".
 */

test.describe('Adresssuche', () => {
  test('↑/↓ und Enter wählen einen Treffer, das Feld meldet ihn', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=vertraege')
    const box = page.getByRole('combobox', { name: 'Rechnungsadresse' })
    await box.fill('Sta')
    const list = page.getByRole('listbox', { name: 'Treffer', exact: true })
    await expect(list.getByRole('option')).toHaveCount(3)
    await expect(box).toHaveAttribute('aria-expanded', 'true')

    await box.press('ArrowDown')
    await box.press('ArrowDown')
    await expect(list.getByRole('option', { name: 'Stadtwerke Ravensburg GmbH' })).toHaveAttribute('aria-selected', 'true')
    await expect(box).toHaveAttribute('aria-activedescendant', /.+/)
    // Nach oben über den Anfang springt ans Ende
    await box.press('ArrowUp'); await box.press('ArrowUp')
    await expect(list.getByRole('option', { name: 'Staatliches Hochbauamt Ulm' })).toHaveAttribute('aria-selected', 'true')
    await box.press('ArrowDown')
    await box.press('ArrowDown')
    await box.press('Enter')

    await expect(box).toHaveValue('Stadtwerke Ravensburg GmbH')
    await expect(box).toHaveAttribute('aria-expanded', 'false')
    // Adresse und (zurückgesetzter) Kontakt sind die offenen Änderungen
    await expect(page.getByRole('region', { name: 'Seitenaktionen' })).toContainText('2 Felder geändert')
  })

  test('Tippfehler: „Keine Treffer" statt leerer Stelle, Escape schliesst', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=vertraege')
    const box = page.getByRole('combobox', { name: 'Rechnungsadresse' })
    await box.fill('Xyzq')
    await expect(page.getByRole('status').filter({ hasText: 'Keine Treffer für „Xyzq"' })).toBeVisible()
    await box.fill('Kita')
    await expect(page.getByRole('option', { name: 'Kita-Verbund Sonnenblume e. V.' })).toBeVisible()
    await box.press('Escape')
    await expect(page.getByRole('listbox', { name: 'Treffer', exact: true })).toBeHidden()
    await expect(box).toHaveValue('Kita')
  })

  test('im Dialog schliesst Escape erst die Liste, dann das Fenster', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte')
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Projekt bearbeiten' })
    const box = dialog.getByRole('combobox', { name: 'Adresse' })
    await box.fill('Stadt')
    const hits = dialog.getByRole('listbox', { name: 'Treffer', exact: true })
    await expect(hits.getByRole('option').first()).toBeVisible()
    await box.press('Escape')
    await expect(hits).toBeHidden()
    await expect(dialog).toBeVisible()
    await box.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
