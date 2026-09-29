import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot, mockEinstellungen } from './fixtures/pilotData'

/**
 * Einstellungen: Vorbelegungen und Stammdaten (UI-Pilot Runde 12).
 *
 * Vorher: 28 PUT-Aufrufe je Speichern (auch für Unverändertes), Zahlenfelder
 * ohne Komma, ein Reiterwechsel verwarf Eingaben ohne Rückfrage, der Reiter
 * stand nicht in der URL, und Abteilungen, Typen, Rollen und Arbeitszeitmodelle
 * ließen sich per „×" ohne Rückfrage löschen.
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> | null }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

async function setup(page: Page) {
  await mockPilot(page)
  await mockEinstellungen(page)
}

test.describe('Vorbelegungen', () => {
  test('Speichern schickt nur geänderte Felder in einer Anfrage, Komma geht', async ({ page }) => {
    await setup(page)
    const puts = record(page, 'PUT', /\/api\/v1\/stammdaten\/defaults$/)
    await page.goto('/admin?tab=vorbelegungen')
    await page.getByLabel('Skonto (%)').fill('2,5')
    await page.getByLabel('Zahlungsziel (Kalendertage)').fill('21')
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await expect(bar).toContainText('2 Felder geändert')
    await bar.getByRole('button', { name: 'Speichern' }).click()
    // Am Handy verschwindet die ruhige Aktionsleiste — die Bestätigung bleibt
    await expect(page.getByRole('status').filter({ hasText: 'Vorbelegungen gespeichert.' })).toHaveCount(1)
    expect(puts).toHaveLength(1)
    expect(puts[0].body).toEqual({ values: { default_cash_discount_percent: '2,5', default_payment_term_days: '21' } })
    // Nach dem Neuladen steht der gespeicherte Wert mit Komma da
    await page.reload()
    await expect(page.getByLabel('Skonto (%)')).toHaveValue('2,5')
  })

  test('Leeren entfernt die Vorbelegung, Schalter speichern nur „aus"', async ({ page }) => {
    await setup(page)
    const puts = record(page, 'PUT', /\/api\/v1\/stammdaten\/defaults$/)
    await page.goto('/admin?tab=vorbelegungen')
    await page.getByLabel(/Gültigkeitsdauer/).fill('')
    await page.getByLabel('Stempeluhr in der Kopfzeile').uncheck()
    await page.getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0].body).toEqual({ values: { offer_valid_days: null, timer_enabled: 'false' } })
  })

  test('Sicherheitseinbehalt: Unterfelder erst nach dem Einschalten', async ({ page }) => {
    await setup(page)
    await page.goto('/admin?tab=vorbelegungen')
    await expect(page.getByLabel('Sicherheitseinbehalt (%)')).toHaveCount(0)
    await page.getByLabel('Sicherheitseinbehalt vereinbart').check()
    await expect(page.getByLabel('Sicherheitseinbehalt (%)')).toBeVisible()
    await expect(page.getByLabel('Basis')).toHaveValue('BRUTTO')
  })

  test('Reiterwechsel mit offenen Änderungen fragt nach', async ({ page }) => {
    await setup(page)
    await page.goto('/admin?tab=vorbelegungen')
    await page.getByLabel('Skonto (%)').fill('3')
    await page.getByRole('tab', { name: 'Stammdaten' }).click()
    const dlg = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dlg).toContainText('1 Änderung in „Vorbelegungen"')
    await dlg.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page).toHaveURL(/tab=vorbelegungen/)
    await expect(page.getByLabel('Skonto (%)')).toHaveValue('3')
    await page.getByRole('tab', { name: 'Stammdaten' }).click()
    await dlg.getByRole('button', { name: 'Verwerfen' }).click()
    await expect(page).toHaveURL(/tab=stammdaten/)
  })

  test('Serverfehler bleibt stehen, die Eingabe auch', async ({ page }) => {
    await setup(page)
    await page.route(/\/api\/v1\/stammdaten\/defaults(\?|$)/, route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Skonto (%): bitte eine Zahl von 0 bis 100.' }) })
      : route.fallback())
    await page.goto('/admin?tab=vorbelegungen')
    await page.getByLabel('Skonto (%)').fill('150')
    await page.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Skonto (%): bitte eine Zahl von 0 bis 100.')).toBeVisible()
    await expect(page.getByLabel('Skonto (%)')).toHaveValue('150')
  })
})

test.describe('Stammdaten', () => {
  test('Unterreiter stehen in der URL und überleben das Neuladen', async ({ page }, info) => {
    await setup(page)
    await page.goto('/admin?tab=stammdaten')
    if (/mobile/i.test(info.project.name)) {
      // Am Handy eine Auswahl statt acht Knöpfen in vier Zeilen
      await expect(page.getByLabel('Bereich')).toHaveValue('abteilungen')
      await page.getByLabel('Bereich').selectOption('projektrollen')
    } else {
      await expect(page.getByRole('button', { name: 'Abteilungen' })).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: 'Projektrollen' }).click()
    }
    await expect(page).toHaveURL(/tab=stammdaten&sub=projektrollen/)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Rolle PL bearbeiten' })).toBeVisible()
  })

  test('Abteilung löschen fragt nach und zeigt, wo sie noch hängt', async ({ page }) => {
    await setup(page)
    const dels = record(page, 'DELETE', /\/api\/v1\/stammdaten\/department\/\d+$/)
    await page.goto('/admin?tab=stammdaten&sub=abteilungen')
    await page.getByRole('button', { name: 'Abteilung Hochbau löschen' }).click()
    const dlg = page.getByRole('dialog', { name: 'Abteilung löschen?' })
    await dlg.getByRole('button', { name: 'Abbrechen' }).click()
    expect(dels).toHaveLength(0)
    await page.getByRole('button', { name: 'Abteilung Hochbau löschen' }).click()
    await dlg.getByRole('button', { name: 'Löschen' }).click()
    await expect(page.getByText('wird noch in 5 Mitarbeiter:innen und 12 Projekten verwendet')).toBeVisible()
    expect(dels).toHaveLength(1)
  })

  test('Abteilung umbenennen und anlegen, Dublette wird abgefangen', async ({ page }) => {
    await setup(page)
    const patches = record(page, 'PATCH', /\/api\/v1\/stammdaten\/department\/\d+$/)
    const posts = record(page, 'POST', /\/api\/v1\/stammdaten\/department$/)
    await page.goto('/admin?tab=stammdaten&sub=abteilungen')
    await page.getByRole('button', { name: 'Abteilung Tiefbau umbenennen' }).click()
    await page.getByLabel('Neuer Name für Tiefbau').fill('Ingenieurbau')
    await page.getByLabel('Neuer Name für Tiefbau').press('Enter')
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0].body).toEqual({ abbr: 'Ingenieurbau' })
    await page.getByLabel('Neue Abteilung').fill('hochbau')
    await page.getByRole('button', { name: 'Hinzufügen' }).click()
    await expect(page.getByText('Abteilung „hochbau“ gibt es schon.')).toBeVisible()
    expect(posts).toHaveLength(0)
    await page.getByLabel('Neue Abteilung').fill('Landschaft')
    await page.getByLabel('Neue Abteilung').press('Enter')
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0].body).toEqual({ abbr: 'Landschaft' })
  })

  test('Rolle bearbeiten: Stundensatz mit Komma, Anzeige als Betrag', async ({ page }) => {
    await setup(page)
    const patches = record(page, 'PATCH', /\/api\/v1\/stammdaten\/rolle\/\d+$/)
    await page.goto('/admin?tab=stammdaten&sub=projektrollen')
    await expect(page.locator('tr, li').filter({ hasText: 'Projektleitung' }).first()).toContainText('€/h')
    await page.getByRole('button', { name: 'Rolle PL bearbeiten' }).click()
    const dlg = page.getByRole('dialog', { name: 'Rolle PL bearbeiten' })
    await dlg.getByLabel('Stundensatz (€/h)').fill('112,50')
    await dlg.getByRole('button', { name: 'Speichern' }).click()
    await expect(dlg).toBeHidden()
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toMatchObject({ abbr: 'PL', hourly_rate: '112,50' })
  })

  test('Rollendialog: Schließen mit Eingaben fragt nach', async ({ page }) => {
    await setup(page)
    await page.goto('/admin?tab=stammdaten&sub=projektrollen')
    await page.getByRole('button', { name: 'Neue Rolle' }).click()
    const dlg = page.getByRole('dialog', { name: 'Neue Rolle' })
    await dlg.getByLabel('Kürzel*').fill('BL')
    await dlg.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByRole('dialog', { name: 'Eingaben verwerfen?' })).toBeVisible()
  })

  test('Abwesenheitsart: Wirkung mit Erklärung, Verfall über die Aktionsleiste', async ({ page }) => {
    await setup(page)
    const puts = record(page, 'PUT', /\/api\/v1\/abwesenheit\/settings$/)
    await page.goto('/admin?tab=stammdaten&sub=abwesenheitsarten')
    await page.getByRole('button', { name: 'Urlaub bearbeiten' }).click()
    const dlg = page.getByRole('dialog', { name: 'Urlaub bearbeiten' })
    await expect(dlg.getByLabel('Zehrt vom Urlaub')).toBeChecked()
    await expect(dlg.getByText('Die Arbeitstage gehen vom Urlaubsanspruch ab')).toBeVisible()
    await dlg.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(dlg).toBeHidden()

    await page.getByLabel('Monat', { exact: true }).selectOption('06')
    await page.getByLabel('Tag', { exact: true }).selectOption('30')
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await expect(bar).toContainText('Verfall geändert')
    await bar.getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0].body).toEqual({ carryoverExpires: true, carryoverExpiryDate: '06-30' })
  })

  test('Arbeitszeitmodell: Stunden mit Komma, Löschen eines zugeordneten scheitert sichtbar', async ({ page }) => {
    await setup(page)
    const patches = record(page, 'PATCH', /\/api\/v1\/stammdaten\/working-time-models\/\d+$/)
    await page.goto('/admin?tab=stammdaten&sub=arbeitszeitmodelle')
    await page.getByRole('button', { name: 'Teilzeit 30 h bearbeiten' }).click()
    const dlg = page.getByRole('dialog', { name: 'Teilzeit 30 h bearbeiten' })
    await dlg.getByLabel('Freitag, Stunden').fill('4,5')
    await expect(dlg).toContainText('28,5 h/Woche')
    await dlg.getByRole('button', { name: 'Speichern' }).click()
    await expect(dlg).toBeHidden()
    expect(patches[0].body).toMatchObject({ fri: 4.5, mon: 6, country_code: 'DE', state_code: 'BW' })

    await page.getByRole('button', { name: 'Vollzeit 40 h löschen' }).click()
    await page.getByRole('dialog', { name: 'Arbeitszeitmodell löschen?' }).getByRole('button', { name: 'Löschen' }).click()
    await expect(page.getByText('wird noch von 6 Mitarbeiter:innen verwendet')).toBeVisible()
  })

  test('Ohne Bearbeitungsrecht: lesen ja, ändern nein', async ({ page }) => {
    await mockPilot(page, { permissions: ['settings.basedata.view'] })
    await mockEinstellungen(page)
    await page.goto('/admin?tab=stammdaten&sub=projektrollen')
    await expect(page.getByText('Projektleitung').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Neue Rolle' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rolle PL bearbeiten' })).toHaveCount(0)
    await expect(page.getByText('Nur Lesen')).toBeVisible()
  })
})

test.describe('Einstellungen am Handy', () => {
  for (const url of ['/admin?tab=vorbelegungen', '/admin?tab=stammdaten&sub=projektrollen', '/admin?tab=stammdaten&sub=abwesenheitsarten', '/admin?tab=stammdaten&sub=arbeitszeitmodelle']) {
    test(`kein Querscrollen: ${url}`, async ({ page }, info) => {
      test.skip(!/mobile/i.test(info.project.name), 'nur am Handy')
      await setup(page)
      await page.goto(url)
      await page.locator('.st-page, .ws-form').first().waitFor()
      await page.waitForLoadState('networkidle')
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      const vw = page.viewportSize()!.width
      expect(w).toBeLessThanOrEqual(vw + 2)
    })
  }
})
