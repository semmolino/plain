import { test, type Page } from '@playwright/test'
import { hideDevtools } from './fixtures/demoData'
import { mockPilot, TIMER_DRAFTS } from './fixtures/pilotData'

/**
 * Vorher/Nachher-Bilder fuer den UI-Pilot (Branch ui-sm).
 *
 * Erzeugt NUR Bilder, prueft nichts — die Bewertung macht ein Mensch. Laeuft
 * deshalb nur mit PILOT_SCREENS=1 und nie in CI:
 *
 *   PILOT_SCREENS=1 PILOT_PHASE=vorher npx playwright test -c playwright.pilot.config.ts
 *
 * Dieselben Szenen vor und nach den Aenderungen — nur so ist der Vergleich
 * einer. Szenen, die erst mit dem Pilot existieren (Dichte-Umschalter),
 * laufen nur in der Phase „nachher".
 */

// vorher  = Stand vor dem Pilot (main), vorher2 = nach Runde 1,
// vorher3 = nach Runde 2, vorher4 = nach Runde 3, vorher5 = nach Runde 4,
// vorher6 = nach Runde 5, vorher7 = nach Runde 6, vorher8 = nach Runde 7,
// vorher9 = nach Runde 8, nachher = aktueller Stand.
// since(n): gibt es, was Runde n eingefuehrt hat? Runde 4 ist die
// Rueckmeldung zu Runde 3 samt Angebots-Arbeitsbereich, Runde 5 „Vom Angebot
// zum Projekt".
const PHASE = process.env.PILOT_PHASE ?? 'nachher'
const RANK: Record<string, number> = { vorher: 0, vorher2: 1, vorher3: 2, vorher4: 3, vorher5: 4, vorher6: 5, vorher7: 6, vorher8: 7, vorher9: 8 }
const since = (round: number) => (RANK[PHASE] ?? 9) >= round
// Nicht unter test-results/: das leert Playwright bei jedem Lauf.
const OUT   = process.env.PILOT_OUT ?? `pilot-shots/${PHASE}`

test.skip(!process.env.PILOT_SCREENS, 'Nur mit PILOT_SCREENS=1 (lokale Aufnahmen)')
test.use({ timezoneId: 'Europe/Berlin', locale: 'de-DE' })

async function prepare(page: Page, device: string, opts: Parameters<typeof mockPilot>[1] = {}, density?: 'compact' | 'comfortable') {
  if (device === 'desktop') await page.setViewportSize({ width: 1280, height: 800 })
  // install statt setFixedTime: die Uhr laeuft ab dem Startpunkt weiter.
  // Mit eingefrorenem Date.now() bleiben Chart.js-Animationen bei 0 stehen —
  // alle Diagramme saehen aus wie leer.
  await page.clock.install({ time: new Date('2026-09-24T10:30:00+02:00') })
  if (density) {
    await page.addInitScript(d => {
      // Schluessel wie useStickyState: plain:filt:<Schema>:<Mitarbeiter>:<Name>
      localStorage.setItem('plain:filt:v2:1:ui.density', JSON.stringify(d))
    }, density)
  }
  await mockPilot(page, opts)
}

async function shoot(page: Page, device: string, name: string) {
  await hideDevtools(page)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${device}-${name}.png` })
  // Ab 1024px scrollt nur .app-main — fullPage saehe dort nur den Ausschnitt.
  // Fuer das Gesamtbild wird das Fenster kurz so hoch wie der Inhalt.
  const vp = page.viewportSize()!
  const inner = await page.evaluate(() => {
    const m = document.querySelector('.app-main') as HTMLElement | null
    return m && m.scrollHeight > m.clientHeight ? m.scrollHeight - m.clientHeight : 0
  })
  if (inner > 0) {
    await page.setViewportSize({ width: vp.width, height: Math.min(vp.height + inner, 7000) })
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: `${OUT}/${device}-${name}-voll.png`, fullPage: true })
  if (inner > 0) await page.setViewportSize(vp)
}

async function open(page: Page, url: string) {
  await page.goto(url)
  await page.locator('.app-main').waitFor()
  await page.waitForLoadState('networkidle')
}

test('Übersicht Geschäftsleitung', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/')
  await shoot(page, info.project.name, 'uebersicht-gl')
})

// Der Alltag: Einfuehrung einmal weggeklickt (gleicher Schluessel vorher/nachher).
test('Übersicht Geschäftsleitung – Alltag', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('plansimple.welcome_dismissed_1', '1'))
  await prepare(page, info.project.name)
  await open(page, '/')
  await shoot(page, info.project.name, 'uebersicht-gl-alltag')
})

test('Übersicht Controller', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('plansimple.welcome_dismissed_1', '1'))
  await prepare(page, info.project.name, { role: 'controller' })
  await open(page, '/')
  await shoot(page, info.project.name, 'uebersicht-controller')
})

test('Übersicht Mitarbeiter', async ({ page }, info) => {
  await prepare(page, info.project.name, { role: 'mitarbeiter' })
  await open(page, '/')
  await shoot(page, info.project.name, 'uebersicht-ma')
})

test('Projektliste', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte')
  await page.locator('.sx-table, .sxm-list, table').first().waitFor()
  await shoot(page, info.project.name, 'projektliste')
})

test('Projekt – Struktur', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=struktur&projectId=1')
  await page.locator('.sx-table, .sxm-list, table').first().waitFor()
  await shoot(page, info.project.name, 'projekt-struktur')
})

for (const d of ['compact', 'comfortable'] as const) {
  test(`Projekt – Struktur (${d})`, async ({ page }, info) => {
    test.skip(!since(1), 'Dichte gibt es erst mit dem Pilot')
    await prepare(page, info.project.name, {}, d)
    await open(page, '/projekte?tab=struktur&projectId=1')
    await page.locator('.sx-table, .sxm-list, table').first().waitFor()
    await shoot(page, info.project.name, `projekt-struktur-${d}`)
  })
}

test('Projekt – Struktur mit Änderungen', async ({ page }, info) => {
  test.skip(!since(1), 'Änderungszähler gibt es erst mit dem Pilot')
  test.skip(info.project.name !== 'desktop', 'Inline-Bearbeitung ist Desktop')
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=struktur&projectId=1')
  await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Grundlagenermittlung und Bestandsaufnahme')
  await page.getByRole('textbox', { name: 'Honorar' }).nth(1).fill('295000')
  await shoot(page, info.project.name, 'projekt-struktur-geaendert')
})

test('Projekt – wechseln über den Namen', async ({ page }, info) => {
  test.skip(!since(2), 'Umschalter über den Namen gibt es erst mit Runde 2')
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=struktur')
  await page.getByRole('button', { name: /Projekt wechseln/ }).click()
  await page.getByRole('dialog', { name: 'Projekt wechseln' }).waitFor()
  await shoot(page, info.project.name, 'projekt-wechseln')
})

test('Projekt – Buchungen', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=buchungen&projectId=1')
  await page.locator('.sx-table, .sxm-list, table').first().waitFor()
  await shoot(page, info.project.name, 'projekt-buchungen')
})

test('Stunden buchen – Dialog', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=buchungen&projectId=1')
  await page.getByRole('button', { name: /Stundenbuchung|^\s*Stunden( buchen)?\s*$/ }).first().click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'buchung-dialog')
})

test('Zeit buchen – aus dem Kopf', async ({ page }, info) => {
  test.skip(!since(1), 'Einstieg gibt es erst mit dem Pilot')
  await prepare(page, info.project.name)
  await open(page, '/')
  await page.getByRole('button', { name: 'Zeit buchen' }).first().click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'zeit-buchen-kopf')
})

test('Rechnungsliste', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/rechnungen')
  await shoot(page, info.project.name, 'rechnungen-liste')
})

test('Abschlagsrechnung – Schritte', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/rechnungen?tab=abschlag')
  const dev = info.project.name
  await page.locator('#pp-project').fill('P-2024')
  await page.locator('.autocomplete-item').first().click()
  await page.waitForTimeout(400)
  await shoot(page, dev, 'abschlag-1')
  await page.getByRole('button', { name: /^Weiter/ }).last().click()
  await page.waitForTimeout(400)
  await shoot(page, dev, 'abschlag-2')
  await page.getByRole('button', { name: /^Weiter/ }).last().click()
  await page.locator('.sx-table, .sxm-list, table').first().waitFor()
  await shoot(page, dev, 'abschlag-3')
  await page.getByRole('button', { name: /^Weiter/ }).last().click()
  await page.waitForTimeout(400)
  await shoot(page, dev, 'abschlag-4')
  if (since(1)) {
    await page.getByRole('button', { name: 'Jetzt buchen' }).click()
    await page.getByRole('dialog').waitFor()
    await shoot(page, dev, 'abschlag-5-bestaetigen')
  }
})

test('Abschlagsrechnung – Entwurf fortsetzen', async ({ page }, info) => {
  test.skip(!since(1), 'Fortsetzen per URL gibt es erst mit dem Pilot')
  await prepare(page, info.project.name)
  await open(page, '/rechnungen?tab=abschlag&draftId=501')
  await page.locator('#pp-buyer-ref').waitFor()
  await shoot(page, info.project.name, 'abschlag-entwurf')
})

test('Rechnungen – Neue Rechnung', async ({ page }, info) => {
  test.skip(!since(1), 'Menü gibt es erst mit dem Pilot')
  await prepare(page, info.project.name)
  await open(page, '/rechnungen')
  await page.getByRole('button', { name: /Neue Rechnung/ }).click()
  await page.getByRole('menu').waitFor()
  await shoot(page, info.project.name, 'rechnungen-neu')
})

// ── Runde 2 ──────────────────────────────────────────────────────────────────
// Vorher-Bilder fuer Runde 2 entstehen gegen den Stand am Ende von Runde 1
// (PILOT_PHASE=vorher2). Die Szenen muessen deshalb auch mit den alten
// Stempeluhr-Overlays funktionieren (.tbm-modal statt role=dialog).

const DIALOG = '[role="dialog"], .tbm-modal'

async function seedTimer(page: Page, minutesAgo: number) {
  const start = new Date(new Date('2026-09-24T10:30:00+02:00').getTime() - minutesAgo * 60_000).toISOString()
  await page.addInitScript(iso => {
    localStorage.setItem('plain-timer-session', JSON.stringify({
      state: {
        session: { employeeId: 1, employeeName: 'SM', cpRate: 0, projectId: 1, projectName: 'P-2024-001',
          structureId: 107, structureName: 'LP5.1', blockStartIso: iso },
        breakState: null, showReview: false, reviewDate: null,
      },
      version: 0,
    }))
  }, start)
}

/** Kopfzeile am Desktop, Blatt am Handy. */
async function timerAction(page: Page, device: string, name: RegExp) {
  if (device === 'mobile') {
    await page.locator('.timer-chip').click()
    await page.getByRole('dialog', { name: 'Stempeluhr' }).getByRole('button', { name }).click()
  } else {
    await page.getByRole('button', { name }).first().click()
  }
}

test('Stempeluhr – Start', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/')
  await page.getByRole('button', { name: /Stempeluhr/ }).first().click()
  await page.locator(DIALOG).last().waitFor()
  await shoot(page, info.project.name, 'stempeluhr-start')
})

test('Stempeluhr – Nächste Aufgabe', async ({ page }, info) => {
  await seedTimer(page, 95)
  await prepare(page, info.project.name)
  await open(page, '/')
  await timerAction(page, info.project.name, /^Nächste Aufgabe$/)
  await page.locator(DIALOG).last().waitFor()
  await shoot(page, info.project.name, 'stempeluhr-naechste')
})

test('Stempeluhr – Tagesübersicht', async ({ page }, info) => {
  await seedTimer(page, 30)
  await prepare(page, info.project.name)
  await page.route(/\/api\/v1\/buchungen\/timer\/drafts(\?|$)/, r => r.fulfill({ json: { data: TIMER_DRAFTS } }))
  await open(page, '/')
  await timerAction(page, info.project.name, /^Beenden/)
  await page.getByRole('button', { name: /Beenden & prüfen|Abschließen & Prüfen/ }).click()
  await page.getByText(/ohne ausreichende Pause/).waitFor()
  await shoot(page, info.project.name, 'stempeluhr-tag')
})

test('Meine Zeit – Buchung ändern', async ({ page }, info) => {
  test.skip(!since(2), 'gibt es erst mit Runde 2')
  await prepare(page, info.project.name, { role: 'mitarbeiter' })
  await open(page, '/')
  await page.locator('.mz-row').first().getByRole('button', { name: /ändern/ }).click()
  await page.getByRole('dialog', { name: 'Buchung ändern' }).waitFor()
  await shoot(page, info.project.name, 'meine-zeit-aendern')
})

test('Leistungsstände – im Projekt', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=leistungsstand')
  await page.locator('.lr-table, .ls-table').first().waitFor()
  await shoot(page, info.project.name, 'leistungsstand-projekt')
})

test('Leistungsstände – Monatsrunde', async ({ page }, info) => {
  test.skip(!since(2), 'gibt es erst mit Runde 2')
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=leistungsstaende')
  await page.locator('.lsr-list').waitFor()
  if (info.project.name === 'mobile') {
    await shoot(page, info.project.name, 'monatsrunde-liste')
    await page.locator('.lsr-item').first().click()
  }
  await page.locator('.lr-table').waitFor()
  // Eine Änderung mit Warnung: LP5.2 unter den abgerechneten Stand
  await page.getByLabel(/Neuer Stand LP5\.2/).fill('60')
  await page.getByLabel(/Neuer Stand LP6 /).fill('65')
  await shoot(page, info.project.name, 'monatsrunde')
})

test('Struktur – Handy Blatt', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile' || !since(2), 'Blatt gibt es nur am Handy, erst mit Runde 2')
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=struktur')
  await page.getByRole('button', { name: /^LP5\.2 .*bearbeiten/ }).click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'struktur-blatt')
})

// Einzel- und Schlussrechnung (Runde 2, D2). Neu begonnen statt fortgesetzt —
// „?draftId=" gab es am Ende von Runde 1 nur beim Abschlag, und die Szenen
// laufen auch gegen diesen Stand (vorher2).
async function nextStep(page: Page) {
  await page.getByRole('button', { name: /^Weiter/ }).last().click()
  await page.waitForTimeout(500)
}

test('Einzelrechnung – Schritte', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/rechnungen?tab=rechnung')
  const dev = info.project.name
  await page.locator('#pp-project, #rw-project').first().fill('P-2024')
  await page.locator('.autocomplete-item').first().click()
  await page.waitForTimeout(400)
  await nextStep(page)
  await shoot(page, dev, 'rechnung-2')
  await nextStep(page)
  await page.locator('table').first().waitFor()
  await nextStep(page)
  await shoot(page, dev, 'rechnung-4')
})

test('Schlussrechnung – Schritte', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/rechnungen?tab=schluss')
  const dev = info.project.name
  await page.locator('#sw-project').fill('P-2024')
  await page.locator('.autocomplete-item').first().click()
  await page.waitForTimeout(400)
  await nextStep(page)
  await nextStep(page)
  await page.locator('table').first().waitFor()
  await shoot(page, dev, 'schluss-3')
  await nextStep(page)
  await shoot(page, dev, 'schluss-4')
  await nextStep(page)
  await shoot(page, dev, 'schluss-5')
  if (since(2)) {
    await page.getByRole('button', { name: 'Jetzt buchen' }).click()
    await page.getByRole('dialog').waitFor()
    await shoot(page, dev, 'schluss-6-bestaetigen')
  }
})

// ── Runde 3: Angebotsstruktur ────────────────────────────────────────────────
// Vorher-Stand ist derselbe wie in main (Runde 1 und 2 liessen sie unberuehrt);
// aufgenommen als PILOT_PHASE=vorher3 aus einem Arbeitsbaum vor Runde 3.

// Seit Runde 4 ist das Angebot ein Arbeitsbereich mit URL; davor ein Modul-Reiter.
const OFFER_WORKSPACE = since(4)

async function openOfferStructure(page: Page) {
  if (OFFER_WORKSPACE) {
    await open(page, '/angebote?offerId=1&tab=struktur')
  } else {
    await page.addInitScript(() => localStorage.setItem('angebote-selected-oid', '1'))
    await open(page, '/angebote')
    await page.getByRole('tab', { name: 'Angebotsstruktur' }).click()
  }
  await page.waitForLoadState('networkidle')
  await page.locator('.structure-table, .sxm-list').first().waitFor()
}

test('Angebotsstruktur', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await openOfferStructure(page)
  await shoot(page, info.project.name, 'angebot-struktur')
})

test('Angebotsstruktur – kompakt', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !since(3), 'Dichte gibt es erst mit Runde 3, nur am Desktop')
  await prepare(page, info.project.name, {}, 'compact')
  await openOfferStructure(page)
  await shoot(page, info.project.name, 'angebot-struktur-kompakt')
})

test('Angebotsstruktur – Zuschläge', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Zuschlags-Panel nur am Desktop')
  await prepare(page, info.project.name)
  await openOfferStructure(page)
  if (since(3)) await page.getByRole('button', { name: 'Zuschläge von LP5 bearbeiten' }).click()
  else await page.locator('tr[data-struct-id="206"] .row-action-btn').first().click()
  await page.locator('.surcharge-panel').waitFor()
  await shoot(page, info.project.name, 'angebot-struktur-zuschlag')
})

test('Angebotsstruktur – offene Änderungen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !since(3), 'Puffer und Aktionsleiste gibt es erst mit Runde 3')
  await prepare(page, info.project.name)
  await openOfferStructure(page)
  // Erst fokussieren, dann tippen: das Betragsfeld tauscht beim Fokus die
  // Anzeige gegen den Rohwert — ein sofortiges fill() haengte sonst an.
  const fee = page.locator('tr[data-struct-id="203"]').getByRole('textbox', { name: 'Honorar' })
  await fee.click()
  await page.waitForTimeout(100)
  await fee.fill('15800')
  await page.getByRole('textbox', { name: 'Stunden BL1' }).fill('30')
  await page.getByRole('textbox', { name: 'Stunden BL3' }).click()
  await shoot(page, info.project.name, 'angebot-struktur-geaendert')
})

test('Angebotsstruktur – neues Element', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Dialog am Desktop')
  await prepare(page, info.project.name)
  await openOfferStructure(page)
  const nachher = since(3)
  await page.getByRole('button', { name: nachher ? /Neues Element/ : /Neue Position/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.locator('input').first().fill('BL4')
  await dialog.locator('select').first().selectOption('2')
  if (nachher) {
    await dialog.getByLabel('Bezeichnung').fill('Mitwirkung Nachbarschaftsbeteiligung')
    await dialog.getByLabel('Rolle').selectOption('2')
    await dialog.getByLabel('Stunden').fill('8')
    await dialog.getByLabel('Übergeordnetes Element').selectOption('210')
  } else {
    await dialog.locator('input').nth(1).fill('Mitwirkung Nachbarschaftsbeteiligung')
    await dialog.locator('select').nth(1).selectOption('2')
    await dialog.locator('input[type="number"]').first().fill('8')
    await dialog.locator('select').last().selectOption('210')
  }
  await shoot(page, info.project.name, 'angebot-neu')
})

test('Angebotsstruktur – Handy Blatt', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile' || !since(3), 'Blatt gibt es nur am Handy, erst mit Runde 3')
  await prepare(page, info.project.name)
  await openOfferStructure(page)
  await page.getByRole('button', { name: /^BL1 .*bearbeiten/ }).click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'angebot-blatt')
})

// ── Runde 4: Angebote als Arbeitsbereich ─────────────────────────────────────
test('Angebote – Liste', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/angebote')
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'angebote-liste')
})

test('Angebot – Angebotsdaten', async ({ page }, info) => {
  await prepare(page, info.project.name)
  if (OFFER_WORKSPACE) {
    await open(page, '/angebote?offerId=1&tab=daten')
  } else {
    await open(page, '/angebote')
    await page.locator('table').first().waitFor()
    await page.getByTitle('Angebotsdaten bearbeiten').first().click()
    await page.getByRole('dialog').waitFor()
  }
  await page.waitForLoadState('networkidle')
  await shoot(page, info.project.name, 'angebot-daten')
})

test('Angebot – wechseln', async ({ page }, info) => {
  test.skip(!OFFER_WORKSPACE, 'Umschalter über den Namen gibt es erst mit Runde 4')
  await prepare(page, info.project.name)
  await openOfferStructure(page)
  await page.locator('.pw-title-btn').click()
  await page.waitForTimeout(300)
  await shoot(page, info.project.name, 'angebot-wechseln')
})

// ── Runde 4: Rückmeldung zu Runde 3 ──────────────────────────────────────────
// Ausschnitte in doppelter Aufloesung: Farbe und Buendigkeit der Zuschlaege
// sind im ganzen Bild nicht zu erkennen.
test.describe('Ausschnitte', () => {
  test.use({ deviceScaleFactor: 2 })

  async function clipTable(page: Page, name: string, rows: number) {
    // Hoch genug, dass die feste Aktionsleiste unter dem Ausschnitt liegt.
    await page.setViewportSize({ width: 1280, height: 1400 })
    await hideDevtools(page)
    await page.waitForTimeout(500)
    const clip = await page.evaluate((n) => {
      const t = document.querySelector('.sx-table') as HTMLElement
      const trs = t.querySelectorAll('tbody tr')
      const last = trs[Math.min(n, trs.length) - 1] as HTMLElement
      const a = t.getBoundingClientRect(), b = last.getBoundingClientRect()
      return { x: a.left, y: a.top, width: a.width, height: b.bottom - a.top }
    }, rows)
    await page.screenshot({ path: `${OUT}/desktop-${name}.png`, clip })
  }

  test('Zuschläge – Ausschnitt Angebot', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop' || !since(3), 'Tabelle am Desktop, erst mit Runde 3')
    await prepare(page, info.project.name)
    await openOfferStructure(page)
    await clipTable(page, 'angebot-zuschlaege', 7)
  })

  test('Zuschläge – Ausschnitt Projekt', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop' || !since(2), 'Tabelle am Desktop, erst mit Runde 2')
    await prepare(page, info.project.name)
    await open(page, '/projekte?projectId=1&tab=struktur')
    await page.locator('.sx-table').waitFor()
    await clipTable(page, 'projekt-zuschlaege', 7)
  })
})

test('Struktur – Spalten', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !since(4), 'Spaltenauswahl am Desktop, erst mit Runde 4')
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=struktur')
  await page.locator('.sx-table').waitFor()
  await page.getByRole('button', { name: /Spalten/ }).click()
  await page.waitForTimeout(200)
  await shoot(page, info.project.name, 'struktur-spalten')
})

// ── Runde 5: Vom Angebot zum Projekt ─────────────────────────────────────────
// Vorher-Stand ist main nach Runde 4 (PILOT_PHASE=vorher5, Arbeitsbaum).

test('Angebotsstruktur – Aufwand nach Rollen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !since(4), 'Tabelle am Desktop')
  await prepare(page, info.project.name)
  await openOfferStructure(page)
  const row = page.locator('tr[data-struct-id="211"]')
  if (since(5)) {
    await row.getByRole('button', { name: 'Aktionen zu BL1' }).click()
    await page.getByRole('menuitem', { name: 'Aufwand nach Rollen' }).click()
    const panel = page.getByRole('group', { name: 'Aufwand BL1 nach Rollen' })
    await panel.getByRole('button', { name: 'Rolle hinzufügen' }).click()
    await panel.getByRole('combobox', { name: 'Rolle, Zeile 2' }).selectOption('4')
    await panel.getByRole('textbox', { name: 'Stunden, Zeile 2' }).fill('10')
    await page.getByRole('textbox', { name: 'Stunden, Zeile 1' }).click()
  }
  await row.scrollIntoViewIfNeeded()
  await page.evaluate(() => document.querySelector('.app-main')?.scrollBy(0, 120))
  await shoot(page, info.project.name, 'angebot-aufwand')
})

async function openBeauftragt(page: Page) {
  await openOfferStructure(page)
  const head = page.getByRole('button', { name: /Beauftragt/ })
  if (await head.count()) await head.first().click()
  else {
    await page.getByRole('button', { name: /Weitere Aktionen|Aktionen/ }).first().click()
    await page.getByRole('menuitem', { name: /als beauftragt markieren/i }).click()
  }
  await page.getByRole('dialog').waitFor()
  await page.waitForLoadState('networkidle')
}

test('Beauftragen – Dialog', async ({ page }, info) => {
  test.skip(!since(4), 'Dialog im Kopf gibt es erst mit Runde 4')
  await prepare(page, info.project.name)
  await openBeauftragt(page)
  await shoot(page, info.project.name, 'beauftragen')
})

test('Projekt – Plan nach Aufwand', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Tabelle am Desktop')
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=struktur')
  await page.locator('.sx-table').waitFor()
  await page.locator('tr[data-struct-id="124"]').scrollIntoViewIfNeeded()
  await page.evaluate(() => document.querySelector('.app-main')?.scrollBy(0, 200))
  await shoot(page, info.project.name, 'projekt-plan')
})

test('Projekt – Plan bearbeiten', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !since(5), 'gibt es erst mit Runde 5')
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=struktur')
  await page.locator('tr[data-struct-id="124"]').getByRole('button', { name: /Aktionen zu NA2/ }).click()
  await page.getByRole('menuitem', { name: 'Plan bearbeiten …' }).click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'projekt-plan-dialog')
})

test('Kalkulationen – Liste', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=honorar')
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'kalk-liste')
})

/** Neue Kalkulation im Angebot bis zu Schritt `upto` (2 = Grundlagen …). */
async function kalkulation(page: Page, device: string, upto: number) {
  await open(page, '/angebote?offerId=1&tab=kalkulationen')
  await page.getByRole('button', { name: /Neue Kalkulation|Kalkulation hinzufügen/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.locator('select').nth(0).selectOption('1')
  await page.waitForLoadState('networkidle')
  await dialog.locator('select').nth(1).selectOption('10')
  if (upto === 1) { await shoot(page, device, 'kalk-1-leistungsbild'); return }
  const weiter = () => dialog.getByRole('button', { name: /^(Speichern & )?Weiter/ }).last().click()
  await weiter()
  await dialog.locator('select').nth(0).selectOption('3')
  await dialog.locator('input[type="number"]').nth(0).fill('50')
  await dialog.locator('input[type="number"]').nth(1).fill('2450000')
  if (upto === 2) { await shoot(page, device, 'kalk-2-grundlagen'); return }
  await weiter(); await page.waitForLoadState('networkidle')
  if (upto === 3) { await shoot(page, device, 'kalk-3-leistungsphasen'); return }
  await weiter(); await page.waitForLoadState('networkidle')
  await weiter(); await page.waitForLoadState('networkidle')
  await dialog.getByRole('button', { name: /Umbauzuschlag/ }).click()
  await dialog.getByRole('button', { name: /Details/ }).first().click()
  if (upto === 5) { await shoot(page, device, 'kalk-5-zuschlaege'); return }
  await weiter(); await page.waitForLoadState('networkidle')
  await shoot(page, device, 'kalk-6-uebernehmen')
}

for (const [upto, name] of [[1, 'Leistungsbild'], [2, 'Grundlagen'], [3, 'Leistungsphasen'], [5, 'Zuschläge'], [6, 'Übernehmen']] as const) {
  test(`Kalkulation – ${name}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop' && upto !== 2, 'am Handy nur Grundlagen')
    await prepare(page, info.project.name)
    await kalkulation(page, info.project.name, upto)
  })
}

test('Kalkulation – Schließen fragt nach', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !since(5), 'Rückfrage gibt es erst mit Runde 5')
  await prepare(page, info.project.name)
  await kalkulation(page, info.project.name, 2)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' }).waitFor()
  await shoot(page, info.project.name, 'kalk-schliessen')
})

// ── Runde 6: Verträge, Preislisten, Interne Budgets ──────────────────────────

test('Projekt – Vertrag', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=vertraege')
  // Vor Runde 6 hingen die Beschriftungen nicht am Feld
  await page.getByText('Vertragsnummer').first().waitFor()
  await shoot(page, info.project.name, 'vertrag')
})

test('Projekt – Vertrag geändert', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=vertraege')
  await page.getByText('Vertragsnummer').first().waitFor()
  if (since(6)) await page.getByLabel(/^Skonto \(%\)/).fill('3')
  else await page.locator('input[type="number"]').first().fill('3')
  await page.locator('select').filter({ has: page.locator('option[value="AE"]') }).selectOption('AE')
  await page.locator('input[type="text"]').first().focus()
  await shoot(page, info.project.name, 'vertrag-geaendert')
})

test('Projekt – Preislisten', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=mitarbeiter')
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'preislisten')
})

test('Projekt – Preislisten bearbeiten', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=mitarbeiter')
  await page.locator('table').first().waitFor()
  if (since(6)) await page.getByRole('button', { name: /SB: Sabine Braun-Hofmeister bearbeiten/ }).click()
  else await page.locator('table').first().locator('tbody tr').nth(2).getByTitle('Bearbeiten').click()
  await shoot(page, info.project.name, 'preislisten-bearbeiten')
})

test('Projekt – Interne Budgets', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=budget')
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'budget')
})

test('Projekt – Budget Regel anlegen', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=budget')
  await page.getByRole('button', { name: /Neue Regel/ }).first().click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'budget-regel')
})

test('Kalkulation im Angebot – Übersicht', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Assistent am Desktop')
  await prepare(page, info.project.name)
  await open(page, '/angebote?offerId=1&tab=kalkulationen')
  await page.getByRole('button', { name: 'Gebäude und Innenräume bearbeiten' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  for (let i = 0; i < 4; i++) {
    await dialog.getByRole('button', { name: /Weiter/ }).last().click()
    await page.waitForLoadState('networkidle')
  }
  await shoot(page, info.project.name, 'kalk-angebot-uebersicht')
})

// ── Runde 7: Nachträge, Adresssuche ──────────────────────────────────────────

test('Nachträge – im Projekt', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=nachtraege')
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'nachtraege-liste')
})

test('Nachtrag – Detail', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/nachtraege/402')
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'nachtrag-detail')
})

test('Nachtrag – Freigeben', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/nachtraege/402')
  await page.getByRole('button', { name: /Freigeben/ }).first().click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'nachtrag-freigeben')
})

test('Nachtrag – Position hinzufügen', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/nachtraege/402')
  await page.getByRole('button', { name: /Position hinzufügen/ }).first().click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'nachtrag-position')
})

test('Adresssuche – Treffer mit Tastatur', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=vertraege')
  const box = page.locator('#vt-address')
  await box.fill('Sta')
  await page.locator('.autocomplete-item').first().waitFor()
  await box.press('ArrowDown'); await box.press('ArrowDown')
  await shoot(page, info.project.name, 'adresssuche')
})

// ── Runde 8: Projektdaten, Kalkulation am Handy, Adressen und Kontakte ──────

test('Projektdaten', async ({ page }, info) => {
  await prepare(page, info.project.name)
  if (since(8)) {
    await open(page, '/projekte?projectId=1&tab=daten')
    await page.locator('#pd-name').waitFor()
  } else {
    // Vorher: Dialog in der Projektliste
    await open(page, '/projekte')
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).first().click()
    await page.getByRole('dialog').waitFor()
  }
  await shoot(page, info.project.name, 'projektdaten')
})

/** Bestehende Kalkulation 71 (mit Besonderer Leistung und Zuschlag) bis Schritt `upto`. */
async function kalkBestand(page: Page, upto: 3 | 4 | 5) {
  await open(page, '/projekte?projectId=1&tab=honorar')
  await page.getByRole('button', { name: 'Gebäude und Innenräume bearbeiten' }).first().click()
  // Im Projekt steht der Assistent auf der Seite, im Angebot im Dialog
  const wizard = page.locator('.hw-root')
  await wizard.waitFor()
  await page.waitForLoadState('networkidle')
  for (let s = 2; s < upto; s++) {
    // exakt: „Weitere Aktionen" (Handy) beginnt auch mit „Weiter"
    await wizard.getByRole('button', { name: 'Weiter', exact: true }).click()
    await page.waitForLoadState('networkidle')
  }
  return wizard
}

for (const [upto, name] of [[3, 'leistungsphasen'], [4, 'bl'], [5, 'zuschlaege']] as const) {
  test(`Kalkulation am Handy – ${name}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'Handy')
    await prepare(page, info.project.name)
    await kalkBestand(page, upto)
    await shoot(page, info.project.name, `kalk-handy-${name}`)
  })
}

test('Kalkulation am Handy – Blatt', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile' || !since(8), 'Blatt gibt es erst mit Runde 8')
  await prepare(page, info.project.name)
  await kalkBestand(page, 5)
  await page.getByRole('list', { name: 'Zuschläge und Nachlässe' }).getByRole('button').first().click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'kalk-handy-blatt')
})

test('Kalkulation am Handy – Blatt im Angebot', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile' || !since(8), 'Blatt gibt es erst mit Runde 8')
  await prepare(page, info.project.name)
  await open(page, '/angebote?offerId=1&tab=kalkulationen')
  await page.getByRole('button', { name: 'Gebäude und Innenräume bearbeiten' }).click()
  const wizard = page.locator('.hw-root')
  await wizard.waitFor()
  await wizard.getByRole('button', { name: 'Weiter', exact: true }).click()
  await page.getByRole('list', { name: 'Leistungsphasen' }).getByRole('button').nth(4).click()
  await page.getByRole('dialog', { name: /LPH 5/ }).waitFor()
  await shoot(page, info.project.name, 'kalk-handy-blatt-angebot')
})

// Adressen und Kontakte
test('Adressen – Liste', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/adressen')
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'adressen-liste')
})

test('Adresse – Seite', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/adressen/2')
  await page.getByRole('heading', { level: 1, name: /Wohnbau Süd/ }).waitFor()
  await shoot(page, info.project.name, 'adresse')
})

test('Adresse – bearbeiten', async ({ page }, info) => {
  await prepare(page, info.project.name)
  if (since(8)) {
    await open(page, '/adressen/2?tab=daten')
    await page.getByLabel('Name 1*').waitFor()
  } else {
    await open(page, '/adressen/2')
    // Der Kopf-Knopf — die Stifte der Kontaktzeilen heissen auch „Bearbeiten"
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).first().click()
    await page.getByRole('dialog').waitFor()
  }
  await shoot(page, info.project.name, 'adresse-bearbeiten')
})

test('Adresse – Kontakt anlegen', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/adressen/2')
  await page.getByRole('button', { name: since(8) ? 'Kontakt hinzufügen' : 'Kontakt' }).first().click()
  await page.getByRole('dialog').waitFor()
  await shoot(page, info.project.name, 'kontakt-neu')
})

test('Adresse – verwendet in', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, since(8) ? '/adressen/2?tab=verwendung' : '/adressen/2')
  await page.getByText('P-2024-002').first().waitFor()
  await shoot(page, info.project.name, 'adresse-verwendung')
})

test('Kontakte – Liste', async ({ page }, info) => {
  await prepare(page, info.project.name)
  if (since(8)) await open(page, '/adressen?tab=kontakte')
  else { await open(page, '/adressen'); await page.getByRole('tab', { name: 'Kontakte' }).click() }
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'kontakte-liste')
})

// ── Runde 9: Angebotsdaten, Kontakt vorbelegen ──────────────────────────────

const json9 = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** Kontakte je Adresse: 1 mit Hauptansprechpartner, 2 mit genau einem. */
async function mockContacts9(page: Page) {
  const byAddress: Record<string, unknown[]> = {
    '1': [
      { ID: 2, FIRST_NAME: 'Rainer', LAST_NAME: 'Vogt', IS_PRIMARY: 1 },
      { ID: 1, FIRST_NAME: 'Petra', LAST_NAME: 'Albrecht', IS_PRIMARY: 0 },
    ],
    '2': [{ ID: 5, FIRST_NAME: 'Jonas', LAST_NAME: 'Keller', IS_PRIMARY: 0 }],
  }
  await page.route(/\/api\/v1\/stammdaten\/contacts\/by-address(\?|$)/, r => {
    const id = new URL(r.request().url()).searchParams.get('address_id') ?? ''
    return r.fulfill(json9({ data: byAddress[id] ?? [] }))
  })
  await page.route(/\/api\/v1\/stammdaten\/companies(\?|$)/, r => r.fulfill(json9({ data: [{ ID: 1, COMPANY_NAME_1: 'Büro Messina Architekten' }] })))
}

async function pick9(page: Page, input: string, query: string, name: string) {
  await page.locator(input).fill(query)
  // Vorher (Runde 8) lag der Dialog am Handy 1111 px breit — der Treffer war
  // nicht erreichbar. Das Bild zeigt dann genau diesen Zustand.
  await page.getByRole('option', { name }).click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(400)
}

test('Angebotsdaten', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await mockContacts9(page)
  await open(page, '/angebote?offerId=1&tab=daten')
  await page.locator('.form-group', { hasText: 'Angebotstitel' }).locator('input').waitFor()
  await shoot(page, info.project.name, 'angebotsdaten')
})

test('Angebotsdaten – geändert', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await mockContacts9(page)
  // Offen: die Stadtwerke als Empfänger — ein Kontakt; danach Titel angepasst
  await open(page, '/angebote?offerId=1&tab=daten')
  await page.locator('.form-group', { hasText: 'Angebotstitel' }).locator('input').fill('Neubau Kita Sonnenblume — Leistungsphasen 1–5, Stadtwerke')
  await pick9(page, since(9) ? '#od-addr' : '#stmd-offer-addr', 'Stadtw', 'Stadtwerke Ravensburg GmbH')
  await page.locator('.form-group', { hasText: /^Kontakt/ }).locator('select').scrollIntoViewIfNeeded()
  await shoot(page, info.project.name, 'angebotsdaten-geaendert')
})

test('Neues Angebot', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await mockContacts9(page)
  await open(page, '/angebote')
  await page.getByRole('button', { name: '+ Neues Angebot' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.waitFor()
  await dlg.locator('.form-group', { hasText: 'Angebotstitel' }).locator('input').fill('Umbau Rathaus, Leistungsphasen 1–4')
  await pick9(page, since(9) ? '#on-addr' : '#offer-addr', 'Musterst', 'Stadt Musterstadt – Hochbauamt')
  // Der Empfänger ist der Teil, der sich geändert hat — in die Mitte holen
  await dlg.locator('.form-group', { hasText: /^Kontakt/ }).locator('select').first()
    .evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {})
  await shoot(page, info.project.name, 'angebot-neu')
})

test('Vertrag – Rechnungsempfänger gewählt', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await mockContacts9(page)
  await open(page, '/projekte?projectId=1&tab=vertraege')
  await pick9(page, '#vt-address', 'Stadtw', 'Stadtwerke Ravensburg GmbH')
  await shoot(page, info.project.name, 'vertrag-kontakt')
})
