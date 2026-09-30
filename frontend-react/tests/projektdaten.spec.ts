import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Reiter „Projektdaten" (UI-Pilot Runde 8). Vorher: ein Dialog in der
 * Projektliste, Felder ohne verknüpfte Beschriftung, ein leerer Name ging
 * ungeprüft an den Server, und wer im Projekt arbeitete, musste zum Ändern
 * erst zurück in die Liste.
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

const URL_DATEN = '/projekte?projectId=1&tab=daten'

test.describe('Projektdaten', () => {
  test('Stift in der Liste öffnet den Reiter, Felder sind beschriftet', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte')
    await page.getByRole('button', { name: 'Projektdaten P-2024-001 bearbeiten' }).click()
    await expect(page).toHaveURL(/projectId=1&tab=daten/)
    if ((page.viewportSize()?.width ?? 1280) > 640) {
      await expect(page.getByRole('tab', { name: 'Projektdaten', selected: true })).toBeVisible()
    } else {
      await expect(page.getByLabel('Weitere Bereiche des Projekts')).toHaveValue('daten')
    }
    await expect(page.getByLabel('Projektname*')).toHaveValue('Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1')
    await expect(page.getByLabel('Projektnummer*')).toHaveValue('P-2024-001')
    await expect(page.getByLabel('Status*')).toHaveValue('2')   // Laufend, wie im Kopf
    await expect(page.getByRole('combobox', { name: 'Adresse' })).toHaveValue('Stadt Ravensburg')
    // Herkunft: Link zum Angebot, aus dem das Projekt entstand
    await expect(page.getByRole('link', { name: /A-2025-014/ })).toHaveAttribute('href', /\/angebote\?offerId=1/)
    await expect(page.getByText('12.03.2024')).toBeVisible()
  })

  test('Speichern schickt nur das Projekt, Pflichtfelder werden benannt', async ({ page }) => {
    const patches = record(page, 'PATCH', /\/projekte\/1(\?|$)/)
    await mockPilot(page)
    await page.goto(URL_DATEN)
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await page.getByLabel('Projektname*').fill('')
    await expect(bar).toContainText('1 Feld geändert')
    await bar.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Bitte noch angeben: Projektname.')).toBeVisible()
    await expect(page.getByLabel('Projektname*')).toHaveAttribute('aria-invalid', 'true')
    expect(patches).toHaveLength(0)

    await page.getByLabel('Projektname*').fill('Neubau Kita Sonnenblume')
    await page.getByLabel('Abteilung').selectOption({ label: 'Tiefbau' })
    await expect(bar).toContainText('2 Felder geändert')
    await bar.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Projektdaten gespeichert.')).toBeVisible()
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toMatchObject({ name: 'Neubau Kita Sonnenblume', department_id: 2, abbr: 'P-2024-001', is_internal: false })
  })

  test('neuer Auftraggeber: Rückfrage übernimmt ihn in den Vertrag', async ({ page }) => {
    const contract = record(page, 'PATCH', /\/projekte\/contract\/11(\?|$)/)
    await mockPilot(page)
    await page.goto(URL_DATEN)
    const box = page.getByRole('combobox', { name: 'Adresse' })
    await box.fill('Stadtw')
    await page.getByRole('option', { name: 'Stadtwerke Ravensburg GmbH' }).click()
    await page.getByLabel('Ansprechpartner').selectOption({ label: 'Rainer Vogt' })
    await page.getByRole('region', { name: 'Seitenaktionen' }).getByRole('button', { name: 'Speichern' }).click()
    const ask = page.getByRole('dialog', { name: 'Auch im Vertrag übernehmen?' })
    await expect(ask).toContainText('„Stadt Musterstadt – Hochbauamt"')
    await ask.getByRole('button', { name: 'Im Vertrag übernehmen' }).click()
    await expect(page.getByText('Der Vertrag geht jetzt an denselben Empfänger.')).toBeVisible()
    expect(contract[0].body).toEqual({ INVOICE_ADDRESS_ID: 2, INVOICE_CONTACT_ID: 2 })
  })

  test('intern: Rückfrage gibt es an die Elemente weiter', async ({ page }) => {
    const cascade = record(page, 'PATCH', /\/projekte\/1\/internal-cascade/)
    await mockPilot(page)
    await page.goto(URL_DATEN)
    await page.getByLabel('Internes Projekt').check()
    await page.getByRole('region', { name: 'Seitenaktionen' }).getByRole('button', { name: 'Speichern' }).click()
    const ask = page.getByRole('dialog', { name: 'Elemente als intern markieren?' })
    await ask.getByRole('button', { name: 'Elemente anpassen' }).click()
    await expect(page.getByText('Die Elemente der Struktur sind angepasst.')).toBeVisible()
    expect(cascade[0].body).toEqual({ is_internal: true })
  })

  test('offene Änderung: Reiterwechsel fragt nach', async ({ page }) => {
    await mockPilot(page)
    await page.goto(URL_DATEN)
    await page.getByLabel('Projektnummer*').fill('P-2024-001a')
    await page.getByRole('tab', { name: 'Struktur' }).click()
    const guard = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page).toHaveURL(/tab=daten/)
    await expect(page.getByLabel('Projektnummer*')).toHaveValue('P-2024-001a')
  })

  test('nur lesen: Felder gesperrt, keine Aktionsleiste, kein Stift', async ({ page }) => {
    await mockPilot(page, { permissions: ['projects.view', 'projects.structure.view'] })
    await page.goto(URL_DATEN)
    await expect(page.getByText('Nur Lesen', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Projektname*')).toBeDisabled()
    await expect(page.getByRole('region', { name: 'Seitenaktionen' })).toHaveCount(0)
    await page.goto('/projekte')
    await expect(page.getByRole('button', { name: /Projektdaten .* bearbeiten/ })).toHaveCount(0)
  })
})

test.describe('Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) > 640, 'Handy')
  test('kein Querscrollen, Reiter über „Mehr" erreichbar', async ({ page }) => {
    await mockPilot(page)
    await page.goto(URL_DATEN)
    await expect(page.getByLabel('Projektname*')).toBeVisible()
    await expect(page.getByLabel('Weitere Bereiche des Projekts')).toHaveValue('daten')
    await page.waitForLoadState('networkidle')
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(w).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 2)
  })
})
