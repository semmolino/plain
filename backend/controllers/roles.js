"use strict";

/**
 * Controller fuer Rollen-Verwaltung + Permissions (RBAC Phase 0)
 *
 * Endpoints:
 *   GET    /api/v1/permissions/me         -> { keys, unrestricted }
 *   GET    /api/v1/permissions            -> Vollstaendiger Katalog
 *   GET    /api/v1/roles                  -> Rollen des Tenants + Counts
 *   POST   /api/v1/roles                  -> neue Rolle
 *   GET    /api/v1/roles/:id              -> Rolle inkl. Permission-IDs
 *   PATCH  /api/v1/roles/:id              -> Rolle (Name, Farbe, IsDefault, Permissions) updaten
 *   DELETE /api/v1/roles/:id              -> Rolle loeschen (nur wenn IS_SYSTEM=false)
 *   GET    /api/v1/roles/employees        -> Mapping employee_id -> role_ids
 *   PUT    /api/v1/employees/:id/roles    -> Rollen eines Mitarbeiters setzen (Array<role_id>)
 */

// ── /permissions/me ─────────────────────────────────────────────────────────

async function getMyPermissions(req, res /* , supabase */) {
  return res.json({
    keys:         Array.from(req.permissions ?? []),
    unrestricted: !!req._permissionsUnrestricted,
  });
}

// ── /permissions (Katalog) ──────────────────────────────────────────────────

async function listPermissions(req, res, supabase) {
  try {
    const { data, error } = await supabase
      .from("PERMISSION")
      .select("ID, KEY, MODULE, ACTION, LABEL_DE, DESCRIPTION_DE, CATEGORY, POSITION")
      .order("POSITION", { ascending: true });
    if (error) {
      if (/does not exist/i.test(error.message)) return res.json({ data: [] });
      return res.status(500).json({ error: error.message });
    }
    return res.json({ data: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── /roles GET (Tenant-Rollen + Mitarbeiter-Counts) ─────────────────────────

async function listRoles(req, res, supabase) {
  try {
    const { data: roles, error } = await supabase
      .from("USER_ROLE")
      .select("ID, NAME_SHORT, NAME_LONG, COLOR, IS_SYSTEM, IS_DEFAULT, CREATED_AT, UPDATED_AT")
      .eq("TENANT_ID", req.tenantId)
      .order("IS_SYSTEM", { ascending: false })
      .order("NAME_SHORT", { ascending: true });
    if (error) {
      if (/does not exist/i.test(error.message)) return res.json({ data: [] });
      return res.status(500).json({ error: error.message });
    }

    const roleIds = (roles || []).map(r => r.ID);

    // Anzahl Mitarbeiter pro Rolle
    const counts = new Map();
    if (roleIds.length > 0) {
      const { data: er } = await supabase
        .from("EMPLOYEE_ROLE")
        .select("ROLE_ID")
        .in("ROLE_ID", roleIds);
      for (const row of er || []) {
        counts.set(row.ROLE_ID, (counts.get(row.ROLE_ID) || 0) + 1);
      }
    }

    const enriched = (roles || []).map(r => ({ ...r, EMPLOYEE_COUNT: counts.get(r.ID) || 0 }));
    return res.json({ data: enriched });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── /roles/:id GET (Detail inkl. Permission-IDs) ────────────────────────────

async function getRole(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "ungueltige ID" });

    const { data: role, error } = await supabase
      .from("USER_ROLE")
      .select("ID, NAME_SHORT, NAME_LONG, COLOR, IS_SYSTEM, IS_DEFAULT")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (error || !role) return res.status(404).json({ error: "Rolle nicht gefunden" });

    const { data: rp } = await supabase
      .from("ROLE_PERMISSION")
      .select("PERMISSION_ID")
      .eq("ROLE_ID", id);

    return res.json({
      data: { ...role, PERMISSION_IDS: (rp || []).map(r => r.PERMISSION_ID) }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── /roles POST ─────────────────────────────────────────────────────────────

async function createRole(req, res, supabase) {
  try {
    const b = req.body || {};
    const name_short = String(b.name_short || "").trim();
    if (!name_short) return res.status(400).json({ error: "name_short erforderlich" });

    const insertRow = {
      TENANT_ID:  req.tenantId,
      NAME_SHORT: name_short,
      NAME_LONG:  b.name_long || null,
      COLOR:      b.color     || null,
      IS_SYSTEM:  false,
      IS_DEFAULT: false,
    };
    const { data: role, error } = await supabase
      .from("USER_ROLE")
      .insert([insertRow])
      .select("*")
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });

    // Optionale Permission-Liste mitgeben
    const permIds = Array.isArray(b.permission_ids) ? b.permission_ids.filter(Number.isFinite) : [];
    if (permIds.length > 0) {
      const rows = permIds.map(pid => ({ ROLE_ID: role.ID, PERMISSION_ID: pid }));
      await supabase.from("ROLE_PERMISSION").insert(rows);
    }

    return res.json({ data: role });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── /roles/:id PATCH ────────────────────────────────────────────────────────

async function patchRole(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "ungueltige ID" });

    const { data: existing } = await supabase
      .from("USER_ROLE")
      .select("ID, IS_SYSTEM")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "Rolle nicht gefunden" });

    const b = req.body || {};
    const update = { UPDATED_AT: new Date().toISOString() };

    // System-Rollen: Name/IS_SYSTEM/IS_DEFAULT bleiben unveraendert, aber Permissions + Color + Long-Name editierbar
    if (b.name_short != null && !existing.IS_SYSTEM) update.NAME_SHORT = String(b.name_short).trim();
    if (b.name_long  !== undefined) update.NAME_LONG  = b.name_long || null;
    if (b.color      !== undefined) update.COLOR      = b.color     || null;
    if (b.is_default !== undefined && !existing.IS_SYSTEM) update.IS_DEFAULT = !!b.is_default;

    const { error: upErr } = await supabase
      .from("USER_ROLE")
      .update(update)
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId);
    if (upErr) return res.status(500).json({ error: upErr.message });

    // Falls IS_DEFAULT auf true gesetzt — andere Default-Rollen zuruecksetzen (genau eine darf default sein)
    if (update.IS_DEFAULT === true) {
      await supabase
        .from("USER_ROLE")
        .update({ IS_DEFAULT: false })
        .eq("TENANT_ID", req.tenantId)
        .neq("ID", id);
    }

    // Permissions setzen (atomar via delete-all + insert-all)
    if (Array.isArray(b.permission_ids)) {
      await supabase.from("ROLE_PERMISSION").delete().eq("ROLE_ID", id);
      const rows = b.permission_ids
        .filter(Number.isFinite)
        .map(pid => ({ ROLE_ID: id, PERMISSION_ID: pid }));
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("ROLE_PERMISSION").insert(rows);
        if (insErr) return res.status(500).json({ error: insErr.message });
      }
    }

    return res.json({ data: { id } });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── /roles/:id DELETE ───────────────────────────────────────────────────────

async function deleteRole(req, res, supabase) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "ungueltige ID" });

    const { data: role } = await supabase
      .from("USER_ROLE")
      .select("ID, IS_SYSTEM")
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (!role) return res.status(404).json({ error: "Rolle nicht gefunden" });
    if (role.IS_SYSTEM) return res.status(400).json({ error: "System-Rollen koennen nicht geloescht werden" });

    const { error } = await supabase
      .from("USER_ROLE")
      .delete()
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── /roles/employees GET (Mapping fuer die Mitarbeiterliste) ────────────────

async function listEmployeeRoleMap(req, res, supabase) {
  try {
    // Alle Rollen-Zuweisungen fuer Mitarbeiter dieses Tenants
    const { data: emps } = await supabase
      .from("EMPLOYEE")
      .select("ID")
      .eq("TENANT_ID", req.tenantId);
    const empIds = (emps || []).map(e => e.ID);
    if (empIds.length === 0) return res.json({ data: [] });

    const { data: rows } = await supabase
      .from("EMPLOYEE_ROLE")
      .select("EMPLOYEE_ID, ROLE_ID")
      .in("EMPLOYEE_ID", empIds);

    return res.json({ data: rows || [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

// ── /employees/:id/roles PUT (Rollen eines Mitarbeiters setzen) ─────────────

async function setEmployeeRoles(req, res, supabase) {
  try {
    const employeeId = parseInt(req.params.id, 10);
    if (!employeeId) return res.status(400).json({ error: "ungueltige ID" });

    // Mitarbeiter muss zum Tenant gehoeren
    const { data: emp } = await supabase
      .from("EMPLOYEE")
      .select("ID")
      .eq("ID", employeeId)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (!emp) return res.status(404).json({ error: "Mitarbeiter nicht gefunden" });

    const roleIds = Array.isArray(req.body?.role_ids) ? req.body.role_ids.filter(Number.isFinite) : [];

    // Alle gewuenschten Rollen muessen zum Tenant gehoeren
    if (roleIds.length > 0) {
      const { data: validRoles } = await supabase
        .from("USER_ROLE")
        .select("ID")
        .in("ID", roleIds)
        .eq("TENANT_ID", req.tenantId);
      const validSet = new Set((validRoles || []).map(r => r.ID));
      if (validSet.size !== roleIds.length) {
        return res.status(400).json({ error: "Eine oder mehrere Rollen gehoeren nicht zu diesem Tenant" });
      }
    }

    // Atomar: alles loeschen + neu einfuegen
    await supabase.from("EMPLOYEE_ROLE").delete().eq("EMPLOYEE_ID", employeeId);
    if (roleIds.length > 0) {
      const rows = roleIds.map(rid => ({
        EMPLOYEE_ID: employeeId,
        ROLE_ID:     rid,
        ASSIGNED_AT: new Date().toISOString(),
        ASSIGNED_BY: req.employeeId || null,
      }));
      const { error } = await supabase.from("EMPLOYEE_ROLE").insert(rows);
      if (error) return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

module.exports = {
  getMyPermissions, listPermissions,
  listRoles, getRole, createRole, patchRole, deleteRole,
  listEmployeeRoleMap, setEmployeeRoles,
};
