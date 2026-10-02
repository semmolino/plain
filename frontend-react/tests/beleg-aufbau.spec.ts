import { test, expect, type Page } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'
import { CATALOG } from './fixtures/dokumentvorlagenData'

/**
 * Aufbau und Texte dieses Belegs im Rechnungsassistenten (Vorlagen-Plan
 * Stufe 3): gespeichert wird mit dem Schritt — vor dem Buchen, nicht beim
 * Tippen —, „Für dieses Projekt merken" schreibt die Projekt-Ebene, und die
 * Vorschau zeigt den ungespeicherten Stand.
 */

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function setup(page: Page, { canEditProject = true, project = null as Record<string, unknown> | null } = {}) {
  await page.clock.setFixedTime(new Date('2026-09-24T10:30:00'))
  await mockPilot(page)
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = []
  const log = (r: { method(): string; url(): string; postDataJSON(): unknown }) =>
    calls.push({ method: r.method(), url: r.url(), body: (r.method() === 'GET' ? null : r.postDataJSON()) as Record<string, unknown> | null })
  page.on('request', r => {
    if (/\/invoices\/601(\/(layout|book|pdf\/preview))?(\?|$)/.test(r.url()) && r.method() !== 'GET') log(r)
  })
  await page.route(/\/api\/v1\/document-templates\/catalog(\?|$)/, r => r.fulfill(json({ data: CATALOG })))
  await page.route(/\/api\/v1\/document-texts(\?|$)/, r => r.fulfill(json({ data: [
    { id: 1, label: 'Gewährleistung', text: 'Die Gewährleistung beginnt mit der Abnahme.', category: null, position: 'free', sortOrder: 0 },
    { id: 2, label: 'Öffentlicher AG', text: 'Gemäß Vertrag vom {{vertrag}} berechnen wir:', category: 'invoice_rechnung', position: 'intro', sortOrder: 0 },
  ] })))
  await page.route(/\/api\/v1\/invoices\/601\/layout(\?|$)/, r => r.request().method() === 'PUT'
    ? r.fulfill(json({ data: { ok: true } }))
    : r.fulfill(json({ data: {
      category: 'invoice_rechnung', booked: false, projectId: 1, canEditProject,
      template: [], projectParents: [], project, document: null,
      standardTexts: { intro: 'Standard-Kopftext', closing: null },
    } })))
  await page.route(/\/api\/v1\/invoices\/601\/pdf\/preview(\?|$)/, r => r.fulfill(json({ html: '<p>Beleg-Vorschau</p>' })))
  return calls
}

const bar = (page: Page) => page.getByRole('region', { name: 'Seitenaktionen' })
async function toReview(page: Page) {
  await page.goto('/rechnungen?tab=rechnung&draftId=601')
  for (let i = 0; i < 2; i++) {
    await bar(page).getByRole('button', { name: 'Weiter', exact: true }).click()
    await page.waitForTimeout(150)
  }
  await page.getByRole('button', { name: /Aufbau und Texte dieses Belegs/ }).click()
}
// Am Handy steckt „Entwurf speichern" im Menü der Aktionsleiste
async function saveDraft(page: Page) {
  const direct = bar(page).getByRole('button', { name: 'Entwurf speichern' })
  if (await direct.isVisible()) return direct.click()
  await bar(page).getByRole('button', { name: 'Weitere Aktionen' }).click()
  await page.getByRole('menuitem', { name: 'Entwurf speichern' }).click()
}
const row = (page: Page, name: RegExp) => page.locator('.ba-panel').getByRole('listitem').filter({ hasText: name })

test('Aufbau dieses Belegs geht vor dem Buchen mit — nur die Abweichung', async ({ page }) => {
  const calls = await setup(page)
  await toReview(page)
  await expect(page.getByLabel('Kopftext', { exact: true })).toHaveValue('Standard-Kopftext')
  await page.getByLabel('Kopftext aus Textbaustein').selectOption({ label: 'Öffentlicher AG' })
  await row(page, /^Anrede/).getByRole('button', { name: 'Anrede ausblenden' }).click()
  await page.locator('.ba-panel').getByLabel('Textblock aus Textbaustein').selectOption({ label: 'Gewährleistung' })
  await expect(page.locator('.ba-panel .disclosure-hint')).toHaveText('eigener Aufbau')

  await bar(page).getByRole('button', { name: 'Jetzt buchen' }).click()
  await page.getByRole('dialog', { name: 'Rechnung buchen?' }).getByRole('button', { name: 'Jetzt buchen' }).click()
  await expect.poll(() => calls.some(c => /\/book/.test(c.url))).toBe(true)

  const put = calls.find(c => c.method === 'PUT')!
  const book = calls.findIndex(c => /\/book/.test(c.url))
  expect(calls.indexOf(put)).toBeLessThan(book)
  const doc = put.body!.document as Record<string, unknown>
  expect(doc.hidden).toEqual(['salutation'])
  expect(doc.introText).toBe('Gemäß Vertrag vom {{vertrag}} berechnen wir:')
  expect(Object.values(doc.texts as Record<string, string>)).toEqual(['Die Gewährleistung beginnt mit der Abnahme.'])
  expect(doc).not.toHaveProperty('payment')
  expect(put.body).not.toHaveProperty('project')
})

test('„Für dieses Projekt merken" schreibt die Projekt-Ebene und leert den Beleg', async ({ page }) => {
  const calls = await setup(page)
  await toReview(page)
  await row(page, /^Bezugszeile/).getByRole('button', { name: /ausblenden/ }).click()
  await page.getByLabel(/Für dieses Projekt merken/).check()
  await saveDraft(page)
  await expect.poll(() => calls.filter(c => c.method === 'PUT').length).toBe(1)
  expect(calls.find(c => c.method === 'PUT')!.body).toEqual({ project: { hidden: ['reference'] }, document: null })
})

test('ohne projects.edit kein „Für dieses Projekt merken"; Projekt-Aufbau wird angezeigt', async ({ page }) => {
  await setup(page, { canEditProject: false, project: { hidden: ['salutation'] } })
  await toReview(page)
  await expect(page.locator('.ba-panel .disclosure-hint')).toHaveText('wie im Projekt')
  await expect(row(page, /^Anrede/)).toContainText('ausgeblendet')
  await expect(page.getByLabel(/Für dieses Projekt merken/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Projekt-Aufbau entfernen' })).toHaveCount(0)
})

test('Vorschau zeigt den ungespeicherten Stand', async ({ page }) => {
  const calls = await setup(page)
  await toReview(page)
  await row(page, /^Anrede/).getByRole('button', { name: 'Anrede ausblenden' }).click()
  await page.locator('.ba-panel').getByRole('button', { name: 'Vorschau' }).click()
  const dlg = page.getByRole('dialog', { name: 'Vorschau dieses Belegs' })
  await expect(dlg.frameLocator('iframe').getByText('Beleg-Vorschau')).toBeVisible()
  const prev = calls.find(c => /pdf\/preview/.test(c.url))!
  expect(prev.body).toEqual({ document: { hidden: ['salutation'] } })
  // nichts gespeichert, nur angesehen
  expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0)
})
