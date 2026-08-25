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

/** Routen, bei denen vor der Aufnahme noch etwas geoeffnet wird. */
const OEFFNEN: Record<string, string> = {
  // Overlays sind sonst auf keinem Bild zu sehen, obwohl sie eines der
  // auffaelligsten Bauteile eines Designs sind.
  overlay: '.notif-bell-btn',
}

const ROUTEN: [string, string][] = [
  ['overlay',      '/'],
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

      // Laufzeitfehler muessen den Lauf scheitern lassen. Ohne diese Pruefung
      // meldete er "bestanden", waehrend auf jedem Bild der rote
      // Fehlerbildschirm von Vite stand — die Seite wartet nur auf .app-main,
      // und das Fehler-Overlay hat den auch.
      const fehler: string[] = []
      page.on('pageerror', e => fehler.push(e.message))

      await page.setViewportSize({ width, height })
      await mockDemo(page)
      await page.goto(url)
      await hideDevtools(page)

      // Ab 1024px klemmt globals.css .app-layout auf Viewport-Hoehe; gescrollt
      // wird nur .app-main. fullPage sieht davon nichts und liefert genau
      // einen Bildschirm — fuer eine Designdurchsicht zu wenig. Fuer die
      // Aufnahme wird die Klemmung geloest, damit das ganze Blatt entsteht.
      await page.addStyleTag({ content: `
        @media (min-width: 1024px) {
          .app-layout { height: auto !important; overflow: visible !important; }
          .app-main   { overflow: visible !important; }
        }
      ` })

      await page.locator('.app-main').waitFor()

      // Diagramme und Skeletons brauchen einen Moment, sonst landet der
      // Ladezustand im Bild statt der Seite.
      await page.waitForLoadState('networkidle').catch(() => {})
      // Chart.js animiert seine Reihen rund 1s ein. Mit 600ms standen auf
      // den Bildern Achsen und Legende, aber keine Linien.
      await page.waitForTimeout(1600)

      const zuOeffnen = OEFFNEN[name]
      if (zuOeffnen) {
        await page.locator(zuOeffnen).click()
        await page.waitForTimeout(250)
      }

      await page.screenshot({
        path: `design-shots/${DESIGN}/${vpName}/${name}.png`,
        fullPage: true,
      })

      if (fehler.length) throw new Error('Laufzeitfehler auf ' + url + ': ' + fehler.join(' · '))
    })
  }
}
