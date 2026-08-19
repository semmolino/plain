'use strict';

// Notification-Konfiguration (Migration 0055).
//
// - getEffectiveConfig(supabase, tenantId, typeKey)
//     Merge aus NOTIFICATION_TYPE (Default) und NOTIFICATION_TYPE_CONFIG (Tenant-Override).
// - resolveAudience(supabase, tenantId, typeKey, context)
//     Liefert entweder:
//       null              -> tenant-weite Notification (USER_ID = NULL)
//       Set<empId:number> -> eine Notification je Mitarbeiter
//       'managed_by_rule' -> Empfaenger werden vom Aufrufer geliefert (Budget-Regel etc.)
//       'disabled'        -> Typ ist deaktiviert, gar nichts erzeugen
// - listAllForAdmin(supabase, tenantId)
//     Katalog + Tenant-Overrides fuer das Admin-UI.
// - upsertConfig(supabase, { tenantId, typeKey, body, employeeId })
//     Schreibt/aktualisiert eine NOTIFICATION_TYPE_CONFIG-Zeile.

// In-Memory Cache der Katalog-Zeilen (tenant-uebergreifend, aendert sich
// nur via Migration). 60s TTL — kein Spam.
let _catalogCache = null;
let _catalogCacheAt = 0;
const CATALOG_TTL_MS = 60_000;

async function loadCatalog(supabase) {
  if (_catalogCache && (Date.now() - _catalogCacheAt) < CATALOG_TTL_MS) return _catalogCache;
  const { data, error } = await supabase
    .from('NOTIFICATION_TYPE')
    .select('*')
    .order('SORT_ORDER', { ascending: true });
  if (error) {
    // Migration 0055 noch nicht gelaufen -> leerer Katalog, Aufrufer fallen auf Legacy-Pfad
    _catalogCache = [];
  } else {
    _catalogCache = data || [];
  }
  _catalogCacheAt = Date.now();
  return _catalogCache;
}

async function getCatalogEntry(supabase, typeKey) {
  const catalog = await loadCatalog(supabase);
  return catalog.find(r => r.TYPE_KEY === typeKey) || null;
}

async function getEffectiveConfig(supabase, tenantId, typeKey) {
  const cat = await getCatalogEntry(supabase, typeKey);
  if (!cat) return null; // Typ unbekannt -> Aufrufer faellt auf Legacy zurueck

  let cfg = null;
  try {
    const { data } = await supabase
      .from('NOTIFICATION_TYPE_CONFIG')
      .select('*')
      .eq('TENANT_ID', tenantId)
      .eq('TYPE_KEY', typeKey)
      .maybeSingle();
    cfg = data || null;
  } catch (_) { /* Tabelle noch nicht da */ }

  // Merge
  return {
    typeKey,
    catalog: cat,
    hasOverride:         !!cfg, // existiert eine NOTIFICATION_TYPE_CONFIG-Zeile?
    enabled:             cfg ? !!cfg.ENABLED : !!cat.DEFAULT_ENABLED,
    audienceUseDefault:  cfg ? !!cfg.AUDIENCE_USE_DEFAULT : true,
    audienceAllTenant:   cfg ? !!cfg.AUDIENCE_ALL_TENANT  : false,
    audienceRoles:       cfg?.AUDIENCE_ROLES       ?? null,
    audienceDepartments: cfg?.AUDIENCE_DEPARTMENTS ?? null,
    audienceEmployees:   cfg?.AUDIENCE_EMPLOYEES   ?? null,
  };
}

// Loest die effektive Empfaenger-Menge fuer einen Notification-Versand auf.
async function resolveAudience(supabase, tenantId, typeKey /*, context */) {
  const eff = await getEffectiveConfig(supabase, tenantId, typeKey);
  if (!eff) return null; // Typ nicht im Katalog -> Legacy-Verhalten (tenant-wide)

  // managed_by_rule-Typen: die Regel oder der Schedule sind die
  // autoritative Quelle (BUDGET_WARNING_RULE.MUTED bzw.
  // NOTIFICATION_SCHEDULE_CONFIG.ENABLED). Den Katalog-DEFAULT_ENABLED
  // ignorieren wir hier — sonst muss der Seed-Wert immer TRUE sein,
  // sonst blockt der Gate stillschweigend. Nur ein expliziter
  // Tenant-Override (NOTIFICATION_TYPE_CONFIG mit ENABLED=false) wirkt
  // weiterhin als Master-Kill-Switch.
  if (eff.catalog.DEFAULT_AUDIENCE_KIND === 'managed_by_rule') {
    if (eff.hasOverride && !eff.enabled) return 'disabled';
    return 'managed_by_rule';
  }

  if (!eff.enabled) return 'disabled';
  // Default fuer alle anderen Typen: 'tenant_wide'
  if (eff.audienceUseDefault) {
    return null; // tenant-wide
  }
  if (eff.audienceAllTenant) return null;

  return resolveEmployeeIds(supabase, tenantId, {
    roles:       eff.audienceRoles,
    departments: eff.audienceDepartments,
    employees:   eff.audienceEmployees,
  });
}

// Loest Rollen / Abteilungen / einzelne Mitarbeiter zu einer Empfaenger-Menge
// auf (OR ueber alle drei Quellen).
//
// Eigene Funktion, damit die Empfaenger-VORSCHAU im Admin und der spaetere
// VERSAND garantiert dasselbe Ergebnis liefern. Eine nachgebaute Vorschau
// waere die naechste Stelle, die beim ersten Feld auseinanderlaeuft — und
// eine Vorschau, der man nicht trauen kann, ist schlimmer als keine.
//
// Leere Konfiguration -> leere Menge. Bewusst KEIN Rueckfall auf
// "dann eben alle": wer Empfaenger einschraenkt und sich vertut, soll keine
// Rundmail an das ganze Buero ausloesen.
async function resolveEmployeeIds(supabase, tenantId, { roles, departments, employees } = {}) {
  const empIds = new Set();
  const roleList = Array.isArray(roles)       ? roles.filter(Boolean) : [];
  const deptList = Array.isArray(departments) ? departments.filter(x => x != null) : [];
  const emplList = Array.isArray(employees)   ? employees.filter(x => x != null)   : [];

  if (roleList.length || deptList.length) {
    let q = supabase.from('EMPLOYEE').select('ID').eq('TENANT_ID', tenantId);
    // OR per supabase-js: ein einziges OR mit allen Teilen
    const orParts = [];
    if (roleList.length) orParts.push(`DASHBOARD_ROLE.in.(${roleList.map(r => `"${r}"`).join(',')})`);
    if (deptList.length) orParts.push(`DEPARTMENT_ID.in.(${deptList.join(',')})`);
    if (orParts.length) q = q.or(orParts.join(','));
    const { data } = await q;
    for (const r of (data || [])) empIds.add(Number(r.ID));
  }
  for (const eid of emplList) empIds.add(Number(eid));

  return empIds;
}

// Empfaenger-Vorschau fuer einen noch nicht gespeicherten Entwurf.
// Liefert { tenantWide, recipients:[{id, name}] } — dieselbe Aufloesung wie
// beim Versand, nur mit Namen statt IDs.
async function previewAudience(supabase, tenantId, typeKey, body) {
  const cat = await getCatalogEntry(supabase, typeKey);
  const b = body || {};

  if (cat && cat.DEFAULT_AUDIENCE_KIND === 'managed_by_rule') {
    return { tenantWide: false, managedByRule: true, recipients: [] };
  }
  if (b.enabled === false) return { tenantWide: false, disabled: true, recipients: [] };
  if (b.audienceUseDefault !== false || b.audienceAllTenant === true) {
    return { tenantWide: true, recipients: [] };
  }

  const ids = await resolveEmployeeIds(supabase, tenantId, {
    roles:       b.audienceRoles,
    departments: b.audienceDepartments,
    employees:   b.audienceEmployees,
  });
  if (ids.size === 0) return { tenantWide: false, recipients: [] };

  const { data } = await supabase
    .from('EMPLOYEE')
    .select('ID, SHORT_NAME, FIRST_NAME, LAST_NAME')
    .eq('TENANT_ID', tenantId)
    .in('ID', Array.from(ids));

  const recipients = (data || [])
    .map(e => ({
      id:   Number(e.ID),
      name: e.SHORT_NAME || [e.FIRST_NAME, e.LAST_NAME].filter(Boolean).join(' ') || `#${e.ID}`,
    }))
    .sort((a, b2) => a.name.localeCompare(b2.name, 'de'));

  return { tenantWide: false, recipients };
}

// ── Admin-API ──────────────────────────────────────────────────────────────

async function listAllForAdmin(supabase, tenantId) {
  const catalog = await loadCatalog(supabase);
  let configs = [];
  try {
    const { data } = await supabase
      .from('NOTIFICATION_TYPE_CONFIG')
      .select('*')
      .eq('TENANT_ID', tenantId);
    configs = data || [];
  } catch (_) { /* */ }
  const configByKey = new Map(configs.map(c => [c.TYPE_KEY, c]));
  return catalog.map(cat => {
    const cfg = configByKey.get(cat.TYPE_KEY) || null;
    return {
      typeKey:                    cat.TYPE_KEY,
      category:                   cat.CATEGORY,
      title:                      cat.TITLE_DE,
      description:                cat.DESCRIPTION_DE,
      defaultEnabled:             !!cat.DEFAULT_ENABLED,
      defaultAudienceKind:        cat.DEFAULT_AUDIENCE_KIND,
      supportsAudienceOverride:   !!cat.SUPPORTS_AUDIENCE_OVERRIDE,
      sortOrder:                  Number(cat.SORT_ORDER) || 0,
      enabled:                    cfg ? !!cfg.ENABLED : !!cat.DEFAULT_ENABLED,
      audienceUseDefault:         cfg ? !!cfg.AUDIENCE_USE_DEFAULT : true,
      audienceAllTenant:          cfg ? !!cfg.AUDIENCE_ALL_TENANT  : false,
      audienceRoles:              cfg?.AUDIENCE_ROLES       ?? [],
      audienceDepartments:        cfg?.AUDIENCE_DEPARTMENTS ?? [],
      audienceEmployees:          cfg?.AUDIENCE_EMPLOYEES   ?? [],
      updatedAt:                  cfg?.UPDATED_AT ?? null,
    };
  });
}

async function upsertConfig(supabase, { tenantId, typeKey, body, employeeId }) {
  const cat = await getCatalogEntry(supabase, typeKey);
  if (!cat) throw { status: 404, message: 'Unbekannter Notification-Typ' };
  const b = body || {};
  const row = {
    TENANT_ID:            tenantId,
    TYPE_KEY:             typeKey,
    ENABLED:              b.enabled !== false,
    AUDIENCE_USE_DEFAULT: b.audienceUseDefault !== false,
    AUDIENCE_ALL_TENANT:  !!b.audienceAllTenant,
    AUDIENCE_ROLES:       Array.isArray(b.audienceRoles)       ? b.audienceRoles.filter(Boolean) : null,
    AUDIENCE_DEPARTMENTS: Array.isArray(b.audienceDepartments) ? b.audienceDepartments.map(Number).filter(Number.isFinite) : null,
    AUDIENCE_EMPLOYEES:   Array.isArray(b.audienceEmployees)   ? b.audienceEmployees.map(Number).filter(Number.isFinite)   : null,
    UPDATED_AT:           new Date().toISOString(),
    UPDATED_BY:           employeeId ?? null,
  };
  if (!cat.SUPPORTS_AUDIENCE_OVERRIDE) {
    // Bei rule-managed Typen: Empfaengerfelder forcen auf default
    row.AUDIENCE_USE_DEFAULT = true;
    row.AUDIENCE_ALL_TENANT  = false;
    row.AUDIENCE_ROLES       = null;
    row.AUDIENCE_DEPARTMENTS = null;
    row.AUDIENCE_EMPLOYEES   = null;
  }
  const { data, error } = await supabase
    .from('NOTIFICATION_TYPE_CONFIG')
    .upsert([row], { onConflict: 'TENANT_ID,TYPE_KEY' })
    .select('*')
    .single();
  if (error) throw { status: 500, message: error.message };
  return data;
}

module.exports = {
  loadCatalog,
  getEffectiveConfig,
  resolveAudience,
  resolveEmployeeIds,
  previewAudience,
  listAllForAdmin,
  upsertConfig,
};
