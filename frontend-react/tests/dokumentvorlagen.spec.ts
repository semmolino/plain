import { test, expect, type Page } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'
import { mockDokumentvorlagen } from './fixtures/dokumentvorlagenData'

/**
 * Einstellungen → Dokumentvorlagen (Vorlagen-Plan 10/2026, Stufe 2).
 *
 * Vorher: Anhänge nur für vier Belegarten, der Hauptteil nicht einstellbar,
 * Speichern ohne Rückfrage bei offenen Änderungen, und Strg+S in den Texten
 * speicherte nur die gerade gewählte Belegart — die übrigen Eingaben gingen
 * beim Wechsel verloren.
 */

async function setup(page: Page, init?: Parameters<typeof mockDokumentvorlagen>[1]) {
  await mockPilot(page)
  return mockDokumentvorlagen(page, init)
}

// Unterreiter: am Desktop Umschalter, am Handy eine Auswahl
async function goSub(page: Page, name: 'Gestaltung' | 'Aufbau' | 'Texte') {
  const select = page.getByLabel('Bereich', { exact: true })
  if (await select.isVisible()) await select.selectOption({ label: name })
  else await page.getByRole('button', { name, exact: true }).click()
}

const bar = (page: Page) => page.getByRole('region', { name: 'Seitenaktionen' })
const row = (page: Page, name: string | RegExp) => page.getByRole('listitem').filter({ hasText: name })

test.describe('Aufbau', () => {
  test('Baustein ausblenden, verschieben, Textblock — Vorschau und Speichern tragen nur die Abweichung', async ({ page }) => {
    const state = await setup(page)
    await page.goto('/admin?tab=dokumentvorlagen&sub=aufbau')
    await expect(page.getByLabel('Belegart', { exact: true })).toHaveValue('invoice_rechnung')
    // Die Vorschau zeigt, was der Server rendert (hier: der Mock)
    await expect(page.frameLocator('iframe[title="Vorschau"]').getByText('Vorschau')).toBeVisible()

    // Pflichtangaben lassen sich nicht ausblenden
    await expect(row(page, /^Titel/).getByRole('button', { name: /ausblenden/ })).toHaveCount(0)
    await row(page, /^Anrede/).getByRole('button', { name: 'Anrede ausblenden' }).click()
    await expect(row(page, /^Anrede/)).toContainText('ausgeblendet')
    await row(page, /^Kommentar zur Rechnung/).getByRole('button', { name: 'Kommentar zur Rechnung nach oben' }).click()
    await page.getByRole('button', { name: 'Textblock' }).click()
    await page.getByLabel('Text des Textblocks').fill('Es gelten unsere AGB.')

    await expect.poll(() => {
      const last = state.previews.at(-1)
      const body = (last?.theme_json.bodyByCategory as Record<string, { hidden?: string[] }> | undefined)?.invoice_rechnung
      return body?.hidden
    }).toEqual(['salutation'])

    await expect(bar(page)).toContainText('Ungespeicherte Änderungen')
    await bar(page).getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => state.puts.length).toBe(1)
    const saved = (state.puts[0].theme_json as { bodyByCategory: Record<string, Record<string, unknown>> }).bodyByCategory.invoice_rechnung
    expect(saved.hidden).toEqual(['salutation'])
    expect(saved.order).toEqual(expect.arrayContaining(['letterhead', 'comment']))
    expect(Object.values(saved.texts as Record<string, string>)).toEqual(['Es gelten unsere AGB.'])
    // keine Felder, die nicht abweichen — sonst erbte die Korrektur den Zahlungshinweis
    expect(saved).not.toHaveProperty('payment')
    expect(saved).not.toHaveProperty('pageBreaks')

    // Nach dem Neuladen steht es so da, und die Belegart gilt als angepasst
    await page.reload()
    await expect(row(page, /^Anrede/)).toContainText('ausgeblendet')
    await expect(page.getByLabel('Belegart', { exact: true }).locator('option:checked')).toHaveText('Rechnung — angepasst')
  })

  test('Korrektur übernimmt die Rechnung, bis sie selbst abweicht; „Wie Rechnung" stellt es wieder her', async ({ page }) => {
    await setup(page, { theme: {
      brand: { primaryColor: '#111827', accentColor: '#111827', fontFamily: 'system-sans', fontScale: 1 },
      header: { showLogo: true, logoMaxHeightMm: 20, logoPosition: 'right' }, blocks: {},
      bodyByCategory: { invoice_rechnung: { hidden: ['reference'] } },
    } })
    await page.goto('/admin?tab=dokumentvorlagen&sub=aufbau&cat=invoice_korrektur')
    await expect(page.getByText('Übernimmt die Einstellung der Rechnung.')).toBeVisible()
    await expect(row(page, /^Bezugszeile/)).toContainText('ausgeblendet')
    // Die Korrektur hat nie einen Zahlungshinweis — auch nicht über die Rechnung
    await expect(page.getByLabel('Zahlungshinweis', { exact: true })).toHaveValue('never')

    await row(page, /^Anrede/).getByRole('button', { name: 'Anrede ausblenden' }).click()
    await expect(page.getByText('Eigene Einstellung.')).toBeVisible()
    await page.getByRole('button', { name: 'Wie Rechnung' }).click()
    await expect(page.getByText('Übernimmt die Einstellung der Rechnung.')).toBeVisible()
  })

  test('Gestaltung ↔ Aufbau verliert nichts, ein Reiterwechsel fragt nach', async ({ page }) => {
    await setup(page)
    await page.goto('/admin?tab=dokumentvorlagen&sub=aufbau')
    await row(page, /^Anrede/).getByRole('button', { name: 'Anrede ausblenden' }).click()
    await goSub(page, 'Gestaltung')
    await page.getByRole('checkbox', { name: /Bauvorhaben/ }).uncheck()
    await goSub(page, 'Aufbau')
    await expect(row(page, /^Anrede/)).toContainText('ausgeblendet')

    await page.getByRole('tab', { name: 'Vorbelegungen' }).click()
    const dlg = page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })
    await expect(dlg).toContainText('Dokumentvorlage')
    await dlg.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page).toHaveURL(/tab=dokumentvorlagen/)
  })

  test('Anhänge auch für die Auftragsbestätigung? Nein — nur wo es welche gibt; Angebot hat das Bestellblatt', async ({ page }) => {
    const state = await setup(page)
    await page.goto('/admin?tab=dokumentvorlagen&sub=aufbau&cat=offer_ab')
    await expect(page.getByRole('heading', { name: 'Anhänge' })).toHaveCount(0)
    await page.getByLabel('Belegart', { exact: true }).selectOption('offer_angebot')
    await page.getByRole('checkbox', { name: 'Bestellblatt' }).uncheck()
    await bar(page).getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => state.puts.length).toBe(1)
    expect(state.puts[0]).toMatchObject({ blocks_by_category: { offer_angebot: { showOrderSheet: false } } })
  })
})

test.describe('Texte', () => {
  test('Standardtexte mehrerer Belegarten gehen in einem Speichern, Platzhalter an der Cursorposition', async ({ page }) => {
    const state = await setup(page, { texts: { invoice_schluss: { headerText: 'Schlusstext', footerText: null } } })
    await page.goto('/admin?tab=dokumentvorlagen&sub=texte')
    await page.getByRole('button', { name: 'Rechnung', exact: true }).click()
    const head = page.getByLabel('Kopftext — vor den Positionen')
    await head.fill('Leistungen bis ')
    await page.getByRole('button', { name: 'Leistungszeitraum' }).click()
    await expect(head).toHaveValue('Leistungen bis {{leistungszeitraum}}')

    // Teilschluss ohne eigenen Text: Hinweis auf den Rückfall
    await page.getByRole('button', { name: 'Teilschlussrechnung' }).click()
    await expect(page.getByText('Leer — es gilt der Text der Schlussrechnung.')).toBeVisible()
    // Angebot: Platzhalter ohne Wert dort werden nicht angeboten
    await page.getByRole('button', { name: 'Angebot', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Leistungszeitraum' })).toHaveCount(0)
    await page.getByLabel('Fußtext — nach den Beträgen').fill('Gültig bis {{gueltig_bis}}.')

    await expect(bar(page)).toContainText('2 Texte geändert')
    await page.keyboard.press('Control+s')
    await expect.poll(() => state.textPuts.length).toBe(2)
    expect(state.textPuts.map(p => p.type).sort()).toEqual(['invoice_rechnung', 'offer_angebot'])
    expect(state.textPuts.find(p => p.type === 'invoice_rechnung')!.body).toEqual({ headerText: 'Leistungen bis {{leistungszeitraum}}', footerText: null })
  })

  test('Textbaustein anlegen, im Aufbau übernehmen, löschen mit Rückfrage', async ({ page }) => {
    const state = await setup(page)
    await page.goto('/admin?tab=dokumentvorlagen&sub=texte')
    await expect(page.getByText(/Noch keine Textbausteine/)).toBeVisible()
    await page.getByRole('button', { name: 'Textbaustein', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: 'Neuer Textbaustein' })
    await dlg.getByLabel('Bezeichnung').fill('Gewährleistung')
    await dlg.getByLabel('Belegart').selectOption('invoice_schluss')
    await dlg.getByLabel('Text').fill('Die Gewährleistung beginnt mit der Abnahme.')
    await dlg.getByRole('button', { name: 'Speichern' }).click()
    await expect(dlg).toHaveCount(0)
    expect(state.snippetCalls.find(c => c.method === 'POST')!.body).toEqual({
      label: 'Gewährleistung', text: 'Die Gewährleistung beginnt mit der Abnahme.', category: 'invoice_schluss', position: 'free',
    })
    await expect(page.getByRole('listitem').filter({ hasText: 'Gewährleistung' })).toContainText('Schlussrechnung · Eigener Textblock')

    // Im Aufbau der Schlussrechnung steht er zur Wahl — bei der Rechnung nicht
    await goSub(page, 'Aufbau')
    await expect(page.getByLabel('Textblock aus Textbaustein')).toHaveCount(0)
    await page.getByLabel('Belegart', { exact: true }).selectOption('invoice_schluss')
    await page.getByLabel('Textblock aus Textbaustein').selectOption({ label: 'Gewährleistung' })
    await expect(page.getByLabel('Text des Textblocks')).toHaveValue('Die Gewährleistung beginnt mit der Abnahme.')

    await goSub(page, 'Texte')
    await page.getByRole('button', { name: 'Gewährleistung löschen' }).click()
    const confirm = page.getByRole('dialog', { name: 'Textbaustein löschen?' })
    await confirm.getByRole('button', { name: 'Löschen' }).click()
    await expect.poll(() => state.snippetCalls.filter(c => c.method === 'DELETE').length).toBe(1)
  })
})

test('Handy: Bereich als Auswahl, kein seitliches Scrollen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await page.goto('/admin?tab=dokumentvorlagen&sub=aufbau')
  await expect(page.getByLabel('Bereich')).toHaveValue('aufbau')
  await expect(row(page, /^Anrede/)).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(2)
})

test.describe('Seitenaufbau und Briefpapier (Stufe 4)', () => {
  test('Stil-Vorlage, DIN 5008, Falzmarken und Briefpapier gehen mit dem Speichern', async ({ page }) => {
    const state = await setup(page)
    await page.goto('/admin?tab=dokumentvorlagen&sub=gestaltung')
    // Standard ist das bisherige Aussehen
    await expect(page.getByLabel('Anschriftfeld')).toHaveValue('none')

    // Stil-Vorlage (setzt Stil, Farbe, Schrift, Logo) — nicht der Stil-Knopf gleichen Namens
    await page.locator('.dv-preset').filter({ hasText: 'Klar' }).click()
    await page.getByLabel('Anschriftfeld').selectOption('B')
    await page.getByLabel('Falz- und Lochmarken').check()

    await page.locator('input[type=file][accept="application/pdf"]').setInputFiles({
      name: 'briefbogen.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF'),
    })
    await expect(page.getByText('briefbogen.pdf')).toBeVisible()
    expect(state.uploads[0]).toContain('LETTERHEAD')
    await page.getByLabel(/Fußzeile mit Anschrift, Bank und Steuer weglassen/).check()

    await bar(page).getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => state.puts.length).toBe(1)
    expect(state.puts[0]).toMatchObject({ theme_json: {
      layout: { style: 'klar', din: 'B', foldMarks: true, followHeader: false },
      letterhead: { assetId: 77, pages: 'first', hideFooter: true },
      brand: { fontFamily: 'inter' },
    } })
  })

  test('„Als PDF ansehen" schickt die ungespeicherte Gestaltung', async ({ page }) => {
    const state = await setup(page)
    await page.goto('/admin?tab=dokumentvorlagen&sub=gestaltung')
    await page.getByLabel('Belegart, Nummer und Empfänger oben auf Folgeseiten').check()
    const popup = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Als PDF ansehen' }).click()
    await popup
    expect(state.pdfPreviews[0]).toMatchObject({ category: 'invoice_rechnung', theme_json: { layout: { followHeader: true } } })
    expect(state.puts).toHaveLength(0)
  })
})

test.describe('Vorlagen-Varianten (Stufe 5)', () => {
  test('Neue Vorlage als Kopie, bearbeiten, speichern, umbenennen, entfernen', async ({ page }) => {
    const state = await setup(page)
    await page.goto('/admin?tab=dokumentvorlagen&sub=gestaltung')
    await expect(page.getByLabel('Vorlage', { exact: true })).toHaveValue('')

    await page.getByRole('button', { name: 'Neue Vorlage' }).click()
    const dlg = page.getByRole('dialog', { name: 'Neue Vorlage' })
    await dlg.getByLabel('Name').fill('Öffentliche AG')
    await dlg.getByRole('button', { name: 'Anlegen' }).click()
    await expect(page).toHaveURL(/[?&]v=500/)
    await expect(page.getByLabel('Vorlage', { exact: true })).toHaveValue('500')

    // Bearbeitet wird die Variante — der Standard bleibt, wie er ist
    await page.getByLabel('Anschriftfeld').selectOption('B')
    await bar(page).getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => state.variantCalls.filter(c => c.method === 'PUT').length).toBe(1)
    expect(state.variantCalls.find(c => c.method === 'PUT')!.body).toMatchObject({ theme_json: { layout: { din: 'B' } } })
    expect(state.puts).toHaveLength(0)

    await page.getByRole('button', { name: 'Umbenennen' }).click()
    const ren = page.getByRole('dialog', { name: 'Vorlage umbenennen' })
    await ren.getByLabel('Name').fill('Öffentliche Auftraggeber')
    await ren.getByRole('button', { name: 'Umbenennen' }).click()
    await expect(page.getByLabel('Vorlage', { exact: true }).locator('option:checked')).toHaveText('Öffentliche Auftraggeber')

    await page.getByRole('button', { name: 'Entfernen', exact: true }).first().click()
    await page.getByRole('dialog', { name: 'Vorlage entfernen?' }).getByRole('button', { name: 'Entfernen' }).click()
    await expect(page.getByLabel('Vorlage', { exact: true })).toHaveValue('')
    await expect(page).not.toHaveURL(/[?&]v=/)
  })
})
