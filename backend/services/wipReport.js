"use strict";

/**
 * Report „Teilfertige Leistungen" (unfertige Leistungen, nicht abgerechnete
 * Leistungen) — der kaufmännische Abschluss-Report.
 *
 * Konzept, Rechtsgrundlagen und Herleitung: docs/TEILFERTIGE_LEISTUNGEN_CONCEPT.md
 *
 * KURZ:
 *   Zum Stichtag T gilt je Projekt (alles netto)
 *     B  Auftragswert        L  Leistungswert      R  abgerechnet    K  Kosten
 *   und daraus
 *     q   = min(1, R/L)                      Abrechnungsgrad
 *     U   = max(0, L − R)                    unfertig, zu Auftragspreisen
 *     A   = max(0, R − L)                    erhaltene Anzahlung  → Passivseite
 *     K_u = K × (1 − q) × f                  Kosten der unfertigen Leistung
 *     TFL(HK)     = min(K_u, U)              HGB-Ansatz, verlustfrei bewertet
 *     TFL(Erlös)  = U                        Controlling-Ansatz
 *     D   = max(0, K_u − U)                  Drohverlust-Hinweis
 *     G   = U − TFL(HK)                      nicht realisierter Gewinn
 *
 * ZWEI DINGE, DIE HIER BEWUSST NICHT PASSIEREN:
 *   1. Es wird NICHT saldiert. Aktivüberhänge (TFL) und Passivüberhänge
 *      (erhaltene Anzahlungen) werden je Projekt getrennt ermittelt und
 *      getrennt summiert — § 246 Abs. 2 HGB verbietet die Verrechnung.
 *   2. Der HGB-Wert enthält keine Marge. Wer die betriebswirtschaftliche Sicht
 *      will, nimmt TFL(Erlös); wer die Bilanzzahl will, TFL(HK).
 */

const { loadParentSurchargesByProject } = require("./reportSurcharges");

const METHODS = ["hk", "erloes"];

const SETTING_COST_FACTOR     = "wip_cost_factor_percent";
const SETTING_METHOD          = "wip_method_default";
const SETTING_TAX_COST_FACTOR = "wip_tax_cost_factor_percent";
const SETTING_TARGET_RATIO    = "wip_target_cost_ratio_percent";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

// ── Rechenkern (rein, ohne Datenbank — so ist er testbar) ────────────────────

/**
 * Marker je Zeile. Sie sind der Grund, warum der Report benutzbar ist: eine 0
 * kann „nichts geleistet" oder „nie erfasst" heißen, und das ist ein
 * Unterschied von der Art, der einen Jahresabschluss falsch macht.
 */
const FLAG_NO_PERFORMANCE = "no_performance"; // Kosten gebucht, kein Leistungsstand
const FLAG_PREPAYMENT     = "prepayment";     // mehr abgerechnet als geleistet
const FLAG_LOSS_RISK      = "loss_risk";      // Kosten übersteigen den erzielbaren Erlös
const FLAG_NO_SNAPSHOT    = "no_snapshot";    // kein Leistungsstand-Snapshot ≤ Stichtag
const FLAG_PROGRESS_GAP   = "progress_gap";   // gepflegter und rechnerischer Leistungsstand klaffen

/**
 * Ab wie vielen Prozentpunkten Abstand zwischen gepflegtem und rechnerischem
 * Leistungsstand die Zeile markiert wird. Bewusst eine Konstante und keine
 * Einstellung: der Wert entscheidet nichts, er lenkt nur den Blick, und ein
 * weiterer Regler kostet mehr Erklärung als er einbringt.
 */
const PROGRESS_GAP_THRESHOLD_POINTS = 15;

/**
 * Ermittelt aus den Basisgrößen eines Projekts die Abschlusswerte.
 *
 * @param {object}  input
 * @param {number}  input.orderValue         B — Auftragswert
 * @param {number}  input.performance        L — Leistungswert
 * @param {number}  input.billed             R — kumuliert abgerechnet
 * @param {number}  input.cost               K — angefallene Kosten
 * @param {number} [input.costFactorPercent]    f — Bewertungsfaktor in Prozent (Default 100)
 * @param {number} [input.taxCostFactorPercent] Bewertungsfaktor der Steuerbilanz;
 *                 fehlt er, entfällt der zweite Wertansatz
 * @param {number} [input.performancePercent]   gepflegter Leistungsstand in Prozent
 * @param {number} [input.targetCostRatioPercent] Zielkostenquote für die Gegenprobe;
 *                 fehlt sie, entfällt der rechnerische Leistungsstand
 * @returns {object} Zeile mit allen Ergebnisgrößen und `flags`
 */
function computeWipRow(input) {
  const B = num(input.orderValue);
  const L = num(input.performance);
  const R = num(input.billed);
  const K = num(input.cost);
  const factor = input.costFactorPercent == null ? 1 : num(input.costFactorPercent) / 100;

  // Abrechnungsgrad, auf 0..1 begrenzt. Beide Enden sind echte Faelle:
  //   R > L   mehr abgerechnet als geleistet -> nichts mehr unfertig (q = 1)
  //   R < 0   Stornos ueberwiegen die Abrechnungen -> nichts wirksam
  //           abgerechnet (q = 0). Ohne die untere Grenze waere (1 - q) > 1 und
  //           der Kostenanteil stiege ueber die gebuchten Kosten hinaus.
  const billedRatio = L > 0 ? Math.min(1, Math.max(0, R / L)) : (R > 0 ? 1 : 0);

  const unbilled     = Math.max(0, L - R);
  const prepayment   = Math.max(0, R - L);
  const costUnbilled = K * (1 - billedRatio) * factor;

  // Verlustfreie Bewertung (§ 253 Abs. 4 HGB): der Vorratsposten darf den noch
  // erzielbaren Erlös nicht übersteigen.
  const wipHk       = Math.min(costUnbilled, unbilled);
  const wipRevenue  = unbilled;
  const lossRisk    = Math.max(0, costUnbilled - unbilled);
  const unrealized  = unbilled - wipHk;

  // ── Zweiter Wertansatz für die Steuerbilanz ────────────────────────────────
  // Nur der Kostenfaktor unterscheidet sich; die verlustfreie Bewertung gilt
  // auch steuerlich (Teilwert, § 6 Abs. 1 Nr. 2 EStG). Was steuerlich fehlt,
  // ist die Rückstellung für den Überhang (§ 5 Abs. 4a EStG) — die bildet
  // dieser Report ohnehin nicht, er weist den Prüfbedarf nur aus.
  const hasTaxFactor = input.taxCostFactorPercent != null && input.taxCostFactorPercent !== "";
  const taxFactor    = hasTaxFactor ? num(input.taxCostFactorPercent) / 100 : null;
  const costUnbilledTax = taxFactor == null ? null : K * (1 - billedRatio) * taxFactor;
  const wipTax          = costUnbilledTax == null ? null : Math.min(costUnbilledTax, unbilled);

  // ── Gegenprobe: rechnerischer Leistungsstand ───────────────────────────────
  // Ohne Kostenplan im Datenmodell ist die erwartete Gesamtkostengröße eine
  // Annahme: Auftragswert × Zielkostenquote. Das ist keine zweite
  // Bewertungsgrundlage, sondern eine Plausibilitätsprüfung — sie zeigt, ob
  // der gepflegte Leistungsstand zum Kostenverbrauch passt.
  const hasTarget   = input.targetCostRatioPercent != null && input.targetCostRatioPercent !== "";
  const targetRatio = hasTarget ? num(input.targetCostRatioPercent) / 100 : null;
  const expectedCost = targetRatio != null && targetRatio > 0 ? B * targetRatio : null;
  const progressCalc = expectedCost && expectedCost > 0 ? (100 * K) / expectedCost : null;

  const performancePercent = input.performancePercent == null ? null : num(input.performancePercent);
  // Positiv = mehr Kosten verbraucht, als Leistung gemeldet ist.
  const progressGap = progressCalc != null && performancePercent != null
    ? progressCalc - performancePercent
    : null;

  const flags = [];
  if (L === 0 && K > 0)  flags.push(FLAG_NO_PERFORMANCE);
  if (prepayment > 0)    flags.push(FLAG_PREPAYMENT);
  if (lossRisk   > 0)    flags.push(FLAG_LOSS_RISK);
  if (progressGap != null && Math.abs(progressGap) >= PROGRESS_GAP_THRESHOLD_POINTS) {
    flags.push(FLAG_PROGRESS_GAP);
  }

  return {
    ORDER_VALUE_NET:     round2(B),
    PERFORMANCE_NET:     round2(L),
    BILLED_NET:          round2(R),
    COST_NET:            round2(K),
    BILLED_RATIO:        round2(billedRatio * 100),
    UNBILLED_NET:        round2(unbilled),
    COST_UNBILLED_NET:   round2(costUnbilled),
    WIP_HK_NET:          round2(wipHk),
    WIP_REVENUE_NET:     round2(wipRevenue),
    PREPAYMENT_NET:      round2(prepayment),
    LOSS_RISK_NET:       round2(lossRisk),
    UNREALIZED_GAIN_NET: round2(unrealized),
    COST_UNBILLED_TAX_NET: costUnbilledTax == null ? null : round2(costUnbilledTax),
    WIP_TAX_NET:           wipTax          == null ? null : round2(wipTax),
    PROGRESS_CALC_PERCENT: progressCalc    == null ? null : round2(progressCalc),
    PROGRESS_GAP_POINTS:   progressGap     == null ? null : round2(progressGap),
    flags,
  };
}

/**
 * Verdichtet die Zeilen. Aktiv- und Passivseite bleiben getrennt (s. Kopf).
 * @param {Array<object>} rows Zeilen aus computeWipRow (ggf. angereichert)
 */
function aggregateWip(rows) {
  const sum = (key) => round2((rows || []).reduce((acc, r) => acc + num(r[key]), 0));
  const countFlag = (flag) => (rows || []).filter(r => (r.flags || []).includes(flag)).length;

  return {
    projectCount:        (rows || []).length,
    orderValue:          sum("ORDER_VALUE_NET"),
    performance:         sum("PERFORMANCE_NET"),
    billed:              sum("BILLED_NET"),
    cost:                sum("COST_NET"),
    unbilled:            sum("UNBILLED_NET"),
    costUnbilled:        sum("COST_UNBILLED_NET"),
    wipHk:               sum("WIP_HK_NET"),
    wipRevenue:          sum("WIP_REVENUE_NET"),
    prepayments:         sum("PREPAYMENT_NET"),
    lossRisk:            sum("LOSS_RISK_NET"),
    unrealizedGain:      sum("UNREALIZED_GAIN_NET"),
    // Steuerbilanz nur summieren, wenn der zweite Faktor gepflegt ist —
    // sonst waere 0 eine Aussage, die niemand getroffen hat.
    wipTax:              (rows || []).some(r => r.WIP_TAX_NET != null) ? sum("WIP_TAX_NET") : null,
    noSnapshotCount:     countFlag(FLAG_NO_SNAPSHOT),
    noPerformanceCount:  countFlag(FLAG_NO_PERFORMANCE),
    prepaymentCount:     countFlag(FLAG_PREPAYMENT),
    lossRiskCount:       countFlag(FLAG_LOSS_RISK),
    progressGapCount:    countFlag(FLAG_PROGRESS_GAP),
  };
}

/** Der Wert, der bei der gewählten Methode als Bilanzansatz gilt. */
function wipTotalForMethod(totals, method) {
  return method === "erloes" ? num(totals?.wipRevenue) : num(totals?.wipHk);
}

/**
 * Bestandsveränderung zwischen zwei Stichtagen — der Wert, der in der GuV
 * gebucht wird (§ 275 Abs. 2 Nr. 2 HGB), nicht der Bestand selbst.
 */
function stockChange(totalsNow, totalsBefore, method) {
  if (!totalsBefore) return null;
  return {
    wip:         round2(wipTotalForMethod(totalsNow, method) - wipTotalForMethod(totalsBefore, method)),
    prepayments: round2(num(totalsNow?.prepayments) - num(totalsBefore?.prepayments)),
  };
}

// ── Datenbeschaffung ─────────────────────────────────────────────────────────

const SELECT_COLS = [
  "PROJECT_ID", "NAME_SHORT", "NAME_LONG",
  "PROJECT_STATUS_ID", "PROJECT_STATUS_NAME_SHORT",
  "PROJECT_TYPE_ID", "PROJECT_TYPE_NAME_SHORT",
  "PROJECT_MANAGER_ID", "PROJECT_MANAGER_DISPLAY",
  "DEPARTMENT_ID", "DEPARTMENT_NAME",
  "ADDRESS_NAME", "COMPANY_NAME",
  "BUDGET_TOTAL_NET", "LEISTUNGSSTAND_PERCENT", "LEISTUNGSSTAND_VALUE",
  "HOURS_TOTAL", "COST_TOTAL", "BILLED_NET_TOTAL", "PAYED_NET_TOTAL",
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Basisgrößen je Projekt zum Stichtag.
 *
 * Stichtag heute (oder in der Zukunft) liest die Live-View: PROJECT_STRUCTURE
 * trägt den aktuellen Leistungsstand, und der kann den letzten Snapshot
 * überholt haben (patchStructureCompletionPercents schreibt keinen Snapshot).
 * Ein Stichtag in der Vergangenheit geht über die stichtagsfähige RPC. Das ist
 * dasselbe Verhalten wie „Aktuell" ↔ „Stichtag" im übrigen Reporting.
 */
async function loadBaseRows(supabase, tenantId, asOf) {
  const historic = isIsoDate(asOf) && asOf < todayIso();

  if (historic) {
    const { data, error } = await supabase.rpc("fn_project_list_report", {
      p_tenant_id: parseInt(tenantId, 10),
      p_as_of:     `${asOf}T23:59:59`,
      p_date_from: null,
      p_date_to:   null,
    });
    if (error) throw { status: 500, message: error.message };
    return { rows: data || [], historic };
  }

  const { data, error } = await supabase
    .from("VW_REPORT_PROJECT_DETAIL")
    .select(SELECT_COLS.join(", "))
    .eq("TENANT_ID", tenantId)
    .order("NAME_SHORT", { ascending: true });
  if (error) throw { status: 500, message: error.message };
  return { rows: data || [], historic };
}

/** Map<projectId (String), ISO-Datum des letzten Leistungsstand-Snapshots ≤ T> */
async function loadSnapshotDates(supabase, tenantId, asOf) {
  const out = new Map();
  try {
    const { data, error } = await supabase.rpc("fn_wip_snapshot_dates", {
      p_tenant_id: parseInt(tenantId, 10),
      p_as_of:     `${asOf}T23:59:59`,
    });
    if (error) throw error;
    for (const r of data || []) {
      if (r.SNAPSHOT_AT) out.set(String(r.PROJECT_ID), String(r.SNAPSHOT_AT).slice(0, 10));
    }
  } catch (e) {
    // Migration 0137 noch nicht eingespielt: der Report bleibt benutzbar, nur
    // ohne Snapshot-Spalte. Lieber ein fehlender Hinweis als kein Report.
    console.warn("[wip] fn_wip_snapshot_dates nicht verfügbar:", e?.message || e);
  }
  return out;
}

async function readSetting(supabase, tenantId, key) {
  const { data } = await supabase
    .from("TENANT_SETTINGS")
    .select("VALUE")
    .eq("TENANT_ID", tenantId)
    .eq("KEY", key)
    .maybeSingle();
  return data?.VALUE ?? null;
}

/** Bewertungsfaktor in Prozent: Übergabe > Mandanteneinstellung > 100. */
async function resolveCostFactor(supabase, tenantId, override) {
  if (override != null && override !== "") {
    const n = Number(override);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw { status: 400, message: "Bewertungsfaktor muss zwischen 0 und 100 liegen." };
    }
    return n;
  }
  const raw = await readSetting(supabase, tenantId, SETTING_COST_FACTOR);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 100;
}

/**
 * Optionale Prozent-Einstellung. Anders als der Bewertungsfaktor hat sie
 * keinen Standardwert: fehlt sie, bleibt die zugehoerige Spalte leer. Ein
 * geratener Wert waere hier schlimmer als gar keiner — er saehe aus wie eine
 * Angabe des Mandanten.
 */
async function resolveOptionalPercent(supabase, tenantId, key, override, { max = 100 } = {}) {
  const raw = override != null && override !== ""
    ? override
    : await readSetting(supabase, tenantId, key);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

async function resolveDefaultMethod(supabase, tenantId, override) {
  if (METHODS.includes(override)) return override;
  const raw = await readSetting(supabase, tenantId, SETTING_METHOD);
  return METHODS.includes(raw) ? raw : "hk";
}

/**
 * Eine Stichtagsauswertung: Zeilen + Summen.
 * `withDetails=false` liefert nur die Summen (für den Vergleichsstichtag).
 *
 * @param {object} valuation { costFactorPercent, taxCostFactorPercent, targetCostRatioPercent }
 */
async function evaluateAsOf(supabase, tenantId, asOf, valuation, withDetails) {
  const { rows: baseRows, historic } = await loadBaseRows(supabase, tenantId, asOf);

  const projectIds = baseRows.map(r => r.PROJECT_ID).filter(Boolean);
  const surcharges = await loadParentSurchargesByProject(supabase, tenantId, projectIds);
  const snapshots  = withDetails || historic
    ? await loadSnapshotDates(supabase, tenantId, asOf)
    : new Map();

  const rows = [];
  for (const r of baseRows) {
    const pid = String(r.PROJECT_ID);
    const orderValue = num(r.BUDGET_TOTAL_NET) + (surcharges.get(pid) || 0);
    const performance = num(r.LEISTUNGSSTAND_VALUE);
    const billed = num(r.BILLED_NET_TOTAL);
    const cost = num(r.COST_TOTAL);

    // Projekte ohne jede Bewegung zum Stichtag tragen zum Abschluss nichts bei
    // und würden die Liste zumüllen (Vorlagen, Altbestand, noch nicht gestartet).
    if (!orderValue && !performance && !billed && !cost) continue;

    const computed = computeWipRow({
      orderValue, performance, billed, cost,
      performancePercent: r.LEISTUNGSSTAND_PERCENT,
      costFactorPercent:      valuation.costFactorPercent,
      taxCostFactorPercent:   valuation.taxCostFactorPercent,
      targetCostRatioPercent: valuation.targetCostRatioPercent,
    });
    const snapshotDate = snapshots.get(pid) || null;
    const flags = [...computed.flags];
    if (historic && !snapshotDate) flags.push(FLAG_NO_SNAPSHOT);

    rows.push({
      PROJECT_ID:                r.PROJECT_ID,
      NAME_SHORT:                r.NAME_SHORT ?? null,
      NAME_LONG:                 r.NAME_LONG ?? null,
      PROJECT_STATUS_ID:         r.PROJECT_STATUS_ID ?? null,
      PROJECT_STATUS_NAME_SHORT: r.PROJECT_STATUS_NAME_SHORT ?? null,
      PROJECT_TYPE_ID:           r.PROJECT_TYPE_ID ?? null,
      PROJECT_TYPE_NAME_SHORT:   r.PROJECT_TYPE_NAME_SHORT ?? null,
      PROJECT_MANAGER_ID:        r.PROJECT_MANAGER_ID ?? null,
      PROJECT_MANAGER_DISPLAY:   r.PROJECT_MANAGER_DISPLAY ?? null,
      DEPARTMENT_NAME:           r.DEPARTMENT_NAME ?? null,
      ADDRESS_NAME:              r.ADDRESS_NAME ?? r.COMPANY_NAME ?? null,
      PERFORMANCE_PERCENT:       r.LEISTUNGSSTAND_PERCENT == null ? null : round2(r.LEISTUNGSSTAND_PERCENT),
      HOURS_TOTAL:               round2(r.HOURS_TOTAL),
      PAYED_NET_TOTAL:           round2(r.PAYED_NET_TOTAL),
      SNAPSHOT_DATE:             snapshotDate,
      ...computed,
      flags,
    });
  }

  rows.sort((a, b) => String(a.NAME_SHORT || "").localeCompare(String(b.NAME_SHORT || ""), "de"));

  return { rows, totals: aggregateWip(rows), historic };
}

/**
 * Der vollständige Report.
 *
 * @param {object} opts
 * @param {string} [opts.asOf]              Stichtag (ISO), Default heute
 * @param {string} [opts.compareTo]         Vergleichsstichtag (ISO) für die Bestandsveränderung
 * @param {number} [opts.costFactorPercent] Bewertungsfaktor, sonst Mandanteneinstellung
 * @param {string} [opts.method]            'hk' | 'erloes', sonst Mandanteneinstellung
 * @param {number} [opts.taxCostFactorPercent]   zweiter Faktor für die Steuerbilanz (optional)
 * @param {number} [opts.targetCostRatioPercent] Zielkostenquote für die Gegenprobe (optional)
 */
async function buildWipReport(supabase, tenantId, opts = {}) {
  const asOf = isIsoDate(opts.asOf) ? opts.asOf : todayIso();
  const compareTo = isIsoDate(opts.compareTo) ? opts.compareTo : null;
  if (compareTo && compareTo >= asOf) {
    throw { status: 400, message: "Der Vergleichsstichtag muss vor dem Stichtag liegen." };
  }

  const costFactorPercent = await resolveCostFactor(supabase, tenantId, opts.costFactorPercent);
  const method = await resolveDefaultMethod(supabase, tenantId, opts.method);
  const taxCostFactorPercent = await resolveOptionalPercent(
    supabase, tenantId, SETTING_TAX_COST_FACTOR, opts.taxCostFactorPercent);
  // Die Zielkostenquote darf ueber 100 % liegen — ein Projekt, das mehr kosten
  // soll als es einbringt, ist eine Fehlkalkulation, aber keine Fehleingabe.
  const targetCostRatioPercent = await resolveOptionalPercent(
    supabase, tenantId, SETTING_TARGET_RATIO, opts.targetCostRatioPercent, { max: 500 });

  const valuation = { costFactorPercent, taxCostFactorPercent, targetCostRatioPercent };

  const current = await evaluateAsOf(supabase, tenantId, asOf, valuation, true);
  const previous = compareTo
    ? await evaluateAsOf(supabase, tenantId, compareTo, valuation, false)
    : null;

  // Vergleichswert je Projekt, damit die Tabelle die Veränderung zeigen kann.
  if (previous) {
    const prevByProject = new Map(previous.rows.map(r => [String(r.PROJECT_ID), r]));
    for (const row of current.rows) {
      const prev = prevByProject.get(String(row.PROJECT_ID));
      const key = method === "erloes" ? "WIP_REVENUE_NET" : "WIP_HK_NET";
      const before = prev ? num(prev[key]) : 0;
      row.COMPARE_WIP_NET = round2(before);
      row.CHANGE_WIP_NET  = round2(num(row[key]) - before);
    }
  }

  return {
    asOf,
    compareTo,
    method,
    costFactorPercent,
    taxCostFactorPercent,
    targetCostRatioPercent,
    progressGapThreshold: PROGRESS_GAP_THRESHOLD_POINTS,
    historic: current.historic,
    rows: current.rows,
    totals: current.totals,
    compareTotals: previous ? previous.totals : null,
    stockChange: stockChange(current.totals, previous?.totals, method),
    dataQuality: {
      historic:            current.historic,
      noSnapshotCount:     current.totals.noSnapshotCount,
      noPerformanceCount:  current.totals.noPerformanceCount,
      prepaymentCount:     current.totals.prepaymentCount,
      lossRiskCount:       current.totals.lossRiskCount,
      progressGapCount:    current.totals.progressGapCount,
    },
  };
}

// ── Festgeschriebene Abschlüsse ──────────────────────────────────────────────

/**
 * Wer den Abschluss gezogen hat, als Text. Der Name wird mitgeschrieben und
 * nicht nur die ID: ein spaeter geloeschter Mitarbeiter darf einen
 * festgeschriebenen Abschluss nicht anonymisieren.
 */
async function resolveEmployeeName(supabase, tenantId, employeeId) {
  if (!employeeId) return null;
  try {
    const { data } = await supabase
      .from("EMPLOYEE")
      .select("SHORT_NAME, FIRST_NAME, LAST_NAME")
      .eq("TENANT_ID", tenantId)
      .eq("ID", employeeId)
      .maybeSingle();
    if (!data) return null;
    const full = [data.FIRST_NAME, data.LAST_NAME].filter(Boolean).join(" ");
    return full || data.SHORT_NAME || null;
  } catch (_) {
    return null;
  }
}

/**
 * Schreibt den Report zum Stichtag fest. Ein bestehender Abschluss zum
 * gleichen Stichtag wird ersetzt — zwei Abschlüsse zum selben Tag wären zwei
 * Wahrheiten, und die Zeilen hängen per ON DELETE CASCADE am Kopf.
 */
async function saveClosing(supabase, tenantId, opts = {}) {
  const report = await buildWipReport(supabase, tenantId, opts);
  const createdByName = await resolveEmployeeName(supabase, tenantId, opts.employeeId);

  const { data: existing } = await supabase
    .from("WIP_CLOSING")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .eq("AS_OF_DATE", report.asOf);
  for (const row of existing || []) {
    await supabase.from("WIP_CLOSING").delete().eq("ID", row.ID).eq("TENANT_ID", tenantId);
  }

  const head = {
    TENANT_ID:               tenantId,
    AS_OF_DATE:              report.asOf,
    METHOD:                  report.method,
    COST_FACTOR_PERCENT:     report.costFactorPercent,
    TAX_COST_FACTOR_PERCENT: report.taxCostFactorPercent,
    COMPARE_TO_DATE:         report.compareTo,
    LABEL:                   opts.label ? String(opts.label).slice(0, 200) : null,
    TOTAL_WIP_HK:            report.totals.wipHk,
    TOTAL_WIP_REVENUE:       report.totals.wipRevenue,
    TOTAL_WIP_TAX:           report.totals.wipTax,
    TOTAL_PREPAYMENTS:       report.totals.prepayments,
    TOTAL_LOSS_RISK:         report.totals.lossRisk,
    PROJECT_COUNT:           report.totals.projectCount,
    MISSING_SNAPSHOT_COUNT:  report.totals.noSnapshotCount,
    CREATED_BY_EMPLOYEE_ID:  opts.employeeId ?? null,
    CREATED_BY_NAME:         createdByName,
  };

  // Ohne gepflegten Steuerfaktor die Spalten gar nicht mitschicken: Migration
  // 0138 wird von Hand eingespielt, und ein Mandant, der die Steuerbilanz nicht
  // nutzt, soll nicht am Festschreiben scheitern, weil sie noch aussteht.
  const withTax = report.taxCostFactorPercent != null;
  if (!withTax) {
    delete head.TAX_COST_FACTOR_PERCENT;
    delete head.TOTAL_WIP_TAX;
  }

  const { data: created, error: headErr } = await supabase
    .from("WIP_CLOSING").insert([head]).select("ID").single();
  if (headErr) throw { status: 500, message: headErr.message };

  const closingId = created.ID;
  const lines = report.rows.map(r => ({
    TENANT_ID:            tenantId,
    CLOSING_ID:           closingId,
    PROJECT_ID:           r.PROJECT_ID,
    NAME_SHORT:           r.NAME_SHORT,
    NAME_LONG:            r.NAME_LONG,
    PROJECT_STATUS_NAME:  r.PROJECT_STATUS_NAME_SHORT,
    PROJECT_MANAGER:      r.PROJECT_MANAGER_DISPLAY,
    ORDER_VALUE_NET:      r.ORDER_VALUE_NET,
    PERFORMANCE_NET:      r.PERFORMANCE_NET,
    PERFORMANCE_PERCENT:  r.PERFORMANCE_PERCENT,
    BILLED_NET:           r.BILLED_NET,
    COST_NET:             r.COST_NET,
    HOURS_TOTAL:          r.HOURS_TOTAL,
    UNBILLED_NET:         r.UNBILLED_NET,
    COST_UNBILLED_NET:    r.COST_UNBILLED_NET,
    COST_UNBILLED_TAX_NET: r.COST_UNBILLED_TAX_NET,
    WIP_TAX_NET:           r.WIP_TAX_NET,
    WIP_HK_NET:           r.WIP_HK_NET,
    WIP_REVENUE_NET:      r.WIP_REVENUE_NET,
    PREPAYMENT_NET:       r.PREPAYMENT_NET,
    LOSS_RISK_NET:        r.LOSS_RISK_NET,
    UNREALIZED_GAIN_NET:  r.UNREALIZED_GAIN_NET,
    SNAPSHOT_DATE:        r.SNAPSHOT_DATE,
    FLAGS:                (r.flags || []).join(",") || null,
  })).map(line => {
    if (withTax) return line;
    const { COST_UNBILLED_TAX_NET: _c, WIP_TAX_NET: _w, ...rest } = line;
    return rest;
  });

  if (lines.length > 0) {
    const { error: lineErr } = await supabase.from("WIP_CLOSING_LINE").insert(lines);
    if (lineErr) {
      // Kopf ohne Zeilen wäre ein Abschluss, der eine Summe behauptet, die er
      // nicht belegen kann.
      await supabase.from("WIP_CLOSING").delete().eq("ID", closingId).eq("TENANT_ID", tenantId);
      throw { status: 500, message: lineErr.message };
    }
  }

  return { id: closingId, asOf: report.asOf, projectCount: lines.length, totals: report.totals };
}

async function listClosings(supabase, tenantId) {
  const { data, error } = await supabase
    .from("WIP_CLOSING")
    .select("ID, AS_OF_DATE, METHOD, COST_FACTOR_PERCENT, TAX_COST_FACTOR_PERCENT, COMPARE_TO_DATE, LABEL, TOTAL_WIP_HK, TOTAL_WIP_REVENUE, TOTAL_WIP_TAX, TOTAL_PREPAYMENTS, TOTAL_LOSS_RISK, PROJECT_COUNT, MISSING_SNAPSHOT_COUNT, CREATED_BY_NAME, created_at")
    .eq("TENANT_ID", tenantId)
    .order("AS_OF_DATE", { ascending: false });
  if (error) throw { status: 500, message: error.message };
  return data || [];
}

/**
 * Ein festgeschriebener Abschluss samt Zeilen. `drift` vergleicht die
 * festgeschriebene Summe mit dem, was heute für denselben Stichtag
 * herauskäme — genau die Abweichung, die nachträgliche Buchungen erzeugen.
 */
async function getClosing(supabase, tenantId, id, { withDrift = false } = {}) {
  const { data: head, error } = await supabase
    .from("WIP_CLOSING")
    .select("*")
    .eq("TENANT_ID", tenantId)
    .eq("ID", id)
    .maybeSingle();
  if (error) throw { status: 500, message: error.message };
  if (!head) throw { status: 404, message: "Abschluss nicht gefunden." };

  const { data: lines, error: lErr } = await supabase
    .from("WIP_CLOSING_LINE")
    .select("*")
    .eq("TENANT_ID", tenantId)
    .eq("CLOSING_ID", id)
    .order("NAME_SHORT", { ascending: true });
  if (lErr) throw { status: 500, message: lErr.message };

  let drift = null;
  if (withDrift) {
    const live = await buildWipReport(supabase, tenantId, {
      asOf: String(head.AS_OF_DATE).slice(0, 10),
      costFactorPercent: head.COST_FACTOR_PERCENT,
      method: head.METHOD,
    });
    const frozen = head.METHOD === "erloes" ? num(head.TOTAL_WIP_REVENUE) : num(head.TOTAL_WIP_HK);
    drift = {
      frozen,
      live:        wipTotalForMethod(live.totals, head.METHOD),
      difference:  round2(wipTotalForMethod(live.totals, head.METHOD) - frozen),
    };
  }

  return { ...head, lines: lines || [], drift };
}

async function deleteClosing(supabase, tenantId, id) {
  const { error } = await supabase
    .from("WIP_CLOSING").delete().eq("TENANT_ID", tenantId).eq("ID", id);
  if (error) throw { status: 500, message: error.message };
  return { ok: true };
}

module.exports = {
  buildWipReport,
  saveClosing,
  listClosings,
  getClosing,
  deleteClosing,
  // Rechenkern — für Tests und den PDF-Renderer
  computeWipRow,
  aggregateWip,
  stockChange,
  wipTotalForMethod,
  METHODS,
  FLAG_NO_PERFORMANCE,
  FLAG_PREPAYMENT,
  FLAG_LOSS_RISK,
  FLAG_NO_SNAPSHOT,
  FLAG_PROGRESS_GAP,
  PROGRESS_GAP_THRESHOLD_POINTS,
};
