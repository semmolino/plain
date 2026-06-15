const express    = require("express");
const jwt        = require("jsonwebtoken");
const bcrypt     = require("bcryptjs");
const crypto     = require("crypto");
const { sendMail: _sendMail } = require("../services/emailService");
const {
  loginLimiter, passwordLimiter, resetRequestLimiter, resetConfirmLimiter, signupLimiter,
} = require("../middleware/rateLimit");

// Compatibility shim — auth.js used createMailer() locally; now delegates to emailService
function createMailer() {
  if (!process.env.SMTP_HOST) return null;
  // Return a duck-typed object so existing sendMail() call sites still work
  return {
    sendMail: (opts) => _sendMail(opts),
  };
}

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET environment variable is required");
  return s;
}

function issueToken(payload) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: "8h" });
}

/**
 * One-Time-Fingerprint des aktuellen Passwort-Hashes. Wird in den Reset-Token
 * eingebettet und beim Bestätigen geprüft: ändert sich das Passwort, passt der
 * Fingerprint nicht mehr -> ein bereits benutzter Reset-Link (und alle anderen
 * ausstehenden) wird ungültig. Replay-/Wiederverwendungsschutz.
 */
function pwdFingerprint(passwordHashOrNull) {
  return crypto.createHash("sha256").update(String(passwordHashOrNull || "")).digest("hex").slice(0, 16);
}

/**
 * Legt fuer einen NEUEN Tenant die Standard-Rollen an (spiegelt Migration 0062)
 * und weist dem Erst-User die Administrator-Rolle zu.
 *
 * Hintergrund: Migration 0062 hat die Default-Rollen nur fuer die damals
 * existierenden Tenants erzeugt. Ein per Signup neu angelegter Tenant haette
 * sonst gar keine Rollen -> der Erst-User bekommt keine Permissions und ist
 * komplett ausgesperrt (kein UI zum Selbst-Zuweisen).
 *
 * Best-effort: faengt Fehler ab und blockiert die Registrierung nicht. Fehlt
 * der PERMISSION-Katalog (RBAC-Migration nicht eingespielt), laeuft die
 * Permissions-Middleware ohnehin im "unrestricted"-Modus -> No-Op hier.
 */
async function seedTenantRbacAndAssignAdmin(supabase, tenantId, employeeId) {
  try {
    const { data: perms, error: permErr } = await supabase
      .from("PERMISSION")
      .select("ID, KEY, MODULE, CATEGORY");
    if (permErr || !perms || perms.length === 0) return; // RBAC nicht aktiv -> nichts zu tun

    const uniq      = (arr) => [...new Set(arr)];
    const allIds    = perms.map(p => p.ID);
    const byCat     = (cat)  => perms.filter(p => p.CATEGORY === cat).map(p => p.ID);
    const byModule  = (mods) => perms.filter(p => mods.includes(p.MODULE)).map(p => p.ID);
    const byKey     = (keys) => perms.filter(p => keys.includes(p.KEY)).map(p => p.ID);

    const roleDefs = [
      { name: "Administrator",    long: "Voller Zugriff auf alle Funktionen",                          color: "#dc2626", isDefault: false, permIds: allIds },
      { name: "Geschäftsleitung", long: "Voller Lesezugriff, Rechnungen buchen, keine Konfiguration",  color: "#7c3aed", isDefault: false,
        permIds: uniq([...byCat("reading"), ...byKey(["invoices.book","invoices.send_email","dunning.send","reports.export"])]) },
      { name: "Projektleiter",    long: "Projekte/Angebote/Rechnungen voll, keine Mitarbeiterverwaltung", color: "#2563eb", isDefault: false,
        permIds: byModule(["dashboard","addresses","projects","reports","invoices","dunning","offers"]) },
      { name: "Buchhaltung",      long: "Rechnungen/Mahnungen voll, Projekte/Angebote nur lesen",       color: "#16a34a", isDefault: false,
        permIds: uniq([...byModule(["invoices","dunning","reports","addresses","dashboard"]), ...byKey(["projects.view","offers.view","employees.view"])]) },
      { name: "Mitarbeiter",      long: "Basis-Zugriff: Übersicht + eigene Stunden",                    color: "#6b7280", isDefault: true,
        permIds: byKey(["dashboard.view","addresses.view","addresses.contacts.view"]) },
    ];

    let adminRoleId = null;
    for (const rd of roleDefs) {
      const { data: role, error: roleErr } = await supabase
        .from("USER_ROLE")
        .insert([{ TENANT_ID: tenantId, NAME_SHORT: rd.name, NAME_LONG: rd.long, COLOR: rd.color, IS_SYSTEM: true, IS_DEFAULT: rd.isDefault }])
        .select("ID")
        .single();
      if (roleErr || !role) { console.error("[SIGNUP][ROLE]", rd.name, roleErr?.message); continue; }
      if (rd.name === "Administrator") adminRoleId = role.ID;
      if (rd.permIds.length) {
        const { error: rpErr } = await supabase
          .from("ROLE_PERMISSION")
          .insert(rd.permIds.map(pid => ({ ROLE_ID: role.ID, PERMISSION_ID: pid })));
        if (rpErr) console.error("[SIGNUP][ROLE_PERMISSION]", rd.name, rpErr.message);
      }
    }

    // Fallback: Administrator-Rolle nachladen, falls Insert oben fehlschlug
    if (!adminRoleId) {
      const { data: existing } = await supabase
        .from("USER_ROLE").select("ID")
        .eq("TENANT_ID", tenantId).eq("NAME_SHORT", "Administrator").maybeSingle();
      adminRoleId = existing?.ID ?? null;
    }

    if (adminRoleId) {
      const { error: erErr } = await supabase
        .from("EMPLOYEE_ROLE")
        .insert([{ EMPLOYEE_ID: employeeId, ROLE_ID: adminRoleId, ASSIGNED_BY: employeeId }]);
      if (erErr) console.error("[SIGNUP][EMPLOYEE_ROLE]", erErr.message);
    } else {
      console.error("[SIGNUP][EMPLOYEE_ROLE] Administrator-Rolle nicht gefunden — User ohne Rolle!");
    }
  } catch (e) {
    console.error("[SIGNUP][RBAC_SEED]", e?.message || e);
  }
}

module.exports = (supabase) => {
  const router = express.Router();

  // ── Login ─────────────────────────────────────────────────────────────────
  // Validates EMPLOYEE.MAIL + EMPLOYEE.PASSWORD and issues a JWT.
  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "E-Mail ist erforderlich." });
    }

    const { data: employee, error: empErr } = await supabase
      .from("EMPLOYEE")
      .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME, PASSWORD, TENANT_ID, MAIL, ACTIVE, DASHBOARD_ROLE")
      .ilike("MAIL", email.trim())
      .maybeSingle();

    if (empErr) return res.status(500).json({ error: "Fehler beim Laden des Benutzers." });
    if (!employee) return res.status(401).json({ error: "E-Mail oder Passwort falsch." });

    if (employee.ACTIVE === 2) {
      return res.status(403).json({ error: "Dieser Benutzer ist inaktiv. Bitte Administrator kontaktieren." });
    }

    const stored = employee.PASSWORD || null;
    if (stored) {
      const valid = stored.startsWith("$2")
        ? await bcrypt.compare(password || "", stored)
        : stored === (password || "");
      if (!valid) return res.status(401).json({ error: "E-Mail oder Passwort falsch." });
    }
    // If stored is null (no password set), login is allowed — employee should set a password after first login.

    const tenantId = employee.TENANT_ID;
    if (!tenantId) {
      return res.status(403).json({ error: "Kein Mandant zugewiesen. Bitte Administrator kontaktieren." });
    }

    const token = issueToken({
      employee_id: employee.ID,
      tenant_id:   tenantId,
      email:       employee.MAIL,
      short_name:  employee.SHORT_NAME,
    });

    let companyName = null;
    const { data: company } = await supabase
      .from("COMPANY")
      .select("COMPANY_NAME_1")
      .eq("TENANT_ID", tenantId)
      .limit(1)
      .maybeSingle();
    companyName = company?.COMPANY_NAME_1 ?? null;

    return res.json({
      token,
      employee_id:    employee.ID,
      tenant_id:      tenantId,
      email:          employee.MAIL,
      short_name:     employee.SHORT_NAME,
      company_name:   companyName,
      dashboard_role: employee.DASHBOARD_ROLE ?? null,
    });
  });

  // ── Current user ──────────────────────────────────────────────────────────
  router.get("/me", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Nicht authentifiziert" });

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret());
    } catch {
      return res.status(401).json({ error: "Ungültiger Token" });
    }

    const { data: employee } = await supabase
      .from("EMPLOYEE")
      .select("ID, SHORT_NAME, MAIL, TENANT_ID")
      .eq("ID", decoded.employee_id)
      .eq("TENANT_ID", decoded.tenant_id)
      .maybeSingle();

    if (!employee) return res.status(401).json({ error: "Benutzer nicht gefunden." });

    let companyName = null;
    const { data: company } = await supabase
      .from("COMPANY")
      .select("COMPANY_NAME_1")
      .eq("TENANT_ID", employee.TENANT_ID)
      .limit(1)
      .maybeSingle();
    companyName = company?.COMPANY_NAME_1 ?? null;

    return res.json({
      employee_id:  employee.ID,
      tenant_id:    employee.TENANT_ID,
      email:        employee.MAIL,
      short_name:   employee.SHORT_NAME,
      company_name: companyName,
    });
  });

  // ── Change password ───────────────────────────────────────────────────────
  router.patch("/me/password", passwordLimiter, async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Nicht authentifiziert" });

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret());
    } catch {
      return res.status(401).json({ error: "Ungültiger Token" });
    }

    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Aktuelles und neues Passwort sind erforderlich." });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
    }

    const { data: employee } = await supabase
      .from("EMPLOYEE")
      .select("ID, PASSWORD")
      .eq("ID", decoded.employee_id)
      .maybeSingle();

    if (!employee) return res.status(404).json({ error: "Benutzer nicht gefunden." });

    const stored = employee.PASSWORD || "";
    const valid = stored.startsWith("$2") && await bcrypt.compare(current_password, stored);
    if (!valid) return res.status(401).json({ error: "Aktuelles Passwort ist falsch." });

    const hashed = await bcrypt.hash(new_password, 10);
    const { error: updErr } = await supabase
      .from("EMPLOYEE")
      .update({ PASSWORD: hashed })
      .eq("ID", decoded.employee_id);

    if (updErr) return res.status(500).json({ error: updErr.message });
    return res.json({ success: true });
  });

  // ── Password reset request ────────────────────────────────────────────────
  router.post("/reset-request", resetRequestLimiter, async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "E-Mail ist erforderlich." });

    const { data: employee } = await supabase
      .from("EMPLOYEE")
      .select("ID, MAIL, PASSWORD")
      .ilike("MAIL", email.trim())
      .maybeSingle();

    if (!employee) {
      return res.json({ success: true });
    }

    const resetToken = jwt.sign(
      { employee_id: employee.ID, email: employee.MAIL, purpose: "reset", pv: pwdFingerprint(employee.PASSWORD) },
      jwtSecret(),
      { expiresIn: "1h" }
    );
    const baseUrl  = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    const mailer = createMailer();
    if (mailer) {
      const from = process.env.SMTP_FROM || process.env.SMTP_USER;
      try {
        await mailer.sendMail({
          from,
          to:      employee.MAIL,
          subject: "PlaIn – Passwort zurücksetzen",
          text:    `Klicken Sie auf folgenden Link, um Ihr Passwort zurückzusetzen (gültig 1 Stunde):\n\n${resetUrl}`,
          html:    `<p>Klicken Sie auf folgenden Link, um Ihr Passwort zurückzusetzen (gültig 1 Stunde):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
        });
      } catch (mailErr) {
        console.error("[PASSWORD RESET] Mail error:", mailErr.message);
        return res.status(500).json({ error: "E-Mail konnte nicht gesendet werden. Bitte Administrator kontaktieren." });
      }
    } else {
      // No SMTP configured — log to console for admin retrieval
      console.log(`[PASSWORD RESET] ${employee.MAIL}: ${resetUrl}`);
      return res.status(500).json({ error: "E-Mail-Versand nicht konfiguriert. Bitte Administrator kontaktieren." });
    }

    return res.json({ success: true });
  });

  // ── Password reset confirm ────────────────────────────────────────────────
  router.post("/reset-confirm", resetConfirmLimiter, async (req, res) => {
    const { token, new_password } = req.body || {};
    if (!token || !new_password) {
      return res.status(400).json({ error: "Token und neues Passwort sind erforderlich." });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret());
    } catch {
      return res.status(400).json({ error: "Link ist ungültig oder abgelaufen." });
    }
    if (decoded.purpose !== "reset") {
      return res.status(400).json({ error: "Ungültiger Link." });
    }

    // One-Time-Schutz: Fingerprint muss zum AKTUELLEN Passwort passen. Wurde der
    // Link schon benutzt (Passwort geändert), schlägt das fehl -> kein Replay.
    const { data: emp } = await supabase
      .from("EMPLOYEE")
      .select("ID, PASSWORD")
      .eq("ID", decoded.employee_id)
      .maybeSingle();
    if (!emp) {
      return res.status(400).json({ error: "Link ist ungültig oder abgelaufen." });
    }
    if (decoded.pv !== pwdFingerprint(emp.PASSWORD)) {
      return res.status(400).json({ error: "Dieser Link wurde bereits verwendet oder ist nicht mehr gültig." });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    const { error: updErr } = await supabase
      .from("EMPLOYEE")
      .update({ PASSWORD: hashed })
      .eq("ID", decoded.employee_id);

    if (updErr) return res.status(500).json({ error: updErr.message });
    return res.json({ success: true });
  });

  // ── Sign up ───────────────────────────────────────────────────────────────
  // Creates a new tenant: TENANT + COMPANY + Supabase Auth user + first EMPLOYEE.
  router.post("/signup", signupLimiter, async (req, res) => {
    try {
      const { email, password, companyName, shortName } = req.body || {};

      if (!email || !password || !companyName || !shortName) {
        return res.status(400).json({ error: "E-Mail, Passwort, Firmenname und Kürzel sind erforderlich." });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
      }

      // 1. Create Supabase Auth user (email auto-confirmed)
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authError) return res.status(400).json({ error: authError.message || String(authError) || "Auth-Benutzer konnte nicht erstellt werden." });
      const userId = authData.user.id;

      // 2. Create TENANTS record
      const { data: tenant, error: tenantError } = await supabase
        .from("TENANTS")
        .insert([{ TENANT: companyName }])
        .select("ID")
        .single();

      if (tenantError) {
        await supabase.auth.admin.deleteUser(userId).catch(() => {});
        return res.status(500).json({ error: "Mandant konnte nicht angelegt werden: " + tenantError.message });
      }
      const tenantId = tenant.ID;

      // 3. Create COMPANY record
      await supabase.from("COMPANY").insert([{ COMPANY_NAME_1: companyName, TENANT_ID: tenantId }]);

      // 4. Store tenant_id in Supabase app_metadata (best-effort, non-fatal)
      await supabase.auth.admin.updateUserById(userId, { app_metadata: { tenant_id: tenantId } }).catch((e) => {
        console.error("[SIGNUP][APP_METADATA]", e?.message || e);
      });

      // 5. Create the first EMPLOYEE so they can log in
      const hashedPw = await bcrypt.hash(password, 10);
      const { data: emp, error: empErr } = await supabase.from("EMPLOYEE").insert([{
        MAIL:       email,
        PASSWORD:   hashedPw,
        SHORT_NAME: shortName.trim().toUpperCase(),
        FIRST_NAME: "Administrator",
        LAST_NAME:  "",
        TENANT_ID:  tenantId,
      }]).select("ID").single();
      if (empErr) {
        console.error("[SIGNUP][EMPLOYEE]", empErr.message);
        return res.status(500).json({ error: "Mitarbeiter konnte nicht angelegt werden: " + empErr.message });
      }

      // 6. RBAC: Standard-Rollen fuer den neuen Tenant anlegen + Erst-User als
      // Administrator. Ohne das waere der User komplett ohne Berechtigungen.
      await seedTenantRbacAndAssignAdmin(supabase, tenantId, emp.ID);

      return res.json({ success: true, message: "Konto erstellt. Bitte anmelden." });
    } catch (e) {
      console.error("[SIGNUP]", e?.message || e);
      return res.status(500).json({ error: e?.message || "Unbekannter Fehler beim Registrieren." });
    }
  });

  return router;
};

// Für Tests exponiert (pure Funktion, kein DB-Bezug).
module.exports._pwdFingerprint = pwdFingerprint;
