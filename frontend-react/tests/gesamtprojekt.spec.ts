import { test, expect, type Page } from '@playwright/test'
import { hideDevtools } from './fixtures/demoData'
import { GROUP, mockGroups } from './fixtures/gesamtprojektData'
import { CATALOG } from './fixtures/dokumentvorlagenData'
import { pdfResponse } from './fixtures/samplePdf'

/**
 * Gesamtprojekte (Migration 0181, docs/GESAMTPROJEKT_CONCEPT.md): Liste,
 * Ansicht mit Summen, „Teil von" im Projektkopf, Zuordnung in den
 * Projektdaten und Zwischensummen im Report „Alle Projekte".
 */

const noHorizontalScroll = (page: Page) => page.evaluate(() =>
  document.documentElement.scrollWidth <= window.innerWidth + 2)

/** Ein Projekt in der Übersicht: Tabellenzeile am Desktop, Listeneintrag am Handy. */
const member = (page: Page, mobile: boolean, abbr: string) =>
  mobile ? page.getByRole('button', { name: new RegExp(abbr) }) : page.getByRole('row', { name: new RegExp(abbr) })

test.describe('Gesamtprojekte', () => {
  test('Liste zeigt Summen und öffnet die Ansicht mit Kopf-Kennzahlen', async ({ page }, info) => {
    const mobile = info.project.name === 'mobile'
    await mockGroups(page)
    await page.goto('/projekte?tab=gesamtprojekte')
    await hideDevtools(page)
    const entry = mobile
      ? page.getByRole('button', { name: /Kita Sonnenblume/ })
      : page.getByRole('row', { name: /Kita Sonnenblume/ })
    await expect(entry).toContainText('2')
    await expect(entry).toContainText('500.000')
    expect(await noHorizontalScroll(page)).toBe(true)

    await (mobile ? entry : entry.getByRole('button', { name: GROUP.ABBR })).click()
    await expect(page).toHaveURL(/groupId=5&tab=uebersicht/)
    await expect(page.locator('h1')).toContainText('Kita Sonnenblume')
    const kpis = page.locator('.pw-kpis').first()
    await expect(kpis).toContainText('500.000')
    await expect(kpis).toContainText('58 %')
    // Zwei Projekte und eine Summe, kein Scope-Hinweis
    await expect(member(page, mobile, 'P-2024-001')).toBeVisible()
    await expect(member(page, mobile, 'P-2024-002')).toBeVisible()
    await expect(page.locator(mobile ? '.km-total' : '.sum-row')).toContainText('500.000')
    await expect(page.locator('.pg-scope-note')).toHaveCount(0)
    expect(await noHorizontalScroll(page)).toBe(true)
  })

  test('Summen außerhalb des Reporting-Bereichs: Hinweis „1 von 2"', async ({ page }, info) => {
    const mobile = info.project.name === 'mobile'
    await mockGroups(page, { partial: true })
    await page.goto('/projekte?groupId=5')
    await expect(page).toHaveURL(/groupId=5&tab=uebersicht/)
    await expect(page.locator('.pg-scope-note')).toContainText('1 von 2 Projekten')
    // Projekt 2 steht da, aber ohne Beträge
    await expect(member(page, mobile, 'P-2024-002')).toContainText(mobile ? 'außerhalb deines Reporting-Bereichs' : '—')
  })

  test('Leere Liste erklärt, wofür Gesamtprojekte da sind', async ({ page }) => {
    await mockGroups(page, { empty: true })
    await page.goto('/projekte?tab=gesamtprojekte')
    await expect(page.getByText('Noch keine Gesamtprojekte.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Erstes Gesamtprojekt anlegen/ })).toBeVisible()
  })

  test('Projektkopf: „Teil von" führt ins Gesamtprojekt', async ({ page }) => {
    await mockGroups(page)
    await page.goto('/projekte?projectId=1&tab=struktur')
    const link = page.getByRole('button', { name: GROUP.NAME })
    await expect(link).toBeVisible()
    await expect(page.locator('.pw-header')).toContainText('2 Projekte')
    await link.click()
    await expect(page).toHaveURL(/groupId=5&tab=uebersicht/)
  })

  test('Projektdaten: Zuordnung lösen wird gespeichert, Neuanlage ist vorbelegt', async ({ page }) => {
    const calls = await mockGroups(page)
    await page.goto('/projekte?projectId=1&tab=daten')
    const select = page.getByLabel('Teil von')
    await expect(select).toHaveValue('5')

    // Neues Gesamtprojekt: Dialog übernimmt Name und Nummer des Projekts
    await select.selectOption({ label: '+ Neues Gesamtprojekt anlegen …' })
    const dialog = page.getByRole('dialog', { name: 'Neues Gesamtprojekt' })
    await expect(dialog.getByLabel('Name*')).toHaveValue('Neubau Kindertagesstätte Sonnenblume, Bauabschnitt 1')
    await expect(dialog.getByLabel('Kürzel')).toHaveValue('P-2024-001')
    // Unverändert vorbelegt ist keine Eingabe — Abbrechen schließt ohne Rückfrage.
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(select).toHaveValue('5')

    await select.selectOption('')
    await page.keyboard.press('Control+s')
    await expect.poll(() => calls.patches.length).toBe(1)
    expect(calls.patches[0]).toMatchObject({ project_group_id: null })
  })

  test('Daten-Reiter: Änderung speichern, Löschen fragt nach', async ({ page }) => {
    const calls = await mockGroups(page)
    await page.goto('/projekte?groupId=5&tab=daten')
    await expect(page.getByRole('textbox', { name: 'Notizen' })).toHaveValue(GROUP.NOTES)
    await page.getByLabel('Name*').fill('Kita Sonnenblume')
    await page.getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => calls.patches.length).toBe(1)
    expect(calls.patches[0]).toMatchObject({ name: 'Kita Sonnenblume' })

    await page.getByRole('button', { name: 'Weitere Aktionen zum Gesamtprojekt' }).click()
    await page.getByRole('menuitem', { name: 'Gesamtprojekt löschen' }).click()
    const confirm = page.getByRole('dialog', { name: 'Gesamtprojekt löschen?' })
    await expect(confirm).toContainText('Die 2 Projekte bleiben erhalten')
    await confirm.getByRole('button', { name: 'Löschen' }).click()
    await expect.poll(() => calls.deletes).toBe(1)
    await expect(page).toHaveURL(/tab=gesamtprojekte/)
  })

  test('Projekte zuordnen schickt genau die angekreuzte Liste', async ({ page }) => {
    const calls = await mockGroups(page)
    await page.goto('/projekte?groupId=5&tab=uebersicht')
    await page.getByRole('button', { name: 'Projekte zuordnen' }).click()
    const dialog = page.getByRole('dialog', { name: /Projekte in/ })
    await dialog.getByRole('checkbox', { name: /P-2024-003/ }).check()
    await dialog.getByRole('button', { name: 'Zuordnung speichern' }).click()
    await expect.poll(() => calls.puts.length).toBe(1)
    expect((calls.puts[0] as { project_ids: number[] }).project_ids.sort()).toEqual([1, 2, 3])
  })

  test('Report „Alle Projekte": Zwischensumme je Gesamtprojekt', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tabelle mit allen Spalten ist Desktop')
    await mockGroups(page)
    await page.addInitScript(() => localStorage.removeItem('plain:filt:proj-list:groupBy'))
    await page.goto('/daten')
    await page.getByLabel('Nach Gesamtprojekt zusammenfassen').check()
    const head = page.locator('.pg-group-row').first()
    await expect(head).toContainText('Kita Sonnenblume')
    await expect(head).toContainText('500.000')
    // Quote aus Summen: 290.000 / 500.000 = 58 %, nicht der Mittelwert (70 %)
    await expect(head).toContainText('58,00 %')
    await expect(page.locator('.pg-group-row').nth(1)).toContainText('Ohne Gesamtprojekt')
  })
})

test.describe('Gesamtprojekte — Stufe 2', () => {
  test('Beauftragen: gleich ins Gesamtprojekt, Nummer abgeleitet', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Kopf-Aktion am Desktop')
    const calls = await mockGroups(page)
    await page.goto('/angebote?offerId=1&tab=struktur')
    await page.getByRole('button', { name: /Beauftragt/ }).click()
    const dialog = page.getByRole('dialog', { name: /Beauftragt/ })
    await dialog.getByLabel('Projektstatus*').selectOption({ label: 'Laufend' })
    await dialog.getByLabel(/^Gesamtprojekt/).selectOption('5')
    const derived = dialog.getByRole('radio', { name: /Abgeleitet: GP-2024-01-03/ })
    await expect(derived).toBeEnabled()
    await derived.check()
    await dialog.getByRole('button', { name: 'Projekt anlegen' }).last().click()
    await expect.poll(() => calls.converts.length).toBe(1)
    expect(calls.converts[0]).toMatchObject({ project_group_id: 5, project_abbr: 'GP-2024-01-03' })
  })

  test('Beauftragen ohne Gesamtprojekt schickt keine Gruppenfelder', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Kopf-Aktion am Desktop')
    const calls = await mockGroups(page)
    await page.goto('/angebote?offerId=1&tab=struktur')
    await page.getByRole('button', { name: /Beauftragt/ }).click()
    const dialog = page.getByRole('dialog', { name: /Beauftragt/ })
    await dialog.getByLabel('Projektstatus*').selectOption({ label: 'Laufend' })
    await expect(dialog.getByRole('radio', { name: /Abgeleitet/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Projekt anlegen' }).last().click()
    await expect.poll(() => calls.converts.length).toBe(1)
    expect(calls.converts[0]).not.toHaveProperty('project_group_id')
    expect(calls.converts[0]).not.toHaveProperty('project_abbr')
  })

  test('Neues Projekt aus dem Gesamtprojekt: vorgewählt, Auftraggeber übernommen', async ({ page }) => {
    await mockGroups(page)
    await page.goto('/projekte?groupId=5&tab=uebersicht')
    await page.getByRole('button', { name: 'Neues Projekt' }).click()
    const dialog = page.getByRole('dialog', { name: /Neues Projekt in/ })
    await expect(dialog.getByLabel(/^Gesamtprojekt/)).toHaveValue('5')
    await expect(dialog.getByLabel('Rechnungsadresse*')).toHaveValue('Stadt Ravensburg')
  })

  test('Folgeprojekt: Kopie mit abgeleiteter Nummer, danach im neuen Projekt', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Zeilenaktion am Desktop')
    const calls = await mockGroups(page)
    await page.goto('/projekte?groupId=5&tab=uebersicht')
    await page.getByRole('button', { name: 'Folgeprojekt aus P-2024-001 anlegen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Folgeprojekt anlegen' })
    await expect(dialog.getByRole('radio', { name: /Abgeleitet: GP-2024-01-03/ })).toBeChecked()
    await dialog.getByRole('button', { name: 'Folgeprojekt anlegen', exact: true }).click()
    await expect.poll(() => calls.copies.length).toBe(1)
    expect(calls.copies[0]).toEqual({ project_abbr: 'GP-2024-01-03' })
    await expect(page).toHaveURL(/projectId=9/)
  })

  test('Reiter Leistungsphasen: Matrix über die Projekte des Gesamtprojekts', async ({ page }) => {
    const calls = await mockGroups(page)
    await page.goto('/projekte?groupId=5&tab=leistungsphasen')
    await expect(page.getByRole('heading', { name: 'Leistungsphasen im Gesamtprojekt' })).toBeVisible()
    expect(calls.matrixUrls.some(u => u.includes('group_id=5'))).toBe(true)
    await expect(page.getByRole('row', { name: /^LPH 5/ })).toContainText('80.000')
    expect(await noHorizontalScroll(page)).toBe(true)
  })

  test('Rechnungen: Filter „Gesamtprojekt"', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Chips liegen am Handy hinter „Filter"')
    await mockGroups(page)
    await page.goto('/rechnungen')
    await expect(page.getByRole('button', { name: /^Gesamtprojekt/ })).toBeVisible()
  })

  test('Projektwahl (Strg+K) zeigt das Gesamtprojekt', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Umschalter als Aufklapper am Desktop')
    await mockGroups(page)
    await page.goto('/projekte?projectId=3&tab=struktur')
    await page.getByRole('button', { name: /Projekt wechseln/ }).click()
    const option = page.getByRole('option', { name: /P-2024-002/ }).last()
    await expect(option).toContainText(GROUP.NAME)
  })
})

test.describe('Gesamtprojekte — Stufe 3: Nachtrag als eigenes Projekt', () => {
  const RELEASED = { release_no: 2, amount_net: 4_920, approved_total_net: 17_720, status_code: 'PARTIALLY_COMMISSIONED',
    group_structure_id: null, target_project: { ID: 9, ABBR: 'GP-2024-01-03', NAME: 'Fassadenvariante' }, group_created: false }

  test('Freigabe als eigenes Projekt: Ziel, Vorbelegungen und Nutzlast', async ({ page }) => {
    await mockGroups(page)
    const posts: Record<string, unknown>[] = []
    await page.route(/\/api\/v1\/nachtraege\/402\/release(\?|$)/, r => {
      posts.push(r.request().postDataJSON())
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: RELEASED }) })
    })
    await page.goto('/nachtraege/402')
    await page.getByRole('button', { name: 'Freigeben' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nachtrag freigeben' })
    await dialog.getByRole('radio', { name: /Als eigenes Projekt im Gesamtprojekt „Kita Sonnenblume/ }).check()
    await expect(dialog.getByLabel('Projektname*')).not.toHaveValue('')
    await dialog.getByLabel('Status*').selectOption({ index: 1 })
    await expect(dialog.getByRole('radio', { name: /Abgeleitet: GP-2024-01-03/ })).toBeChecked()
    await dialog.getByRole('button', { name: 'Freigeben und Projekt anlegen' }).click()
    await expect(dialog).toBeHidden()
    expect(posts[0]).toMatchObject({
      target: { kind: 'new_project', project_manager_id: 1, address_id: 1, contact_id: 2, abbr_mode: 'derived' },
    })
    await expect(page.getByText('in das Projekt GP-2024-01-03 übernommen')).toBeVisible()
    await expect(page.getByRole('link', { name: /Zum Projekt GP-2024-01-03/ })).toBeVisible()
  })

  test('ohne Recht „Projekte anlegen" bleibt das eigene Projekt gesperrt, mit Grund', async ({ page }) => {
    await mockGroups(page, { permissions: ['projects.view', 'projects.edit', 'nachtraege.view', 'nachtraege.edit', 'nachtraege.release'] })
    await page.goto('/nachtraege/402')
    await page.getByRole('button', { name: 'Freigeben' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nachtrag freigeben' })
    await expect(dialog.getByRole('radio', { name: /Als eigenes Projekt/ })).toBeDisabled()
    await expect(dialog).toContainText('Dafür fehlt das Recht, Projekte anzulegen.')
    await expect(dialog.getByRole('radio', { name: /Ins Projekt P-2024-001/ })).toBeChecked()
  })

  test('frühere Freigabe in ein eigenes Projekt: Ziel in der Tabelle und als Wahl für die nächste', async ({ page }) => {
    await mockGroups(page)
    await page.route(/\/api\/v1\/nachtraege\/402\/releases(\?|$)/, r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [{ ID: 1, NACHTRAG_ID: 402, RELEASE_NO: 1, RELEASE_KIND: 'PARTIAL', RELEASE_BASIS: 'WRITTEN',
        AMOUNT_NET: 12_800, RELEASED_BY: 1, RELEASED_AT: '2026-09-10T11:00:00Z', NOTE: null,
        TARGET_PROJECT_ID: 9, TARGET_PROJECT_ABBR: 'GP-2024-01-02', TARGET_PROJECT_NAME: 'Fassade, eigener Vertrag' }] }),
    }))
    const posts: Record<string, unknown>[] = []
    await page.route(/\/api\/v1\/nachtraege\/402\/release(\?|$)/, r => {
      posts.push(r.request().postDataJSON())
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...RELEASED, target_project: { ID: 9, ABBR: 'GP-2024-01-02' } } }) })
    })
    await page.goto('/nachtraege/402')
    await expect(page.getByRole('link', { name: 'GP-2024-01-02' })).toBeVisible()
    await page.getByRole('button', { name: 'Freigeben' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nachtrag freigeben' })
    await dialog.getByRole('radio', { name: /In GP-2024-01-02 · Fassade, eigener Vertrag — angelegt mit Freigabe 1/ }).check()
    await dialog.getByRole('button', { name: 'Freigeben und ins Projekt übernehmen' }).click()
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0]).toMatchObject({ target: { kind: 'release_project', project_id: 9 } })
  })
})

test.describe('Gesamtprojekte — Stufe 3: Bauvorhaben auf Belegen', () => {
  test('Dokumentvorlage: Zeile abschaltbar, Vorschau und Speichern tragen den Schalter', async ({ page }) => {
    await mockGroups(page)
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    // Gespeicherte Vorlage von vor dieser Einstellung: der Schlüssel fehlt — gilt als an
    const saved = {
      version: 2, brand: { primaryColor: '#111827', accentColor: '#111827', fontFamily: 'system-sans', fontScale: 1 },
      header: { showLogo: true, logoMaxHeightMm: 20, logoPosition: 'right' }, blocks: {},
    }
    const previews: Record<string, unknown>[] = []
    const puts: Record<string, unknown>[] = []
    await page.route(/\/api\/v1\/document-templates\/branding(\?|$)/, r => {
      if (r.request().method() === 'PUT') { puts.push(r.request().postDataJSON()); return r.fulfill(json({ data: { ok: true } })) }
      return r.fulfill(json({ data: { theme: saved, blocksByCategory: {}, companyId: 1 } }))
    })
    await page.route(/\/api\/v1\/document-templates\/preview\/pdf(\?|$)/, r => {
      previews.push(r.request().postDataJSON())
      return r.fulfill(pdfResponse())
    })
    await page.route(/\/api\/v1\/mahnungen\/text-templates(\?|$)/, r => r.fulfill(json({ data: [] })))

    await page.route(/\/api\/v1\/document-templates\/catalog(\?|$)/, r => r.fulfill(json({ data: CATALOG })))
    await page.route(/\/api\/v1\/document-texts(\?|$)/, r => r.fulfill(json({ data: [] })))

    await page.goto('/admin?tab=dokumentvorlagen')
    const toggle = page.getByRole('checkbox', { name: /Zeile „Bauvorhaben: …“ auf Belegen/ })
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await expect.poll(() => previews.some(p => (p.theme_json as { header: { showBauvorhaben?: boolean } }).header.showBauvorhaben === false)).toBe(true)
    await page.getByRole('region', { name: 'Seitenaktionen' }).getByRole('button', { name: 'Speichern' }).click()
    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0]).toMatchObject({ theme_json: { header: { showBauvorhaben: false, logoPosition: 'right' } } })

    // Platzhalter in Kopf-/Fußtexten: bei Rechnungen ja, beim Angebot nicht (kein Gesamtprojekt)
    const bereich = page.getByLabel('Bereich', { exact: true })
    if (await bereich.isVisible()) await bereich.selectOption({ label: 'Texte' })
    else await page.getByRole('button', { name: 'Texte', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Bauvorhaben', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Angebot', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Bauvorhaben', exact: true })).toHaveCount(0)
  })
})
