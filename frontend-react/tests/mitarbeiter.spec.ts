import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Mitarbeiter als Arbeitsbereich (UI-Pilot Runde 10).
 *
 * Vorher: ein Dialog mit acht Abschnitten, der alle Felder schickte, nach dem
 * Speichern von selbst zuging und beim Schließen nichts fragte. Im Zeitkonto
 * schrieb „Speichern" nach einer geänderten Uhrzeit 0 Stunden (das Zahlenfeld
 * ließ „5,5" nicht zu), und die abrechenbaren Stunden gingen dabei verloren.
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

const bar = (page: Page) => page.getByRole('region', { name: 'Seitenaktionen' })
/** Desktop: Kürzel in der Tabelle; Handy: die Karte mit dem Namen. */
const kernLink = (page: Page) => page.getByRole('link', { name: /^TK$|Thomas Kern/ }).first()

test.describe('Mitarbeiterseite', () => {
  test('Liste führt auf die Seite, der Reiter steht in der URL', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/mitarbeiter')
    await kernLink(page).click()
    await expect(page).toHaveURL(/\/mitarbeiter\/2$/)
    await expect(page.getByRole('heading', { level: 1, name: /Thomas Kern/ })).toBeVisible()
    await page.getByRole('tab', { name: 'Arbeitszeit' }).click()
    await expect(page).toHaveURL(/\/mitarbeiter\/2\?tab=arbeitszeit$/)
    await expect(page.getByRole('cell', { name: /Vollzeit/ }).first()).toBeVisible()
  })

  test('Stammdaten: nur das geänderte Feld geht an den Server', async ({ page }) => {
    await mockPilot(page)
    const patches = record(page, 'PATCH', /\/api\/v1\/mitarbeiter\/2$/)
    await page.goto('/mitarbeiter/2')
    await page.getByLabel('Abteilung').selectOption({ label: 'Tiefbau' })
    await expect(bar(page)).toContainText('1 Feld geändert')
    await bar(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Stammdaten gespeichert.')).toBeVisible()
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toEqual({ department_id: 2 })
  })

  test('Pflichtfeld leer: kein Speichern, Feld markiert', async ({ page }) => {
    await mockPilot(page)
    const patches = record(page, 'PATCH', /\/api\/v1\/mitarbeiter\/2$/)
    await page.goto('/mitarbeiter/2')
    await page.getByLabel('Vorname *').fill('')
    await bar(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Bitte noch angeben: Vorname.')).toBeVisible()
    await expect(page.getByLabel('Vorname *')).toHaveAttribute('aria-invalid', 'true')
    expect(patches).toHaveLength(0)
  })

  test('Verlassen mit offenen Änderungen fragt nach', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/mitarbeiter/2')
    await page.getByLabel('Mobil').fill('0171 555 12 12')
    await page.getByRole('tab', { name: 'Zugang' }).click()
    await expect(page.getByRole('dialog')).toContainText(/nicht gespeichert|Änderung/)
    await expect(page).toHaveURL(/\/mitarbeiter\/2$/)
  })

  test('Das eigene Konto lässt sich nicht deaktivieren und nicht löschen', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/mitarbeiter/1')
    await expect(page.getByLabel('Status')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Weitere Aktionen zum Mitarbeiter' })).toHaveCount(0)
  })

  test('Zeitkonto: geänderte Uhrzeit rechnet 5,5 Stunden, nicht 0', async ({ page }) => {
    await mockPilot(page)
    const patches = record(page, 'PATCH', /\/api\/v1\/buchungen\/\d+$/)
    await page.goto('/mitarbeiter/2?tab=zeitkonto')
    await page.getByRole('button', { name: /Buchungen anzeigen: 22\.09\.2026/ }).click()
    await page.getByRole('button', { name: /^Buchung .* bearbeiten$/ }).first().click()
    const dlg = page.getByRole('dialog', { name: 'Buchung bearbeiten' })
    await dlg.getByLabel('Ende').fill('13:30')
    await expect(dlg.getByLabel('Stunden')).toHaveValue('5,5')
    await dlg.getByRole('button', { name: 'Speichern' }).click()
    await expect(dlg).toBeHidden()
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toMatchObject({ TIME_FINISH: '13:30:00', QUANTITY_INT: 5.5, QUANTITY_EXT: 5.5 })
    expect(patches[0].body).not.toHaveProperty('POSTING_DESCRIPTION')
  })

  test('Zeitkonto: Löschen fragt nach, abgerechnete Buchungen sind gesperrt', async ({ page }) => {
    await mockPilot(page)
    const deletes = record(page, 'DELETE', /\/api\/v1\/buchungen\/\d+$/)
    await page.goto('/mitarbeiter/2?tab=zeitkonto')
    // Bis zum 7. sind die ersten Buchungen je Tag abgerechnet
    await page.getByRole('button', { name: /Buchungen anzeigen: 02\.09\.2026/ }).click()
    await expect(page.getByRole('button', { name: /^Buchung .* bearbeiten$/ })).toHaveCount(1)
    await page.getByRole('button', { name: /^Buchung .* bearbeiten$/ }).click()
    const dlg = page.getByRole('dialog', { name: 'Buchung bearbeiten' })
    await dlg.getByRole('button', { name: 'Löschen' }).click()
    const ask = page.getByRole('dialog', { name: 'Buchung löschen?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Abbrechen' }).click()
    expect(deletes).toHaveLength(0)
  })

  test('Neuer Mitarbeiter öffnet danach seine Seite', async ({ page }) => {
    await mockPilot(page)
    const posts = record(page, 'POST', /\/api\/v1\/mitarbeiter$/)
    const models = record(page, 'POST', /\/api\/v1\/mitarbeiter\/42\/work-models$/)
    await page.goto('/mitarbeiter')
    await page.getByRole('button', { name: /Neuer Mitarbeiter/ }).click()
    const dlg = page.getByRole('dialog', { name: 'Neuer Mitarbeiter' })
    await dlg.getByLabel('Kürzel *').fill('NE')
    await dlg.getByLabel('Vorname *').fill('Nina')
    await dlg.getByLabel('Nachname *').fill('Eck')
    await dlg.getByLabel('Geschlecht *').selectOption({ label: 'weiblich' })
    await dlg.getByLabel(/^Arbeitszeitmodell/).selectOption({ index: 1 })
    // „Gültig ab" folgt dem Eintritt (vorbelegt: heute)
    const entry = await dlg.getByLabel('Eintritt').inputValue()
    expect(entry).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await expect(dlg.getByLabel('Modell gültig ab')).toHaveValue(entry)
    await dlg.getByRole('button', { name: 'Anlegen' }).click()
    await expect(page).toHaveURL(/\/mitarbeiter\/42$/)
    expect(posts[0].body).toMatchObject({ abbr: 'NE', first_name: 'Nina', last_name: 'Eck', gender_id: 2 })
    expect(models[0].body).toMatchObject({ valid_from: entry })
  })

  test('Liste: Status direkt ändern schickt nur den Status', async ({ page }) => {
    await mockPilot(page)
    const patches = record(page, 'PATCH', /\/api\/v1\/mitarbeiter\/\d+$/)
    await page.goto('/mitarbeiter')
    await page.getByRole('combobox', { name: 'Status JW' }).selectOption('2')
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0].body).toEqual({ active: 2 })
  })

  test('Kein Treffer ist etwas anderes als keine Daten', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/mitarbeiter')
    await page.getByRole('searchbox', { name: 'Mitarbeiter suchen' }).fill('zzz')
    await expect(page.getByText('Kein Mitarbeiter passt zu Suche und Filter.')).toBeVisible()
    await page.getByRole('button', { name: 'Suche und Filter zurücksetzen' }).click()
    await expect(kernLink(page)).toBeVisible()
  })
})

test.describe('Mitarbeiter am Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  for (const path of ['/mitarbeiter', '/mitarbeiter/2', '/mitarbeiter/2?tab=zeitkonto', '/mitarbeiter/2?tab=kostensatz']) {
    test(`${path}: kein Querscrollen`, async ({ page }) => {
      await mockPilot(page)
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const w = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth))
      expect(w).toBeLessThanOrEqual(392)
    })
  }

  test('Liste als Karten, Tipp öffnet den Mitarbeiter', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/mitarbeiter')
    await page.getByRole('link', { name: /Thomas Kern/ }).click()
    await expect(page).toHaveURL(/\/mitarbeiter\/2$/)
  })
})
