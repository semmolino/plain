const express    = require("express");
const jwt        = require("jsonwebtoken");
const bcrypt     = require("bcryptjs");
const nodemailer = require("nodemailer");

function createMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function jwtSecret() {
  return process.env.JWT_SECRET || "plain-dev-secret-change-me";
}

function issueToken(payload) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: "8h" });
}

module.exports = (supabase) => {
  const router = express.Router();

  // ── Public config ─────────────────────────────────────────────────────────
  // Returns the Supabase URL + anon key so SignupPage can call the signup API.
  router.get("/config", (req, res) => {
    res.json({
      supabaseUrl:     process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    });
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  // Validates EMPLOYEE.MAIL + EMPLOYEE.PASSWORD and issues a JWT.
  router.post("/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "E-Mail und Passwort sind erforderlich." });
    }

    const { data: employee, error: empErr } = await supabase
      .from("EMPLOYEE")
      .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME, PASSWORD, TENANT_ID, MAIL")
      .ilike("MAIL", email.trim())
      .maybeSingle();

    if (empErr) return res.status(500).json({ error: "Fehler beim Laden des Benutzers." });
    if (!employee) return res.status(401).json({ error: "E-Mail oder Passwort falsch." });

    const stored = employee.PASSWORD || "";
    let valid = false;
    if (stored.startsWith("$2")) {
      valid = await bcrypt.compare(password, stored);
    } else {
      valid = stored === password;
    }

    if (!valid) return res.status(401).json({ error: "E-Mail oder Passwort falsch." });

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
      employee_id:  employee.ID,
      tenant_id:    tenantId,
      email:        employee.MAIL,
      short_name:   employee.SHORT_NAME,
      company_name: companyName,
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
  router.patch("/me/password", async (req, res) => {
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
    let valid = false;
    if (stored.startsWith("$2")) {
      valid = await bcrypt.compare(current_password, stored);
    } else {
      valid = stored === current_password;
    }
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
  router.post("/reset-request", async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "E-Mail ist erforderlich." });

    const { data: employee } = await supabase
      .from("EMPLOYEE")
      .select("ID, MAIL")
      .ilike("MAIL", email.trim())
      .maybeSingle();

    if (!employee) {
      return res.status(404).json({ error: "Diese E-Mail-Adresse ist nicht registriert." });
    }

    const resetToken = jwt.sign(
      { employee_id: employee.ID, email: employee.MAIL, purpose: "reset" },
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
  router.post("/reset-confirm", async (req, res) => {
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
  router.post("/signup", async (req, res) => {
    const { email, password, companyName } = req.body || {};

    if (!email || !password || !companyName) {
      return res.status(400).json({ error: "E-Mail, Passwort und Firmenname sind erforderlich." });
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
    if (authError) return res.status(400).json({ error: authError.message });
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

    // 4. Store tenant_id in Supabase app_metadata
    await supabase.auth.admin.updateUserById(userId, { app_metadata: { tenant_id: tenantId } });

    // 5. Create the first EMPLOYEE (admin user) so they can log in with EMPLOYEE credentials
    const shortName = email.split("@")[0].slice(0, 10).toUpperCase();
    const hashedPw  = await bcrypt.hash(password, 10);
    await supabase.from("EMPLOYEE").insert([{
      MAIL:       email,
      PASSWORD:   hashedPw,
      SHORT_NAME: shortName,
      FIRST_NAME: "Administrator",
      LAST_NAME:  "",
      TENANT_ID:  tenantId,
    }]).catch(() => {});

    return res.json({ success: true, message: "Konto erstellt. Bitte anmelden." });
  });

  return router;
};
