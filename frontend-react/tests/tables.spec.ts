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
    // Bewusst schmal: Seit die Rechnungsliste ihre Spalten selbst anpasst,
    // passt sie auf Desktop-Breiten — dort gaebe es nichts zu verdecken und
    // die Kante waere (richtigerweise) aus. Der Fall, den dieser Test
    // absichert, tritt erst auf, wenn selbst die Grundausstattung nicht mehr
    // hineinpasst.
    await page.setViewportSize({ width: 700, height: 800 })
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

const ueberstand = (page: import('@playwright/test').Page) =>
  page.locator('.table-scroll').first().evaluate(el => el.scrollWidth - el.clientWidth)

test('Rechnungsliste — passt auf Desktop-Breiten in ihren Container', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'prueft Fensterbreiten, nicht Geraete')
  // Der Kern der Sache. Zuerst stufte die Liste nach festen Pixelschwellen,
  // die an einer zu ordentlichen Fixture ermittelt waren („ab 1520px passt
  // alles"). Mit realistischen Werten lief sie auf JEDER Breite ueber, und
  // die fixierte Aktionsspalte schnitt Betraege mittendrin ab. Jetzt misst
  // die Liste selbst und laesst so viele Spalten weg, wie noetig sind.
  await mockDemo(page); await page.goto('/rechnungen'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()

  for (const w of [1280, 1440, 1600, 1920]) {
    await page.setViewportSize({ width: w, height: 900 })
    await expect.poll(() => ueberstand(page), { message: `Ueberstand bei ${w}px` })
      .toBeLessThanOrEqual(1)
  }
})

test('Rechnungsliste — weggelassene Spalten kehren beim Aufziehen zurueck', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'prueft Fensterbreiten, nicht Geraete')
  // Der erste Anlauf holte Spalten zurueck, sobald „freier Platz" da war.
  // Weil die Tabelle width:100% hat, fuellt sie ihren Container nach jedem
  // Weglassen aber wieder vollstaendig aus — freier Platz entstand nie, und
  // einmal weggelassene Spalten waeren fuer immer weg gewesen.
  await page.setViewportSize({ width: 1100, height: 900 })
  await mockDemo(page); await page.goto('/rechnungen'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()
  await expect.poll(() => spalten(page)).not.toContain('SEB €')

  await page.setViewportSize({ width: 1920, height: 900 })
  await expect.poll(() => spalten(page), { message: 'SEB muss auf breitem Fenster zurueckkommen' })
    .toContain('SEB €')

  await page.setViewportSize({ width: 1100, height: 900 })
  await expect.poll(() => spalten(page)).not.toContain('SEB €')
  // Am Ende steht die Tabelle ruhig — kein Hin und Her an der Grenze.
  await expect.poll(() => ueberstand(page)).toBeLessThanOrEqual(1)
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

/**
 * Projektliste.
 *
 * Zwei getrennte Befunde, beide am 24.08.2026 aus Screenshots der echten
 * Instanz entstanden:
 *
 * 1. Ueber der rechten Spalte lag ein weisser Streifen, der Zebrastreifen und
 *    Hover-Farbe durchschnitt. Ursache war `display: flex` auf einer <td> —
 *    damit ist die Zelle keine Tabellenzelle mehr, der Browser erzeugt eine
 *    anonyme Ersatzzelle, und die traegt keinen Hintergrund.
 * 2. Zeilenhoehen schwankten zwischen 46 und 66px, weil Name und Adresse
 *    umbrachen. Eine Liste mit ungleich hohen Zeilen laesst sich nicht
 *    ueberfliegen.
 *
 * Rangfolge beim Platzmangel (vom Nutzer festgelegt): Typ, Abteilung,
 * Intern, zuletzt Adresse.
 */

test('Projektliste — Aktionszelle bleibt eine Tabellenzelle', async ({ page }) => {
  await mockDemo(page); await page.goto('/projekte'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()

  const zelle = page.locator('.master-table tbody td.doc-actions').first()
  // `display: flex` auf einer td nimmt sie aus dem Tabellenlayout — genau das
  // erzeugte den weissen Streifen.
  await expect(zelle).toHaveCSS('display', 'table-cell')

  // Gegenprobe am sichtbaren Ergebnis: Die Aktionszelle muss dieselbe
  // Hintergrundfarbe tragen wie die uebrigen Zellen ihrer Zeile.
  const gleich = await page.evaluate(() => {
    const zeile = document.querySelector('.master-table tbody tr:nth-child(2)')!
    const zellen = [...zeile.querySelectorAll('td')]
    const farben = zellen.map(td => getComputedStyle(td).backgroundColor)
    return farben.every(f => f === farben[0])
  })
  expect(gleich, 'die Aktionszelle faellt farblich aus der Zeile').toBe(true)
})

test('Projektliste — alle Zeilen sind gleich hoch', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await mockDemo(page); await page.goto('/projekte'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()

  const hoehen = await page.$$eval('.master-table tbody tr',
    trs => trs.map(tr => Math.round(tr.getBoundingClientRect().height)))
  expect(hoehen.length).toBeGreaterThan(3)
  // Spannweite statt exakter Gleichheit: Rahmen und Teilpixel ergeben je nach
  // Zeile 47 oder 48px. Der Befund, den dieser Test absichert, war ein
  // Unterschied von 20px (46 gegen 66) durch umbrechende Texte.
  const spanne = Math.max(...hoehen) - Math.min(...hoehen)
  expect(spanne, `Zeilenhoehen: ${[...new Set(hoehen)].sort().join(', ')}`).toBeLessThanOrEqual(2)
})

test('Projektliste — Spalten weichen in der festgelegten Reihenfolge', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'prueft Fensterbreiten, nicht Geraete')
  await page.setViewportSize({ width: 1600, height: 900 })
  await mockDemo(page); await page.goto('/projekte'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()

  // Alle Zusatzspalten einschalten, damit die volle Breite gefordert wird.
  await page.getByRole('button', { name: 'Spalten' }).click()
  for (const l of ['Typ', 'Abteilung', 'Adresse']) {
    const cb = page.locator('.pl-col-option', { hasText: l }).locator('input[type=checkbox]').first()
    if (!(await cb.isChecked())) await cb.check()
  }
  await page.keyboard.press('Escape')
  await expect.poll(() => spalten(page)).toContain('Typ')

  // Enger: Typ und Abteilung gehen zuerst, Adresse bleibt am laengsten.
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect.poll(() => spalten(page)).not.toContain('Typ')
  expect(await spalten(page)).toContain('Adresse')

  // Und die Liste passt dabei weiterhin in ihren Container.
  await expect
    .poll(() => page.locator('.list-section').first().evaluate(el => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1)
})

/**
 * colSpan der Leerzeilen.
 *
 * Ein colSpan, der groesser ist als die Kopfzeile, spannt eine Phantomspalte
 * auf und verbreitert die Tabelle — ausgerechnet dort, wo der Platz ohnehin
 * knapp ist. Beide Listen hatten den Fehler, aus je eigenem Grund:
 *
 * - Projektliste rechnete die Intern-Spalte als feste Groesse ein, obwohl sie
 *   seit den Spaltenstufen wegfallen kann (gemessen bei 700px: 5 Kopfspalten
 *   gegen colSpan 6).
 * - Rechnungsliste rechnete mit drei festen Spalten (Auswahl, Nummer,
 *   Aktionen). Auf dem Handy steht die Aktionsspalte aber VORNE und ERSETZT
 *   die Auswahlspalte — es sind nur zwei (bei 390px: 6 gegen 7).
 *
 * Beide Zahlen werden jetzt aus denselben Groessen abgeleitet wie die
 * Kopfzeile. Der Test prueft genau diese Gleichheit, ueber alle Breiten, an
 * denen Spalten weichen.
 */
for (const [liste, url] of [['Projektliste', '/projekte'], ['Rechnungsliste', '/rechnungen']] as [string, string][]) {
  test(`${liste} — colSpan der Leerzeile passt bei jeder Breite zur Spaltenzahl`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'prueft Fensterbreiten, nicht Geraete')
    for (const w of [390, 560, 700, 1100, 1280, 1920]) {
      await page.setViewportSize({ width: w, height: 800 })
      await mockDemo(page); await page.goto(url); await hideDevtools(page)
      await page.locator('.master-table').waitFor()
      // Suche ohne Treffer erzwingt die Leerzeile mit dem colSpan.
      await page.locator('input[type=search]').first().fill('zzzz-gibtsnicht')

      await expect.poll(async () => page.evaluate(() => {
        const t = document.querySelector('.master-table')!
        const leer = t.querySelector('tbody td[colspan]')
        return `${t.querySelectorAll('thead tr th').length}/${leer ? leer.getAttribute('colspan') : '-'}`
      }), { message: `${url} bei ${w}px (Kopfspalten/colSpan)` })
        .toMatch(/^(\d+)\/\1$/)
    }
  })
}


/**
 * Die Projektliste hat Typ, Abteilung und Adresse standardmaessig ABGEWAEHLT.
 * Dann faellt auch nichts aus Platzmangel weg und es gibt (richtigerweise)
 * keinen Aufklapp-Knopf. Fuer die Tests unten werden sie eingeschaltet.
 */
async function alleSpaltenAn(page: import('@playwright/test').Page, url: string) {
  if (!url.includes('projekte')) return
  await page.getByRole('button', { name: 'Spalten' }).click()
  for (const l of ['Typ', 'Abteilung', 'Adresse']) {
    const cb = page.locator('.pl-col-option', { hasText: l }).locator('input[type=checkbox]').first()
    if (!(await cb.isChecked())) await cb.check()
  }
  await page.keyboard.press('Escape')
}

/**
 * Aufklappbare Detailzeile.
 *
 * Sie faengt genau die Werte auf, die `useFitColumns` wegen der Fensterbreite
 * weggelassen hat. Ohne sie waeren diese Werte auf schmalen Geraeten gar
 * nicht mehr erreichbar — der Spaltenwaehler hilft dort nicht, weil ohnehin
 * kein Platz ist.
 *
 * Muster ist Disclosure (WAI-ARIA APG): echter Knopf mit aria-expanded, kein
 * tabIndex an der <tr>, keine erfundene Rolle. Der Zeilenklick bleibt frei —
 * in der Projektliste oeffnet er das Projekt, und dieselbe Geste darf nicht
 * in zwei Listen Verschiedenes tun.
 */
for (const [liste, url, breite] of [
  ['Projektliste',   '/projekte',   1100],
  ['Rechnungsliste', '/rechnungen', 1280],
] as [string, string, number][]) {

  test(`${liste} — Detailzeile zeigt genau die weggelassenen Spalten`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'prueft eine bestimmte Fensterbreite')
    await page.setViewportSize({ width: breite, height: 800 })
    await mockDemo(page); await page.goto(url); await hideDevtools(page)
    await page.locator('.master-table').waitFor()
    await alleSpaltenAn(page, url)

    const knopf = page.locator('.row-expand-btn').first()
    await expect(knopf, 'bei dieser Breite fallen Spalten weg, also muss es den Knopf geben').toBeVisible()
    await expect(knopf).toHaveAttribute('aria-expanded', 'false')

    const sichtbar = await spalten(page)
    await knopf.click()
    await expect(knopf).toHaveAttribute('aria-expanded', 'true')

    const panel = page.locator('tr.row-detail').first()
    await expect(panel).toBeVisible()

    // Genau die weggelassenen — keine, die schon in der Tabelle steht.
    const felder = await panel.locator('dt').allTextContents()
    expect(felder.length).toBeGreaterThan(0)
    for (const f of felder) {
      expect(sichtbar, `„${f}" steht schon in der Tabelle und gehoert nicht ins Panel`).not.toContain(f)
    }

    // Die Detailzeile steht unmittelbar hinter IHRER Datenzeile.
    const direktDanach = await panel.evaluate(el => {
      const vor = el.previousElementSibling
      return vor?.tagName === 'TR' && !vor.classList.contains('row-detail')
    })
    expect(direktDanach, 'die Detailzeile muss direkt hinter ihrer Datenzeile stehen').toBe(true)
  })

  test(`${liste} — Aufklappen verbreitert die Tabelle nicht`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'prueft eine bestimmte Fensterbreite')
    // Der Sinn der Sache: Ein <td colSpan> ist so breit wie die TABELLE.
    // Waere die zu breit, muesste man die Detailangaben genauso seitwaerts
    // scrollen wie vorher die Spalten — das Panel brauchte dann niemand.
    await page.setViewportSize({ width: breite, height: 800 })
    await mockDemo(page); await page.goto(url); await hideDevtools(page)
    await page.locator('.master-table').waitFor()
    await alleSpaltenAn(page, url)

    const behaelter = page.locator('.table-scroll, .list-section').first()
    await expect.poll(() => behaelter.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await page.locator('.row-expand-btn').first().click()
    await expect(page.locator('tr.row-detail')).toHaveCount(1)
    await expect.poll(() => behaelter.evaluate(el => el.scrollWidth - el.clientWidth),
      { message: 'die Detailzeile hat die Tabelle verbreitert' }).toBeLessThanOrEqual(1)
  })

  test(`${liste} — colSpan der Detailzeile passt zur Spaltenzahl`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'prueft eine bestimmte Fensterbreite')
    await page.setViewportSize({ width: breite, height: 800 })
    await mockDemo(page); await page.goto(url); await hideDevtools(page)
    await page.locator('.master-table').waitFor()
    await alleSpaltenAn(page, url)
    await page.locator('.row-expand-btn').first().click()
    const r = await page.evaluate(() => ({
      kopf: document.querySelectorAll('.master-table thead th').length,
      span: Number(document.querySelector('tr.row-detail td')!.getAttribute('colspan')),
    }))
    expect(r.span).toBe(r.kopf)
  })
}

test('Detailzeile — Fokus bleibt beim Umschalten auf dem Knopf', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'prueft eine bestimmte Fensterbreite')
  // Ein Fokussprung ins Panel waere ein unangekuendigter Kontextwechsel
  // (WCAG 3.2.1). Der Inhalt folgt im DOM, der naechste Tabulator reicht.
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockDemo(page); await page.goto('/rechnungen'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()
  const knopf = page.locator('.row-expand-btn').first()
  await knopf.click()
  expect(await knopf.evaluate(el => document.activeElement === el)).toBe(true)
  await knopf.click()
  expect(await knopf.evaluate(el => document.activeElement === el)).toBe(true)
  await expect(page.locator('tr.row-detail')).toHaveCount(0)
})

test('Detailzeile — auf breitem Bildschirm gibt es den Knopf gar nicht', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'prueft eine bestimmte Fensterbreite')
  // Ein Bedienelement, das ein leeres Panel oeffnet, verspricht mehr als es
  // haelt. Faellt keine Spalte weg, ist auch nichts nachzureichen.
  await page.setViewportSize({ width: 1920, height: 900 })
  await mockDemo(page); await page.goto('/rechnungen'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()
  await expect.poll(() => page.locator('.row-expand-btn').count()).toBe(0)
})

test('Detailzeile — Trefferflaeche auf dem Handy mindestens 44px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockDemo(page); await page.goto('/projekte'); await hideDevtools(page)
  await page.locator('.master-table').waitFor()
  const knopf = page.locator('.row-expand-btn').first()
  await expect(knopf).toBeVisible()
  const box = await knopf.boundingBox()
  expect(box!.width,  'CLAUDE.md fordert 44x44').toBeGreaterThanOrEqual(44)
  expect(box!.height, 'CLAUDE.md fordert 44x44').toBeGreaterThanOrEqual(44)
})
