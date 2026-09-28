import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Angebotsstruktur, Runde 3 — dasselbe Muster wie die Projektstruktur:
 * Spalte „Element" mit Auf-/Zuklappen, Speichern ueber die feste Leiste,
 * Rueckfrage bei offenen Aenderungen, am Handy Baumliste + Blatt.
 * Vorher speicherten Zuschlaege beim Schliessen des Panels, Angebots- und
 * Reiterwechsel verwarfen Offenes still, die Zeilenbefehle lagen nur hinter
 * dem Rechtsklick.
 */

async function open(page: Page, density?: 'compact' | 'comfortable') {
  await page.addInitScript(v => {
    localStorage.setItem('angebote-selected-oid', '1')
    if (v) localStorage.setItem('plain:filt:v2:1:ui.density', JSON.stringify(v))
  }, density ?? null)
  await mockPilot(page)
  await page.goto('/angebote')
  await page.getByRole('tab', { name: 'Angebotsstruktur' }).click()
}

function recordPuts(page: Page) {
  const puts: { url: string; body: Record<string, unknown> }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === 'PUT' && /\/angebote\/\d+(\/structure\/\d+)?(\?|$)/.test(r.url())) puts.push({ url: r.url(), body: r.postDataJSON() })
  })
  return puts
}

const abbr = (page: Page, v: string) => page.locator(`input[aria-label="Kürzel"][value="${v}"]`)

test.describe('Angebotsstruktur am Desktop', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Tabelle nur am Desktop')

  for (const d of ['comfortable', 'compact'] as const) {
    test(`Dichte ${d}: kein Querscrollen bei 1280 px, auch mit Stunden × Satz`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await open(page, d)
      await page.locator('.sx-table').waitFor()
      await expect(page.getByRole('textbox', { name: 'Stunden BL1' })).toBeVisible()
      const { table, box } = await page.evaluate(() => {
        const t = document.querySelector('.sx-table') as HTMLElement
        return { table: t.scrollWidth, box: (t.closest('.list-section') as HTMLElement).clientWidth }
      })
      expect(table).toBeLessThanOrEqual(box + 1)
      await expect(page.getByRole('columnheader', { name: /inkl\. Zuschl/ })).toHaveCount(d === 'compact' ? 1 : 0)
    })
  }

  test('Spalte „Element" mit Zuklappen, Gesamtzeile, keine Emoji-Symbole', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('columnheader', { name: /^Element/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Kürzel' })).toHaveCount(0)
    await expect(page.locator('.sx-root-row')).toContainText('Angebot gesamt')
    await expect(abbr(page, 'LP3')).toBeVisible()
    await page.getByRole('button', { name: 'LPH zuklappen' }).click()
    await expect(abbr(page, 'LP3')).toHaveCount(0)
    await expect(page.getByText('5 ausgeblendet')).toBeVisible()
    await page.getByRole('button', { name: 'LPH aufklappen' }).click()
    await expect(abbr(page, 'LP3')).toBeVisible()
    // ⋮⋮ und ✅ waren die alten Symbole
    await expect(page.locator('.sx-root')).not.toContainText('⋮⋮')
  })

  test('Aufwand-Zeile: Stunden × Satz, Honorar = Produkt', async ({ page }) => {
    await open(page)
    const hours = page.getByRole('textbox', { name: 'Stunden BL1' })
    await expect(hours).toHaveValue('24')
    await expect(page.getByRole('textbox', { name: 'Stundensatz BL1' })).toHaveValue('95,00')
    // Das Produkt steht in „Gesamt" (NK 0 %) und im Tooltip der Zelle
    const row = page.locator('tr[data-struct-id="211"]')
    await expect(row).toContainText('2.280,00')
    await expect(row.locator('.ox-hours')).toHaveAttribute('title', /= 2\.280,00/)
    await expect(row.locator('.ox-role')).toHaveText('PL')
    await hours.fill('30')
    await expect(row.locator('.ox-hours')).toHaveAttribute('title', /= 2\.850,00/)
  })

  test('Änderungen sammeln sich, Speichern schickt je Element genau einen PUT', async ({ page }) => {
    const puts = recordPuts(page)
    await open(page)
    const bar = page.locator('.action-bar')
    await expect(bar).toContainText('Alle Änderungen gespeichert')
    await page.locator('tr[data-struct-id="203"]').getByRole('textbox', { name: 'Honorar' }).fill('15000')
    await page.getByRole('textbox', { name: 'Stunden BL1' }).fill('30')
    // Zuschlag: geht in den Puffer, nicht mehr beim Schliessen
    await page.getByRole('button', { name: 'Zuschläge von LP4 bearbeiten' }).click()
    await page.getByRole('textbox', { name: 'Zuschlag 1 Bezeichnung' }).fill('Eilzuschlag')
    await page.getByRole('textbox', { name: 'Zuschlag 1 Prozent' }).fill('5')
    await page.getByRole('button', { name: 'Fertig' }).click()
    expect(puts).toHaveLength(0)
    await expect(bar).toContainText('3 Elemente geändert')

    await bar.getByRole('button', { name: /Speichern/ }).click()
    await expect(page.locator('.toast-message', { hasText: '3 Elemente gespeichert' })).toBeVisible()
    expect(puts).toHaveLength(3)
    const by = (id: number) => puts.find(p => p.url.includes(`/structure/${id}`))?.body
    expect(by(203)).toEqual({ revenue: 15000 })
    expect(by(211)).toEqual({ quantity: 30 })
    expect(by(205)).toMatchObject({ SURCHARGE_1_LABEL: 'Eilzuschlag', SURCHARGE_1_PCT: 5 })
  })

  test('Angebotszuschläge über das ⋯ der Gesamtzeile, gespeichert mit Strg+S', async ({ page }) => {
    const puts = recordPuts(page)
    await open(page)
    await page.getByRole('button', { name: 'Aktionen zum Angebot' }).click()
    await page.getByRole('menuitem', { name: 'Angebotszuschläge bearbeiten' }).click()
    const pct = page.getByRole('textbox', { name: 'Zuschlag 1 Prozent' })
    await expect(pct).toHaveValue('-3')
    await pct.fill('-5')
    await page.keyboard.press('Control+s')
    await expect(page.locator('.toast-message', { hasText: '1 Element gespeichert' })).toBeVisible()
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toMatch(/\/angebote\/1(\?|$)/)
    expect(puts[0].body).toMatchObject({ SURCHARGE_1_LABEL: 'Nachlass Rahmenvertrag', SURCHARGE_1_PCT: -5 })
  })

  test('Zeilenmenü trägt die Befehle, die vorher nur hinter dem Rechtsklick lagen', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Aktionen zu LP2' }).click()
    for (const name of ['Unterelement anlegen', 'Zuschläge bearbeiten', 'Kalkulation anlegen', 'Element löschen']) {
      await expect(page.getByRole('menuitem', { name })).toBeVisible()
    }
  })

  test('Unterelement unter einem Blatt übernimmt dessen Honorar', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Aktionen zu LP2' }).click()
    await page.getByRole('menuitem', { name: 'Unterelement anlegen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Neues Element anlegen' })
    await expect(dialog).toContainText('unter LP2')
    await expect(dialog.getByLabel('Honorar €')).toHaveValue('14.525,70')
    await expect(dialog).toContainText('hat bisher ein eigenes Honorar')
    // Aufwand: Rolle belegt den Satz vor
    await dialog.getByLabel('Abrechnungsart*').selectOption('2')
    await dialog.getByLabel('Rolle').selectOption('3')
    await expect(dialog.getByLabel('Satz €/h')).toHaveValue('78,50')
    await dialog.getByLabel('Stunden').fill('10')
    await expect(dialog.locator('#ox-add-fee')).toContainText('785,00')
    // Abbrechen links, Anlegen rechts
    const footer = dialog.locator('.modal-actions').last()
    const [first, last] = [footer.getByRole('button').first(), footer.getByRole('button').last()]
    await expect(first).toHaveText('Abbrechen')
    await expect(last).toHaveText('Anlegen')
  })

  test('Wechsel des übergeordneten Elements im Dialog behält Eingetipptes', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: /Neues Element/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Neues Element anlegen' })
    await dialog.getByLabel('Kürzel*').fill('BL4')
    await dialog.getByLabel('Abrechnungsart*').selectOption('2')
    await dialog.getByLabel('Rolle').selectOption('2')
    await dialog.getByLabel('Stunden').fill('8')
    await dialog.getByLabel('Übergeordnetes Element').selectOption('210')
    await expect(dialog).toContainText('unter BL')
    await expect(dialog.getByLabel('Stunden')).toHaveValue('8')
    await expect(dialog.getByLabel('Rolle')).toHaveValue('2')
    await expect(dialog.locator('#ox-add-fee')).toContainText('760,00')
  })

  test('Angebots- und Reiterwechsel fragen bei offenen Änderungen nach', async ({ page }) => {
    await open(page)
    await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Geändert')
    await page.getByRole('tab', { name: 'Angebotsliste' }).click()
    const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Angebotsstruktur')
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1)).toHaveValue('Geändert')

    await page.getByRole('combobox', { name: 'Angebot' }).click()
    await page.getByRole('option', { name: /A-2025-016/ }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByRole('combobox', { name: 'Angebot' })).toHaveValue(/A-2025-014/)

    await page.getByRole('navigation').getByRole('link', { name: 'Adressen' }).first().click()
    await dialog.getByRole('button', { name: 'Verwerfen' }).click()
    await expect(page).toHaveURL(/\/adressen/)
  })
})

test.describe('Angebotsstruktur am Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'nur schmale Viewports')

  test('Baumliste ohne Querscrollen, Blatt speichert Stunden eines Aufwand-Elements', async ({ page }) => {
    const puts = recordPuts(page)
    await open(page)
    const list = page.getByRole('list', { name: 'Elemente der Angebotsstruktur' })
    await expect(list).toBeVisible()
    await expect(page.locator('.sx-table')).toHaveCount(0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)

    await list.getByRole('button', { name: /^BL1 Bestandsaufnahme/ }).click()
    const sheet = page.getByRole('dialog', { name: /BL1 · Bestandsaufnahme/ })
    await expect(sheet.getByRole('button', { name: 'Speichern' })).toBeDisabled()
    await sheet.locator('#oxm-hours').fill('30')
    await expect(sheet.locator('#oxm-fee')).toContainText('2.850,00')
    await sheet.getByRole('button', { name: 'Speichern' }).click()
    await expect(sheet).toBeHidden()
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toMatch(/structure\/211/)
    expect(puts[0].body).toEqual({ quantity: 30 })
  })

  test('Zuklappen in der Liste, Ziele mindestens 44 px', async ({ page }) => {
    await open(page)
    const list = page.getByRole('list', { name: 'Elemente der Angebotsstruktur' })
    await list.getByRole('button', { name: 'LPH zuklappen' }).click()
    await expect(list.getByRole('button', { name: /^LP3 / })).toHaveCount(0)
    for (const b of await list.getByRole('button').all()) {
      const box = await b.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })
})

test.describe('Angebotsstruktur: Löschen', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Zeilenmenü am Desktop')

  test('ein Vater lässt sich erst ohne Unterelemente löschen (wie im Backend)', async ({ page }) => {
    const deletes: string[] = []
    page.on('request', r => { if (r.method() === 'DELETE') deletes.push(r.url()) })
    await open(page)
    await page.getByRole('button', { name: 'Aktionen zu LPH' }).click()
    await expect(page.getByRole('menuitem', { name: 'Löschen (erst Unterelemente)' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Aktionen zu LP1' }).click()
    await page.getByRole('menuitem', { name: 'Element löschen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Element löschen' })
    await expect(dialog).toContainText('Element „LP1" löschen?')
    await dialog.getByRole('button', { name: 'Löschen' }).click()
    await expect.poll(() => deletes.length).toBe(1)
    expect(deletes[0]).toMatch(/angebote\/1\/structure\/202/)
  })
})
