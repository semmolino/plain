import { test, expect, type Page } from '@playwright/test'

// ── Auth helpers ──────────────────────────────────────────────────────────────

const FAKE_AUTH = {
  state: {
    token:       'test-token',
    employeeId:  1,
    tenantId:    1,
    shortName:   'TEST',
    email:       'test@plain.de',
    companyName: 'Test GmbH',
  },
  version: 0,
}

async function mockLoggedIn(page: Page) {
  // Inject Zustand persisted state before the app boots
  await page.addInitScript((auth) => {
    localStorage.setItem('plain_auth', JSON.stringify(auth))
  }, FAKE_AUTH)

  // AuthContext calls /auth/me on startup to validate the token
  await page.route('/api/v1/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        employee_id: 1, tenant_id: 1,
        email: 'test@plain.de', short_name: 'TEST', company_name: 'Test GmbH',
      }),
    })
  )

  // Return empty data for all other API calls so pages render without errors
  await page.route('/api/v1/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    })
  )
}

// ── Login page ────────────────────────────────────────────────────────────────

test.describe('Login page', () => {
  test('has email and password inputs with correct types', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('Anmelden button is visible in viewport', async ({ page }) => {
    await page.goto('/login')
    const btn = page.locator('button.btn-primary').filter({ hasText: 'Anmelden' })
    await expect(btn).toBeVisible()
    await expect(btn).toBeInViewport()
  })

  test('no horizontal overflow', async ({ page, viewport }) => {
    await page.goto('/login')
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual((viewport?.width ?? 390) + 2)
  })
})

// ── Unauthenticated redirects ─────────────────────────────────────────────────

test.describe('Unauthenticated redirects', () => {
  test('/ redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/angebote redirects to /login', async ({ page }) => {
    await page.goto('/angebote')
    await expect(page).toHaveURL(/\/login/)
  })
})

// ── Authenticated shell ───────────────────────────────────────────────────────

test.describe('Authenticated shell', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('dashboard loads and primary nav is visible', async ({ page, viewport }) => {
    await page.goto('/')
    const isMobile = (viewport?.width ?? 0) < 1024
    await expect(page.locator(isMobile ? '.bottom-nav' : '.side-nav')).toBeVisible()
  })

  test('no horizontal overflow on dashboard', async ({ page, viewport }) => {
    await page.goto('/')
    await page.locator('.app-main').waitFor()
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual((viewport?.width ?? 390) + 2)
  })

  test('bottom nav items meet 44px touch target height (mobile only)', async ({ page, viewport }) => {
    if ((viewport?.width ?? 0) >= 1024) return // bottom-nav hidden on desktop
    await page.goto('/')
    await page.locator('.bottom-nav-item').first().waitFor()
    const heights = await page.locator('.bottom-nav-item').evaluateAll(
      els => els.map(el => el.getBoundingClientRect().height)
    )
    expect(heights.length).toBeGreaterThan(0)
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(44)
    }
  })

  test('primary nav navigates to /adressen', async ({ page, viewport }) => {
    await page.goto('/')
    const isMobile = (viewport?.width ?? 0) < 1024
    const selector = isMobile ? '.bottom-nav-item' : '.side-nav-item'
    await page.locator(selector).filter({ hasText: 'Adressen' }).click()
    await expect(page).toHaveURL('/adressen')
  })

  test('Angebote nav item links to /angebote', async ({ page, viewport }) => {
    await page.goto('/')
    const isMobile = (viewport?.width ?? 0) < 1024
    const selector = isMobile ? '.bottom-nav-item' : '.side-nav-item'
    const href = await page.locator(selector).filter({ hasText: 'Angebote' }).getAttribute('href')
    expect(href).toBe('/angebote')
  })

  test('no horizontal overflow on /angebote', async ({ page, viewport }) => {
    await page.goto('/angebote')
    await page.locator('.app-main').waitFor()
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual((viewport?.width ?? 390) + 2)
  })
})
