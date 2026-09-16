import { test, expect } from '@playwright/test'
import { mockDemo } from './fixtures/demoData'

/**
 * Chart.js zeichnet auf ein <canvas>. Dort ist `var(--token)` KEIN Farbwert —
 * der Browser meldet nichts und nimmt Schwarz. Genau so wurden im
 * Projektverlauf aus fuenf farbigen Linien fuenf schwarze, und weder der
 * Typecheck (es ist ein string) noch die Kontrastpruefung (die liest CSS)
 * haben es gesehen.
 *
 * `npm run check:design` faengt den bekannten Fehler ab. Dieser Test prueft
 * das Ergebnis: Was am Ende auf dem Canvas steht, muss bunt sein.
 */

/** Zaehlt deutlich verschiedene, gesaettigte Farbtoene auf dem Canvas. */
async function hues(page: import('@playwright/test').Page, index = 0): Promise<number[]> {
  return page.locator('canvas').nth(index).evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, el.width, el.height)
    const seen = new Set<number>()
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
      if (a < 200) continue
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      // Nur kraeftige Farben zaehlen: Grau, Achsen und Gitter sollen die
      // Zaehlung nicht auffuellen, sonst besteht ein schwarzes Diagramm.
      if (max - min < 60 || max < 80) continue
      let h = 0
      const d = max - min
      if (max === r)      h = ((g - b) / d + 6) % 6
      else if (max === g) h = (b - r) / d + 2
      else                h = (r - g) / d + 4
      seen.add(Math.round(h * 60 / 20))  // 20-Grad-Koerbe
    }
    return [...seen]
  })
}

for (const theme of ['light', 'dark'] as const) {
  test(`Projektverlauf zeichnet farbige Linien (${theme})`, async ({ page }) => {
    await mockDemo(page)
    await page.goto('/')
    await page.locator('canvas').first().waitFor({ timeout: 10_000 })
    if (theme === 'dark') {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      await page.waitForTimeout(600)
    }
    await page.waitForTimeout(600)

    // Fuenf Reihen in fuenf Farben. Vier verschiedene Farbtoene sind die
    // Untergrenze: Blau und Himmelblau koennen im selben Korb landen.
    expect((await hues(page)).length).toBeGreaterThanOrEqual(4)
  })
}
