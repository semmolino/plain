import { test, expect, type Page } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * „Zeit buchen" (UI-Pilot 2026-09): ein Dialog von ueberall, Zuletzt-Chips,
 * Dauer aus Von/Bis, Strg+S bucht genau einmal, Einstieg nur mit Recht.
 */

async function setup(page: Page, opts: Parameters<typeof mockPilot>[1] = {}) {
  await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
  await mockPilot(page, opts)
}

function capturePosts(page: Page) {
  const bodies: Record<string, unknown>[] = []
  page.on('request', r => {
    if (r.method() === 'POST' && /\/api\/v1\/buchungen(\?|$)/.test(r.url())) bodies.push(r.postDataJSON())
  })
  return bodies
}

test.describe('Zeit buchen', () => {
  test('aus der Kopfzeile: Chip, Von/Bis, Buchen', async ({ page }) => {
    await setup(page)
    const posts = capturePosts(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Zeit buchen' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Zeit buchen' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: /LP5\.1/ }).click()
    await expect(dialog.getByLabel('Leistung*')).toHaveValue('107')

    const narrow = (page.viewportSize()?.width ?? 1280) <= 640
    if (narrow) await dialog.getByRole('button', { name: /Uhrzeit angeben/ }).click()
    await dialog.getByLabel('Von').fill('08:15')
    await dialog.getByLabel('Bis').fill('12:45')
    await expect(dialog.getByLabel('Dauer (Stunden)*')).toHaveValue('4,5')

    await dialog.getByLabel('Beschreibung*').fill('Werkplanung Treppenhaus')
    await dialog.getByRole('button', { name: 'Buchen', exact: true }).click()
    await expect(dialog).toBeHidden()

    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      PROJECT_ID: 1, STRUCTURE_ID: 107, EMPLOYEE_ID: 1,
      BOOKING_DATE: '2026-09-24', QUANTITY_INT: 4.5, QUANTITY_EXT: 4.5,
      HOURLY_RATE: 95, POSTING_DESCRIPTION: 'Werkplanung Treppenhaus',
    })
  })

  test('Pflichtfelder werden im Dialog benannt, nichts wird gesendet', async ({ page }) => {
    await setup(page)
    const posts = capturePosts(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Zeit buchen' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Zeit buchen' })
    await dialog.getByRole('button', { name: 'Buchen', exact: true }).click()
    await expect(dialog.getByText('Wähle ein Projekt.')).toBeVisible()
    await expect(dialog.getByText('Gib eine Dauer größer 0 an.')).toBeVisible()
    expect(posts).toHaveLength(0)
  })

  test('Strg+S im Dialog bucht genau einmal und speichert die Seite nicht mit', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tastatur')
    await setup(page)
    const posts = capturePosts(page)
    const patches: string[] = []
    page.on('request', r => { if (r.method() === 'PATCH') patches.push(r.url()) })
    await page.goto('/projekte?projectId=1&tab=struktur')
    // Offene Aenderung in der Struktur — die darf Strg+S im Dialog nicht speichern.
    await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Geändert')
    await page.getByRole('button', { name: 'Zeit buchen' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Zeit buchen' })
    await dialog.getByRole('button', { name: /LP5\.1/ }).click()
    await dialog.getByRole('button', { name: '2 h' }).click()
    await dialog.getByLabel('Beschreibung*').fill('Abstimmung Statik')
    await dialog.getByLabel('Beschreibung*').press('Control+s')
    await expect(dialog).toBeHidden()
    expect(posts).toHaveLength(1)
    expect(patches).toHaveLength(0)
  })

  test('im Projekt-Tab: eine Hauptaktion, Projekt vorbelegt', async ({ page }, info) => {
    await setup(page)
    await page.goto('/projekte?projectId=1&tab=buchungen')
    await page.locator('.bk-table').waitFor()
    const label = info.project.name === 'mobile' ? /^\s*Stunden\s*$/ : 'Stunden buchen'
    await page.getByRole('button', { name: label }).click()
    const dialog = page.getByRole('dialog', { name: 'Zeit buchen' })
    await expect(dialog.getByRole('combobox', { name: 'Projekt suchen …' })).toHaveValue(/P-2024-001/)
    // Vorher: fuenf Anlegen-Knoepfe in einer eigenen Zeile.
    await expect(page.getByRole('button', { name: /\+ Stückleistung|\+ Pauschale/ })).toHaveCount(0)
  })

  test('ohne Buchungsrecht weder „Zeit buchen" noch Stempeluhr', async ({ page }) => {
    await setup(page, { permissions: ['dashboard.view', 'addresses.view'] })
    await page.goto('/')
    await page.locator('.app-main').waitFor()
    await expect(page.getByRole('button', { name: 'Zeit buchen' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Stempeluhr/ })).toHaveCount(0)
  })

  test('Handy: Kopfzeile passt, Ziele mindestens 44 px', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile')
    await setup(page)
    await page.goto('/')
    await page.locator('.app-main').waitFor()
    // Gegen die Geraetebreite messen: waechst die Seite, waechst am Handy
    // auch window.innerWidth mit, und der Vergleich damit sieht nichts.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)
    for (const name of ['Zeit buchen', 'Stempeluhr']) {
      const box = await page.getByRole('button', { name }).first().boundingBox()
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
  })
})
