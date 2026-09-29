import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot, OFFER_DETAIL } from './fixtures/pilotData'

/**
 * Angebotsdaten und „Neues Angebot" (UI-Pilot Runde 9), dazu die Vorbelegung
 * des Kontakts in Angebot, Projekt und Vertrag.
 *
 * Vorher: eine lange Spalte mit eigenem Speichern-Knopf, keine Rückfrage beim
 * Verlassen, Felder ohne verknüpfte Beschriftung, zweimal „Ansprechpartner"
 * (Büro und Kunde); ein geleerter Kontakt ging als 0 an den Server. Nach jeder
 * Adresse musste man den Kontakt selbst wählen.
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** Kontakte je Adresse: 1 mit Hauptansprechpartner, 2 mit genau einem, 3 mit zweien ohne. */
async function mockContacts(page: Page) {
  const byAddress: Record<string, unknown[]> = {
    '1': [
      { ID: 2, FIRST_NAME: 'Rainer', LAST_NAME: 'Vogt', IS_PRIMARY: 1 },
      { ID: 1, FIRST_NAME: 'Petra', LAST_NAME: 'Albrecht', IS_PRIMARY: 0 },
    ],
    '2': [{ ID: 5, FIRST_NAME: 'Jonas', LAST_NAME: 'Keller', IS_PRIMARY: 0 }],
    '3': [
      { ID: 6, FIRST_NAME: 'Anna', LAST_NAME: 'Albers', IS_PRIMARY: 0 },
      { ID: 7, FIRST_NAME: 'Ben', LAST_NAME: 'Bauer', IS_PRIMARY: 0 },
    ],
  }
  await page.route(/\/api\/v1\/stammdaten\/contacts\/by-address(\?|$)/, r => {
    const id = new URL(r.request().url()).searchParams.get('address_id') ?? ''
    return r.fulfill(json({ data: byAddress[id] ?? [] }))
  })
  await page.route(/\/api\/v1\/stammdaten\/companies(\?|$)/, r => r.fulfill(json({ data: [{ ID: 1, COMPANY_NAME_1: 'Büro Messina Architekten' }] })))
}

async function pickAddress(page: Page, name: RegExp | string, query: string, label: string | RegExp = /^Adresse/) {
  const box = page.getByRole('combobox', { name: label })
  await box.fill(query)
  await page.getByRole('option', { name }).click()
}

const URL_DATEN = '/angebote?offerId=1&tab=daten'
const bar = (page: Page) => page.getByRole('region', { name: 'Seitenaktionen' })

test.describe('Angebotsdaten', () => {
  test('Felder sind beschriftet und zeigen den gespeicherten Stand', async ({ page }) => {
    await mockPilot(page)
    await mockContacts(page)
    await page.goto(URL_DATEN)
    await expect(page.getByLabel('Angebotstitel*')).toHaveValue(OFFER_DETAIL.NAME)
    await expect(page.getByLabel('Status*')).toHaveValue(String(OFFER_DETAIL.OFFER_STATUS_ID))
    await expect(page.getByLabel('Zuständig*')).toHaveValue('1')
    await expect(page.getByText('Steht im PDF als Ansprechpartner.')).toBeVisible()
    await expect(page.getByLabel('Wahrscheinlichkeit (%)')).toHaveValue('78')
    await expect(page.getByLabel('Kontakt*')).toHaveValue('1')
    await expect(page.getByLabel('Kopftext')).toBeVisible()
    // Die Nummer vergibt der Nummernkreis — sie steht unter „Stand", nicht im Formular
    await expect(page.locator('.ws-facts')).toContainText('A-2025-014')
    // Ein gespeicherter Stand wird nie vorbelegt
    await expect(page.getByText(/Vorbelegt:/)).toHaveCount(0)
  })

  test('Speichern: Pflichtfelder werden benannt, sonst geht eine Nutzlast an den Server', async ({ page }) => {
    const puts = record(page, 'PUT', /\/angebote\/1(\?|$)/)
    await mockPilot(page)
    await mockContacts(page)
    await page.goto(URL_DATEN)
    await page.getByLabel('Angebotstitel*').fill('   ')
    await page.getByLabel('Wahrscheinlichkeit (%)').fill('250')
    await expect(bar(page)).toContainText('2 Felder geändert')
    await bar(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Bitte noch angeben: Angebotstitel, Wahrscheinlichkeit (0–100 %).')).toBeVisible()
    await expect(page.getByLabel('Angebotstitel*')).toHaveAttribute('aria-invalid', 'true')
    expect(puts).toHaveLength(0)

    await page.getByLabel('Angebotstitel*').fill('  Neubau Kita Sonnenblume ')
    await page.getByLabel('Wahrscheinlichkeit (%)').fill('62,5')
    await page.keyboard.press('Control+s')
    await expect(page.getByText('Angebotsdaten gespeichert.')).toBeVisible()
    expect(puts).toHaveLength(1)
    expect(puts[0].body).toMatchObject({ name: 'Neubau Kita Sonnenblume', probability: 62.5, contact_id: 1, address_id: 1, employee_id: 1 })
  })

  test('neue Adresse belegt den Hauptansprechpartner vor', async ({ page }) => {
    const puts = record(page, 'PUT', /\/angebote\/1(\?|$)/)
    await mockPilot(page)
    await mockContacts(page)
    await page.goto(URL_DATEN)
    // Erst eine Adresse mit zwei Kontakten ohne Kennzeichen: nichts vorbelegt
    await pickAddress(page, 'Staatliches Hochbauamt Ulm', 'Staatl')
    await expect(page.getByLabel('Kontakt*')).toHaveValue('')
    await bar(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Bitte noch angeben: Kontakt.')).toBeVisible()
    expect(puts).toHaveLength(0)
    // Adresse mit genau einem Kontakt
    await pickAddress(page, 'Stadtwerke Ravensburg GmbH', 'Stadtw')
    await expect(page.getByLabel('Kontakt*')).toHaveValue('5')
    await expect(page.getByText('Vorbelegt: einziger Kontakt der Adresse.')).toBeVisible()
    // Adresse mit Hauptansprechpartner
    await pickAddress(page, 'Stadt Musterstadt – Hochbauamt', 'Musterst')
    await expect(page.getByLabel('Kontakt*')).toHaveValue('2')
    await expect(page.getByLabel('Kontakt*').locator('option:checked')).toHaveText('Rainer Vogt (Hauptansprechpartner)')
    await expect(page.getByText('Vorbelegt: Hauptansprechpartner der Adresse.')).toBeVisible()
    // Wer selbst wählt, sieht den Hinweis nicht mehr
    await page.getByLabel('Kontakt*').selectOption('1')
    await expect(page.getByText(/Vorbelegt:/)).toHaveCount(0)
    await page.getByLabel('Kontakt*').selectOption('2')
    await bar(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Angebotsdaten gespeichert.')).toBeVisible()
    expect(puts[0].body).toMatchObject({ address_id: 1, contact_id: 2 })
  })

  test('Verlassen mit offenen Änderungen fragt nach', async ({ page }) => {
    await mockPilot(page)
    await mockContacts(page)
    await page.goto(URL_DATEN)
    await page.getByLabel('Fußtext').fill('Mit freundlichen Grüßen')
    // Seitennavigation: am Desktop die Seitenleiste, am Handy die Leiste unten
    await page.getByRole('navigation').getByRole('link', { name: 'Adressen' }).filter({ visible: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dialog).toContainText('Angebotsdaten')
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page).toHaveURL(/offerId=1&tab=daten/)
    await expect(page.getByLabel('Fußtext')).toHaveValue('Mit freundlichen Grüßen')
  })

  test('ohne Bearbeitungsrecht lesbar statt unsichtbar', async ({ page }) => {
    await mockPilot(page, { permissions: ['offers.view'] })
    await mockContacts(page)
    await page.goto(URL_DATEN)
    await expect(page.getByText('Nur Lesen — zum Ändern fehlt das Recht „Angebote bearbeiten".')).toBeVisible()
    await expect(page.getByLabel('Angebotstitel*')).toBeDisabled()
    await expect(bar(page)).toHaveCount(0)
  })
})

test.describe('Neues Angebot', () => {
  async function openDialog(page: Page) {
    await page.goto('/angebote')
    await page.getByRole('button', { name: '+ Neues Angebot' }).click()
    return page.getByRole('dialog', { name: 'Neues Angebot' })
  }

  test('Zuständig und Kontakt vorbelegt, Anlegen öffnet das Angebot', async ({ page }) => {
    const posts = record(page, 'POST', /\/angebote(\?|$)/)
    await mockPilot(page)
    await mockContacts(page)
    await page.route(/\/api\/v1\/angebote(\?|$)/, r => r.request().method() === 'POST'
      ? r.fulfill(json({ data: { ID: 1, ABBR: 'A-2026-021' } }))
      : r.fallback())
    const dlg = await openDialog(page)
    await expect(dlg.getByLabel('Zuständig*')).toHaveValue('1')
    await dlg.getByLabel('Angebotstitel*').fill('Umbau Rathaus')
    await dlg.getByLabel('Status*').selectOption({ label: 'Entwurf' })
    await pickAddress(page, 'Stadt Musterstadt – Hochbauamt', 'Musterst')
    await expect(dlg.getByLabel('Kontakt*')).toHaveValue('2')
    // Kopf- und Fußtext stehen eingeklappt darunter
    await expect(dlg.getByRole('button', { name: 'Kopf- und Fußtext' })).toHaveAttribute('aria-expanded', 'false')
    await dlg.getByRole('button', { name: 'Anlegen' }).click()
    await expect(page.getByText('Angebot A-2026-021 angelegt.').first()).toBeVisible()
    await expect(page).toHaveURL(/offerId=1/)
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toMatchObject({ name: 'Umbau Rathaus', employee_id: 1, address_id: 1, contact_id: 2, company_id: 1 })
  })

  test('Pflichtfelder werden markiert, Schließen mit Eingaben fragt nach', async ({ page }) => {
    const posts = record(page, 'POST', /\/angebote(\?|$)/)
    await mockPilot(page)
    await mockContacts(page)
    const dlg = await openDialog(page)
    await dlg.getByRole('button', { name: 'Anlegen' }).click()
    await expect(dlg.getByText(/Bitte noch angeben: Angebotstitel, Status, Adresse, Kontakt\./)).toBeVisible()
    await expect(dlg.getByLabel('Angebotstitel*')).toHaveAttribute('aria-invalid', 'true')
    await expect(dlg.getByRole('combobox', { name: 'Adresse*' })).toHaveAttribute('aria-invalid', 'true')
    expect(posts).toHaveLength(0)

    // Ohne Eingaben schließt Abbrechen sofort; mit Eingaben nach Rückfrage
    await dlg.getByLabel('Angebotstitel*').fill('Umbau Rathaus')
    await expect(dlg.getByLabel('Angebotstitel*')).not.toHaveAttribute('aria-invalid', 'true')
    await dlg.getByRole('button', { name: 'Abbrechen' }).click()
    const ask = page.getByRole('dialog', { name: 'Eingaben verwerfen?' })
    await expect(ask).toContainText('Das Angebot wird nicht angelegt.')
    await ask.getByRole('button', { name: 'Verwerfen' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test.describe('Kontakt vorbelegen in Projekt und Vertrag', () => {
  test('Projektdaten: Hauptansprechpartner nach der Adresswahl', async ({ page }) => {
    await mockPilot(page)
    await mockContacts(page)
    await page.goto('/projekte?projectId=1&tab=daten')
    await pickAddress(page, 'Stadt Musterstadt – Hochbauamt', 'Musterst')
    await expect(page.getByLabel('Ansprechpartner')).toHaveValue('2')
    await expect(page.getByText('Vorbelegt: Hauptansprechpartner der Adresse.')).toBeVisible()
    // Adresse geleert: Kontakt leer, Hinweis weg
    await page.getByRole('combobox', { name: 'Adresse' }).fill('')
    await expect(page.getByLabel('Ansprechpartner')).toHaveValue('')
    await expect(page.getByText(/Vorbelegt:/)).toHaveCount(0)
  })

  test('Vertrag: einziger Kontakt der Rechnungsadresse', async ({ page }) => {
    await mockPilot(page)
    await mockContacts(page)
    await page.goto('/projekte?projectId=1&tab=vertraege')
    await pickAddress(page, 'Stadtwerke Ravensburg GmbH', 'Stadtw', 'Rechnungsadresse')
    await expect(page.getByLabel('Rechnungskontakt')).toHaveValue('5')
    await expect(page.getByText('Vorbelegt: einziger Kontakt der Adresse.')).toBeVisible()
  })

  test('Neues Projekt: Rechnungskontakt vorbelegt', async ({ page }) => {
    await mockPilot(page)
    await mockContacts(page)
    await page.goto('/projekte')
    await page.getByRole('button', { name: /Neues Projekt/ }).first().click()
    await pickAddress(page, 'Stadt Musterstadt – Hochbauamt', 'Musterst', 'Rechnungsadresse*')
    await expect(page.getByLabel('Rechnungskontakt*')).toHaveValue('2')
    await expect(page.getByText('Vorbelegt: Hauptansprechpartner der Adresse.')).toBeVisible()
  })
})

test.describe('Listen am Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) > 640, 'nur Handy')

  // Ein .sr-only im Tabellenkopf lag am Seitenrand und machte die Angebotsliste
  // 1111 px breit — body.scrollWidth merkte davon nichts, documentElement schon.
  // Danach war auch jeder Dialog dort 1111 px breit.
  for (const url of ['/angebote', '/projekte', '/rechnungen', '/adressen', '/adressen?tab=kontakte']) {
    test(`${url}: kein Seitwärts-Scrollen`, async ({ page }) => {
      await mockPilot(page)
      await page.goto(url)
      await page.locator('table').first().waitFor()
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(w).toBeLessThanOrEqual(page.viewportSize()!.width + 2)
    })
  }

  test('„Neues Angebot" passt auf den Bildschirm', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/angebote')
    await page.getByRole('button', { name: '+ Neues Angebot' }).click()
    const box = await page.getByRole('dialog', { name: 'Neues Angebot' }).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  })
})
