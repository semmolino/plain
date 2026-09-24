import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Runde 2, Block 0 — Fehler mit Datenverlust:
 *  - Einzelrechnung fortsetzen ueberschrieb Datum und E-Rechnungsfelder
 *  - Pause verwarf die Arbeitszeit bis zur Pause
 *  - eine Stempeluhr-Sitzung gehoerte dem Browser, nicht dem Nutzer
 */

function capture(page: Page, method: string, re: RegExp) {
  const hits: Request[] = []
  page.on('request', r => { if (r.method() === method && re.test(r.url())) hits.push(r) })
  return hits
}

async function seedTimer(page: Page, employeeId: number, minutesAgo: number) {
  const start = new Date(new Date('2026-09-24T10:30:00').getTime() - minutesAgo * 60_000).toISOString()
  await page.addInitScript(([emp, iso]) => {
    localStorage.setItem('plain-timer-session', JSON.stringify({
      state: {
        session: { employeeId: emp, employeeName: 'SM', cpRate: 0, projectId: 1, projectName: 'P-2024-001',
          structureId: 107, structureName: 'LP5.1', blockStartIso: iso },
        breakState: null, showReview: false,
      },
      version: 0,
    }))
  }, [employeeId, start] as const)
}

test('Einzelrechnung fortsetzen behält Datum, Leitweg-ID und Zahlungsart', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
  await mockPilot(page)
  const patches = capture(page, 'PATCH', /\/invoices\/601(\?|$)/)
  await page.goto('/rechnungen?tab=rechnung&draftId=601')
  await expect(page.getByLabel('Käuferreferenz / Leitweg-ID')).toHaveValue('04011000-12345-34')
  await page.getByRole('button', { name: 'Weiter', exact: true }).last().click()
  await expect.poll(() => patches.length).toBe(1)
  expect(patches[0].postDataJSON()).toMatchObject({
    invoice_date: '2026-09-18', due_date: '2026-10-18', comment: 'Nebenleistung Brandschutz',
    buyer_reference: '04011000-12345-34', buyer_order_reference: 'BE-2024-0815',
    buyer_accounting_reference: 'KST 4711', payment_means_id: 2,
  })
})

test('Pause sichert die Arbeitszeit bis jetzt', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Kopfzeile Desktop')
  await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
  await seedTimer(page, 1, 45)
  await mockPilot(page)
  const drafts = capture(page, 'POST', /\/buchungen\/timer\/draft(\?|$)/)
  await page.goto('/')
  await page.getByRole('button', { name: /^Pause/ }).click()
  await expect(page.getByRole('button', { name: /Weiter arbeiten/ })).toBeVisible()
  expect(drafts).toHaveLength(1)
  expect(drafts[0].postDataJSON()).toMatchObject({ PROJECT_ID: 1, STRUCTURE_ID: 107, QUANTITY_INT: 0.75 })
})

test('Stempeluhr eines anderen Nutzers am selben Browser bleibt verborgen', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
  await seedTimer(page, 2, 45)
  await mockPilot(page)
  await page.goto('/')
  await page.locator('.app-main').waitFor()
  await expect(page.getByRole('button', { name: /Stempeluhr/ }).first()).toBeVisible()
  await expect(page.locator('.timer-chip')).toHaveCount(0)
})
