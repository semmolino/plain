const express = require("express");

module.exports = (supabase) => {
  const router = express.Router();

  // ── Public config ─────────────────────────────────────────────────────────
  // Returns the Supabase URL + anon key so the frontend can initialise its
  // own Supabase client without hardcoding keys in source files.
  router.get("/config", (req, res) => {
    res.json({
      supabaseUrl:     process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    });
  });

  // ── Sign up ───────────────────────────────────────────────────────────────
  // Creates the auth user + a COMPANY record, then stores the company ID as
  // tenant_id in the user's app_metadata (server-side only — clients can't
  // forge this).
  router.post("/signup", async (req, res) => {
    const { email, password, companyName } = req.body || {};

    if (!email || !password || !companyName) {
      return res.status(400).json({ error: "E-Mail, Passwort und Firmenname sind erforderlich." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
    }

    // 1. Create auth user (admin API — email auto-confirmed)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    // 2. Create COMPANY record (this ID becomes the tenant identifier)
    const { data: company, error: companyError } = await supabase
      .from("COMPANY")
      .insert([{ NAME: companyName }])
      .select("ID")
      .single();

    if (companyError) {
      // Best-effort rollback
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
      return res.status(500).json({ error: "Firma konnte nicht angelegt werden: " + companyError.message });
    }

    const tenantId = company.ID;

    // 3. Store tenant_id in app_metadata (authoritative — user cannot modify)
    const { error: metaError } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { tenant_id: tenantId },
    });

    if (metaError) {
      return res.status(500).json({ error: "Benutzerprofil konnte nicht gesetzt werden: " + metaError.message });
    }

    res.json({ success: true, message: "Konto erstellt." });
  });

  // ── Current user ──────────────────────────────────────────────────────────
  // Returns basic info about the authenticated user including their tenantId.
  router.get("/me", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Nicht authentifiziert" });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Ungültiger Token" });

    res.json({
      id:       user.id,
      email:    user.email,
      tenantId: user.app_metadata?.tenant_id ?? null,
    });
  });

  return router;
};
