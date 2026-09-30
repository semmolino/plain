import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot, addressDetail } from './fixtures/pilotData'

/**
 * Adressen und Kontakte (UI-Pilot Runde 8). Vorher: bearbeitet wurde in
 * Dialogen ohne Rückfrage beim Schließen und ohne Hinweis, welche
 * Pflichtangabe fehlte; der Bearbeiten-Dialog ging auch ohne Recht auf
 * („Zuletzt verwendet"); die Verknüpfungen waren nackte Nummern.
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

const desktop = (page: Page) => (page.viewportSize()?.width ?? 1280) > 640

test.describe('Adressliste', () => {
  test('Name und Stift führen auf die Adressseite, Reiter in der URL', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/adressen')
    await page.getByRole('link', { name: 'Wohnbau Süd GmbH' }).click()
    await expect(page).toHaveURL(/\/adressen\/2$/)
    await page.goto('/adressen')
    await page.getByRole('button', { name: 'Wohnbau Süd GmbH bearbeiten' }).click()
    await expect(page).toHaveURL(/\/adressen\/2\?tab=daten$/)
    await page.goto('/adressen')
    await page.getByRole('tab', { name: 'Kontakte' }).click()
    await expect(page).toHaveURL(/\/adressen\?tab=kontakte$/)
    await expect(page.getByRole('link', { name: 'Wohnbau Süd GmbH' }).first()).toBeVisible()
  })

  test('alter Einstieg mit openAddressId öffnet die Adressseite', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte')
    await page.evaluate(() => {
      window.history.pushState({ usr: { openAddressId: 2 }, key: 'x', idx: 1 }, '', '/adressen')
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    })
    await expect(page).toHaveURL(/\/adressen\/2$/)
  })

  test('Neu: gleicher Name fragt nach, danach öffnet die neue Adresse', async ({ page }) => {
    const posts = record(page, 'POST', /\/stammdaten\/address(\?|$)/)
    await mockPilot(page)
    await page.goto('/adressen')
    await page.getByRole('button', { name: 'Neu', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Neue Adresse' })
    await dialog.getByRole('button', { name: 'Anlegen' }).click()
    await expect(dialog).toContainText('Bitte noch angeben: Name 1')
    await dialog.getByLabel('Name 1*').fill('Stadtwerke Ravensburg GmbH')
    await dialog.getByLabel('Land*').selectOption({ label: 'Deutschland' })
    await dialog.getByRole('button', { name: 'Anlegen' }).click()
    const ask = page.getByRole('dialog', { name: 'Diese Adresse gibt es schon' })
    await expect(ask).toContainText('„Stadtwerke Ravensburg GmbH" steht bereits im Adressbuch')
    await ask.getByRole('button', { name: 'Trotzdem anlegen' }).click()
    await expect(page).toHaveURL(/\/adressen\/42$/)
    expect(posts[0].body).toMatchObject({ address_name_1: 'Stadtwerke Ravensburg GmbH', country_id: 'DE' })
  })

  test('Anlegen abbrechen mit Eingaben fragt nach', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/adressen')
    await page.getByRole('button', { name: 'Neu', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Neue Adresse' })
    await dialog.getByLabel('Name 1*').fill('Neue GmbH')
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByRole('dialog', { name: 'Eingaben verwerfen?' })).toBeVisible()
  })
})

test.describe('Adressseite', () => {
  test('Kopf mit Anschrift und Kontaktwegen, Reiter mit Zahlen', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/adressen/2')
    await expect(page.getByRole('heading', { level: 1, name: 'Wohnbau Süd GmbH' })).toBeVisible()
    await expect(page.getByRole('link', { name: '0751 12345-1' })).toHaveAttribute('href', 'tel:0751 12345-1')
    await expect(page.getByRole('tab', { name: 'Kontakte (3)' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Verwendet in (7)' })).toBeVisible()
    // Hauptansprechpartner steht oben
    const first = desktop(page) ? page.locator('tbody tr').first() : page.locator('.ad-card').first()
    await expect(first).toContainText('Julia Neumann')
    await expect(first).toContainText('Hauptansprechpartner')
  })

  test('Verwendet in: Links führen an die richtige Stelle', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/adressen/2?tab=verwendung')
    await expect(page.getByRole('link', { name: /P-2024-002/ })).toHaveAttribute('href', '/projekte?projectId=2&tab=struktur')
    await expect(page.getByRole('link', { name: /V-2024-002/ })).toHaveAttribute('href', '/projekte?projectId=2&tab=vertraege')
    await expect(page.getByRole('link', { name: /N-003/ })).toHaveAttribute('href', '/nachtraege/403')
    await expect(page.getByRole('region', { name: /Rechnungen/ })).toContainText('08.07.2026')
  })

  test('Adressdaten: Pflichtfeld benannt, Speichern schickt die Adresse', async ({ page }) => {
    const patches = record(page, 'PATCH', /\/stammdaten\/addresses\/2(\?|$)/)
    await mockPilot(page)
    await page.goto('/adressen/2?tab=daten')
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await page.getByLabel('Name 1*').fill('  ')
    await bar.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Bitte noch angeben: Name 1.')).toBeVisible()
    await expect(page.getByLabel('Name 1*')).toHaveAttribute('aria-invalid', 'true')
    expect(patches).toHaveLength(0)

    await page.getByLabel('Name 1*').fill('Wohnbau Süd GmbH & Co. KG')
    await page.getByLabel('Website').fill('www.wohnbau-sued.de')
    await expect(bar).toContainText('2 Felder geändert')
    await bar.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Adresse gespeichert.', { exact: false })).toBeVisible()
    expect(patches[0].body).toMatchObject({ address_name_1: 'Wohnbau Süd GmbH & Co. KG', website: 'www.wohnbau-sued.de', country_id: 'DE' })
  })

  test('Adressdaten: Reiterwechsel mit offener Änderung fragt nach', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/adressen/2?tab=daten')
    await page.getByLabel('Ort').fill('Tettnang')
    await page.getByRole('tab', { name: /Kontakte/ }).click()
    const guard = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page).toHaveURL(/tab=daten/)
    await expect(page.getByLabel('Ort')).toHaveValue('Tettnang')
  })

  test('gespeicherter Peppol-Code außerhalb der Liste bleibt erhalten', async ({ page }) => {
    await mockPilot(page)
    await page.route(/\/api\/v1\/stammdaten\/addresses\/2(\?|$)/, r => {
      const d = addressDetail(2)
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { ...d, address: { ...d.address, PEPPOL_SCHEME_ID: '0060' } } }) })
    })
    await page.goto('/adressen/2?tab=daten')
    await expect(page.getByLabel('Peppol Scheme-ID (EAS)')).toHaveValue('0060')
  })
})

test.describe('Kontakte', () => {
  test('Anlegen: Pflichtangaben benannt, Anrede folgt dem Geschlecht', async ({ page }) => {
    const posts = record(page, 'POST', /\/stammdaten\/contacts(\?|$)/)
    await mockPilot(page)
    await page.goto('/adressen/2')
    await page.getByRole('button', { name: 'Kontakt hinzufügen' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Kontakt hinzufügen' })
    await expect(dialog.getByRole('combobox', { name: 'Adresse*' })).toHaveValue('Wohnbau Süd GmbH')
    await dialog.getByRole('button', { name: 'Anlegen' }).click()
    await expect(dialog).toContainText('Bitte noch angeben: Vorname, Nachname, Geschlecht, Anrede.')
    await dialog.getByLabel('Vorname*').fill('Lena')
    await dialog.getByLabel('Nachname*').fill('Hartmann')
    await dialog.getByLabel('Geschlecht*').selectOption({ label: 'weiblich' })
    await expect(dialog.getByLabel(/^Anrede\*/)).toHaveValue('1')
    await dialog.getByRole('button', { name: 'Anlegen' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Lena Hartmann angelegt.').first()).toBeVisible()
    expect(posts[0].body).toMatchObject({ first_name: 'Lena', last_name: 'Hartmann', address_id: 2, gender_id: '1', salutation_id: '1' })
  })

  test('Adresse neu tippen löst die alte Auswahl', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/adressen/2')
    await page.getByRole('button', { name: 'Ben Okafor bearbeiten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kontakt bearbeiten' })
    await dialog.getByRole('combobox', { name: 'Adresse*' }).fill('Wohnbau')
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(dialog).toContainText('Bitte noch angeben: Adresse.')
  })

  test('Schließen mit Änderungen fragt nach', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/adressen/2')
    await page.getByRole('button', { name: 'Ben Okafor bearbeiten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kontakt bearbeiten' })
    await dialog.getByLabel('Funktion').fill('Bauleitung')
    await page.keyboard.press('Escape')
    const ask = page.getByRole('dialog', { name: 'Änderungen verwerfen?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(dialog.getByLabel('Funktion')).toHaveValue('Bauleitung')
  })

  test('Löschen eines verwendeten Kontakts sagt, wo', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/adressen/2')
    await page.getByRole('button', { name: 'Julia Neumann löschen' }).click()
    await page.getByRole('dialog', { name: 'Kontakt löschen?' }).getByRole('button', { name: 'Löschen' }).click()
    await expect(page.getByText('verwendet in 1 Vertrag (V-2024-002)', { exact: false }).first()).toBeVisible()
  })
})

test.describe('Rechte', () => {
  test('nur lesen: kein Stift, kein Hinzufügen, Adressdaten gesperrt', async ({ page }) => {
    await mockPilot(page, { permissions: ['addresses.view', 'addresses.contacts.view'] })
    await page.goto('/adressen')
    await expect(page.getByRole('link', { name: 'Wohnbau Süd GmbH' })).toBeVisible()
    await expect(page.getByRole('button', { name: /bearbeiten$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Neu', exact: true })).toHaveCount(0)
    await page.goto('/adressen/2')
    await expect(page.getByRole('button', { name: 'Kontakt hinzufügen' })).toHaveCount(0)
    await page.getByRole('tab', { name: 'Adressdaten' }).click()
    await expect(page.getByLabel('Name 1*')).toBeDisabled()
    await expect(page.getByRole('region', { name: 'Seitenaktionen' })).toHaveCount(0)
  })

  test('ohne Kontakt-Recht: kein Reiter Kontakte, Adressdaten zuerst', async ({ page }) => {
    await mockPilot(page, { permissions: ['addresses.view'] })
    await page.route(/\/api\/v1\/stammdaten\/addresses\/2(\?|$)/, r => {
      const d = addressDetail(2)
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
        ...d, contacts: [], invoices: [], partials: [],
        visible: { ...d.visible, contacts: false, invoices: false, partials: false },
      } }) })
    })
    await page.goto('/adressen/2')
    await expect(page.getByRole('tab', { name: /Kontakte/ })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Adressdaten' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: /Verwendet in/ }).click()
    await expect(page.getByText('Ohne Recht zum Ansehen nicht aufgeführt: Rechnungen, Abschlagsrechnungen.')).toBeVisible()
  })
})

test.describe('Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) > 640, 'Handy')
  for (const url of ['/adressen', '/adressen?tab=kontakte', '/adressen/2', '/adressen/2?tab=daten', '/adressen/2?tab=verwendung']) {
    test(`kein Querscrollen: ${url}`, async ({ page }) => {
      await mockPilot(page)
      await page.goto(url)
      await page.locator('.master-page').first().waitFor()
      await page.waitForLoadState('networkidle')
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(w).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 2)
    })
  }
})
