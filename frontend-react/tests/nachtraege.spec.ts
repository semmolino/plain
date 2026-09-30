import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Nachträge im Arbeitsbereich-Muster (UI-Pilot Runde 7). Vorher: die
 * Detailseite führte zurück ins Modul statt ins Projekt, freigegebene
 * Positionen liessen sich (am Server) weiter ändern, eine gekürzte Position
 * stand erneut zur Freigabe, Dialoge hatten kein Abbrechen, und die Prüfung
 * ging beim Verlassen still verloren.
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

const VIEW = ['projects.view', 'nachtraege.view']

test.describe('Nachträge im Projekt', () => {
  test('Liste mit Status und Summe, Detail führt zurück ins Projekt', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=nachtraege')
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(5)
    await expect(rows.filter({ hasText: 'Fassadenvariante Holz-Alu' })).toContainText('Teilweise beauftragt')
    await expect(page.locator('tfoot')).toContainText('Summe (5)')

    await page.getByRole('link', { name: /N-002.*Fassadenvariante Holz-Alu/ }).click()
    await expect(page).toHaveURL(/\/nachtraege\/402$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Fassadenvariante Holz-Alu' })).toBeVisible()
    await page.getByRole('button', { name: 'Projekt', exact: true }).click()
    await expect(page).toHaveURL(/\/projekte\?projectId=1&tab=nachtraege/)
  })

  test('Anlegen: Abbrechen links, Pflichtfeld wird benannt', async ({ page }) => {
    const posts = record(page, 'POST', /\/nachtraege(\?|$)/)
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=nachtraege')
    await page.getByRole('button', { name: 'Nachtrag', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Nachtrag anlegen' })
    await dialog.getByRole('button', { name: 'Anlegen' }).click()
    await expect(dialog).toContainText('Bitte einen Betreff angeben.')
    expect(posts).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('Nachtrag im Detail', () => {
  test('freigegebene Positionen sind gesperrt, offene lassen sich bearbeiten', async ({ page }) => {
    const puts = record(page, 'PUT', /\/nachtraege\/402\/structure\/4204/)
    await mockPilot(page)
    await page.goto('/nachtraege/402')
    const pos = page.getByRole('region', { name: 'Positionen' })
    await expect(pos.getByRole('row').filter({ hasText: 'Entwurf Holz-Alu-Variante' })).toContainText('freigegeben · 8.000,00')
    await expect(pos.getByRole('button', { name: /Entwurf Holz-Alu-Variante (bearbeiten|löschen)/ })).toHaveCount(0)
    await expect(pos.getByRole('button', { name: /Werkplanung Fassade (bearbeiten|löschen)/ })).toHaveCount(0)
    // Der Vater enthält Freigegebenes — löschen geht nicht, umbenennen schon
    await expect(pos.getByRole('button', { name: '1 — Fassade Holz-Alu löschen' })).toHaveCount(0)
    await expect(pos.getByRole('button', { name: '2 — Brandschutznachweis Fassade löschen' })).toBeVisible()

    await pos.getByRole('button', { name: '1.3 — Bemusterung bearbeiten' }).click()
    const dialog = page.getByRole('dialog', { name: 'Position bearbeiten' })
    await expect(dialog.getByLabel('Abrechnung')).toHaveValue('2')
    await dialog.getByLabel('Stunden', { exact: true }).fill('30')
    await expect(dialog).toContainText('Ergibt 2.850,00')
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(dialog).toBeHidden()
    expect(puts[0].body).toMatchObject({ name: 'Bemusterung', billing_type_id: '2', quantity: '30', hourly_rate: '95' })
  })

  test('Freigabe bietet nur offene Positionen an', async ({ page }) => {
    const posts = record(page, 'POST', /\/nachtraege\/402\/release/)
    await mockPilot(page)
    await page.goto('/nachtraege/402')
    await page.getByRole('button', { name: 'Freigeben' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nachtrag freigeben' })
    await expect(dialog.getByRole('checkbox')).toHaveCount(2)
    await expect(dialog).not.toContainText('Werkplanung Fassade')
    await dialog.getByRole('checkbox', { name: '1.3 — Bemusterung freigeben' }).uncheck()
    await expect(dialog).toContainText('Pauschal freigegeben: 4.920,00')
    await dialog.getByRole('button', { name: 'Freigeben und ins Projekt übernehmen' }).click()
    await expect(dialog).toBeHidden()
    expect(posts[0].body).toMatchObject({ positions: [{ nachtrag_structure_id: 4205, approved_amount_net: null }] })
    await expect(page.getByText('Freigabe 2: 4.920,00', { exact: false })).toBeVisible()
  })

  test('Prüfung: Leiste zeigt offene Angaben, Verlassen fragt nach', async ({ page }) => {
    const puts = record(page, 'PUT', /\/nachtraege\/402\/review/)
    await mockPilot(page)
    await page.goto('/nachtraege/402')
    await page.getByLabel(/Rechnerisch nachvollziehbar/).check()
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await expect(bar).toContainText('Prüfung: 1 Angabe geändert')
    await page.getByRole('button', { name: 'Nachträge', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })).toBeVisible()
    await page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' }).getByRole('button', { name: 'Abbrechen' }).click()
    await bar.getByRole('button', { name: 'Prüfung speichern' }).click()
    await expect(page.getByText('Prüfung gespeichert.')).toBeVisible()
    expect(puts[0].body).toMatchObject({ review_formal: true, review_content: true, review_calculation: true, review_recommendation: 'REDUCE' })
  })

  test('nur lesen: keine Knöpfe, Prüfung gesperrt', async ({ page }) => {
    await mockPilot(page, { permissions: VIEW })
    await page.goto('/nachtraege/402')
    await expect(page.getByRole('heading', { level: 1, name: 'Fassadenvariante Holz-Alu' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Position hinzufügen|Freigeben|bearbeiten$/ })).toHaveCount(0)
    await expect(page.getByLabel(/Formell prüffähig/)).toBeDisabled()
    await expect(page.getByText('Nur Lesen', { exact: false })).toBeVisible()
  })
})

test.describe('Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) > 640, 'Handy')
  for (const url of ['/projekte?projectId=1&tab=nachtraege', '/nachtraege/402']) {
    test(`kein Querscrollen: ${url}`, async ({ page }) => {
      await mockPilot(page)
      await page.goto(url)
      await page.locator('table').first().waitFor()
      await page.waitForLoadState('networkidle')
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(w).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 2)
    })
  }
})
