import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot, budgetOverview } from './fixtures/pilotData'

/**
 * Verträge, Preislisten, Interne Budgets im Arbeitsbereich-Muster (UI-Pilot
 * Runde 6). Vorher: der Vertrag zeigte die USt-Kategorie immer als
 * „Standard" und schrieb das beim nächsten Speichern zurück; „Zurücksetzen"
 * liess Steuer und Adresse stehen; Preislisten und Budget boten Knöpfe an,
 * die das Backend mit 403 ablehnte; Budgetregeln hiessen „Struktur #412".
 */

function record(page: Page, method: string, re: RegExp) {
  const out: { url: string; body: Record<string, unknown> }[] = []
  page.on('request', (r: Request) => {
    if (r.method() === method && re.test(r.url())) out.push({ url: r.url(), body: r.postDataJSON() })
  })
  return out
}

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** Vertrag nach §13b — genau der Fall, der beim Speichern verloren ging. */
async function reverseChargeContract(page: Page) {
  await page.route(/\/api\/v1\/projekte\/\d+\/contract(\?|$)/, r => r.fulfill(json({ data: {
    ID: 11, ABBR: 'V-2024-001', NAME: 'Generalplanervertrag', PROJECT_ID: 1,
    INVOICE_ADDRESS_ID: 1, INVOICE_ADDRESS_NAME: 'Stadt Musterstadt – Hochbauamt', INVOICE_CONTACT_ID: 2,
    CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14, VAT_ID: 1,
    SE_ENABLED: true, SE_PERCENT: 5, SE_BASIS: 'BRUTTO', SE_LEGAL_REFERENCE: '§ 17 VOB/B',
    VAT_CATEGORY: 'AE', VAT_EXEMPTION_REASON_CODE: 'VATEX-EU-AE', VAT_EXEMPTION_REASON_TEXT: 'Steuerschuldnerschaft des Leistungsempfängers',
  } })))
}

const VIEW = ['projects.view', 'projects.contracts.view', 'projects.hourly_rates.view', 'projects.budget.view']

test.describe('Verträge', () => {
  test('USt-Kategorie wird geladen und beim Speichern nicht überschrieben', async ({ page }) => {
    const patches = record(page, 'PATCH', /\/projekte\/contract\/11/)
    await mockPilot(page)
    await reverseChargeContract(page)
    await page.goto('/projekte?projectId=1&tab=vertraege')

    await expect(page.getByLabel(/Umsatzsteuer-Kategorie/)).toHaveValue('AE')
    await expect(page.getByLabel(/Befreiungsgrund, Code/)).toHaveValue('VATEX-EU-AE')

    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await page.getByLabel(/^Skonto \(%\)/).fill('3')
    await expect(bar).toContainText('1 Feld geändert')
    await bar.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Vertrag gespeichert.', { exact: false })).toBeVisible()

    expect(patches).toHaveLength(1)
    expect(patches[0].body).toMatchObject({ CASH_DISCOUNT_PERCENT: 3, VAT_CATEGORY: 'AE', VAT_EXEMPTION_REASON_CODE: 'VATEX-EU-AE', SE_PERCENT: 5 })
  })

  test('Verwerfen stellt alle Felder zurück — auch Steuer und Adresse', async ({ page }) => {
    await mockPilot(page)
    await reverseChargeContract(page)
    await page.goto('/projekte?projectId=1&tab=vertraege')

    await page.getByLabel(/Umsatzsteuer-Kategorie/).selectOption('S')
    await page.getByLabel('Steuersatz (MwSt.)').selectOption('2')
    await page.getByLabel('Rechnungsadresse').fill('')
    const bar = page.getByRole('region', { name: 'Seitenaktionen' })
    await expect(bar).toContainText('4 Felder geändert')

    await bar.getByRole('button', { name: 'Verwerfen' }).click()
    await page.getByRole('dialog', { name: 'Änderungen verwerfen?' }).getByRole('button', { name: 'Verwerfen' }).click()

    await expect(page.getByLabel(/Umsatzsteuer-Kategorie/)).toHaveValue('AE')
    await expect(page.getByLabel('Steuersatz (MwSt.)')).toHaveValue('1')
    await expect(page.getByLabel('Rechnungsadresse')).toHaveValue('Stadt Musterstadt – Hochbauamt')
    // Am Handy blendet sich die Leiste ohne offene Änderung aus (quiet)
    await expect(page.getByRole('button', { name: 'Verwerfen' })).toHaveCount(0)
  })

  test('Ungespeicherte Änderungen: Reiterwechsel fragt nach', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=vertraege')
    await page.getByLabel('Vertragsnummer').fill('V-2024-001a')
    await page.getByRole('tab', { name: 'Struktur' }).click()
    await expect(page.getByRole('dialog', { name: 'Ungespeicherte Änderungen' })).toBeVisible()
  })

  test('ohne Bearbeitungsrecht nur lesen', async ({ page }) => {
    await mockPilot(page, { permissions: VIEW })
    await page.goto('/projekte?projectId=1&tab=vertraege')
    await expect(page.getByText('Nur Lesen', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Vertragsnummer')).toBeDisabled()
    await expect(page.getByRole('region', { name: 'Seitenaktionen' })).toHaveCount(0)
  })
})

test.describe('Preislisten', () => {
  test('Zuordnung bearbeiten über den Dialog', async ({ page }) => {
    const patches = record(page, 'PATCH', /\/employee2project\/\d+/)
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=mitarbeiter')
    await page.getByRole('button', { name: 'SB: Sabine Braun-Hofmeister bearbeiten' }).click()
    const dialog = page.getByRole('dialog', { name: /Zuordnung: SB/ })
    await dialog.getByLabel('Stundensatz (€/h)').fill('101,5')
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(dialog).toBeHidden()
    expect(patches[0].body).toMatchObject({ hourly_rate: 101.5, role_abbr: 'AR' })
  })

  test('Rechte wie im Backend: Team ohne Satz-Recht schickt keinen Satz', async ({ page }) => {
    const patches = record(page, 'PATCH', /\/employee2project\/\d+/)
    await mockPilot(page, { permissions: [...VIEW, 'projects.edit'] })
    await page.goto('/projekte?projectId=1&tab=mitarbeiter')
    // Buchungsart-Preise brauchen projects.hourly_rates.edit
    await expect(page.getByRole('button', { name: /Projektpreis für PLOT-A0 setzen/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'SB: Sabine Braun-Hofmeister bearbeiten' }).click()
    const dialog = page.getByRole('dialog', { name: /Zuordnung: SB/ })
    await expect(dialog.getByLabel('Stundensatz (€/h)')).toBeDisabled()
    await dialog.getByLabel('Rollenbezeichnung').fill('Architektin')
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(dialog).toBeHidden()
    expect(patches[0].body).toEqual({ role_id: 3, role_abbr: 'AR', role_name: 'Architektin' })
  })

  test('nur lesen: keine Knöpfe zum Zuordnen oder Ändern', async ({ page }) => {
    await mockPilot(page, { permissions: VIEW })
    await page.goto('/projekte?projectId=1&tab=mitarbeiter')
    await expect(page.getByRole('row').filter({ hasText: 'SB: Sabine Braun-Hofmeister' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Mitarbeiter zuordnen/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /bearbeiten$/ })).toHaveCount(0)
  })
})

test.describe('Interne Budgets', () => {
  test('Budget je Element mit Plan-Stunden, Regeln mit Elementnamen', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=budget')
    const na1 = page.getByRole('row').filter({ hasText: 'Planungsänderungen auf Wunsch des Bauherrn' }).first()
    await expect(na1).toContainText('nach Plan · 194 von 180 h gebucht')
    await expect(na1).toContainText('Handlungsbedarf')
    await expect(page.getByText('Stunden nach Plan')).toBeVisible()
    const rules = page.getByRole('region', { name: 'Warnregeln' })
    await expect(rules.getByRole('row').filter({ hasText: 'LP5.3 · Werk- und Montageplanung prüfen' })).toContainText('erreicht')
    await expect(page.getByText(/Struktur #\d+/)).toHaveCount(0)
  })

  test('Ampel: beobachten ab der niedrigsten Warnregel, ohne Regel erst ab 100 %', async ({ page }) => {
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=budget')
    const elements = page.getByRole('region', { name: 'Budget je Element' })
    // NA2 79,6 %, niedrigste Regel 75 %
    const na2 = elements.getByRole('row').filter({ hasText: 'Zusätzliche Baubesprechungen' })
    await expect(na2).toContainText('beobachten')
    // LP9 bei 0 % bleibt ohne Stufe
    await expect(elements.getByRole('row').filter({ hasText: 'Objektbetreuung' })).not.toContainText(/beobachten|Handlungsbedarf/)

    await page.route(/\/api\/v1\/budget-warnings\/projects\/\d+(\?|$)/, r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...budgetOverview(), rules: [], fired: [] } }),
    }))
    await page.reload()
    await expect(na2).not.toContainText('beobachten')
    await expect(elements.getByRole('row').filter({ hasText: 'Planungsänderungen auf Wunsch des Bauherrn' })).toContainText('Handlungsbedarf')
  })

  test('Regel anlegen: Personen als Häkchen, Element aus der Liste', async ({ page }) => {
    const posts = record(page, 'POST', /\/budget-warnings\/projects\/1\/rules/)
    await mockPilot(page)
    await page.goto('/projekte?projectId=1&tab=budget')
    await page.getByRole('button', { name: /Neue Regel/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Neue Warnregel' })
    await dialog.getByLabel('Gilt für').selectOption('124')
    await dialog.getByLabel('Schwelle (% des Budgets)').fill('80')
    await dialog.getByLabel('Wer die auslösende Buchung erfasst hat').uncheck()
    await dialog.getByLabel('TK · Thomas Kern').check()
    await expect(dialog).toContainText('Empfänger: Projektleiter (SM), TK')
    await dialog.getByRole('button', { name: 'Anlegen' }).click()
    await expect(dialog).toBeHidden()
    expect(posts[0].body).toMatchObject({ threshold_pct: 80, structure_id: 124, notify_pm: true, notify_booker: false, notify_cc: [2] })
  })

  test('ohne Bearbeitungsrecht keine Knöpfe', async ({ page }) => {
    await mockPilot(page, { permissions: VIEW })
    await page.goto('/projekte?projectId=1&tab=budget')
    await expect(page.getByText('Budget je Element')).toBeVisible()
    await expect(page.getByRole('button', { name: /Neue Regel|stumm schalten/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Regel .* bearbeiten$/ })).toHaveCount(0)
  })
})

test.describe('Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) > 640, 'Handy')

  for (const tab of ['vertraege', 'mitarbeiter', 'budget']) {
    test(`kein Querscrollen: ${tab}`, async ({ page }) => {
      await mockPilot(page)
      await page.goto(`/projekte?projectId=1&tab=${tab}`)
      await page.locator('.form-section').first().waitFor()
      await page.waitForLoadState('networkidle')
      // documentElement statt body: ein absolut positionierter Screenreader-
      // Text in einer Tabelle vergrösserte das Dokument, nicht den body.
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(w).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 2)
    })
  }
})
