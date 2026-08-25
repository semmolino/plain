import { test } from '@playwright/test'
import { mockDemo, hideDevtools } from './fixtures/demoData'

/**
 * Bildstrecke fuer den Design-Vergleich.
 *
 * Kein Test — dieser Lauf prueft nichts, er nimmt auf. Zweck ist, mehrere
 * Design-Varianten (je ein Branch) an denselben Stellen und in denselben
 * Breiten nebeneinanderlegen zu koennen.
 *
 *   npx playwright test design-shots --project=desktop
 *   DESIGN_NAME=planar npx playwright test design-shots --project=desktop
 *
 * Ablage: design-shots/<DESIGN_NAME>/<breite>/<route>.png
 *
 * Die Auswahl der Seiten ist bewusst klein gehalten. Diese sieben decken das
 * gesamte sichtbare Vokabular ab — Kennzahlen und Diagramme, dichte Tabellen
 * mit Filterleiste, Baumstruktur, Formulare, Einstellungen. Wer alles
 * aufnimmt, vergleicht am Ende nichts mehr.
 */

const DESIGN = process.env.DESIGN_NAME ?? 'base'

const VIEWPORTS: [string, number, number][] = [
  ['desktop', 1280, 800],
  ['tablet',   768, 1024],
  ['mobile',   390, 844],
]

const ROUTEN: [string, string][] = [
  ['uebersicht',   '/'],
  ['projekte',     '/projekte'],
  ['rechnungen',   '/rechnungen'],
  ['angebote',     '/angebote'],
  ['adressen',     '/adressen'],
  ['reporting',    '/daten'],
  ['einstellungen','/admin'],
]

for (const [vpName, width, height] of VIEWPORTS) {
  for (const [name, url] of ROUTEN) {
    test(`${DESIGN} · ${vpName} · ${name}`, async ({ page }, testInfo) => {
      // Der Lauf setzt seine Breiten selbst; sonst entstuende jede Aufnahme
      // zweimal (einmal je Playwright-Projekt) mit falschem Namen.
      test.skip(testInfo.project.name !== 'desktop', 'nur einmal aufnehmen')

      await page.setViewportSize({ width, height })
      await mockDemo(page)
      await page.goto(url)
      await hideDevtools(page)
      await page.locator('.app-main').waitFor()

      // Diagramme und Skeletons brauchen einen Moment, sonst landet der
      // Ladezustand im Bild statt der Seite.
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(600)

      await page.screenshot({
        path: `design-shots/${DESIGN}/${vpName}/${name}.png`,
        fullPage: true,
      })
    })
  }
}
