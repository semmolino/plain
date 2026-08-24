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
