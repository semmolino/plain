import { test, expect, type Page } from '@playwright/test'
import { mockDemo, hideDevtools } from './fixtures/demoData'

/**
 * Report „Teilfertige Leistungen" (docs/TEILFERTIGE_LEISTUNGEN_CONCEPT.md).
 *
 * Festgehalten wird hier vor allem die fachliche Zusage, die man beim
 * Umbauen am leichtesten kaputt macht: Aktivposten und erhaltene Anzahlungen
 * stehen getrennt und werden NICHT gegeneinander verrechnet (§ 246 Abs. 2
 * HGB). Ein „aufgeraeumter" Saldo waere hier ein Bilanzfehler.
 */

const WIP = {
  data: {
    asOf: '2026-08-31',
    compareTo: '2026-07-31',
    method: 'hk' as const,
    costFactorPercent: 100,
    taxCostFactorPercent: 90,
    targetCostRatioPercent: 60,
    progressGapThreshold: 15,
    historic: true,
    rows: [
      {
        PROJECT_ID: 1, NAME_SHORT: 'P-001', NAME_LONG: 'Wohnhaus Seestrasse',
        PROJECT_STATUS_ID: 2, PROJECT_STATUS_NAME_SHORT: 'Laufend',
        PROJECT_TYPE_ID: 1, PROJECT_TYPE_NAME_SHORT: 'Neubau',
        PROJECT_MANAGER_ID: 1, PROJECT_MANAGER_DISPLAY: 'M. Messina',
        DEPARTMENT_NAME: 'Hochbau', ADDRESS_NAME: 'Bauherr GmbH',
        ORDER_VALUE_NET: 100000, PERFORMANCE_NET: 60000, PERFORMANCE_PERCENT: 60,
        BILLED_NET: 40000, COST_NET: 30000, HOURS_TOTAL: 240, PAYED_NET_TOTAL: 40000,
        BILLED_RATIO: 66.67, UNBILLED_NET: 20000, COST_UNBILLED_NET: 10000,
        WIP_HK_NET: 10000, WIP_REVENUE_NET: 20000,
        PREPAYMENT_NET: 0, LOSS_RISK_NET: 0, UNREALIZED_GAIN_NET: 10000,
        COST_UNBILLED_TAX_NET: 9000, WIP_TAX_NET: 9000,
        PROGRESS_CALC_PERCENT: 50, PROGRESS_GAP_POINTS: -10,
        SNAPSHOT_DATE: '2026-08-31', flags: [] as string[],
        COMPARE_WIP_NET: 4800, CHANGE_WIP_NET: 5200,
      },
      {
        PROJECT_ID: 2, NAME_SHORT: 'P-002', NAME_LONG: 'Schulsanierung Nord',
        PROJECT_STATUS_ID: 2, PROJECT_STATUS_NAME_SHORT: 'Laufend',
        PROJECT_TYPE_ID: 2, PROJECT_TYPE_NAME_SHORT: 'Sanierung',
        PROJECT_MANAGER_ID: 2, PROJECT_MANAGER_DISPLAY: 'T. Kern',
        DEPARTMENT_NAME: 'Hochbau', ADDRESS_NAME: 'Stadt Nord',
        ORDER_VALUE_NET: 80000, PERFORMANCE_NET: 40000, PERFORMANCE_PERCENT: 50,
        BILLED_NET: 55000, COST_NET: 30000, HOURS_TOTAL: 180, PAYED_NET_TOTAL: 55000,
        BILLED_RATIO: 100, UNBILLED_NET: 0, COST_UNBILLED_NET: 0,
        WIP_HK_NET: 0, WIP_REVENUE_NET: 0,
        PREPAYMENT_NET: 15000, LOSS_RISK_NET: 0, UNREALIZED_GAIN_NET: 0,
        COST_UNBILLED_TAX_NET: 0, WIP_TAX_NET: 0,
        PROGRESS_CALC_PERCENT: 75, PROGRESS_GAP_POINTS: 25,
        SNAPSHOT_DATE: null, flags: ['prepayment', 'no_snapshot', 'progress_gap'],
        COMPARE_WIP_NET: 0, CHANGE_WIP_NET: 0,
      },
    ],
    totals: {
      projectCount: 2, orderValue: 180000, performance: 100000, billed: 95000,
      cost: 60000, unbilled: 20000, costUnbilled: 10000,
      wipHk: 10000, wipRevenue: 20000, prepayments: 15000, lossRisk: 0,
      unrealizedGain: 10000, wipTax: 9000,
      noSnapshotCount: 1, noPerformanceCount: 0, prepaymentCount: 1, lossRiskCount: 0,
      progressGapCount: 1,
    },
    compareTotals: null,
    stockChange: { wip: 5200, prepayments: 0 },
    dataQuality: {
      historic: true, noSnapshotCount: 1, noPerformanceCount: 0,
      prepaymentCount: 1, lossRiskCount: 0, progressGapCount: 1,
    },
  },
}

async function openTab(page: Page) {
  await mockDemo(page)
  await page.route(/\/api\/v1\/reports\/wip(\?|$)/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WIP) }))
  await page.goto('/daten')
  await hideDevtools(page)
  await page.getByRole('tab', { name: 'Teilfertige Leistungen' }).click()
  await expect(page.getByRole('cell', { name: /P-001/ })).toBeVisible()
}

test('Aktiva und erhaltene Anzahlungen stehen getrennt, nicht saldiert', async ({ page }) => {
  await openTab(page)

  const aktiva  = page.locator('.daten-kpi-tile', { hasText: 'Teilfertige Leistungen (Aktiva)' })
  const passiva = page.locator('.daten-kpi-tile', { hasText: 'Erhaltene Anzahlungen (Passiva)' })

  // 10.000 aktiv, 15.000 passiv — ein Saldo waere -5.000 und genau der Fehler,
  // den § 246 Abs. 2 HGB verbietet.
  await expect(aktiva.locator('.daten-kpi-value')).toHaveText(/10\.000,00/)
  await expect(passiva.locator('.daten-kpi-value')).toHaveText(/15\.000,00/)
})

test('Bestandsveraenderung wird gegen den Vergleichsstichtag gezeigt', async ({ page }) => {
  await openTab(page)
  const tile = page.locator('.daten-kpi-tile', { hasText: 'Bestandsveränderung' })
  await expect(tile.locator('.daten-kpi-value')).toHaveText(/5\.200,00/)
})

test('Methodenwechsel schaltet den ausgewiesenen Wert um', async ({ page }) => {
  await openTab(page)
  const aktiva = page.locator('.daten-kpi-tile', { hasText: 'Teilfertige Leistungen (Aktiva)' })
  await expect(aktiva.locator('.daten-kpi-value')).toHaveText(/10\.000,00/)

  // Der Leistungswert enthaelt die Marge und ist deshalb hoeher.
  await page.locator('.daten-filter-mode-btn', { hasText: 'Leistungswert' }).click()
  await expect(aktiva.locator('.daten-kpi-value')).toHaveText(/20\.000,00/)
})

test('ein Projekt ohne Snapshot wird als solches markiert', async ({ page }) => {
  await openTab(page)
  await expect(page.locator('.tfl-flag', { hasText: 'kein Leistungsstand-Snapshot zum Stichtag' })).toBeVisible()
  await expect(page.locator('.message.info')).toContainText('kein Leistungsstand-Snapshot')
})

test('kein waagerechter Seitenlauf trotz breiter Tabelle', async ({ page }) => {
  await openTab(page)
  const overflow = await page.evaluate(() =>
    document.body.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(2)
})

test('der Steuerbilanz-Wert steht neben dem Handelswert, nicht statt dessen', async ({ page }) => {
  await openTab(page)
  const handel = page.locator('.daten-kpi-tile', { hasText: 'Teilfertige Leistungen (Aktiva)' })
  const steuer = page.locator('.daten-kpi-tile', { hasText: 'Teilfertig (Steuerbilanz)' })
  await expect(handel.locator('.daten-kpi-value')).toHaveText(/10\.000,00/)
  await expect(steuer.locator('.daten-kpi-value')).toHaveText(/9\.000,00/)
})

test('die Gegenprobe markiert das Projekt, dessen Kosten nicht zum Stand passen', async ({ page }) => {
  await openTab(page)
  await expect(page.locator('.tfl-flag', { hasText: 'Leistungsstand passt nicht zum Kostenverbrauch' })).toBeVisible()

  const tile = page.locator('.daten-kpi-tile', { hasText: 'Leistungsstand prüfen' })
  await expect(tile.locator('.daten-kpi-value')).toHaveText('1')
})

test('ohne gepflegte Zielkostenquote gibt es die Gegenprobe-Spalten nicht', async ({ page }) => {
  await mockDemo(page)
  const ohne = JSON.parse(JSON.stringify(WIP))
  ohne.data.targetCostRatioPercent = null
  ohne.data.taxCostFactorPercent   = null
  ohne.data.totals.wipTax          = null
  await page.route(/\/api\/v1\/reports\/wip(\?|$)/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ohne) }))
  await page.goto('/daten')
  await hideDevtools(page)
  await page.getByRole('tab', { name: 'Teilfertige Leistungen' }).click()
  await expect(page.getByRole('cell', { name: /P-001/ })).toBeVisible()

  // Eine leere Spalte erklaert sich nicht von selbst — sie bleibt ganz weg.
  await expect(page.getByRole('columnheader', { name: /Leistungsstand rechn/ })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: /Steuerbilanz/ })).toHaveCount(0)
  await expect(page.locator('.daten-kpi-tile', { hasText: 'Leistungsstand prüfen' })).toHaveCount(0)
})
