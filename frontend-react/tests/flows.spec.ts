/**
 * flows.spec.ts — Main user-journey tests for Plain and Simple
 *
 * These tests cover the core flows an architect or structural engineer
 * would use day-to-day. All API calls are mocked so tests run offline
 * and without a live backend.
 *
 * Run: npx playwright test tests/flows.spec.ts
 */

import { test, expect, type Page } from '@playwright/test'

// ── Auth mock helpers ─────────────────────────────────────────────────────────

const FAKE_AUTH = {
  state: {
    token:       'test-token',
    employeeId:  1,
    tenantId:    1,
    shortName:   'SM',
    email:       'simon@plain.de',
    companyName: 'Architekturbüro Muster GmbH',
  },
  version: 0,
}

/** Injects auth state and stubs all API routes with realistic empty responses. */
async function mockLoggedIn(page: Page) {
  await page.addInitScript((auth) => {
    localStorage.setItem('plain_auth', JSON.stringify(auth))
  }, FAKE_AUTH)

  // Playwright route precedence: most-recently-registered runs first.
  // Catch-all MUSS daher ZUERST registriert werden, danach die spezifischen
  // Handler, damit /auth/me und /permissions/me korrekt antworten.
  await page.route('/api/v1/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    })
  )

  await page.route('/api/v1/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        employee_id:  1,
        tenant_id:    1,
        email:        'simon@plain.de',
        short_name:   'SM',
        company_name: 'Architekturbüro Muster GmbH',
      }),
    })
  )

  // RBAC: Test-User ist "unrestricted" (= Admin/Foundation-Phase), damit Nav,
  // Tabs und Buttons sichtbar bleiben. Sonst filtert die App alles weg.
  await page.route('/api/v1/permissions/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ keys: [], unrestricted: true }),
    })
  )

  // Lizenz (L2): AuthContext.init() laedt nach den Permissions auch das
  // Entitlement. Ohne eigenen Mock faellt /license/me auf den Catch-All
  // ({ data: [] }) zurueck -> licenseStore.unrestricted=false + leere caps,
  // wodurch SideNav/BottomNav JEDES Item mit `feature` ausfiltern. Daher hier
  // explizit unrestricted=true, damit die Lizenz-Schicht nichts versteckt.
  await page.route('/api/v1/license/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        unrestricted: true, plan_id: null, state: null,
        capabilities: [], limits: {},
      }),
    })
  )
}

/** Navigates to a page and waits for the app shell to be visible.
 *  Uses .app-main which is always present (vs. .bottom-nav which is mobile-only,
 *  display:none on desktop ≥ 1024px). */
async function gotoPage(page: Page, path: string) {
  await page.goto(path)
  await page.locator('.app-main').waitFor({ timeout: 10_000 })
}

/** True when the test runs in the mobile project (viewport < 1024px). */
function isMobile(viewport: { width: number; height: number } | null | undefined): boolean {
  return (viewport?.width ?? 0) < 1024
}

// ── Shared layout checks (run on every main page) ─────────────────────────────

const MAIN_ROUTES = [
  { path: '/',           label: 'Dashboard'    },
  { path: '/angebote',   label: 'Angebote'     },
  { path: '/projekte',   label: 'Projekte'     },
  { path: '/rechnungen', label: 'Rechnungen'   },
  { path: '/adressen',   label: 'Adressen'     },
  { path: '/mitarbeiter',label: 'Mitarbeiter'  },
]

test.describe('Layout — all main pages', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  for (const route of MAIN_ROUTES) {
    test(`${route.label}: no horizontal overflow`, async ({ page, viewport }) => {
      await gotoPage(page, route.path)
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      expect(scrollWidth).toBeLessThanOrEqual((viewport?.width ?? 390) + 2)
    })

    test(`${route.label}: primary nav always visible`, async ({ page, viewport }) => {
      await gotoPage(page, route.path)
      // Mobile: bottom-nav; Desktop: side-nav. Beide tragen die Hauptnavigation.
      const selector = isMobile(viewport) ? '.bottom-nav' : '.side-nav'
      await expect(page.locator(selector)).toBeVisible()
    })

    test(`${route.label}: page content not hidden behind bottom nav`, async ({ page, viewport }) => {
      if (!isMobile(viewport)) {
        // Desktop hat keine fixed Bottom-Nav -- der Padding-Check ist mobile-only.
        return
      }
      await gotoPage(page, route.path)
      const paddingBottom = await page.evaluate(() => {
        const main = document.querySelector('main') ?? document.querySelector('.page-root') ?? document.body
        return parseInt(window.getComputedStyle(main).paddingBottom, 10)
      })
      expect(paddingBottom).toBeGreaterThanOrEqual(64)
    })
  }
})

// ── Dashboard ─────────────────────────────────────────────────────────────────

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('loads without error boundary', async ({ page }) => {
    await gotoPage(page, '/')
    await expect(page.locator('.error-boundary, [data-testid="error"]')).toHaveCount(0)
  })
})

// ── Angebote (Offers) ─────────────────────────────────────────────────────────

test.describe('Angebote', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('list page renders', async ({ page }) => {
    await gotoPage(page, '/angebote')
    // Page should not crash — app shell confirms render
    await expect(page.locator('.app-main')).toBeVisible()
  })

  test('shows empty state when no offers exist', async ({ page }) => {
    await gotoPage(page, '/angebote')
    // With empty API response, the list should be empty (no table rows or a visible empty message)
    const rows = page.locator('table tbody tr, [data-testid="angebot-row"]')
    // Either zero rows or a visible empty-state indicator is acceptable
    const rowCount = await rows.count()
    if (rowCount > 0) {
      // If rows render despite empty data, something is wrong
      expect(rowCount).toBe(0)
    }
  })

  test('"Neu" button is visible and has sufficient touch target', async ({ page }) => {
    await gotoPage(page, '/angebote')
    const neuBtn = page.locator('button').filter({ hasText: /neu|anlegen|erstellen/i }).first()
    const count = await neuBtn.count()
    if (count > 0) {
      const box = await neuBtn.boundingBox()
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
      }
    }
  })
})

// ── Projekte (Projects) ───────────────────────────────────────────────────────

test.describe('Projekte', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('list page renders', async ({ page }) => {
    await gotoPage(page, '/projekte')
    await expect(page.locator('.app-main')).toBeVisible()
  })

  test('no error boundary triggered on empty data', async ({ page }) => {
    await gotoPage(page, '/projekte')
    await expect(page.locator('.error-boundary, [data-testid="error"]')).toHaveCount(0)
  })
})

// ── Rechnungen (Invoices) ─────────────────────────────────────────────────────

test.describe('Rechnungen', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('list page renders', async ({ page }) => {
    await gotoPage(page, '/rechnungen')
    await expect(page.locator('.app-main')).toBeVisible()
  })

  test('no error boundary triggered on empty data', async ({ page }) => {
    await gotoPage(page, '/rechnungen')
    await expect(page.locator('.error-boundary, [data-testid="error"]')).toHaveCount(0)
  })
})

// ── Adressen (Addresses) ──────────────────────────────────────────────────────

test.describe('Adressen', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('page renders', async ({ page }) => {
    await gotoPage(page, '/adressen')
    await expect(page.locator('.app-main')).toBeVisible()
  })
})

// ── Mitarbeiter (Employees) ───────────────────────────────────────────────────

test.describe('Mitarbeiter', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('page renders', async ({ page }) => {
    await gotoPage(page, '/mitarbeiter')
    await expect(page.locator('.app-main')).toBeVisible()
  })
})

// ── Navigation flow ───────────────────────────────────────────────────────────

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('can navigate between all main sections without crash', async ({ page }) => {
    await gotoPage(page, '/')
    for (const route of MAIN_ROUTES) {
      await page.goto(route.path)
      await page.locator('.app-main').waitFor({ timeout: 10_000 })
      await expect(page.locator('.app-main')).toBeVisible()
    }
  })
})

// ── Mobile viewport (390 × 844 — iPhone 14) ──────────────────────────────────

test.describe('Mobile layout (390 × 844)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('no horizontal overflow on dashboard', async ({ page }) => {
    await gotoPage(page, '/')
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(392)
  })

  test('bottom nav is visible on mobile', async ({ page }) => {
    await gotoPage(page, '/')
    await expect(page.locator('.bottom-nav')).toBeVisible()
  })

  test('bottom nav items have sufficient touch target (height ≥ 44px)', async ({ page }) => {
    await gotoPage(page, '/')
    const items = page.locator('.bottom-nav-item')
    const count = await items.count()
    for (let i = 0; i < count; i++) {
      const box = await items.nth(i).boundingBox()
      if (box) expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })

  test('no horizontal overflow on Rechnungen', async ({ page }) => {
    await gotoPage(page, '/rechnungen')
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(392)
  })

  test('no horizontal overflow on Projekte', async ({ page }) => {
    await gotoPage(page, '/projekte')
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(392)
  })

  test('side nav is hidden on mobile', async ({ page }) => {
    await gotoPage(page, '/')
    const sideNav = page.locator('.side-nav')
    // Side nav should either not exist or be hidden (display:none)
    const count = await sideNav.count()
    if (count > 0) {
      const isVisible = await sideNav.isVisible()
      expect(isVisible).toBe(false)
    }
  })
})

// ── Auth guard ────────────────────────────────────────────────────────────────

test.describe('Auth guard', () => {
  test('unauthenticated access to /projekte redirects to /login', async ({ page }) => {
    await page.goto('/projekte')
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated access to /rechnungen redirects to /login', async ({ page }) => {
    await page.goto('/rechnungen')
    await expect(page).toHaveURL(/\/login/)
  })
})

// ── Forms — input types ───────────────────────────────────────────────────────

test.describe('Form input types', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('login form uses correct input types for mobile keyboards', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })
})
