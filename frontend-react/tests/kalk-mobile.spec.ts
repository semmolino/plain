import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Kalkulation am Handy (UI-Pilot Runde 8). Vorher stand dort dieselbe
 * Tabelle wie am Desktop — sieben bis acht Spalten mit Eingabefeldern,
 * seitwärts zu schieben. Jetzt eine Liste, ein Tipp öffnet die Zeile als
 * Blatt; gespeichert wird wie am Desktop mit „Weiter".
 */

function record(page: Page, re: RegExp) {
  const out: Record<string, unknown>[] = []
  page.on('request', (r: Request) => { if (r.method() === 'POST' && re.test(r.url())) out.push(r.postDataJSON()) })
  return out
}

async function openStep(page: Page, steps: number) {
  await page.goto('/projekte?projectId=1&tab=honorar')
  await page.getByRole('button', { name: 'Gebäude und Innenräume bearbeiten' }).first().click()
  const wizard = page.locator('.hw-root')
  await expect(wizard.getByRole('heading', { name: /Grundlagen/ })).toBeVisible()
  for (let i = 0; i < steps; i++) {
    await wizard.getByRole('button', { name: 'Weiter', exact: true }).click()
  }
  return wizard
}

async function noSideScroll(page: Page) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(w).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 2)
}

test.describe('Kalkulation am Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) > 640, 'Handy')

  test('Leistungsphase im Blatt ändern, Weiter speichert', async ({ page }) => {
    const saves = record(page, /phases\/save/)
    await mockPilot(page)
    const wizard = await openStep(page, 1)
    const list = page.getByRole('list', { name: 'Leistungsphasen' })
    await expect(list.getByRole('listitem')).toHaveCount(9)
    await expect(wizard.locator('table')).toHaveCount(0)
    await noSideScroll(page)

    await list.getByRole('button', { name: /LPH 5: Ausführungsplanung/ }).click()
    const sheet = page.getByRole('dialog', { name: 'LPH 5: Ausführungsplanung' })
    await sheet.getByLabel('Honorar %').fill('30')
    await expect(sheet).toContainText('78.725,52 €')
    await sheet.getByRole('button', { name: 'Übernehmen' }).click()
    await expect(sheet).toBeHidden()
    await expect(list.getByRole('button', { name: /LPH 5/ })).toContainText('K0 · 30 %')
    await expect(list.getByRole('button', { name: /LPH 5/ })).toContainText('78.725,52 €')

    // Abbrechen verwirft nur das Blatt
    await list.getByRole('button', { name: /LPH 6/ }).click()
    const s6 = page.getByRole('dialog', { name: /LPH 6/ })
    await s6.getByLabel('Honorar %').fill('50')
    await s6.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(list.getByRole('button', { name: /LPH 6/ })).toContainText('K0 · 10 %')

    await wizard.getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(wizard.getByRole('heading', { name: /Besondere Leistungen/ })).toBeVisible()
    const rows = (saves[0]?.rows ?? []) as { ID: number; FEE_PERCENT: number }[]
    expect(rows.find(r => r.ID === 7105)?.FEE_PERCENT).toBe(30)
    expect(rows.find(r => r.ID === 7106)?.FEE_PERCENT).toBe(10)
  })

  test('Besondere Leistung: Bezeichnung ist Pflicht, Hinzufügen und Entfernen', async ({ page }) => {
    const saves = record(page, /bl\/save/)
    await mockPilot(page)
    const wizard = await openStep(page, 2)
    const list = page.getByRole('list', { name: 'Besondere Leistungen' })
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(list).toContainText('24.800,00 €')

    await wizard.getByRole('button', { name: 'Besondere Leistung hinzufügen' }).click()
    const sheet = page.getByRole('dialog', { name: 'Besondere Leistung hinzufügen' })
    await sheet.getByRole('button', { name: 'Hinzufügen' }).click()
    await expect(sheet).toContainText('Bitte eine Bezeichnung angeben.')
    await sheet.getByLabel('Kürzel').fill('BL2')
    await sheet.getByLabel('Bezeichnung*').fill('Bestandsaufnahme')
    await sheet.getByLabel('Berechnungsart').selectOption('pct_grundhonorar')
    await sheet.getByLabel('Prozent').fill('2')
    await expect(sheet).toContainText('5.248,37 €')
    await sheet.getByRole('button', { name: 'Hinzufügen' }).click()
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(list.getByRole('button', { name: /BL2 · Bestandsaufnahme/ })).toContainText('2 % auf Grundhonorar')
    await noSideScroll(page)

    await list.getByRole('button', { name: /BL1/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Besondere Leistung entfernen' }).click()
    await expect(list.getByRole('listitem')).toHaveCount(1)

    await wizard.getByRole('button', { name: 'Weiter', exact: true }).click()
    await expect(wizard.getByRole('heading', { name: /Zuschläge/ })).toBeVisible()
    expect((saves[0]?.rows as { NAME: string; AMOUNT_TYPE: string; PERCENT: number }[])).toEqual([
      expect.objectContaining({ NAME: 'Bestandsaufnahme', AMOUNT_TYPE: 'pct_grundhonorar', PERCENT: 2 }),
    ])
  })

  test('Zuschlag: Phasen im Blatt wählen, Betrag rechnet mit', async ({ page }) => {
    const saves = record(page, /surcharges\/save/)
    await mockPilot(page)
    const wizard = await openStep(page, 3)
    const list = page.getByRole('list', { name: 'Zuschläge und Nachlässe' })
    await expect(list.getByRole('button', { name: /Umbauzuschlag/ })).toContainText('20 % · parallel · alle Phasen')
    await noSideScroll(page)

    await list.getByRole('button', { name: /Umbauzuschlag/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Umbauzuschlag' })
    await sheet.getByRole('checkbox', { name: 'LPH 8: Objektüberwachung' }).uncheck()
    await sheet.getByRole('checkbox', { name: 'LPH 9: Objektbetreuung' }).uncheck()
    // 20 % auf (262.418,41 − 83.973,89 − 5.248,37)
    await expect(sheet).toContainText('34.639,23 €')
    await sheet.getByRole('button', { name: 'Kumulativ' }).click()
    await sheet.getByRole('button', { name: 'Übernehmen' }).click()
    await expect(list.getByRole('button', { name: /Umbauzuschlag/ })).toContainText('kumulativ · 7 von 9 Phasen')

    await wizard.getByRole('button', { name: 'Weiter', exact: true }).click()
    const row = (saves[0]?.rows as { LPH_FILTER: string; CALC_MODE: string }[])[0]
    expect(row.CALC_MODE).toBe('cumulative')
    expect(JSON.parse(row.LPH_FILTER)).toHaveLength(7)
  })
})

test.describe('Kalkulation am Desktop', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 640, 'Desktop')
  test('bleibt eine Tabelle', async ({ page }) => {
    await mockPilot(page)
    const wizard = await openStep(page, 1)
    await expect(wizard.locator('table')).toHaveCount(1)
    await expect(page.getByRole('list', { name: 'Leistungsphasen' })).toHaveCount(0)
  })
})
