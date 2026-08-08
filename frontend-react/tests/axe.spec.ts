import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockDemo, hideDevtools } from './fixtures/demoData'

/**
 * Automatische Barrierefreiheits-Pruefung der Hauptseiten.
 *
 * Ergaenzt scripts/check-design-system.mjs: Das Skript prueft die Tokens
 * statisch, axe prueft das GERENDERTE Ergebnis — also auch Kontraste, die
 * erst durch Ueberlagerung entstehen, fehlende Formular-Beschriftungen und
 * kaputte ARIA-Beziehungen.
 *
 * Bewusst auf die Regeln beschraenkt, die wir aktuell halten koennen. Was
 * noch offen ist (Tabellen-Semantik, htmlFor auf allen Feldern), steht in
 * KNOWN_GAPS — mit dem Ziel, die Liste Stueck fuer Stueck zu leeren, statt
 * die Pruefung ganz abzuschalten.
 */

/** Regeln, die noch nicht flaechendeckend erfuellt sind. Siehe docs/UX_UI_AUDIT_2026-08.md. */
const KNOWN_GAPS = [
  'label',            // ~370 Felder ohne htmlFor/id-Verknuepfung
  'form-field-multiple-labels',
  'aria-required-children',
]

const PAGES: [string, string][] = [
  ['Übersicht',  '/'],
  ['Projekte',   '/projekte'],
  ['Rechnungen', '/rechnungen'],
]

for (const [name, url] of PAGES) {
  test(`${name} — keine kritischen Barrierefreiheits-Verstoesse`, async ({ page }) => {
    await mockDemo(page)
    await page.goto(url)
    await hideDevtools(page)
    await page.locator('.app-main').waitFor()
    await page.waitForTimeout(800)   // Diagramme/Listen fertig rendern lassen

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(KNOWN_GAPS)
      .analyze()

    // Lesbare Ausgabe: axe liefert sonst nur eine grosse JSON-Struktur.
    const summary = result.violations.map(v =>
      `${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join('\n    ')}`
    ).join('\n  ')

    expect(summary, `Barrierefreiheits-Verstoesse auf ${url}:\n  ${summary}`).toBe('')
  })
}

test('Login — keine kritischen Barrierefreiheits-Verstoesse', async ({ page }) => {
  await page.goto('/login')
  await hideDevtools(page)
  await page.locator('.auth-logo').waitFor()

  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(KNOWN_GAPS)
    .analyze()

  const summary = result.violations.map(v => `${v.id} (${v.impact}) — ${v.help}`).join('\n  ')
  expect(summary, `Barrierefreiheits-Verstoesse auf /login:\n  ${summary}`).toBe('')
})
