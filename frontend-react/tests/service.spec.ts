import { test, expect, type Page } from '@playwright/test'

// ── Auth helper (gleiches Muster wie smoke.spec.ts / flows.spec.ts) ──────────

const FAKE_AUTH = {
  state: {
    token: 'test-token', employeeId: 1, tenantId: 1,
    shortName: 'TEST', email: 'test@plain.de', companyName: 'Test GmbH',
  },
  version: 0,
}

async function mockLoggedIn(page: Page) {
  await page.addInitScript((auth) => {
    localStorage.setItem('plain_auth', JSON.stringify(auth))
  }, FAKE_AUTH)

  // Catch-all ZUERST (Playwright: zuletzt registrierte Route gewinnt).
  await page.route('/api/v1/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }))

  await page.route('/api/v1/auth/me', route =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ employee_id: 1, tenant_id: 1, email: 'test@plain.de', short_name: 'TEST', company_name: 'Test GmbH' }),
    }))

  await page.route('/api/v1/permissions/me', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ keys: [], unrestricted: true }) }))

  await page.route('/api/v1/license/me', route =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ unrestricted: true, plan_id: null, state: null, capabilities: [], limits: {} }),
    }))
}

// Service-spezifische Mocks. `accepted` steuert das Zugangs-Gate; der POST
// schaltet es (stateful) frei, damit der Accept-Flow testbar ist.
async function mockService(page: Page, { accepted = true }: { accepted?: boolean } = {}) {
  const state = { accepted }
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route(/\/service\/consent/, route => {
    if (route.request().method() === 'POST') {
      state.accepted = true
      return route.fulfill(json({ accepted: true, current_version: '2026-06-29' }))
    }
    return route.fulfill(json({ current_version: '2026-06-29', accepted: state.accepted, accepted_at: state.accepted ? '2026-06-30T00:00:00Z' : null }))
  })
  await page.route(/\/service\/delegate/, route => route.fulfill(json({ employee_id: null, employee_name: null, is_me: false })))
  await page.route(/\/service\/suggestions\/board/, route => route.fulfill(json({ can_vote: false, data: [] })))
  await page.route(/\/service\/suggestions\/mine/, route => route.fulfill(json({ org_view: false, data: [] })))
  await page.route(/\/service\/requests\/contact/, route => route.fulfill(json({ name: 'Max Muster', email: 'max@test.de', org: 'Test GmbH' })))
  await page.route(/\/service\/requests\/mine/, route => route.fulfill(json({ data: [] })))
}

// ── Zugangs-Gate (Haftungsbestätigung) ───────────────────────────────────────

test.describe('Service — Zugangs-Gate', () => {
  test('zeigt das Haftungs-/Nutzungs-Gate, solange nicht bestätigt', async ({ page }) => {
    await mockLoggedIn(page)
    await mockService(page, { accepted: false })
    await page.goto('/service')

    await expect(page.locator('.consent-card')).toBeVisible()
    // Vor Bestätigung sind die Bereichs-Tabs nicht sichtbar.
    await expect(page.getByRole('heading', { name: 'Vorschläge für Funktionen' })).toHaveCount(0)
  })

  test('Akzeptieren ist erst nach Häkchen möglich und gibt den Bereich frei', async ({ page }) => {
    await mockLoggedIn(page)
    await mockService(page, { accepted: false })
    await page.goto('/service')

    const accept = page.locator('button.btn-primary').filter({ hasText: 'Akzeptieren und fortfahren' })
    await expect(accept).toBeVisible()
    await expect(accept).toBeDisabled()

    await page.locator('.consent-check input[type="checkbox"]').check()
    await expect(accept).toBeEnabled()
    await accept.click()

    await expect(page.locator('.consent-card')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Vorschläge für Funktionen' })).toBeVisible()
  })
})

// ── Bereich (Consent bereits bestätigt) ──────────────────────────────────────

test.describe('Service — Bereich', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
    await mockService(page, { accepted: true })
  })

  test('Service-Nav-Eintrag verlinkt auf /service', async ({ page, viewport }) => {
    await page.goto('/')
    const isMobile = (viewport?.width ?? 0) < 1024
    const selector = isMobile ? '.bottom-nav-item' : '.side-nav-item'
    const href = await page.locator(selector).filter({ hasText: 'Service' }).getAttribute('href')
    expect(href).toBe('/service')
  })

  test('rendert die drei Sub-Tabs', async ({ page }) => {
    await page.goto('/service')
    for (const label of ['Vorschläge', 'Feedback', 'Unterstützung']) {
      await expect(page.locator('.seg-nav-btn').filter({ hasText: label })).toBeVisible()
    }
  })

  test('kein horizontaler Overflow auf /service', async ({ page, viewport }) => {
    await page.goto('/service')
    await page.locator('.service-page').waitFor()
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual((viewport?.width ?? 390) + 2)
  })

  test('Einreich-Modal öffnet sich', async ({ page }) => {
    await page.goto('/service')
    await page.locator('button.btn-primary').filter({ hasText: 'Vorschlag einreichen' }).click()
    await expect(page.locator('.modal-title').filter({ hasText: 'Vorschlag einreichen' })).toBeVisible()
  })

  test('Feedback-Tab zeigt vorbelegte Organisation', async ({ page }) => {
    await page.goto('/service')
    await page.locator('.seg-nav-btn').filter({ hasText: 'Feedback' }).click()
    await expect(page.getByText('Test GmbH')).toBeVisible()
  })

  test('Unterstützung-Tab zeigt Kategorie-Kacheln', async ({ page }) => {
    await page.goto('/service')
    await page.locator('.seg-nav-btn').filter({ hasText: 'Unterstützung' }).click()
    await expect(page.locator('.sg-cat-tile').filter({ hasText: 'Datenimport & Altdaten' })).toBeVisible()
  })
})
