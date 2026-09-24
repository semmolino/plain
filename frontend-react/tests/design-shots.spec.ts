import { test } from '@playwright/test'
import { mockDemo, hideDevtools } from './fixtures/demoData'

/**
 * Bildstrecke fuer das Design-Experiment auf der Uebersicht.
 *
 * Kein Test — dieser Lauf prueft nichts, er nimmt auf: neuer Look hell und
 * dunkel, zum Vergleich der bisherige, jeweils in drei Breiten. Angelehnt an
 * die Bildstrecke aus design/aeline-preview, aber nur fuer die Uebersicht.
 *
 *   npm run design:shots
 *
 * Ablage: design-shots/uebersicht/<variante>/<breite>.png (nicht im Git)
 */

// Schluessel wie in useStickyState bzw. ThemeOptions — Mitarbeiter 1 aus
// der Demo-Fixture.
const SKIN_KEY  = 'plain:filt:v2:1:dashboard-skin'
const THEME_KEY = 'plain-theme-1'

const VARIANTEN: [string, 'stuxen' | 'classic', 'light' | 'dark'][] = [
  ['stuxen-hell',   'stuxen',  'light'],
  ['stuxen-dunkel', 'stuxen',  'dark'],
  ['bisher-hell',   'classic', 'light'],
]

const VIEWPORTS: [string, number, number][] = [
  ['desktop', 1280, 800],
  ['tablet',   768, 1024],
  ['mobile',   390, 844],
]

for (const [variante, skin, theme] of VARIANTEN) {
  for (const [vpName, width, height] of VIEWPORTS) {
    test(`Uebersicht · ${variante} · ${vpName}`, async ({ page }, testInfo) => {
      // Der Lauf setzt seine Breiten selbst; sonst entstuende jede Aufnahme
      // einmal je Playwright-Projekt.
      test.skip(testInfo.project.name !== 'desktop', 'nur einmal aufnehmen')

      // Laufzeitfehler lassen den Lauf scheitern — sonst stuende auf dem
      // Bild der Fehlerbildschirm von Vite, und der Lauf hiesse "bestanden".
      const fehler: string[] = []
      page.on('pageerror', e => fehler.push(e.message))

      await page.setViewportSize({ width, height })
      await page.addInitScript(([sk, th, skinKey, themeKey]) => {
        localStorage.setItem(skinKey, JSON.stringify(sk))
        localStorage.setItem(themeKey, th)
      }, [skin, theme, SKIN_KEY, THEME_KEY])
      await mockDemo(page)
      await page.goto('/')
      await hideDevtools(page)

      // Ab 1024px klemmt globals.css .app-layout auf Viewport-Hoehe; gescrollt
      // wird nur .app-main. Fuer die Aufnahme die Klemmung loesen, damit das
      // ganze Blatt aufs Bild kommt und nicht nur ein Bildschirm.
      await page.addStyleTag({ content: `
        @media (min-width: 1024px) {
          .app-layout { height: auto !important; overflow: visible !important; }
          .app-main   { overflow: visible !important; }
        }
      ` })

      await page.locator('.dash-page').waitFor()
      await page.waitForLoadState('networkidle').catch(() => {})
      // Chart.js animiert seine Reihen rund 1s ein; Schriften kommen per swap.
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(1600)

      await page.screenshot({
        path: `design-shots/uebersicht/${variante}/${vpName}.png`,
        fullPage: true,
      })

      if (fehler.length) throw new Error('Laufzeitfehler: ' + fehler.join(' · '))
    })
  }
}
