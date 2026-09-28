import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Vom Angebot zum Projekt (UI-Pilot Runde 5): „Beauftragt …" zeigt vorher,
 * was ins Projekt uebergeht; Elemente nach Aufwand bekommen die Schaetzung
 * als Plan. Im Projekt steht der Plan unter dem gebuchten Betrag und laesst
 * sich aendern.
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

test.describe('Beauftragen', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Kopf-Aktion am Desktop')

  test('Vorschau, Plan abwählbar, Mitarbeiter je Rolle, ein Aufruf', async ({ page }) => {
    const posts = record(page, 'POST', /\/angebote\/\d+\/convert/)
    await mockPilot(page)
    await page.goto('/angebote?offerId=1&tab=struktur')
    await page.getByRole('button', { name: /Beauftragt/ }).click()
    const dialog = page.getByRole('dialog', { name: /Beauftragt/ })
    const preview = dialog.getByRole('table')
    const row = (abbr: string) => preview.getByRole('row').filter({ has: page.getByText(abbr, { exact: true }) })
    await expect(row('BL1')).toContainText('Plan 24 h · 2.280,00 €')
    await expect(row('LP2')).toContainText('Honorar 14.525,70 €')
    await expect(row('LPH')).toContainText('Summe der Unterelemente')

    // Plan abwaehlen: die Vorschau sagt, was dann passiert
    const planBox = dialog.getByRole('checkbox', { name: /Schätzung als Plan übernehmen/ })
    await expect(planBox).toBeChecked()
    await planBox.uncheck()
    await expect(row('BL1')).toContainText('startet bei 0')
    await planBox.check()

    // Projektleitung vorbelegt mit der Zuständigen des Angebots
    await expect(dialog.getByLabel('Projektleitung*')).not.toHaveValue('')
    await dialog.getByLabel('Projektstatus*').selectOption({ label: 'Laufend' })
    await dialog.getByRole('combobox', { name: 'Mitarbeiter für PL' }).selectOption({ index: 1 })
    await dialog.getByRole('button', { name: 'Projekt anlegen' }).last().click()
    await expect(dialog).toBeHidden()
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toMatchObject({
      transfer_plan: true,
      employee2project: [{ role_id: 2, role_abbr: 'PL', role_name: 'Projektleitung', hourly_rate: 95 }],
    })
  })
})

test.describe('Plan im Projekt', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'Tabelle nur am Desktop')

  test('Plan unter dem Gebuchten, „über Plan" bei Überschreitung, ändern über das ⋯', async ({ page }) => {
    const patches = record(page, 'PATCH', /\/projekte\/structure\/\d+\/plan/)
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    const na1 = page.locator('tr[data-struct-id="123"]')
    const na2 = page.locator('tr[data-struct-id="124"]')
    await expect(na1.locator('.sx-plan-note')).toHaveText('über Plan 17.100,00 €')
    await expect(na2.locator('.sx-plan-note')).toHaveText('Plan 9.880,00 €')
    await na2.getByRole('button', { name: /Aktionen zu NA2/ }).click()
    await page.getByRole('menuitem', { name: 'Plan bearbeiten …' }).click()
    const dialog = page.getByRole('dialog', { name: 'Plan NA2' })
    await expect(dialog.getByLabel('Stunden')).toHaveValue('104')
    await dialog.getByLabel('Stunden').fill('120')
    await dialog.getByRole('button', { name: 'Plan speichern' }).click()
    await expect(dialog).toBeHidden()
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toEqual({ plan_hours: 120, plan_revenue: 9880 })
  })
})

test.describe('Plan am Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'nur schmale Viewports')

  test('Blatt zeigt den Plan und öffnet „Plan bearbeiten"', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    const list = page.getByRole('list', { name: /Elemente/ })
    await list.getByRole('button', { name: /^NA1 / }).click()
    const sheet = page.getByRole('dialog', { name: /NA1/ })
    await expect(sheet).toContainText('über Plan 17.100,00 €')
    await sheet.getByRole('button', { name: 'Plan bearbeiten' }).click()
    await expect(page.getByRole('dialog', { name: 'Plan NA1' })).toBeVisible()
  })
})
