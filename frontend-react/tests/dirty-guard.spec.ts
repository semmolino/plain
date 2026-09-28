import { test, expect } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Rückfrage bei ungespeicherten Änderungen (Runde 2, Data-Router + useBlocker).
 * Runde 1 fragte nur bei Wechseln innerhalb der Projektseite; ein Klick in
 * die Seitennavigation oder Zurück im Browser verwarf still.
 */

test.describe('Rückfrage bei ungespeicherten Änderungen', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Inline-Bearbeitung und Seitennavigation am Desktop')

  test('Klick in die Seitennavigation fragt nach — Abbrechen bleibt, Verwerfen geht', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Geändert')
    const nav = page.getByRole('navigation').getByRole('link', { name: 'Adressen' }).first()
    await nav.click()
    const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Struktur')
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page).toHaveURL(/\/projekte\?projectId=1&tab=struktur/)
    await expect(page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1)).toHaveValue('Geändert')

    await nav.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Verwerfen' }).click()
    await expect(page).toHaveURL(/\/adressen/)
  })

  test('Zurück im Browser fragt nach', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=buchungen')
    await page.getByRole('tab', { name: 'Struktur' }).click()
    await expect(page).toHaveURL(/tab=struktur/)
    await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Geändert')
    await page.goBack()
    const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page).toHaveURL(/tab=struktur/)
    await expect(page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1)).toHaveValue('Geändert')
  })

  test('„Speichern und wechseln" speichert die Leistungsstände und geht weiter', async ({ page }) => {
    await mockPilot(page)
    const posts: unknown[] = []
    page.on('request', r => { if (r.method() === 'POST' && /projekte\/1\/leistungsstand/.test(r.url())) posts.push(r.postDataJSON()) })
    await page.goto('/projekte?projectId=1&tab=leistungsstand')
    await page.getByLabel(/Neuer Stand LP7 /).fill('30')
    await page.getByRole('navigation').getByRole('link', { name: 'Rechnungen' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Speichern und wechseln' }).click()
    await expect(page).toHaveURL(/\/rechnungen/)
    expect(posts).toHaveLength(1)
  })

  test('ohne Änderungen keine Rückfrage', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    await page.locator('.sx-table').waitFor()
    await page.getByRole('navigation').getByRole('link', { name: 'Adressen' }).first().click()
    await expect(page).toHaveURL(/\/adressen/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test('Handy: Bottom-Nav fragt in der Monatsrunde nach', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile')
  await mockPilot(page)
  await page.goto('/projekte?tab=leistungsstaende')
  await page.getByRole('button', { name: /P-2024-001/ }).click()
  await page.getByLabel(/Neuer Stand LP6 /).fill('55')
  await page.locator('.bottom-nav').getByRole('link', { name: 'Übersicht' }).click()
  await expect(page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })).toBeVisible()
})
