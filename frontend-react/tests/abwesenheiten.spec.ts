import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot } from './fixtures/pilotData'

/**
 * Abwesenheiten und Stundencontrolling (UI-Pilot Runde 11).
 *
 * Vorher: „Ablehnen" ohne Rückfrage und ohne Begründung, „Zurückziehen" und
 * „Stornieren" ohne Rückfrage, ein Antragsformular ohne Vorschau der Tage und
 * ohne Hinweis auf Überschneidungen, Unterreiter, die bei jedem Besuch von
 * vorn anfingen, und am Handy ein Postfach, dessen Knöpfe aus dem Bild liefen.
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> | null }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

// Die Testdaten liegen im Herbst 2026 — die Uhr steht dort, damit
// „geplant" und „vergangen" nicht vom Tag des Testlaufs abhängen.
async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-09-24T10:30:00+02:00') })
  await mockPilot(page)
}

test.describe('Abwesenheiten', () => {
  test('Ablehnen fragt nach und schickt die Begründung mit', async ({ page }) => {
    await setup(page)
    const posts = record(page, 'POST', /\/api\/v1\/abwesenheit\/\d+\/decision$/)
    await page.goto('/mitarbeiter?tab=abwesenheiten')
    await page.getByRole('button', { name: 'Antrag von LH ablehnen' }).click()
    const dlg = page.getByRole('dialog', { name: 'Antrag ablehnen?' })
    await expect(dlg).toContainText('Lena Hartmann')
    await dlg.getByLabel(/Begründung/).fill('Abgabe Werk II')
    await dlg.getByRole('button', { name: 'Ablehnen' }).click()
    await expect(dlg).toBeHidden()
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toMatch(/\/abwesenheit\/54\/decision$/)
    expect(posts[0].body).toEqual({ decision: 'REJECTED', note: 'Abgabe Werk II' })
  })

  test('Genehmigen geht direkt, Abbrechen beim Ablehnen schickt nichts', async ({ page }) => {
    await setup(page)
    const posts = record(page, 'POST', /\/api\/v1\/abwesenheit\/\d+\/decision$/)
    await page.goto('/mitarbeiter?tab=abwesenheiten')
    await page.getByRole('button', { name: 'Antrag von TK ablehnen' }).click()
    await page.getByRole('dialog', { name: 'Antrag ablehnen?' }).getByRole('button', { name: 'Abbrechen' }).click()
    await page.getByRole('button', { name: 'Antrag von TK genehmigen' }).click()
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0].body).toMatchObject({ decision: 'APPROVED' })
    expect(posts[0].url).toMatch(/\/abwesenheit\/51\/decision$/)
  })

  test('Überschneidung mit genehmigtem Urlaub steht am Antrag', async ({ page }) => {
    await setup(page)
    await page.goto('/mitarbeiter?tab=abwesenheiten')
    // Tabelle am Desktop, Karte am Handy
    await expect(page.locator('tr, li').filter({ hasText: 'Lena Hartmann' })).toContainText('Gleichzeitig abwesend: JW')
  })

  test('Der Unterreiter steht in der URL, der Deep-Link verschwindet beim Wechsel', async ({ page }) => {
    await setup(page)
    await page.goto('/mitarbeiter?tab=abwesenheiten&sub=my&absence=58')
    const card = page.locator('.abs-card--focus')
    await expect(card).toContainText('28.12.–31.12.2026')
    // Offene Rückfrage: das Antwortfeld ist gleich offen
    await expect(page.getByLabel('Antwort an die Genehmiger')).toBeVisible()
    await page.getByRole('button', { name: 'Kalender' }).click()
    await expect(page).toHaveURL(/sub=calendar/)
    await expect(page).not.toHaveURL(/absence=/)
    await page.reload()
    await expect(page.getByText('September 2026', { exact: true })).toBeVisible()
  })

  test('Antrag stellen: Vorschau der Tage und des Resturlaubs, dann einreichen', async ({ page }) => {
    await setup(page)
    const posts = record(page, 'POST', /\/api\/v1\/abwesenheit$/)
    await page.goto('/mitarbeiter?tab=abwesenheiten&sub=my')
    await page.getByRole('button', { name: 'Abwesenheit beantragen' }).click()
    const dlg = page.getByRole('dialog', { name: 'Abwesenheit beantragen' })
    await dlg.getByLabel('Art *').selectOption({ label: 'Urlaub' })
    await dlg.getByLabel('Von *').fill('2026-10-19')
    await dlg.getByLabel('Bis').fill('2026-10-23')
    await expect(dlg).toContainText('5 Arbeitstage')
    await expect(dlg).toContainText('Resturlaub 2026 danach: 6,5 Tage')
    await dlg.getByRole('button', { name: 'Antrag einreichen' }).click()
    await expect(dlg).toBeHidden()
    expect(posts[0].body).toEqual({ absence_type_id: 1, date_from: '2026-10-19', date_to: '2026-10-23', half_day: false, note: '' })
  })

  test('Antrag über einen schon genehmigten Urlaub warnt vor doppelter Zählung', async ({ page }) => {
    await setup(page)
    await page.goto('/mitarbeiter?tab=abwesenheiten&sub=my')
    await page.getByRole('button', { name: 'Abwesenheit beantragen' }).click()
    const dlg = page.getByRole('dialog', { name: 'Abwesenheit beantragen' })
    await dlg.getByLabel('Art *').selectOption({ label: 'Urlaub' })
    await dlg.getByLabel('Von *').fill('2026-09-10')
    await dlg.getByLabel('Bis').fill('2026-09-14')
    await expect(dlg).toContainText('Überschneidet sich mit Urlaub 07.09.–11.09.2026 (genehmigt)')
    await expect(dlg).toContainText('zählen doppelt')
  })

  test('Pflichtfelder: ohne Art und Datum kein Antrag; Schließen mit Eingaben fragt nach', async ({ page }) => {
    await setup(page)
    const posts = record(page, 'POST', /\/api\/v1\/abwesenheit$/)
    await page.goto('/mitarbeiter?tab=abwesenheiten&sub=my')
    await page.getByRole('button', { name: 'Abwesenheit beantragen' }).click()
    const dlg = page.getByRole('dialog', { name: 'Abwesenheit beantragen' })
    await dlg.getByRole('button', { name: 'Antrag einreichen' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('Bitte noch angeben: Art, Von.')
    await expect(dlg.getByLabel('Art *')).toHaveAttribute('aria-invalid', 'true')
    await dlg.getByLabel('Notiz').fill('x')
    await dlg.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByRole('dialog', { name: 'Eingaben verwerfen?' })).toBeVisible()
    expect(posts).toHaveLength(0)
  })

  test('Zurückziehen fragt nach; vergangene Abwesenheiten lassen sich selbst nicht stornieren', async ({ page }) => {
    await setup(page)
    const deletes = record(page, 'DELETE', /\/api\/v1\/abwesenheit\/\d+$/)
    await page.goto('/mitarbeiter?tab=abwesenheiten&sub=my')
    await page.getByRole('button', { name: 'Zurückziehen' }).click()
    const ask = page.getByRole('dialog', { name: 'Antrag zurückziehen?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Abbrechen' }).click()
    expect(deletes).toHaveLength(0)
    // Der Urlaub 07.–11.09. ist vorbei: kein „Stornieren"
    await expect(page.getByRole('button', { name: 'Stornieren' })).toHaveCount(0)
    await expect(page.getByText('Begründung:')).toBeVisible()
  })

  test('Urlaubsansprüche: offene Eingaben fragen beim Wechsel des Unterreiters', async ({ page }) => {
    await setup(page)
    await page.goto('/mitarbeiter?tab=abwesenheiten&sub=entitlements')
    await page.getByLabel('Anspruch TK').fill('27,5')
    await page.getByRole('button', { name: 'Kalender' }).click()
    await expect(page.getByRole('dialog')).toContainText(/nicht gespeichert|Änderung/)
    await expect(page).toHaveURL(/sub=entitlements/)
  })

  test('Mitarbeiterseite: Abwesenheit für den Mitarbeiter erfassen', async ({ page }) => {
    await setup(page)
    const posts = record(page, 'POST', /\/api\/v1\/abwesenheit$/)
    await page.goto('/mitarbeiter/2?tab=abwesenheit')
    await page.getByRole('button', { name: 'Abwesenheit erfassen' }).click()
    const dlg = page.getByRole('dialog', { name: 'Abwesenheit erfassen – Thomas Kern' })
    await dlg.getByLabel('Art *').selectOption({ label: 'Krank' })
    await dlg.getByLabel('Von *').fill('2026-09-21')
    await expect(dlg).toContainText('Wird direkt als genehmigt eingetragen.')
    await dlg.getByRole('button', { name: 'Eintragen' }).click()
    await expect(dlg).toBeHidden()
    expect(posts[0].body).toMatchObject({ employee_id: 2, absence_type_id: 2, date_from: '2026-09-21', date_to: '2026-09-21' })
  })
})

test.describe('Stundencontrolling', () => {
  test('Unterreiter und Mitarbeiter stehen in der URL', async ({ page }) => {
    await setup(page)
    await page.goto('/mitarbeiter?tab=zeitwirtschaft')
    await page.getByRole('button', { name: 'Einzelne/r Mitarbeiter' }).click()
    await expect(page).toHaveURL(/sub=single/)
    const pick = page.getByLabel('Mitarbeiter', { exact: true })
    await pick.fill('Kern')
    await pick.press('Enter')
    await expect(page).toHaveURL(/emp=2/)
    await page.reload()
    await expect(page.getByLabel('Mitarbeiter', { exact: true })).toHaveValue('TK – Thomas Kern')
  })

  test('Auswertung: kein Treffer ist etwas anderes als keine Daten, Minus in Konventionsfarbe', async ({ page }) => {
    await setup(page)
    await page.goto('/mitarbeiter?tab=zeitwirtschaft')
    const row = page.locator('tr, li').filter({ hasText: 'Clara Fischer' })
    await expect(row.locator('.ma-balance-neg').first()).toHaveText('−12,00 h')
    await page.getByRole('searchbox', { name: /suchen/ }).fill('zzz')
    await expect(page.getByText('Kein Mitarbeiter passt zu Suche und Filter.')).toBeVisible()
    await page.getByRole('button', { name: 'Suche und Filter zurücksetzen' }).click()
    await expect(row).toBeVisible()
  })

  test('Auswertung sortiert über den Spaltenkopf', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Spaltenköpfe gibt es am Desktop')
    await setup(page)
    await page.goto('/mitarbeiter?tab=zeitwirtschaft')
    await page.getByRole('columnheader', { name: /Monatssaldo/ }).click()
    await expect(page.locator('.sc-table tbody tr').first()).toContainText('Clara Fischer')
  })

  test('Monatsabschluss: Öffnen fragt nach, Abschließen geht direkt', async ({ page }) => {
    await setup(page)
    const deletes = record(page, 'DELETE', /\/month-close\/\d+\/\d+$/)
    const posts = record(page, 'POST', /\/mitarbeiter\/\d+\/month-close$/)
    await page.goto('/mitarbeiter?tab=zeitwirtschaft&sub=close')
    await page.getByRole('button', { name: 'SM August 2026: abgeschlossen, öffnen' }).click()
    const ask = page.getByRole('dialog', { name: 'August 2026 für SM öffnen?' })
    await ask.getByRole('button', { name: 'Abbrechen' }).click()
    expect(deletes).toHaveLength(0)
    await page.getByRole('button', { name: 'SM September 2026: offen, abschließen' }).click()
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0].body).toEqual({ year: 2026, month: 9 })
  })
})

test.describe('Abwesenheiten und Stundencontrolling am Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  for (const path of [
    '/mitarbeiter?tab=abwesenheiten', '/mitarbeiter?tab=abwesenheiten&sub=calendar', '/mitarbeiter?tab=abwesenheiten&sub=my',
    '/mitarbeiter?tab=zeitwirtschaft', '/mitarbeiter?tab=zeitwirtschaft&sub=close', '/mitarbeiter/2?tab=abwesenheit',
  ]) {
    test(`${path}: kein Querscrollen`, async ({ page }) => {
      await setup(page)
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const w = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth))
      expect(w).toBeLessThanOrEqual(392)
    })
  }

  test('Anträge als Karten mit erreichbaren Knöpfen', async ({ page }) => {
    await setup(page)
    await page.goto('/mitarbeiter?tab=abwesenheiten')
    const btn = page.getByRole('button', { name: 'Antrag von AK genehmigen' })
    await btn.scrollIntoViewIfNeeded()
    const box = await btn.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })

  test('Kalender springt zum heutigen Tag', async ({ page }) => {
    await setup(page)
    await page.goto('/mitarbeiter?tab=abwesenheiten&sub=calendar')
    await expect(page.locator('th.abs-cal-today')).toBeInViewport()
  })
})
