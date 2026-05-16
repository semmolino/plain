"use strict";

const { createNotification } = require("./notifications");
const projekteSvc = require("./projekte");

const KEY_ENABLED     = "monatsabschluss_enabled";
const KEY_TYPES       = "monatsabschluss_project_types";
const KEY_LAST_MONTH  = "monatsabschluss_last_run_month";
const KEY_LAST_DATE   = "monatsabschluss_last_run_date";
const KEY_LAST_COUNT  = "monatsabschluss_last_run_count";
const KEY_REPORT_DATA = "monatsabschluss_last_report_data";

function isLastDayOfMonth() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return tomorrow.getMonth() !== now.getMonth();
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getSetting(supabase, tenantId, key) {
  const { data } = await supabase
    .from("TENANT_SETTINGS")
    .select("VALUE")
    .eq("TENANT_ID", tenantId)
    .eq("KEY", key)
    .maybeSingle();
  return data?.VALUE ?? null;
}

async function putSetting(supabase, tenantId, key, value) {
  await supabase.from("TENANT_SETTINGS").upsert(
    [{ TENANT_ID: tenantId, KEY: key, VALUE: value, UPDATED_AT: new Date().toISOString() }],
    { onConflict: "TENANT_ID,KEY" }
  );
}

async function getSettings(supabase, tenantId) {
  const keys = [KEY_ENABLED, KEY_TYPES, KEY_LAST_MONTH, KEY_LAST_DATE, KEY_LAST_COUNT];
  const { data } = await supabase
    .from("TENANT_SETTINGS")
    .select("KEY, VALUE")
    .eq("TENANT_ID", tenantId)
    .in("KEY", keys);
  const map = Object.fromEntries((data || []).map(r => [r.KEY, r.VALUE]));
  return {
    enabled:      map[KEY_ENABLED] === "true",
    projectTypes: map[KEY_TYPES] ? JSON.parse(map[KEY_TYPES]) : [],
    lastRunMonth: map[KEY_LAST_MONTH] || null,
    lastRunDate:  map[KEY_LAST_DATE]  || null,
    lastRunCount: map[KEY_LAST_COUNT] != null ? parseInt(map[KEY_LAST_COUNT], 10) : null,
  };
}

async function saveSettings(supabase, tenantId, { enabled, projectTypes }) {
  const now = new Date().toISOString();
  const upserts = [
    { TENANT_ID: tenantId, KEY: KEY_ENABLED, VALUE: enabled ? "true" : "false", UPDATED_AT: now },
    { TENANT_ID: tenantId, KEY: KEY_TYPES,   VALUE: JSON.stringify(projectTypes || []), UPDATED_AT: now },
  ];
  const { error } = await supabase.from("TENANT_SETTINGS").upsert(upserts, { onConflict: "TENANT_ID,KEY" });
  if (error) throw { status: 500, message: error.message };
}

async function runMonatsabschluss(supabase, tenantId, { year, month, isTest = false } = {}) {
  const now = new Date();
  const runYear  = year  ?? now.getFullYear();
  const runMonth = month ?? (now.getMonth() + 1);
  const monthKey   = `${runYear}-${String(runMonth).padStart(2, "0")}`;
  const monthLabel = new Date(runYear, runMonth - 1, 1)
    .toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  const settings = await getSettings(supabase, tenantId);
  const projectTypeIds = (settings.projectTypes || []).map(Number).filter(Boolean);

  // Fetch matching projects from the live report view
  let query = supabase
    .from("VW_REPORT_PROJECT_DETAIL")
    .select([
      "PROJECT_ID", "NAME_SHORT", "NAME_LONG",
      "PROJECT_TYPE_ID", "PROJECT_TYPE_NAME_SHORT",
      "BUDGET_TOTAL_NET", "LEISTUNGSSTAND_PERCENT", "LEISTUNGSSTAND_VALUE",
      "BILLED_NET_TOTAL", "OPEN_NET_TOTAL", "PAYED_NET_TOTAL",
    ].join(", "))
    .eq("TENANT_ID", tenantId)
    .order("NAME_SHORT", { ascending: true });

  if (projectTypeIds.length > 0) {
    query = query.in("PROJECT_TYPE_ID", projectTypeIds);
  }

  const { data: projects, error: pErr } = await query;
  if (pErr) throw { status: 500, message: pErr.message };

  const matchingProjects = projects || [];

  // Take a Projekt-Snapshot for each project
  let snapshotCount = 0;
  for (const p of matchingProjects) {
    try {
      await projekteSvc.progressSnapshot(supabase, { projectId: p.PROJECT_ID });
      snapshotCount++;
    } catch (e) {
      console.error(`[MONATSABSCHLUSS] Snapshot failed for project ${p.PROJECT_ID}:`, e?.message || e);
    }
  }

  // Persist report data so we can generate the PDF later
  const reportData = {
    year: runYear,
    month: runMonth,
    monthLabel,
    generatedAt: new Date().toISOString(),
    isTest,
    projects: matchingProjects,
  };
  await putSetting(supabase, tenantId, KEY_REPORT_DATA, JSON.stringify(reportData));

  // Update last-run metadata
  await Promise.all([
    putSetting(supabase, tenantId, KEY_LAST_MONTH, monthKey),
    putSetting(supabase, tenantId, KEY_LAST_DATE,  new Date().toISOString()),
    putSetting(supabase, tenantId, KEY_LAST_COUNT, String(snapshotCount)),
  ]);

  // Notify all users of this tenant
  const plural = snapshotCount !== 1 ? "e" : "";
  await createNotification(supabase, {
    tenantId,
    userId: null,
    type:   "monatsabschluss",
    title:  isTest
      ? `Monatsabschluss ${monthLabel} (Test) — ${snapshotCount} Projekt${plural} erfasst`
      : `Monatsabschluss ${monthLabel} — ${snapshotCount} Projekt${plural} erfasst`,
    body:  "Projekt-Snapshots wurden gespeichert. Bericht kann jetzt heruntergeladen werden.",
    link:  "/admin?tab=monatsabschluss",
    metadata: { month: monthKey, count: snapshotCount, isTest },
  });

  return { monthKey, snapshotCount, projectCount: matchingProjects.length };
}

async function getReportData(supabase, tenantId) {
  const raw = await getSetting(supabase, tenantId, KEY_REPORT_DATA);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function checkAndRun(supabase) {
  if (!isLastDayOfMonth()) return;
  const ym = currentYearMonth();

  const { data: rows, error } = await supabase
    .from("TENANT_SETTINGS")
    .select("TENANT_ID")
    .eq("KEY", KEY_ENABLED)
    .eq("VALUE", "true");

  if (error) {
    console.error("[MONATSABSCHLUSS] Failed to read enabled tenants:", error.message);
    return;
  }

  for (const row of rows || []) {
    const tenantId = row.TENANT_ID;
    try {
      const lastMonth = await getSetting(supabase, tenantId, KEY_LAST_MONTH);
      if (lastMonth === ym) {
        console.log(`[MONATSABSCHLUSS] Already ran for tenant ${tenantId} in ${ym}`);
        continue;
      }
      console.log(`[MONATSABSCHLUSS] Running for tenant ${tenantId} — ${ym}`);
      const result = await runMonatsabschluss(supabase, tenantId);
      console.log(`[MONATSABSCHLUSS] Done for tenant ${tenantId}: ${result.snapshotCount} snapshots`);
    } catch (e) {
      console.error(`[MONATSABSCHLUSS] Error for tenant ${tenantId}:`, e?.message || e);
    }
  }
}

function startMonatsabschlussChecker(supabase) {
  const RUN_AFTER_MS = 45_000;
  const INTERVAL_MS  = 60 * 60 * 1000; // every hour

  setTimeout(async () => {
    console.log("[MONATSABSCHLUSS] Running initial check …");
    await checkAndRun(supabase).catch(e =>
      console.error("[MONATSABSCHLUSS] Error:", e?.message || e)
    );
    setInterval(() => {
      console.log("[MONATSABSCHLUSS] Running hourly check …");
      checkAndRun(supabase).catch(e =>
        console.error("[MONATSABSCHLUSS] Error:", e?.message || e)
      );
    }, INTERVAL_MS);
  }, RUN_AFTER_MS);
}

module.exports = {
  getSettings,
  saveSettings,
  runMonatsabschluss,
  getReportData,
  startMonatsabschlussChecker,
};
