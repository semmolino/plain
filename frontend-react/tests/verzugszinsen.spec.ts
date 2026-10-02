import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Verzugszinsen und Verzugspauschale (Vorlagen-Plan Stufe 5, § 288 BGB):
 * je Mahnstufe einschaltbar, Basiszinssatz mit Stichtag, Verbraucher an der
 * Adresse markiert.
 */

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

function record(page: Page, method: string, re: RegExp) {
  const out: Record<string, unknown>[] = []
  page.on('request', (r: Request) => { if (r.method() === method && re.test(r.url())) out.push(r.postDataJSON()) })
  return out
}

const LEVELS = [1, 2, 3, 4].map(n => ({
  mahnstufe: n, label: ['Zahlungserinnerung', '1. Mahnung', '2. Mahnung', '3. Mahnung'][n - 1],
  daysAfterDue: 7 * n, daysAfterPrev: n === 1 ? 0 : 14, fee: 0, headerText: null, footerText: null,
  chargeInterest: false, chargeFlatFee: false,
}))

test('Zinsen je Stufe, Basiszinssatz mit Stichtag — ohne Satz ein Hinweis', async ({ page }) => {
  await mockPilot(page)
  await page.route(/\/api\/v1\/mahnungen\/settings(\?|$)/, r => r.request().method() === 'PUT'
    ? r.fulfill(json({ ok: true }))
    : r.fulfill(json({ data: LEVELS, baseRate: { percent: null, since: null } })))
  const puts = record(page, 'PUT', /\/mahnungen\/settings(\?|$)/)
  await page.goto('/admin?tab=mahnungseinstellungen')

  await page.getByLabel('Verzugszinsen berechnen').nth(2).check()
  await expect(page.getByText('Ohne Basiszinssatz rechnen die Mahnungen keine Zinsen.')).toBeVisible()
  await page.getByLabel(/Basiszinssatz \(%\)/).fill('1,27')
  await page.getByLabel('gültig seit').fill('2026-07-01')
  await page.getByLabel(/Verzugspauschale 40 €/).nth(2).check()
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()

  await expect.poll(() => puts.length).toBe(1)
  const body = puts[0] as { levels: typeof LEVELS; baseRate: unknown }
  expect(body.baseRate).toEqual({ percent: 1.27, since: '2026-07-01' })
  expect(body.levels[2]).toMatchObject({ mahnstufe: 3, chargeInterest: true, chargeFlatFee: true })
  expect(body.levels[1]).toMatchObject({ chargeInterest: false, chargeFlatFee: false })
})

test('Adresse als Privatperson markieren', async ({ page }) => {
  const patches = record(page, 'PATCH', /\/stammdaten\/addresses\/2(\?|$)/)
  await mockPilot(page)
  await page.goto('/adressen/2?tab=daten')
  await page.getByLabel('Privatperson (Verbraucher)').check()
  const bar = page.getByRole('region', { name: 'Seitenaktionen' })
  await bar.getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => patches.length).toBe(1)
  expect(patches[0]).toMatchObject({ is_consumer: 'true' })
})
