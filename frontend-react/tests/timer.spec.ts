import { test, expect, type Page, type Request } from '@playwright/test'
import { mockPilot, TIMER_DRAFTS } from './fixtures/pilotData'

/**
 * Stempeluhr und „Meine Zeit" (UI-Pilot Runde 2).
 *
 * Die vier Stempeluhr-Dialoge waren eigene Overlays ohne Escape und
 * Fokusfalle, mit Emoji als Symbolen und Auswahllisten, die auch Knoten mit
 * Unterelementen anboten. Jetzt Modal + DialogFooter und dieselbe
 * Projekt-/Leistungswahl wie „Zeit buchen".
 */

const NOW = new Date('2026-09-24T10:30:00')

function capture(page: Page, method: string, re: RegExp) {
  const hits: Request[] = []
  page.on('request', r => { if (r.method() === method && re.test(r.url())) hits.push(r) })
  return hits
}

async function seedTimer(page: Page, minutesAgo: number, employeeId = 1) {
  const start = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString()
  await page.addInitScript(([emp, iso]) => {
    localStorage.setItem('plain-timer-session', JSON.stringify({
      state: {
        session: { employeeId: emp, employeeName: 'SM', cpRate: 0, projectId: 1, projectName: 'P-2024-001',
          structureId: 107, structureName: 'LP5.1', blockStartIso: iso },
        breakState: null, showReview: false, reviewDate: null,
      },
      version: 0,
    }))
  }, [employeeId, start] as const)
}

async function setup(page: Page, opts: Parameters<typeof mockPilot>[1] = {}) {
  await page.clock.setFixedTime(NOW)
  await mockPilot(page, opts)
}

const timerSession = (page: Page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('plain-timer-session') ?? '{}')?.state?.session ?? null)

test.describe('Stempeluhr-Dialoge', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) <= 640, 'Desktop-Kopfzeile; Handy siehe unten')

  test('Start: Zuletzt-Chip, Abbrechen links, Escape schließt und gibt den Fokus zurück', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    const trigger = page.getByRole('button', { name: /Stempeluhr/ }).first()
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Stempeluhr starten' })
    await expect(dialog).toBeVisible()
    // Kein Emoji mehr im Titel oder auf den Knoepfen.
    expect(await dialog.innerText()).not.toMatch(/[▶⏭⏹📋✎🗑]/u)

    const cancel = dialog.getByRole('button', { name: 'Abbrechen' })
    const start  = dialog.getByRole('button', { name: 'Starten' })
    await expect(start).toBeDisabled()
    expect((await cancel.boundingBox())!.x).toBeLessThan((await start.boundingBox())!.x)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()

    await trigger.click()
    await dialog.getByRole('button', { name: /LP5\.1/ }).click()
    await expect(dialog.getByLabel('Woran arbeitest du?*')).toHaveValue('107')
    await dialog.getByRole('button', { name: 'Starten' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.timer-chip')).toBeVisible()
    expect(await timerSession(page)).toMatchObject({ employeeId: 1, projectId: 1, structureId: 107 })
  })

  test('Leistung bietet nur Blätter an', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await page.getByRole('button', { name: /Stempeluhr/ }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Stempeluhr starten' })
    await dialog.getByRole('combobox', { name: 'Projekt suchen …' }).fill('P-2024-001')
    await dialog.getByRole('option', { name: /P-2024-001/ }).first().click()
    const options = await dialog.getByLabel('Woran arbeitest du?*').locator('option').allInnerTexts()
    // 106 (LP5) hat Unterelemente — darauf nimmt der Server keine Buchung an.
    expect(options.some(o => /^LP5: /.test(o))).toBe(false)
    expect(options.some(o => /LP5\.1/.test(o))).toBe(true)
  })

  test('Nächste Aufgabe sichert den Abschnitt und wechselt', async ({ page }) => {
    await seedTimer(page, 45)
    await setup(page)
    const drafts = capture(page, 'POST', /\/buchungen\/timer\/draft(\?|$)/)
    await page.goto('/')
    await page.getByRole('button', { name: 'Nächste Aufgabe' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nächste Aufgabe' })
    await expect(dialog.locator('.tm-block')).toContainText('45min')

    // Die laufende Aufgabe ist kein Wechsel.
    await dialog.getByRole('button', { name: /LP5\.1/ }).click()
    await expect(dialog.getByRole('button', { name: 'Wechseln' })).toBeDisabled()

    await dialog.getByRole('button', { name: /LP5\.2/ }).click()
    await dialog.getByLabel(/Was hast du gemacht/).fill('Schalpläne Treppenhaus')
    await dialog.getByRole('button', { name: 'Wechseln' }).click()
    await expect(dialog).toBeHidden()
    expect(drafts).toHaveLength(1)
    expect(drafts[0].postDataJSON()).toMatchObject({
      PROJECT_ID: 1, STRUCTURE_ID: 107, QUANTITY_INT: 0.75, POSTING_DESCRIPTION: 'Schalpläne Treppenhaus',
    })
    expect(await timerSession(page)).toMatchObject({ structureId: 108 })
  })

  test('Beenden: Uhr ist sofort aus, Tagesübersicht prüft Pause und gibt frei', async ({ page }) => {
    await seedTimer(page, 30)
    await setup(page)
    await page.route(/\/api\/v1\/buchungen\/timer\/drafts(\?|$)/, r => r.fulfill({ json: { data: TIMER_DRAFTS } }))
    const drafts   = capture(page, 'POST', /\/buchungen\/timer\/draft(\?|$)/)
    const confirms = capture(page, 'POST', /\/buchungen\/timer\/confirm(\?|$)/)
    await page.goto('/')
    await page.getByRole('button', { name: 'Beenden' }).click()
    const finish = page.getByRole('dialog', { name: 'Arbeitstag beenden' })
    await finish.getByLabel(/Was hast du gemacht/).fill('Ausschreibung Fenster')
    await finish.getByRole('button', { name: /Beenden & prüfen/ }).click()

    const review = page.getByRole('dialog', { name: 'Tagesübersicht 24.09.2026' })
    await expect(review).toBeVisible()
    expect(drafts).toHaveLength(1)
    expect(drafts[0].postDataJSON()).toMatchObject({ QUANTITY_INT: 0.5, POSTING_DESCRIPTION: 'Ausschreibung Fenster' })
    // Vorher lief die Uhr bis zur Freigabe weiter und zaehlte den Abschnitt doppelt.
    expect(await timerSession(page)).toBeNull()

    // 6,25 h ohne Pause → Hinweis mit Wahl
    await expect(review.getByRole('alert')).toContainText('ohne ausreichende Pause')
    await expect(review.getByText('Noch keine Beschreibung')).toBeVisible()
    await review.getByRole('radio', { name: /Ich habe zusätzlich/ }).check()
    await review.getByRole('spinbutton', { name: 'Minuten Pause' }).fill('30')
    await review.getByRole('button', { name: '2 Einträge freigeben' }).click()
    await expect(review).toBeHidden()
    expect(confirms).toHaveLength(1)
    expect(confirms[0].postDataJSON()).toMatchObject({
      ids: [801, 802],
      break_confirmations: { '1|2026-09-24': { kind: 'BREAK_TAKEN_UNRECORDED', minutes: 30 } },
    })
  })

  test('Tagesübersicht: Eintrag ändern, Stunden folgen Von/Bis', async ({ page }) => {
    await setup(page)
    await page.route(/\/api\/v1\/buchungen\/timer\/drafts(\?|$)/, r => r.fulfill({ json: { data: TIMER_DRAFTS } }))
    const patches = capture(page, 'PATCH', /\/buchungen\/timer\/draft\/802(\?|$)/)
    await page.addInitScript(() => localStorage.setItem('plain-timer-session', JSON.stringify({
      state: { session: null, breakState: null, showReview: true, reviewDate: null }, version: 0,
    })))
    await page.goto('/')
    const review = page.getByRole('dialog', { name: /Tagesübersicht/ })
    await review.getByRole('button', { name: 'Eintrag 11:30 bearbeiten' }).click()
    await review.getByLabel('Bis').fill('13:30')
    await expect(review.getByLabel('Stunden')).toHaveValue('2')
    await review.getByLabel('Beschreibung').fill('Baubesprechung')
    // Freigeben wartet, bis die offene Aenderung uebernommen ist.
    await expect(review.getByRole('button', { name: /Einträge freigeben/ })).toBeDisabled()
    await review.getByRole('button', { name: 'Übernehmen' }).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0].postDataJSON()).toMatchObject({
      description: 'Baubesprechung', time_start: '11:30:00', time_finish: '13:30:00', quantity_int: 2,
    })
  })
})

test.describe('Stempeluhr am Handy', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'nur schmale Viewports')

  test('Blatt → Nächste Aufgabe: Dialog passt, Knöpfe 44 px', async ({ page }) => {
    await seedTimer(page, 20)
    await setup(page)
    await page.goto('/')
    await page.locator('.timer-chip').click()
    await page.getByRole('dialog', { name: 'Stempeluhr' }).getByRole('button', { name: 'Nächste Aufgabe' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nächste Aufgabe' })
    await expect(dialog).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth) - page.viewportSize()!.width
    expect(overflow).toBeLessThanOrEqual(2)
    for (const h of await dialog.locator('.modal-actions button').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) {
      expect(h).toBeGreaterThanOrEqual(44)
    }
    // Die Fusszeile ist antippbar. Vorher lag der Dialog in der Ebene der
    // Kopfzeile, und die untere Navigation deckte „Abbrechen"/„Wechseln" ab.
    await dialog.getByRole('button', { name: 'Abbrechen' }).click({ trial: true, timeout: 3000 })
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('Meine Zeit', () => {
  test('Woche mit Soll/Ist, Tag wählen, gesperrte Buchung erklärt sich', async ({ page }) => {
    await setup(page, { role: 'mitarbeiter' })
    await page.goto('/')
    const card = page.getByRole('region', { name: /Meine Zeit/ })
    await expect(card).toBeVisible()
    const days = card.getByRole('group', { name: /KW 39/ }).getByRole('button')
    await expect(days).toHaveCount(5)
    await expect(card.getByRole('button', { name: /Do\., 24\.09\..*3,5 von 8 Stunden/ })).toHaveAttribute('aria-pressed', 'true')

    // Heute: Entwurf der Stempeluhr wartet
    await expect(card.getByRole('status')).toContainText('1 Eintrag der Stempeluhr')

    // Montag: erste Buchung ist abgerechnet → Schloss statt Ändern/Löschen
    await card.getByRole('button', { name: /Mo\., 21\.09\./ }).click()
    const rows = card.locator('.mz-row')
    await expect(rows.first()).toContainText('abgerechnet')
    await expect(rows.first().getByRole('button', { name: /ändern|löschen/ })).toHaveCount(0)
    await expect(rows.nth(1).getByRole('button', { name: /ändern/ })).toBeVisible()
  })

  test('Ändern schickt nur Geändertes, Abrechnungsstunden folgen', async ({ page }) => {
    await setup(page, { role: 'mitarbeiter' })
    const patches = capture(page, 'PATCH', /\/api\/v1\/buchungen\/\d+(\?|$)/)
    await page.goto('/')
    const card = page.getByRole('region', { name: /Meine Zeit/ })
    await card.locator('.mz-row').first().getByRole('button', { name: /ändern/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Buchung ändern' })
    await dialog.getByLabel('Dauer (Stunden)').fill('2,5')
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(dialog).toBeHidden()
    expect(patches).toHaveLength(1)
    expect(patches[0].postDataJSON()).toEqual({ QUANTITY_INT: 2.5, QUANTITY_EXT: 2.5 })
  })

  test('Nochmal buchen öffnet „Zeit buchen" mit Projekt, Leistung und Text', async ({ page }) => {
    await setup(page, { role: 'mitarbeiter' })
    await page.goto('/')
    const card = page.getByRole('region', { name: /Meine Zeit/ })
    await card.locator('.mz-row').first().getByRole('button', { name: /nochmal buchen/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Zeit buchen' })
    await expect(dialog.getByRole('combobox', { name: 'Projekt suchen …' })).toHaveValue(/P-2024-001/)
    await expect(dialog.getByLabel('Leistung*')).toHaveValue('108')
    await expect(dialog.getByLabel('Beschreibung*')).not.toHaveValue('')
  })

  test('Löschen fragt nach', async ({ page }) => {
    await setup(page, { role: 'mitarbeiter' })
    const deletes = capture(page, 'DELETE', /\/api\/v1\/buchungen\/\d+(\?|$)/)
    await page.goto('/')
    const card = page.getByRole('region', { name: /Meine Zeit/ })
    await card.locator('.mz-row').first().getByRole('button', { name: /löschen/ }).click()
    await page.getByRole('dialog', { name: 'Buchung löschen?' }).getByRole('button', { name: 'Löschen' }).click()
    await expect.poll(() => deletes.length).toBe(1)
  })

  test('Entwürfe eines früheren Tages öffnen dessen Tagesübersicht', async ({ page }) => {
    await setup(page, { role: 'mitarbeiter' })
    await page.route(/\/api\/v1\/buchungen\/mine(\?|$)/, r => r.fulfill({ json: { data: {
      from: '2026-09-21', to: '2026-09-27', bookings: [],
      drafts: [{ ID: 777, PROJECT_ID: 1, STRUCTURE_ID: 107, BOOKING_DATE: '2026-09-22', TIME_START: '08:00:00', TIME_FINISH: '10:00:00',
        QUANTITY_INT: 2, EXT_FOLLOWS: true, POSTING_DESCRIPTION: '', ENTRY_KIND: 'WORK', BOOKING_KIND: null,
        PROJECT: { ABBR: 'P-2024-001', NAME: 'Kita' }, STRUCTURE: { ABBR: 'LP5.1', NAME: null }, BILLED: false, CLOSED: false }],
    } } }))
    const draftReqs = capture(page, 'GET', /\/buchungen\/timer\/drafts\?/)
    await page.goto('/')
    const card = page.getByRole('region', { name: /Meine Zeit/ })
    await card.getByRole('button', { name: /Di\., 22\.09\./ }).click()
    await card.getByRole('button', { name: /Prüfen & freigeben/ }).click()
    await expect(page.getByRole('dialog', { name: 'Tagesübersicht 22.09.2026' })).toBeVisible()
    expect(draftReqs.some(r => /date=2026-09-22/.test(r.url()))).toBe(true)
  })
})

test.describe('Eigene Zeit buchen (nur projects.bookings.own)', () => {
  const PERMS = ['dashboard.view', 'projects.bookings.own']

  test('bucht über die schlanken Listen, ohne Mitarbeiterfeld', async ({ page }) => {
    await setup(page, { role: 'mitarbeiter', permissions: PERMS })
    const lists = capture(page, 'GET', /\/api\/v1\/(buchungen\/eigen\/projekte|projekte)(\/|\?|$)/)
    await page.goto('/')
    await page.getByRole('button', { name: 'Zeit buchen' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Zeit buchen' })
    await dialog.getByRole('button', { name: /LP5\.1/ }).click()
    await expect(dialog.getByLabel('Leistung*')).toHaveValue('107')
    await expect(dialog.getByLabel('Mitarbeiter')).toHaveCount(0)
    const urls = lists.map(r => new URL(r.url()).pathname)
    expect(urls.some(u => u.includes('/buchungen/eigen/projekte'))).toBe(true)
    // Die vollen Projektlisten (Honorare, Strukturwerte) werden nicht angefragt.
    expect(urls.some(u => /\/api\/v1\/projekte(\/\d+\/structure)?$/.test(u))).toBe(false)
  })

  test('Stempeluhr ist da', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Kopfzeile Desktop')
    await setup(page, { role: 'mitarbeiter', permissions: PERMS })
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Stempeluhr/ }).first()).toBeVisible()
  })
})
