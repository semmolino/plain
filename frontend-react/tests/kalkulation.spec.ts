import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Kalkulationen im Assistenten-Muster (UI-Pilot Runde 5): sprechende
 * Schritte, feste Leiste, Rueckfrage bei offenen Aenderungen — auch beim
 * Schliessen des Fensters. Vorher gingen Eingaben mit Escape still verloren,
 * und „Keine Zuordnung" im Angebot endete in einer Fehlermeldung.
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

test.describe('Kalkulation im Angebot', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Desktop')

  test('neu anlegen: Schritte mit Namen, Rückfrage beim Schließen, oberste Ebene', async ({ page }) => {
    const attach = record(page, 'POST', /add-to-offer-structure/)
    const deletes = record(page, 'DELETE', /fee-calculation-masters\/\d+/)
    await mockPilot(page)
    await page.goto('/angebote?offerId=1&tab=kalkulationen')
    await expect(page.getByRole('row').filter({ hasText: 'Gebäude und Innenräume' })).toBeVisible()
    await page.getByRole('button', { name: 'Neue Kalkulation' }).click()

    const dialog = page.getByRole('dialog', { name: 'Neue Kalkulation' })
    const steps = dialog.locator('.wizard-steps')
    await expect(steps).toContainText('Leistungsbild')
    await expect(steps).toContainText('Besondere Leistungen')
    await expect(steps).toContainText('Übernehmen')

    await dialog.getByLabel('Honorarordnung').selectOption({ label: 'HOAI 2021 – Honorarordnung für Architekten und Ingenieure' })
    await dialog.getByLabel('Leistungsbild').selectOption({ label: '§ 34 – Gebäude und Innenräume' })
    const bar = dialog.getByRole('region', { name: 'Seitenaktionen' })
    await bar.getByRole('button', { name: /Weiter/ }).click()

    await expect(dialog.getByRole('heading', { name: 'Grundlagen' })).toBeVisible()
    await dialog.getByLabel('Honorarzone').selectOption({ index: 3 })
    await dialog.getByLabel('Zonenanteil %').fill('50')
    await dialog.getByLabel('K0').fill('2450000')

    // Escape schliesst nicht still — die angefangene Kalkulation waere weg
    await page.keyboard.press('Escape')
    const guard = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(guard).toContainText('ist noch nicht übernommen. Beim Verlassen wird sie verworfen.')
    // Enter bleibt hier, statt zu verwerfen
    await expect(guard.getByRole('button', { name: 'Abbrechen' })).toBeFocused()
    await guard.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(guard).toBeHidden()
    await expect(dialog.getByLabel('K0')).toHaveValue('2450000')
    expect(deletes).toHaveLength(0)

    await bar.getByRole('button', { name: /Weiter/ }).click()
    await expect(dialog.getByRole('heading', { name: 'Leistungsphasen' })).toBeVisible()
    await expect(bar).toContainText('Gesamthonorar 262.418,41 €')
    await bar.getByRole('button', { name: /Weiter/ }).click()
    await expect(dialog.getByRole('heading', { name: 'Besondere Leistungen' })).toBeVisible()
    await bar.getByRole('button', { name: /Weiter/ }).click()
    await expect(dialog.getByRole('heading', { name: 'Zuschläge' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Umbauzuschlag' }).click()
    await expect(bar).toContainText('Gesamthonorar 314.902,09 €')

    // Modus als Umschalter mit aria-pressed statt Farbe
    await dialog.getByRole('button', { name: 'Details' }).click()
    const mode = dialog.getByRole('group', { name: 'Berechnungsmodus Zuschlag 1' })
    await expect(mode.getByRole('button', { name: 'Parallel' })).toHaveAttribute('aria-pressed', 'true')
    await mode.getByRole('button', { name: 'Kumulativ' }).click()
    await expect(mode.getByRole('button', { name: 'Kumulativ' })).toHaveAttribute('aria-pressed', 'true')

    await bar.getByRole('button', { name: /Weiter/ }).click()
    await expect(dialog.getByRole('heading', { name: 'Übernehmen' })).toBeVisible()
    await expect(dialog.getByLabel('Wohin im Angebot?')).toHaveValue('')
    await expect(dialog.getByLabel('Wohin im Angebot?').locator('option').first()).toHaveText('Neues Element „§ 34 Gebäude und Innenräume" auf oberster Ebene')
    await bar.getByRole('button', { name: 'Ins Angebot übernehmen' }).click()
    await expect(dialog).toBeHidden()
    expect(attach).toHaveLength(1)
    expect(attach[0].body).toEqual({ father_id: null })
    expect(deletes).toHaveLength(0)
  })

  test('Zurück speichert den Schritt, statt ihn beim nächsten Weiter zu verlieren', async ({ page }) => {
    const phaseSaves = record(page, 'POST', /phases\/save/)
    await mockPilot(page)
    await page.goto('/angebote?offerId=1&tab=kalkulationen')
    await page.getByRole('button', { name: 'Gebäude und Innenräume bearbeiten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kalkulation bearbeiten' })
    const bar = dialog.getByRole('region', { name: 'Seitenaktionen' })
    await expect(dialog.locator('.wizard-steps')).not.toContainText('Leistungsbild')
    await bar.getByRole('button', { name: /Weiter/ }).click()
    await dialog.getByLabel('Honorar % LPH 5: Ausführungsplanung').fill('20')
    await expect(bar).toContainText('Nicht gespeichert')
    await bar.getByRole('button', { name: 'Zurück' }).click()
    await expect(dialog.getByRole('heading', { name: 'Grundlagen' })).toBeVisible()
    expect(phaseSaves).toHaveLength(1)
    expect(phaseSaves[0].body.rows).toEqual(expect.arrayContaining([expect.objectContaining({ FEE_PERCENT: 20 })]))
  })
})

test.describe('Kalkulation im Angebot ändern', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Desktop')

  // Runde 6: die Elemente im Angebot sind mit der Kalkulation verknüpft
  test('„Angebot aktualisieren" gleicht die verknüpften Elemente ab', async ({ page }) => {
    const sync = record(page, 'POST', /sync-to-structure/)
    await mockPilot(page)
    await page.goto('/angebote?offerId=1&tab=kalkulationen')
    await page.getByRole('button', { name: 'Gebäude und Innenräume bearbeiten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kalkulation bearbeiten' })
    const bar = dialog.getByRole('region', { name: 'Seitenaktionen' })
    for (const title of ['Leistungsphasen', 'Besondere Leistungen', 'Zuschläge', 'Übersicht']) {
      await bar.getByRole('button', { name: /Weiter/ }).click()
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
    }
    await expect(dialog.getByRole('checkbox', { name: /Die 5 verknüpften Angebotselemente mit den neuen Werten überschreiben/ })).toBeChecked()
    await bar.getByRole('button', { name: 'Angebot aktualisieren' }).click()
    await expect(dialog).toBeHidden()
    expect(sync).toHaveLength(1)
    await expect(page.locator('.toast-message', { hasText: '5 Angebotselemente wurden aktualisiert.' })).toBeVisible()
  })
})

test.describe('Kalkulationen im Projekt', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Desktop')

  test('Bearbeiten: offene Werte speichern beim Verlassen, Struktur aktualisieren nur mit Verknüpfung', async ({ page }) => {
    const basis = record(page, 'PATCH', /fee-calculation-masters\/\d+\/basis/)
    const sync  = record(page, 'POST', /sync-to-structure/)
    await mockPilot(page)
    await page.goto('/projekte?tab=honorar')
    await page.getByRole('button', { name: 'Gebäude und Innenräume bearbeiten' }).first().click()
    await expect(page.getByRole('heading', { name: 'Grundlagen' })).toBeVisible()
    await page.getByLabel('K0').fill('2600000')
    await page.getByRole('button', { name: 'Zurück zur Liste' }).click()
    const guard = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(guard).toContainText('„§ 34 Gebäude und Innenräume"')
    await guard.getByRole('button', { name: 'Speichern und wechseln' }).click()
    await expect(guard).toBeHidden()
    expect(basis).toHaveLength(1)
    expect(basis[0].body).toMatchObject({ CONSTRUCTION_COSTS_K0: 2600000 })
    await expect(page.getByRole('button', { name: 'Neue Kalkulation' })).toBeVisible()

    await page.getByRole('button', { name: 'Gebäude und Innenräume bearbeiten' }).first().click()
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    for (const title of ['Leistungsphasen', 'Besondere Leistungen', 'Zuschläge', 'Übersicht']) {
      await bar.getByRole('button', { name: /Weiter/ }).click()
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
    }
    const box = page.getByRole('checkbox', { name: /verknüpften Projektelemente mit den neuen Werten überschreiben/ })
    await expect(box).toBeChecked()
    await box.uncheck()
    await expect(bar.getByRole('button', { name: 'Fertig' })).toBeVisible()
    await box.check()
    await bar.getByRole('button', { name: 'Struktur aktualisieren' }).click()
    expect(sync).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Neue Kalkulation' })).toBeVisible()
  })

  test('leere Liste erklärt, wozu es Kalkulationen gibt', async ({ page }) => {
    await mockPilot(page)
    await page.route(/\/api\/v1\/stammdaten\/fee-calculation-masters(\?|$)/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }))
    await page.goto('/projekte?tab=honorar')
    await expect(page.getByText('Noch keine Kalkulation.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Erste Kalkulation anlegen' })).toBeVisible()
  })
})

test.describe('Kalkulation am Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'nur schmale Viewports')

  test('Leiste steht im Blatt unten, Schritte kompakt', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/angebote?offerId=1&tab=kalkulationen')
    await page.getByRole('button', { name: 'Neue Kalkulation' }).click()
    const dialog = page.getByRole('dialog', { name: 'Neue Kalkulation' })
    await expect(dialog.locator('.wizard-steps-mobile')).toContainText('Schritt 1 von 6')
    const primary = dialog.getByRole('region', { name: 'Seitenaktionen' }).getByRole('button', { name: /Weiter/ })
    await expect(primary).toBeInViewport()
    const box = await primary.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
})
