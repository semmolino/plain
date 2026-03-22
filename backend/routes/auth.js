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

    // 2. Create TENANTS record (this ID is the authoritative tenant_id)
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

    // 3. Create COMPANY record linked to the new tenant
    const { error: companyError } = await supabase
      .from("COMPANY")
      .insert([{ COMPANY_NAME_1: companyName, TENANT_ID: tenantId }]);

    if (companyError) {
      // Non-fatal — tenant and user are created; log and continue
      console.warn("COMPANY konnte nicht angelegt werden:", companyError.message);
    }

    // 4. Store tenant_id in app_metadata (authoritative — user cannot modify)
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

    const tenantId = user.app_metadata?.tenant_id ?? null;

    // Load company name
    let companyName = null;
    if (tenantId) {
      const { data: company } = await supabase
        .from("COMPANY")
        .select("COMPANY_NAME_1")
        .eq("TENANT_ID", tenantId)
        .limit(1)
        .maybeSingle();
      companyName = company?.COMPANY_NAME_1 ?? null;
    }

    res.json({
      id:          user.id,
      email:       user.email,
      tenantId,
      companyName,
    });
  });

  // ── Update current user ───────────────────────────────────────────────────
  // Allows changing email, password, and/or company name.
  router.patch("/me", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Nicht authentifiziert" });

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: "Ungültiger Token" });

    const { email, password, companyName } = req.body || {};
    const tenantId = user.app_metadata?.tenant_id ?? null;

    // Update auth (email / password)
    const authPatch = {};
    if (email && email !== user.email) authPatch.email = email;
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
      authPatch.password = password;
    }

    if (Object.keys(authPatch).length > 0) {
      const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, authPatch);
      if (updateErr) return res.status(400).json({ error: updateErr.message });
    }

    // Update company name
    if (companyName && tenantId) {
      const trimmed = companyName.trim();
      if (trimmed) {
        await supabase.from("COMPANY").update({ COMPANY_NAME_1: trimmed }).eq("TENANT_ID", tenantId);
        await supabase.from("TENANTS").update({ TENANT: trimmed }).eq("ID", tenantId);
      }
    }

    res.json({ success: true });
  });

  // ── Team: list members ─────────────────────────────────────────────────────
  // Returns all users that share the same tenant_id.
  router.get("/team", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Nicht authentifiziert" });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Ungültiger Token" });

    const tenantId = user.app_metadata?.tenant_id ?? null;
    if (!tenantId) return res.status(403).json({ error: "Kein Mandant zugewiesen." });

    // List all auth users and filter by tenant_id in app_metadata
    const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) return res.status(500).json({ error: listErr.message });

    const members = (users || [])
      .filter(u => u.app_metadata?.tenant_id === tenantId)
      .map(u => ({
        id:         u.id,
        email:      u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        is_self:    u.id === user.id,
      }));

    res.json({ data: members });
  });

  // ── Team: invite a new member ──────────────────────────────────────────────
  // Sends a Supabase invite email; the invited user is pre-assigned to the
  // inviter's tenant so they land in the right workspace on first login.
  router.post("/invite", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Nicht authentifiziert" });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Ungültiger Token" });

    const tenantId = user.app_metadata?.tenant_id ?? null;
    if (!tenantId) return res.status(403).json({ error: "Kein Mandant zugewiesen." });

    const { email } = req.body || {};
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Gültige E-Mail-Adresse ist erforderlich." });
    }

    // Invite via Supabase admin (sends confirmation email automatically)
    const { data: invited, error: invErr } = await supabase.auth.admin.inviteUserByEmail(email);
    if (invErr) return res.status(400).json({ error: invErr.message });

    // Assign the same tenant_id so the invited user lands in the right workspace
    const { error: metaErr } = await supabase.auth.admin.updateUserById(invited.user.id, {
      app_metadata: { tenant_id: tenantId },
    });
    if (metaErr) return res.status(500).json({ error: "Einladung gesendet, aber Mandant konnte nicht gesetzt werden: " + metaErr.message });

    res.json({ success: true, message: `Einladung an ${email} gesendet.` });
  });

  // ── Team: remove a member ──────────────────────────────────────────────────
  router.delete("/team/:userId", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Nicht authentifiziert" });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Ungültiger Token" });

    const tenantId = user.app_metadata?.tenant_id ?? null;
    if (!tenantId) return res.status(403).json({ error: "Kein Mandant zugewiesen." });

    const targetId = req.params.userId;
    if (targetId === user.id) return res.status(400).json({ error: "Sie können sich nicht selbst entfernen." });

    // Verify the target user belongs to the same tenant
    const { data: { user: target }, error: getErr } = await supabase.auth.admin.getUserById(targetId);
    if (getErr || !target) return res.status(404).json({ error: "Benutzer nicht gefunden." });
    if (target.app_metadata?.tenant_id !== tenantId) {
      return res.status(403).json({ error: "Dieser Benutzer gehört nicht zu Ihrem Mandanten." });
    }

    const { error: delErr } = await supabase.auth.admin.deleteUser(targetId);
    if (delErr) return res.status(500).json({ error: delErr.message });

    res.json({ success: true });
  });

  return router;
};
