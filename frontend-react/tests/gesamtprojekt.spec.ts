import { test, expect, type Page } from '@playwright/test'
import { hideDevtools } from './fixtures/demoData'
import { GROUP, mockGroups } from './fixtures/gesamtprojektData'

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
