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
  if (!eff.enabled) return 'disabled';
  if (eff.catalog.DEFAULT_AUDIENCE_KIND === 'managed_by_rule') {
    return 'managed_by_rule';
  }
  // Default fuer alle anderen Typen: 'tenant_wide'
  if (eff.audienceUseDefault) {
    return null; // tenant-wide
  }

  // Mixed-Modus: alle Treffer aus den vier Quellen sammeln (OR).
  if (eff.audienceAllTenant) return null;

  const empIds = new Set();
  const roles  = Array.isArray(eff.audienceRoles)       ? eff.audienceRoles.filter(Boolean) : [];
  const depts  = Array.isArray(eff.audienceDepartments) ? eff.audienceDepartments.filter(x => x != null) : [];
  const empls  = Array.isArray(eff.audienceEmployees)   ? eff.audienceEmployees.filter(x => x != null) : [];

  if (roles.length || depts.length) {
    let q = supabase.from('EMPLOYEE').select('ID').eq('TENANT_ID', tenantId);
    // OR per supabase-js: ein einziges OR mit allen Teilen
    const orParts = [];
    if (roles.length) orParts.push(`DASHBOARD_ROLE.in.(${roles.map(r => `"${r}"`).join(',')})`);
    if (depts.length) orParts.push(`DEPARTMENT_ID.in.(${depts.join(',')})`);
    if (orParts.length) q = q.or(orParts.join(','));
    const { data } = await q;
    for (const r of (data || [])) empIds.add(Number(r.ID));
  }
  for (const eid of empls) empIds.add(Number(eid));

  if (empIds.size === 0) {
    // Konfiguration leer -> nichts senden (bewusst still, kein Auto-Tenantweit-Fallback)
    return new Set();
  }
  return empIds;
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
  listAllForAdmin,
  upsertConfig,
};
