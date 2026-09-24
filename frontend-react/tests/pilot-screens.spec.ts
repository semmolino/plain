import { test, type Page } from '@playwright/test'
import { hideDevtools } from './fixtures/demoData'
import { mockPilot } from './fixtures/pilotData'

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
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'projektliste')
})

test('Projekt – Struktur', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=struktur&projectId=1')
  await page.locator('table').first().waitFor()
  await shoot(page, info.project.name, 'projekt-struktur')
})

for (const d of ['compact', 'comfortable'] as const) {
  test(`Projekt – Struktur (${d})`, async ({ page }, info) => {
    test.skip(PHASE !== 'nachher', 'Dichte gibt es erst mit dem Pilot')
    await prepare(page, info.project.name, {}, d)
    await open(page, '/projekte?tab=struktur&projectId=1')
    await page.locator('table').first().waitFor()
    await shoot(page, info.project.name, `projekt-struktur-${d}`)
  })
}

test('Projekt – Struktur mit Änderungen', async ({ page }, info) => {
  test.skip(PHASE !== 'nachher', 'Änderungszähler gibt es erst mit dem Pilot')
  test.skip(info.project.name !== 'desktop', 'Inline-Bearbeitung ist Desktop')
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=struktur&projectId=1')
  await page.getByRole('textbox', { name: 'Bezeichnung' }).nth(1).fill('Grundlagenermittlung und Bestandsaufnahme')
  await page.getByRole('textbox', { name: 'Honorar' }).nth(1).fill('295000')
  await shoot(page, info.project.name, 'projekt-struktur-geaendert')
})

test('Projekt – wechseln über den Namen', async ({ page }, info) => {
  test.skip(PHASE !== 'nachher', 'Umschalter über den Namen gibt es erst mit Runde 2')
  await prepare(page, info.project.name)
  await open(page, '/projekte?projectId=1&tab=struktur')
  await page.getByRole('button', { name: /Projekt wechseln/ }).click()
  await page.getByRole('dialog', { name: 'Projekt wechseln' }).waitFor()
  await shoot(page, info.project.name, 'projekt-wechseln')
})

test('Projekt – Buchungen', async ({ page }, info) => {
  await prepare(page, info.project.name)
  await open(page, '/projekte?tab=buchungen&projectId=1')
  await page.locator('table').first().waitFor()
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
  test.skip(PHASE !== 'nachher', 'Einstieg gibt es erst mit dem Pilot')
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
  await page.locator('table').first().waitFor()
  await shoot(page, dev, 'abschlag-3')
  await page.getByRole('button', { name: /^Weiter/ }).last().click()
  await page.waitForTimeout(400)
  await shoot(page, dev, 'abschlag-4')
  if (PHASE === 'nachher') {
    await page.getByRole('button', { name: 'Jetzt buchen' }).click()
    await page.getByRole('dialog').waitFor()
    await shoot(page, dev, 'abschlag-5-bestaetigen')
  }
})

test('Abschlagsrechnung – Entwurf fortsetzen', async ({ page }, info) => {
  test.skip(PHASE !== 'nachher', 'Fortsetzen per URL gibt es erst mit dem Pilot')
  await prepare(page, info.project.name)
  await open(page, '/rechnungen?tab=abschlag&draftId=501')
  await page.locator('#pp-buyer-ref').waitFor()
  await shoot(page, info.project.name, 'abschlag-entwurf')
})

test('Rechnungen – Neue Rechnung', async ({ page }, info) => {
  test.skip(PHASE !== 'nachher', 'Menü gibt es erst mit dem Pilot')
  await prepare(page, info.project.name)
  await open(page, '/rechnungen')
  await page.getByRole('button', { name: /Neue Rechnung/ }).click()
  await page.getByRole('menu').waitFor()
  await shoot(page, info.project.name, 'rechnungen-neu')
})
