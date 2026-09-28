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

// vorher  = Stand vor dem Pilot (main), vorher2 = Stand nach Runde 1,
// nachher = aktueller Stand. Szenen aus Runde 1 fehlen nur in „vorher",
// Szenen aus Runde 2 in beiden Vorher-Phasen.
const PHASE = process.env.PILOT_PHASE ?? 'nachher'
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
    test.skip(PHASE === 'vorher', 'Dichte gibt es erst mit dem Pilot')
    await prepare(page, info.project.name, {}, d)
    await open(page, '/projekte?tab=struktur&projectId=1')
    await page.locator('.sx-table, .sxm-list, table').first().waitFor()
    await shoot(page, info.project.name, `projekt-struktur-${d}`)
  })
}

test('Projekt – Struktur mit Änderungen', async ({ page }, info) => {
  test.skip(PHASE === 'vorher', 'Änderungszähler gibt es erst mit dem Pilot')
  test.skip(info.project.name !== 'desktop', 'Inline-Bearbeitung ist Desktop')
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=struktur&projectId=1')
  await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Grundlagenermittlung und Bestandsaufnahme')
  await page.getByRole('textbox', { name: 'Honorar' }).nth(1).fill('295000')
  await shoot(page, info.project.name, 'projekt-struktur-geaendert')
})

test('Projekt – wechseln über den Namen', async ({ page }, info) => {
  test.skip(!PHASE.startsWith('nachher'), 'Umschalter über den Namen gibt es erst mit Runde 2')
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
  test.skip(PHASE === 'vorher', 'Einstieg gibt es erst mit dem Pilot')
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
  if (PHASE !== 'vorher') {
    await page.getByRole('button', { name: 'Jetzt buchen' }).click()
    await page.getByRole('dialog').waitFor()
    await shoot(page, dev, 'abschlag-5-bestaetigen')
  }
})

test('Abschlagsrechnung – Entwurf fortsetzen', async ({ page }, info) => {
  test.skip(PHASE === 'vorher', 'Fortsetzen per URL gibt es erst mit dem Pilot')
  await prepare(page, info.project.name)
  await open(page, '/rechnungen?tab=abschlag&draftId=501')
  await page.locator('#pp-buyer-ref').waitFor()
  await shoot(page, info.project.name, 'abschlag-entwurf')
})

test('Rechnungen – Neue Rechnung', async ({ page }, info) => {
  test.skip(PHASE === 'vorher', 'Menü gibt es erst mit dem Pilot')
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
  test.skip(!PHASE.startsWith('nachher'), 'gibt es erst mit Runde 2')
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
  test.skip(!PHASE.startsWith('nachher'), 'gibt es erst mit Runde 2')
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
  test.skip(info.project.name !== 'mobile' || !PHASE.startsWith('nachher'), 'Blatt gibt es nur am Handy, erst mit Runde 2')
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
  if (PHASE.startsWith('nachher')) {
    await page.getByRole('button', { name: 'Jetzt buchen' }).click()
    await page.getByRole('dialog').waitFor()
    await shoot(page, dev, 'schluss-6-bestaetigen')
  }
})

// ── Runde 3: Angebotsstruktur ────────────────────────────────────────────────
// Vorher-Stand ist derselbe wie in main (Runde 1 und 2 liessen sie unberuehrt);
// aufgenommen als PILOT_PHASE=vorher3 aus einem Arbeitsbaum vor Runde 3.

// Seit Runde 4 ist das Angebot ein Arbeitsbereich mit URL; davor ein Modul-Reiter.
const OFFER_WORKSPACE = PHASE.startsWith('nachher')

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
  test.skip(info.project.name !== 'desktop' || !PHASE.startsWith('nachher'), 'Dichte gibt es erst mit Runde 3, nur am Desktop')
  await prepare(page, info.project.name, {}, 'compact')
  await openOfferStructure(page)
  await shoot(page, info.project.name, 'angebot-struktur-kompakt')
})

test('Angebotsstruktur – Zuschläge', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Zuschlags-Panel nur am Desktop')
  await prepare(page, info.project.name)
  await openOfferStructure(page)
  if (PHASE.startsWith('nachher')) await page.getByRole('button', { name: 'Zuschläge von LP5 bearbeiten' }).click()
  else await page.locator('tr[data-struct-id="206"] .row-action-btn').first().click()
  await page.locator('.surcharge-panel').waitFor()
  await shoot(page, info.project.name, 'angebot-struktur-zuschlag')
})

test('Angebotsstruktur – offene Änderungen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !PHASE.startsWith('nachher'), 'Puffer und Aktionsleiste gibt es erst mit Runde 3')
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
  const nachher = PHASE.startsWith('nachher')
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
  test.skip(info.project.name !== 'mobile' || !PHASE.startsWith('nachher'), 'Blatt gibt es nur am Handy, erst mit Runde 3')
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
