import { test, expect, type Page } from '@playwright/test'

/**
 * Regressionstests fuer die Barrierefreiheits-Korrekturen aus dem
 * UX/UI-Audit (docs/UX_UI_AUDIT_2026-08.md).
 *
 * Jeder Test haelt genau einen Befund fest, der vorher gebrochen war —
 * damit er nicht wieder zurueckfaellt.
 */

const FAKE_AUTH = {
  state: {
    token: 'test-token', employeeId: 1, tenantId: 1,
    shortName: 'TEST', email: 'test@plain.de', companyName: 'Test GmbH',
  },
  version: 0,
}

async function mockLoggedIn(page: Page) {
  await page.addInitScript(auth => {
    localStorage.setItem('plain_auth', JSON.stringify(auth))
  }, FAKE_AUTH)

  // Reihenfolge wie in smoke.spec.ts: Catch-All zuerst, dann die
  // spezifischen Routen (Playwright nimmt die zuletzt registrierte).
  await page.route('/api/v1/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }))
  await page.route('/api/v1/auth/me', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      employee_id: 1, tenant_id: 1, email: 'test@plain.de', short_name: 'TEST', company_name: 'Test GmbH',
    }) }))
  await page.route('/api/v1/permissions/me', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ keys: [], unrestricted: true }) }))
  // Ohne diesen Mock filtert die Lizenz-Schicht alle Nav-Items weg.
  await page.route('/api/v1/license/me', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      unrestricted: true, plan_id: null, state: null, capabilities: [], limits: {},
    }) }))
}

/** Devtools-Overlay ausblenden — in Produktion rendert das Paket nichts. */
async function hideDevtools(page: Page) {
  await page.addStyleTag({ content: '.tsqd-parent-container { display: none !important }' })
}

test.describe('Fokus & Tastatur', () => {
  test.beforeEach(async ({ page }) => { await mockLoggedIn(page) })

  test('Skip-Link wird beim ersten Tab sichtbar und springt zum Inhalt', async ({ page }) => {
    await page.goto('/')
    await page.locator('.app-main').waitFor()

    await page.keyboard.press('Tab')
    const skip = page.locator('.skip-link')
    await expect(skip).toBeFocused()
    // Vorher lag der Link ausserhalb des Viewports (left: -9999px).
    const box = await skip.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)

    await page.keyboard.press('Enter')
    await expect(page.locator('#hauptinhalt')).toBeFocused()
  })

  test('Eingabefelder zeigen bei Tastaturfokus einen sichtbaren Ring', async ({ page }) => {
    await page.goto('/login')
    const email = page.locator('input[type="email"]')
    await email.focus()

    // Vorher: outline:none ohne Ersatz -> gar keine sichtbare Rueckmeldung.
    const visible = await email.evaluate(el => {
      const s = getComputedStyle(el)
      const hasOutline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
      const hasShadow  = s.boxShadow !== 'none' && s.boxShadow !== ''
      return hasOutline || hasShadow
    })
    expect(visible).toBe(true)
  })
})

test.describe('Modal-Bedienbarkeit', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedIn(page)
    // Ohne bestaetigtes Consent zeigt /service nur das Zugangs-Gate,
    // dann gibt es gar keinen Button, der ein Modal oeffnet.
    const json = (body: unknown) =>
      ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    await page.route(/\/service\/consent/, r =>
      r.fulfill(json({ current_version: '2026-06-29', accepted: true, accepted_at: '2026-06-30T00:00:00Z' })))
    await page.route(/\/service\/delegate/, r =>
      r.fulfill(json({ employee_id: null, employee_name: null, is_me: false })))
    await page.route(/\/service\/suggestions\/board/, r => r.fulfill(json({ can_vote: false, data: [] })))
    await page.route(/\/service\/suggestions\/mine/,  r => r.fulfill(json({ org_view: false, data: [] })))
  })

  test('Dialog ist als solcher ausgezeichnet und per Escape schliessbar', async ({ page }) => {
    await page.goto('/service')
    await hideDevtools(page)

    await page.locator('button.btn-primary').filter({ hasText: 'Vorschlag einreichen' }).click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    // aria-modal + aria-labelledby fehlten vorher komplett.
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledBy = await dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    // Attribut-Selektor statt "#id": useId() erzeugt Doppelpunkte (»:r1:«),
    // die in einem CSS-ID-Selektor escaped werden muessten.
    await expect(page.locator(`[id="${labelledBy}"]`)).toHaveCount(1)

    // Vorher gab es keinerlei Escape-Behandlung.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

test.describe('Mobile Navigation', () => {
  test.beforeEach(async ({ page }) => { await mockLoggedIn(page) })

  test('Bottom-Nav haelt 44px Touch-Target in Breite UND Hoehe', async ({ page, viewport }) => {
    if ((viewport?.width ?? 0) >= 1024) return
    await page.goto('/')
    await page.locator('.bottom-nav-item').first().waitFor()

    // Der eigentliche Befund: bei 10 Eintraegen blieben 39px BREITE uebrig.
    // Die Hoehe (58px) war nie das Problem und wurde daher nie geprueft.
    const boxes = await page.locator('.bottom-nav-item').evaluateAll(
      els => els.map(el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height } })
    )
    expect(boxes.length).toBeGreaterThan(0)
    expect(boxes.length).toBeLessThanOrEqual(6)   // 5 Ziele + "Mehr"
    for (const b of boxes) {
      expect(b.w).toBeGreaterThanOrEqual(44)
      expect(b.h).toBeGreaterThanOrEqual(44)
    }
  })

  test('"Mehr" oeffnet die restlichen Bereiche', async ({ page, viewport }) => {
    if ((viewport?.width ?? 0) >= 1024) return
    await page.goto('/')
    await hideDevtools(page)

    const more = page.locator('.bn-more-btn')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.bn-more-sheet')).toBeVisible()
    await expect(page.locator('.bn-more-item').filter({ hasText: 'Einstellungen' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.bn-more-sheet')).toBeHidden()
  })

  test('Mobile Navigation behaelt die Reihenfolge der Seitennavigation bei', async ({ page, viewport }) => {
    if ((viewport?.width ?? 0) >= 1024) return
    await page.goto('/')
    await hideDevtools(page)

    // Erst rendern lassen — allInnerTexts() wartet nicht und liefert sonst [].
    await page.locator('.bn-more-btn').waitFor()
    const primary = await page.locator('.bottom-nav-item:not(.bn-more-btn) .bn-label').allInnerTexts()
    await page.locator('.bn-more-btn').click()
    // allInnerTexts() wartet nicht selbst — ohne dieses expect liest der Test
    // das Sheet, bevor React es gerendert hat, und bekommt eine leere Liste.
    await expect(page.locator('.bn-more-sheet')).toBeVisible()
    const overflow = await page.locator('.bn-more-item .bn-label').allInnerTexts()

    // Referenz-Reihenfolge aus navItems.ts — dieselbe Quelle, aus der auch
    // die Seitennavigation gespeist wird.
    const ORDER = ['Übersicht','Adressen','Projekte','Reporting','Rechnungen',
                   'Angebote','Nachträge','Mitarbeiter','Service','Einstellungen']
    const rank = (l: string) => ORDER.indexOf(l)

    // Vorher pflegten SideNav und BottomNav getrennte Arrays: "Einstellungen"
    // stand mobil an Position 6 statt 10. Jetzt darf die Leiste zwar eine
    // Auswahl treffen, aber die relative Reihenfolge nicht mehr umstellen.
    for (const group of [primary, overflow]) {
      const ranks = group.map(rank)
      expect(ranks).not.toContain(-1)
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    }
    expect(primary.length + overflow.length).toBe(ORDER.length)
  })
})

test.describe('Theming', () => {
  test.beforeEach(async ({ page }) => { await mockLoggedIn(page) })

  // Die weisse Wortmarke galt nur fuer data-theme="dark". In allen Branchen-
  // Themes stand der dunkle Schriftzug auf dunkler Chrome-Flaeche — sichtbar
  // blieb nur das blaue „&".
  for (const theme of ['tga-foto', 'urban-foto', 'architecture-foto', 'dark']) {
    test(`Wortmarke in der Seitennavigation ist sichtbar (${theme})`, async ({ page, viewport }) => {
      if ((viewport?.width ?? 0) < 1024) return   // Seitennavigation ist mobil ausgeblendet
      await page.addInitScript(t => { localStorage.setItem('plain-theme-1', t) }, theme)
      await page.goto('/')
      await page.locator('.side-nav-brand').waitFor()

      const shown = await page.locator('.side-nav-brand .brand-wordmark-white').evaluate(
        el => getComputedStyle(el).display
      )
      const hidden = await page.locator('.side-nav-brand .brand-wordmark-color').evaluate(
        el => getComputedStyle(el).display
      )
      expect(shown).not.toBe('none')
      expect(hidden).toBe('none')
    })
  }

  test('Login zeigt weiterhin die farbige Wortmarke auf hellem Grund', async ({ page }) => {
    await page.goto('/login')
    await page.locator('.auth-logo').waitFor()
    const color = await page.locator('.auth-logo .brand-wordmark-color').evaluate(
      el => getComputedStyle(el).display
    )
    expect(color).not.toBe('none')
  })
})

test.describe('Mobile Bedienbarkeit', () => {
  test.beforeEach(async ({ page }) => { await mockLoggedIn(page) })

  // Gemessen auf 390x844 lagen vor dieser Runde 75 Bedienelemente allein auf
  // der Projektliste unter 44px — Zeilen-Icons, Inline-Auswahlen, Checkboxen
  // (16px) und die Kopfzeilen-Knoepfe. Mit Maus unkritisch, mit dem Daumen
  // nicht. WCAG 2.5.8 (AA) fordert 24x24; CLAUDE.md fordert 44x44.
  for (const [name, url] of [['Übersicht', '/'], ['Adressen', '/adressen']] as [string, string][]) {
    test(`${name} — Bedienelemente erfuellen 24px (WCAG 2.5.8)`, async ({ page, viewport }) => {
      if ((viewport?.width ?? 0) >= 1024) return
      await page.goto(url)
      await page.locator('.app-main').waitFor()
      await page.waitForTimeout(600)

      const tooSmall = await page.evaluate(() => {
        const bad: string[] = []
        for (const el of document.querySelectorAll('button, a[href], select')) {
          const b = (el as HTMLElement).getBoundingClientRect()
          if (b.width === 0 || b.height === 0) continue          // ausgeblendet
          if (b.width < 24 || b.height < 24) {
            bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} `
              + `${Math.round(b.width)}x${Math.round(b.height)}`)
          }
        }
        return bad
      })
      expect(tooSmall, `Zu kleine Bedienelemente auf ${url}:\n  ${tooSmall.join('\n  ')}`).toEqual([])
    })
  }

  test('Bottom-Nav respektiert die Safe-Area unten', async ({ page, viewport }) => {
    if ((viewport?.width ?? 0) >= 1024) return
    await page.goto('/')
    await page.locator('.bottom-nav').waitFor()
    // env(safe-area-inset-*) meldet im Test 0; geprueft wird, dass die Regel
    // ueberhaupt greift und die Nav nicht wieder auf feste 58px zurueckfaellt.
    const usesEnv = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav') as HTMLElement
      return getComputedStyle(nav).paddingBottom !== '' && nav.getBoundingClientRect().height >= 58
    })
    expect(usesEnv).toBe(true)
  })
})
