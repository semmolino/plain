import { test, expect } from '@playwright/test'
import { mockDemo, hideDevtools } from './fixtures/demoData'

/**
 * Tabellen, die breiter sind als ihr Container.
 *
 * Hintergrund (Linsenanalyse 24.08.2026): /rechnungen ist auf einem
 * 1280px-Bildschirm 1279px breit in einem 1048px-Container, /angebote
 * 1205px — 231 bzw. 157px liegen unter der rechts fixierten Aktionsspalte.
 * Das ist normales Verhalten einer fixierten Spalte, aber es geschah
 * unsichtbar: Bildlaufleisten sind ueberlagert, und der Schatten an der
 * Spalte war mit `-6px 0 8px -8px` rechnerisch aufgehoben. Drei Wertspalten
 * (Sicherheitseinbehalt, Forderung, Offene Posten) waren damit vorhanden,
 * aber unauffindbar.
 *
 * Diese Tests halten die Rueckmeldung fest — nicht das Layout. Dass die
 * Tabellen ueberlaufen, ist ein offener Punkt (Spaltenprioritaeten, siehe
 * Bericht); dass der Ueberlauf *sichtbar* ist, darf nicht wieder verloren
 * gehen.
 */

const UEBERLAUFENDE_LISTEN: [string, string][] = [
  ['Rechnungsliste', '/rechnungen'],
  ['Angebotsliste',  '/angebote'],
]

for (const [name, url] of UEBERLAUFENDE_LISTEN) {
  test(`${name} — verborgene Spalten sind an der fixierten Spalte erkennbar`, async ({ page }) => {
    await mockDemo(page)
    await page.goto(url)
    await hideDevtools(page)
    await page.locator('.app-main').waitFor()
    await page.locator('.master-table--sticky-actions').waitFor()

    const behaelter = page.locator('.table-scroll').first()
    const zelle     = page.locator('.master-table--sticky-actions tbody td.doc-actions').first()

    const verborgen = await behaelter.evaluate(el => el.scrollWidth - el.clientWidth)
    expect(verborgen, 'Testvoraussetzung: die Tabelle laeuft ueber').toBeGreaterThan(0)

    // Im Ausgangszustand liegt Inhalt unter der Spalte -> Kante an.
    await expect(behaelter).toHaveAttribute('data-more-right', '')
    const kanteAn = await zelle.evaluate(el => getComputedStyle(el).boxShadow)

    // Ganz nach rechts: nichts mehr verdeckt -> Kante aus. Eine Kante, die
    // dann stehenbliebe, waere eine Behauptung ohne Deckung.
    await behaelter.evaluate(el => { el.scrollLeft = el.scrollWidth })
    await expect(behaelter).not.toHaveAttribute('data-more-right', '')
    const kanteAus = await zelle.evaluate(el => getComputedStyle(el).boxShadow)

    expect(kanteAn, 'die Kante muss sich sichtbar unterscheiden').not.toBe(kanteAus)
  })
}

test('Rechnungsliste — die fixierte Kopfzelle deckt die Spalten darunter ab', async ({ page }) => {
  // Waere die Kopfzelle durchsichtig, stuenden ueber den Aktionsknoepfen die
  // Ueberschriften fremder Spalten — Kopf und Inhalt widersprechen sich.
  await mockDemo(page)
  await page.goto('/rechnungen')
  await hideDevtools(page)
  await page.locator('.master-table--sticky-actions').waitFor()

  const treffer = await page.evaluate(() => {
    const th = document.querySelector('.master-table--sticky-actions thead th.doc-actions')
    if (!th) return ['KOPFZELLE FEHLT']
    const b = th.getBoundingClientRect()
    const y = (b.top + b.bottom) / 2
    // links, Mitte, rechts innerhalb der fixierten Kopfzelle
    return [b.left + 6, (b.left + b.right) / 2, b.right - 6]
      .map(x => document.elementFromPoint(x, y)?.closest('th')?.className ?? 'nichts')
  })

  for (const klasse of treffer) expect(klasse).toContain('doc-actions')
})

test('kein waagerechter Seitenlauf trotz ueberlaufender Tabellen', async ({ page }) => {
  // Die Kernregel aus CLAUDE.md: der Ueberlauf gehoert in den Container,
  // nicht in die Seite.
  for (const [, url] of UEBERLAUFENDE_LISTEN) {
    await mockDemo(page)
    await page.goto(url)
    await hideDevtools(page)
    await page.locator('.app-main').waitFor()
    const s = await page.evaluate(() => ({
      body: document.body.scrollWidth, view: document.documentElement.clientWidth,
    }))
    expect(s.body, `${url} laeuft seitlich ueber`).toBeLessThanOrEqual(s.view + 2)
  }
})

/**
 * Spaltenstufen der Rechnungsliste.
 *
 * Entscheidung vom 24.08.2026: Sicherheitseinbehalt und Forderung sind
 * Nachrechen-Details und duerfen bei wenig Platz als Erste weichen. Die
 * Tests halten die Wirkung fest — und vor allem die beiden Zusagen, die das
 * Ausblenden erst vertretbar machen: Es wird ehrlich angezeigt, und eine
 * bewusste Auswahl im Spaltenwaehler schlaegt es.
 */

async function spalten(page: import('@playwright/test').Page) {
  return page.$$eval('.master-table thead th', ths =>
    ths.map(th => (th.textContent || '').replace(/[▲▼]/g, '').trim()).filter(Boolean))
}

test('Rechnungsliste — auf breitem Bildschirm passt die Tabelle vollstaendig', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await mockDemo(page); await page.goto('/rechnungen'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()

  expect(await spalten(page)).toContain('SEB €')
  const ueber = await page.locator('.table-scroll').first()
    .evaluate(el => el.scrollWidth - el.clientWidth)
  expect(ueber, 'ab 1520px darf nichts mehr ueberlaufen').toBe(0)
})

test('Rechnungsliste — auf schmalem Bildschirm weichen SEB und Forderung', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockDemo(page); await page.goto('/rechnungen'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()

  const s = await spalten(page)
  expect(s).not.toContain('SEB €')
  expect(s).not.toContain('Forderung €')
  // Was zum Wiedererkennen und Handeln noetig ist, bleibt.
  for (const pflicht of ['Nummer', 'Datum', 'Status', 'Projekt', 'Brutto €']) {
    expect(s, `${pflicht} gehoert zur Grundausstattung`).toContain(pflicht)
  }
})

test('Rechnungsliste — der Spaltenwaehler verschweigt die Ausblendung nicht', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockDemo(page); await page.goto('/rechnungen'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()

  await page.getByRole('button', { name: 'Spalten' }).click()
  const zeile = page.locator('.pl-col-option', { hasText: 'SEB €' })
  // Haken steht — die Spalte ist nicht abgewaehlt, nur ohne Platz.
  await expect(zeile.locator('input[type=checkbox]')).toBeChecked()
  await expect(zeile.locator('.pl-col-hint')).toHaveText('kein Platz')
  await expect(page.locator('.pl-col-panel-note')).toContainText('Fensterbreite')
})

test('Rechnungsliste — bewusste Auswahl schlaegt die automatische Ausblendung', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockDemo(page); await page.goto('/rechnungen'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()
  expect(await spalten(page)).not.toContain('SEB €')

  await page.getByRole('button', { name: 'Spalten' }).click()
  const kasten = page.locator('.pl-col-option', { hasText: 'SEB €' }).locator('input[type=checkbox]')
  await kasten.uncheck()   // abwaehlen …
  await kasten.check()     // … und bewusst wieder anwaehlen
  await page.keyboard.press('Escape')

  expect(await spalten(page), 'nach bewusster Auswahl muss die Spalte da sein').toContain('SEB €')
})
