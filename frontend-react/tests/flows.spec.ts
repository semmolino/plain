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

  // Default stub — returns empty list for any unmatched API route
  await page.route('/api/v1/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    })
  )
}

/** Navigates to a page and waits for the bottom nav to confirm the app shell loaded. */
async function gotoPage(page: Page, path: string) {
  await page.goto(path)
  await page.locator('.bottom-nav').waitFor({ timeout: 8_000 })
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

    test(`${route.label}: bottom nav always visible`, async ({ page }) => {
      await gotoPage(page, route.path)
      await expect(page.locator('.bottom-nav')).toBeVisible()
    })

    test(`${route.label}: page content not hidden behind bottom nav`, async ({ page }) => {
      await gotoPage(page, route.path)
      // The main content area must have enough bottom padding so the nav doesn't cover it
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
    // Page should not crash — bottom nav confirms shell is up
    await expect(page.locator('.bottom-nav')).toBeVisible()
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
    await expect(page.locator('.bottom-nav')).toBeVisible()
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
    await expect(page.locator('.bottom-nav')).toBeVisible()
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
    await expect(page.locator('.bottom-nav')).toBeVisible()
  })
})

// ── Mitarbeiter (Employees) ───────────────────────────────────────────────────

test.describe('Mitarbeiter', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('page renders', async ({ page }) => {
    await gotoPage(page, '/mitarbeiter')
    await expect(page.locator('.bottom-nav')).toBeVisible()
  })
})

// ── Navigation flow ───────────────────────────────────────────────────────────

test.describe('Bottom nav navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
  })

  test('can navigate between all main sections without crash', async ({ page }) => {
    await gotoPage(page, '/')
    for (const route of MAIN_ROUTES) {
      await page.goto(route.path)
      await page.locator('.bottom-nav').waitFor({ timeout: 8_000 })
      await expect(page.locator('.bottom-nav')).toBeVisible()
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
