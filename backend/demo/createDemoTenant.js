"use strict";

/**
 * createDemoTenant — legt einen loginbaren Demo-Mandanten an (Bootstrap).
 *
 * Spiegelt den Signup-Flow (routes/auth.js): Supabase-Auth-User + TENANTS +
 * COMPANY + erster EMPLOYEE + Standard-Rollen (Erst-User = Administrator).
 * Danach baust du die realistischen Demo-Inhalte (Adressen, HOAI-Angebot →
 * Projekt → Rechnungen → Reports) in der echten Oberfläche auf; mit
 * exportTenant.js wird daraus die wiedereinspielbare Import-Vorlage.
 *
 * NUR für den Demo-Mandanten gedacht — niemals gegen echte Kundendaten.
 *
 * Nutzung (Backend-Env mit SUPABASE_URL + SUPABASE_SERVICE_KEY gesetzt):
 *   node demo/createDemoTenant.js \
 *     --email demo@plan-simple.app --password 'Sicher#2026' \
 *     --company "Beispiel Architekturbüro" --short DEMO
 *
 * Alternativ über Env: DEMO_EMAIL, DEMO_PASSWORD, DEMO_COMPANY, DEMO_SHORT.
 */

const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

// Standard-Rollen wie im Signup (routes/auth.js → seedTenantRbacAndAssignAdmin).
async function seedRolesAndAssignAdmin(supabase, tenantId, employeeId) {
  const { data: perms, error } = await supabase.from("PERMISSION").select("ID, KEY, MODULE, CATEGORY");
  if (error || !perms || perms.length === 0) {
    console.warn("[demo] PERMISSION-Katalog leer/fehlt → keine Rollen angelegt (unrestricted).");
    return;
  }
  const uniq     = (a) => [...new Set(a)];
  const allIds   = perms.map(p => p.ID);
  const byCat    = (c) => perms.filter(p => p.CATEGORY === c).map(p => p.ID);
  const byModule = (m) => perms.filter(p => m.includes(p.MODULE)).map(p => p.ID);
  const byKey    = (k) => perms.filter(p => k.includes(p.KEY)).map(p => p.ID);

  const roleDefs = [
    { name: "Administrator",    long: "Voller Zugriff auf alle Funktionen",                            color: "#dc2626", isDefault: false, permIds: allIds },
    { name: "Geschäftsleitung", long: "Voller Lesezugriff, Rechnungen buchen, keine Konfiguration",    color: "#7c3aed", isDefault: false,
      permIds: uniq([...byCat("reading"), ...byKey(["invoices.book", "invoices.send_email", "dunning.send", "reports.export"])]) },
    { name: "Projektleiter",    long: "Projekte/Angebote/Rechnungen voll, keine Mitarbeiterverwaltung", color: "#2563eb", isDefault: false,
      permIds: byModule(["dashboard", "addresses", "projects", "reports", "invoices", "dunning", "offers"]) },
    { name: "Buchhaltung",      long: "Rechnungen/Mahnungen voll, Projekte/Angebote nur lesen",         color: "#16a34a", isDefault: false,
      permIds: uniq([...byModule(["invoices", "dunning", "reports", "addresses", "dashboard"]), ...byKey(["projects.view", "offers.view", "employees.view"])]) },
    { name: "Mitarbeiter",      long: "Basis-Zugriff: Übersicht + eigene Stunden",                      color: "#6b7280", isDefault: true,
      permIds: byKey(["dashboard.view", "addresses.view", "addresses.contacts.view"]) },
  ];

  let adminRoleId = null;
  for (const rd of roleDefs) {
    const { data: role, error: rErr } = await supabase
      .from("USER_ROLE")
      .insert([{ TENANT_ID: tenantId, NAME_SHORT: rd.name, NAME_LONG: rd.long, COLOR: rd.color, IS_SYSTEM: true, IS_DEFAULT: rd.isDefault }])
      .select("ID").single();
    if (rErr || !role) { console.error("[demo][ROLE]", rd.name, rErr?.message); continue; }
    if (rd.name === "Administrator") adminRoleId = role.ID;
    if (rd.permIds.length) {
      const { error: rpErr } = await supabase.from("ROLE_PERMISSION")
        .insert(rd.permIds.map(pid => ({ ROLE_ID: role.ID, PERMISSION_ID: pid })));
      if (rpErr) console.error("[demo][ROLE_PERMISSION]", rd.name, rpErr.message);
    }
  }
  if (adminRoleId) {
    await supabase.from("EMPLOYEE_ROLE").insert([{ EMPLOYEE_ID: employeeId, ROLE_ID: adminRoleId, ASSIGNED_BY: employeeId }]);
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error("✗ SUPABASE_URL und SUPABASE_SERVICE_KEY müssen gesetzt sein."); process.exit(1); }

  const email    = arg("email",    process.env.DEMO_EMAIL);
  const password = arg("password", process.env.DEMO_PASSWORD);
  const company  = arg("company",  process.env.DEMO_COMPANY || "Beispiel Architekturbüro");
  const shortNm  = arg("short",    process.env.DEMO_SHORT   || "DEMO");
  if (!email || !password) { console.error("✗ --email und --password (bzw. DEMO_EMAIL/DEMO_PASSWORD) sind erforderlich."); process.exit(1); }
  if (password.length < 8) { console.error("✗ Passwort muss mindestens 8 Zeichen haben."); process.exit(1); }

  const supabase = createClient(url, key);

  // 1) Supabase-Auth-User
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (authErr) { console.error("✗ Auth-User:", authErr.message || authErr); process.exit(1); }
  const userId = authData.user.id;

  // 2) TENANTS
  const { data: tenant, error: tErr } = await supabase.from("TENANTS").insert([{ TENANT: company }]).select("ID").single();
  if (tErr) { await supabase.auth.admin.deleteUser(userId).catch(() => {}); console.error("✗ TENANTS:", tErr.message); process.exit(1); }
  const tenantId = tenant.ID;

  // 3) COMPANY
  await supabase.from("COMPANY").insert([{ COMPANY_NAME_1: company, TENANT_ID: tenantId }]);

  // 4) app_metadata (best effort)
  await supabase.auth.admin.updateUserById(userId, { app_metadata: { tenant_id: tenantId } }).catch(() => {});

  // 5) EMPLOYEE
  const hashedPw = await bcrypt.hash(password, 10);
  const { data: emp, error: eErr } = await supabase.from("EMPLOYEE").insert([{
    MAIL: email, PASSWORD: hashedPw, SHORT_NAME: String(shortNm).trim().toUpperCase(),
    FIRST_NAME: "Demo", LAST_NAME: "Admin", TENANT_ID: tenantId,
  }]).select("ID").single();
  if (eErr) { console.error("✗ EMPLOYEE:", eErr.message); process.exit(1); }

  // 6) Rollen + Admin
  await seedRolesAndAssignAdmin(supabase, tenantId, emp.ID);

  console.log("✅ Demo-Mandant angelegt.");
  console.log(`   TENANT_ID : ${tenantId}`);
  console.log(`   Firma     : ${company}`);
  console.log(`   Login     : ${email}`);
  console.log("   → Jetzt einloggen und die Demo-Inhalte aufbauen (Adressen, HOAI-Angebot → Projekt → Rechnungen → Reports),");
  console.log("     danach mit demo/exportTenant.js als wiedereinspielbare Vorlage exportieren.");
}

main().catch(e => { console.error("✗ Unerwarteter Fehler:", e?.message || e); process.exit(1); });
