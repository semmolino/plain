const express      = require("express");
const bcrypt       = require("bcryptjs");
const balanceSvc   = require("../services/employeeBalance");
const { requirePermission } = require("../middleware/permissions");

// Returns an error message string if a duplicate is found, otherwise null.
// excludeId: skip this employee ID (used on update to ignore self).
async function checkEmployeeDuplicates(supabase, tenantId, { short_name, personnel_number, email }, excludeId = null) {
  let q = supabase
    .from("EMPLOYEE")
    .select("ID, SHORT_NAME, PERSONNEL_NUMBER, MAIL")
    .eq("TENANT_ID", tenantId);

  if (excludeId != null) q = q.neq("ID", excludeId);

  const { data, error } = await q;
  if (error) return null; // don't block on lookup failure

  for (const emp of data || []) {
    if (short_name && emp.SHORT_NAME && emp.SHORT_NAME.toLowerCase() === short_name.toLowerCase())
      return `Kürzel „${short_name}" wird bereits von einem anderen Mitarbeiter verwendet.`;
    if (personnel_number && emp.PERSONNEL_NUMBER && String(emp.PERSONNEL_NUMBER) === String(personnel_number))
      return `Personalnummer „${personnel_number}" wird bereits von einem anderen Mitarbeiter verwendet.`;
    if (email && emp.MAIL && emp.MAIL.toLowerCase() === email.toLowerCase())
      return `E-Mail „${email}" wird bereits von einem anderen Mitarbeiter verwendet.`;
  }
  return null;
}

module.exports = (supabase) => {
  const router = express.Router();

  // Phase 2+4: Mitarbeiter-Routen erfordern employees.view.
  // Lookup-Ausnahmen (Dropdowns) + "eigene Daten implicit right":
  //   /genders, /, /search        -> Lookups
  //   /:id/balance(/running)      -> eigener Saldo
  //   /:id/work-models            -> eigenes Arbeitszeitmodell
  //   /:id/month-close/:y/:m      -> eigene Monatsabschluss-Daten lesen
  //
  // /:id/cp-rate(s) sind sensibel und erfordern IMMER employees.salary.view
  // (durchgehend, auch fuer eigenen Datensatz — Gehalt ist tabu).
  const VIEW_GUARD   = requirePermission("employees.view");
  const SALARY_GUARD = requirePermission("employees.salary.view");
  const lookupPaths  = new Set(["/genders","/","/search"]);
  // Phase 6: /me und alle /me/* Pfade -- eigenes Profil + eigene Reports/Arbeitszeit
  const meRegex = /^\/me(?:\/|$)/;

  function isOwn(req, id) {
    return parseInt(id, 10) === req.employeeId;
  }

  router.use((req, res, next) => {
    if (lookupPaths.has(req.path)) return next();
    if (meRegex.test(req.path)) return next();

    // Salary (cp-rate / cp-rates): GET -> salary.view, mutationen werden
    // bereits an den Endpoints mit salary.edit gegated.
    const cpr = req.path.match(/^\/(\d+)\/(cp-rate|cp-rates)$/);
    if (cpr && req.method === "GET") {
      return SALARY_GUARD(req, res, next);
    }

    // Own-data implicit right:
    const mBal = req.path.match(/^\/(\d+)\/balance/);
    if (mBal && isOwn(req, mBal[1])) return next();
    const mWm = req.path.match(/^\/(\d+)\/work-models$/);
    if (mWm && req.method === "GET" && isOwn(req, mWm[1])) return next();
    const mMc = req.path.match(/^\/(\d+)\/month-close\//);
    if (mMc && req.method === "GET" && isOwn(req, mMc[1])) return next();

    return VIEW_GUARD(req, res, next);
  });

  // GET /api/mitarbeiter/genders
  router.get("/genders", async (req, res) => {
    const { data, error } = await supabase
      .from("GENDER")
      .select("ID, GENDER"); // uppercase names

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // ── /me Endpoints (Phase 6) — eigene Daten ohne employees.view ───────────

  router.get("/me", async (req, res) => {
    const { data, error } = await supabase
      .from("EMPLOYEE")
      .select("ID, SHORT_NAME, TITLE, FIRST_NAME, LAST_NAME, MAIL, MOBILE, PERSONNEL_NUMBER, GENDER_ID, DEPARTMENT_ID, ACTIVE, DASHBOARD_ROLE")
      .eq("ID", req.employeeId)
      .eq("TENANT_ID", req.tenantId)
      .maybeSingle();
    if (error || !data) return res.status(404).json({ error: error?.message || "Profil nicht gefunden" });
    res.json({ data });
  });

  router.get("/me/work-models", async (req, res) => {
    const { data, error } = await supabase
      .from("EMPLOYEE_WORK_MODEL")
      .select("ID, MODEL_ID, VALID_FROM")
      .eq("EMPLOYEE_ID", req.employeeId)
      .eq("TENANT_ID", req.tenantId)
      .order("VALID_FROM", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  router.get("/me/balance", async (req, res) => {
    try {
      const year  = parseInt(req.query.year  || new Date().getFullYear(), 10);
      const month = parseInt(req.query.month || (new Date().getMonth() + 1), 10);
      const r = await balanceSvc.calculateMonthBalance(supabase, req.tenantId, req.employeeId, year, month);
      res.json({ data: r });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/me/balance/running", async (req, res) => {
    try {
      const r = await balanceSvc.calculateRunningBalance(supabase, req.tenantId, req.employeeId);
      res.json({ data: r });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/me/achievements", async (req, res) => {
    try {
      const svc = require("../services/achievements");
      const r = await svc.evaluateAndList(supabase, { tenantId: req.tenantId, employeeId: req.employeeId });
      res.json({ data: r });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/me/streak", async (req, res) => {
    try {
      const streakSvc = require("../services/streaks");
      const r = await streakSvc.calculateStreak(supabase, { tenantId: req.tenantId, employeeId: req.employeeId });
      res.json({ data: r });
    } catch (e) {
      res.status(e?.status || 500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/me/arbzg-audit", async (req, res) => {
    const { data, error } = await supabase
      .from("ARBZG_AUDIT")
      .select("*")
      .eq("EMPLOYEE_ID", req.employeeId)
      .eq("TENANT_ID", req.tenantId)
      .order("DATE_DAY", { ascending: false })
      .limit(500);
    if (error) {
      if (/does not exist/i.test(error.message)) return res.json({ data: [] });
      return res.status(500).json({ error: error.message });
    }
    res.json({ data: data || [] });
  });

  // POST /api/mitarbeiter
  router.post("/", requirePermission("employees.create"), async (req, res) => {
    const body = req.body;
    if (!body.short_name || !body.first_name || !body.last_name || !body.gender_id) {
      return res.status(400).json({ error: "Pflichtfelder fehlen" });
    }

    // Uniqueness check within tenant
    const dupConflict = await checkEmployeeDuplicates(supabase, req.tenantId, {
      short_name: body.short_name,
      personnel_number: body.personnel_number,
      email: body.email,
    });
    if (dupConflict) return res.status(409).json({ error: dupConflict });

    const hashedPassword = body.password ? await bcrypt.hash(body.password, 10) : null;

    const { data, error } = await supabase
      .from("EMPLOYEE")
      .insert([{
        "SHORT_NAME": body.short_name,
        "TITLE": body.title,
        "FIRST_NAME": body.first_name,
        "LAST_NAME": body.last_name,
        "PASSWORD": hashedPassword,
        "MAIL": body.email,
        "MOBILE": body.mobile,
        "PERSONNEL_NUMBER": body.personnel_number,
        "GENDER_ID": body.gender_id,
        "ACTIVE": 1,
        "TENANT_ID": req.tenantId ?? null,
      }])
      .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME, MAIL, GENDER_ID, ACTIVE")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // RBAC Phase 0: neuen Mitarbeiter der Default-Rolle des Tenants zuweisen
    // (soft-fail wenn Migration 0062 noch nicht durch)
    try {
      const { data: defRole } = await supabase
        .from("USER_ROLE")
        .select("ID")
        .eq("TENANT_ID", req.tenantId)
        .eq("IS_DEFAULT", true)
        .maybeSingle();
      if (defRole?.ID && data?.ID) {
        await supabase.from("EMPLOYEE_ROLE").insert([{
          EMPLOYEE_ID: data.ID,
          ROLE_ID:     defRole.ID,
          ASSIGNED_BY: req.employeeId || null,
        }]);
      }
    } catch (_) { /* ignore: Migration 0062 evtl. fehlt */ }

    res.json({ data });
  });

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("EMPLOYEE")
    .select("ID, SHORT_NAME")
    .eq("TENANT_ID", req.tenantId)
    .order("SHORT_NAME", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});



  // List EMPLOYEE (for Mitarbeiterliste)
  // GET /api/mitarbeiter/list?limit=2000
  router.get("/list", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "2000", 10) || 2000, 5000);

    const { data: employees, error: empErr } = await supabase
      .from("EMPLOYEE")
      .select("ID, SHORT_NAME, TITLE, FIRST_NAME, LAST_NAME, MAIL, MOBILE, PERSONNEL_NUMBER, GENDER_ID, DEPARTMENT_ID, ACTIVE, DASHBOARD_ROLE")
      .eq("TENANT_ID", req.tenantId)
      .order("SHORT_NAME", { ascending: true })
      .limit(limit);

    if (empErr) return res.status(500).json({ error: empErr.message });

    const today = new Date().toISOString().slice(0, 10);
    const [genderRes, deptRes, wmaRes] = await Promise.all([
      supabase.from("GENDER").select("ID, GENDER"),
      supabase.from("PROJECT_DEPARTMENT").select("ID, NAME_SHORT").eq("TENANT_ID", req.tenantId),
      supabase.from("EMPLOYEE_WORK_MODEL").select("EMPLOYEE_ID, MODEL_ID, VALID_FROM")
        .eq("TENANT_ID", req.tenantId).lte("VALID_FROM", today),
    ]);

    if (genderRes.error) return res.status(500).json({ error: genderRes.error.message });

    const genMap  = new Map((genderRes.data  || []).map(g => [String(g.ID), g.GENDER]));
    const deptMap = new Map((deptRes.data    || []).map(d => [String(d.ID), d.NAME_SHORT]));

    // Find most recent model per employee
    const currentModelByEmp = new Map();
    for (const wm of wmaRes.data || []) {
      const existing = currentModelByEmp.get(wm.EMPLOYEE_ID);
      if (!existing || wm.VALID_FROM > existing.VALID_FROM) {
        currentModelByEmp.set(wm.EMPLOYEE_ID, wm);
      }
    }

    // Fetch WTM names
    const modelIds = [...new Set([...currentModelByEmp.values()].map(v => v.MODEL_ID))];
    let wtmMap = new Map();
    if (modelIds.length > 0) {
      const { data: wtms } = await supabase.from("WORKING_TIME_MODEL").select("ID, NAME").in("ID", modelIds);
      wtmMap = new Map((wtms || []).map(m => [m.ID, m.NAME]));
    }

    const normalized = (employees || []).map(e => ({
      ...e,
      GENDER:              genMap.get(String(e.GENDER_ID)) || "",
      DEPARTMENT_NAME:     deptMap.get(String(e.DEPARTMENT_ID)) || "",
      NAME:                `${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`.trim(),
      CURRENT_MODEL_ID:    currentModelByEmp.get(e.ID)?.MODEL_ID ?? null,
      CURRENT_MODEL_NAME:  wtmMap.get(currentModelByEmp.get(e.ID)?.MODEL_ID) ?? "",
    }));

    res.json({ data: normalized });
  });

  // DELETE /api/mitarbeiter/:id
  router.delete("/:id", requirePermission("employees.delete"), async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID fehlt" });
    const { error } = await supabase.from("EMPLOYEE").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Update EMPLOYEE (for Mitarbeiterliste edit modal)
  // PATCH /api/mitarbeiter/:id
  router.patch("/:id", requirePermission("employees.edit"), async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};

    if (!body.short_name || !body.first_name || !body.last_name || !body.gender_id) {
      return res.status(400).json({ error: "Pflichtfelder fehlen" });
    }

    // Uniqueness check within tenant (exclude current employee)
    const dupConflict = await checkEmployeeDuplicates(supabase, req.tenantId, {
      short_name: body.short_name,
      personnel_number: body.personnel_number,
      email: body.mail,
    }, Number(id));
    if (dupConflict) return res.status(409).json({ error: dupConflict });


    const updateObj = {
      SHORT_NAME:       body.short_name,
      TITLE:            body.title || null,
      FIRST_NAME:       body.first_name,
      LAST_NAME:        body.last_name,
      MAIL:             body.mail || null,
      MOBILE:           body.mobile || null,
      PERSONNEL_NUMBER: body.personnel_number || null,
      GENDER_ID:        body.gender_id,
      DEPARTMENT_ID:  body.department_id != null && body.department_id !== '' ? Number(body.department_id) : null,
      ACTIVE:         body.active != null ? Number(body.active) : undefined,
      DASHBOARD_ROLE: body.dashboard_role !== undefined ? (body.dashboard_role || null) : undefined,
    };

    const { data: upd, error: updErr } = await supabase
      .from("EMPLOYEE")
      .update(updateObj)
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .select("ID, SHORT_NAME, TITLE, FIRST_NAME, LAST_NAME, MAIL, MOBILE, PERSONNEL_NUMBER, GENDER_ID, DASHBOARD_ROLE")
      .single();

    if (updErr) return res.status(500).json({ error: updErr.message });

    const { data: genders, error: genErr } = await supabase.from("GENDER").select("ID, GENDER");
    if (genErr) return res.status(500).json({ error: genErr.message });
    const genMap = new Map((genders || []).map(g => [String(g.ID), g.GENDER]));

    res.json({
      data: {
        ...upd,
        GENDER: genMap.get(String(upd.GENDER_ID)) || "",
        NAME: `${upd.FIRST_NAME || ""} ${upd.LAST_NAME || ""}`.trim(),
      },
    });
  });


// ── Month-close overview (must be before /:id routes) ─────────────────────────
// GET /mitarbeiter/month-close-overview
router.get("/month-close-overview", requirePermission("employees.bookings.view_all"), async (req, res) => {
  const { data: employees, error: empErr } = await supabase
    .from("EMPLOYEE")
    .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME")
    .eq("TENANT_ID", req.tenantId)
    .neq("ACTIVE", 2)
    .order("SHORT_NAME", { ascending: true });
  if (empErr) return res.status(500).json({ error: empErr.message });

  // Rolling last 6 months (oldest first)
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const { data: closes, error: closeErr } = await supabase
    .from("EMPLOYEE_MONTH_CLOSE")
    .select("EMPLOYEE_ID, YEAR, MONTH, CLOSED_AT")
    .eq("TENANT_ID", req.tenantId);
  if (closeErr) return res.status(500).json({ error: closeErr.message });

  const closeMap = new Map();
  for (const c of closes || []) {
    closeMap.set(`${c.EMPLOYEE_ID}-${c.YEAR}-${c.MONTH}`, c.CLOSED_AT);
  }

  const data = (employees || []).map(e => ({
    ...e,
    months: months.map(m => ({
      ...m,
      closed:    closeMap.has(`${e.ID}-${m.year}-${m.month}`),
      closed_at: closeMap.get(`${e.ID}-${m.year}-${m.month}`) ?? null,
    })),
  }));

  res.json({ data, months });
});

// Search EMPLOYEE by SHORT_NAME / FIRST_NAME / LAST_NAME
// GET /api/mitarbeiter/search?q=...
router.get("/search", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q || q.length < 2) return res.json({ data: [] });

  const { data, error } = await supabase
    .from("EMPLOYEE")
    .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME")
    .eq("TENANT_ID", req.tenantId)
    .or(`SHORT_NAME.ilike.%${q}%,FIRST_NAME.ilike.%${q}%,LAST_NAME.ilike.%${q}%`)
    .order("SHORT_NAME", { ascending: true })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});

// ── Work-model assignments ─────────────────────────────────────────────────────

router.get("/:id/work-models", async (req, res) => {
  const empId = Number(req.params.id);
  const { data: assignments, error } = await supabase
    .from("EMPLOYEE_WORK_MODEL")
    .select("ID, MODEL_ID, VALID_FROM")
    .eq("TENANT_ID", req.tenantId)
    .eq("EMPLOYEE_ID", empId)
    .order("VALID_FROM", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  if (!assignments || !assignments.length) return res.json({ data: [] });

  const modelIds = [...new Set(assignments.map(a => a.MODEL_ID))];
  const { data: models, error: mErr } = await supabase
    .from("WORKING_TIME_MODEL")
    .select("ID, NAME, COUNTRY_CODE, STATE_CODE, MON, TUE, WED, THU, FRI, SAT, SUN")
    .in("ID", modelIds);
  if (mErr) return res.status(500).json({ error: mErr.message });

  const modelMap = new Map((models || []).map(m => [m.ID, m]));
  res.json({ data: assignments.map(a => ({ ...a, model: modelMap.get(a.MODEL_ID) ?? null })) });
});

router.post("/:id/work-models", requirePermission("employees.edit"), async (req, res) => {
  const empId = Number(req.params.id);
  const { model_id, valid_from } = req.body;
  if (!model_id || !valid_from) return res.status(400).json({ error: 'model_id und valid_from sind Pflichtfelder' });
  const { data, error } = await supabase
    .from("EMPLOYEE_WORK_MODEL")
    .insert([{ TENANT_ID: req.tenantId, EMPLOYEE_ID: empId, MODEL_ID: Number(model_id), VALID_FROM: valid_from }])
    .select("ID, MODEL_ID, VALID_FROM")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});

router.patch("/:id/work-models/:wid", requirePermission("employees.edit"), async (req, res) => {
  const wid   = Number(req.params.wid);
  const empId = Number(req.params.id);
  const { model_id, valid_from } = req.body;
  const update = {};
  if (model_id)    update.MODEL_ID    = Number(model_id);
  if (valid_from)  update.VALID_FROM  = valid_from;
  const { data, error } = await supabase
    .from("EMPLOYEE_WORK_MODEL")
    .update(update)
    .eq("ID", wid)
    .eq("EMPLOYEE_ID", empId)
    .eq("TENANT_ID", req.tenantId)
    .select("ID, MODEL_ID, VALID_FROM")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});

router.delete("/:id/work-models/:wid", requirePermission("employees.edit"), async (req, res) => {
  const wid   = Number(req.params.wid);
  const empId = Number(req.params.id);
  const { error } = await supabase
    .from("EMPLOYEE_WORK_MODEL")
    .delete()
    .eq("ID", wid)
    .eq("EMPLOYEE_ID", empId)
    .eq("TENANT_ID", req.tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── CP-rate lookup for a specific date ────────────────────────────────────────
// GET /mitarbeiter/:id/cp-rate?date=YYYY-MM-DD
router.get("/:id/cp-rate", async (req, res) => {
  const empId = Number(req.params.id);
  const date  = String(req.query.date || new Date().toISOString().slice(0, 10));
  const { data } = await supabase
    .from("EMPLOYEE_CP_RATE")
    .select("CP_RATE")
    .eq("TENANT_ID", req.tenantId)
    .eq("EMPLOYEE_ID", empId)
    .lte("VALID_FROM", date)
    .order("VALID_FROM", { ascending: false })
    .limit(1);
  const found = data && data.length > 0;
  res.json({ data: { rate: found ? Number(data[0].CP_RATE) : 0, found: !!found } });
});

// ── CP-rate history ────────────────────────────────────────────────────────────

router.get("/:id/cp-rates", async (req, res) => {
  const empId = Number(req.params.id);
  const { data, error } = await supabase
    .from("EMPLOYEE_CP_RATE")
    .select("ID, CP_RATE, VALID_FROM")
    .eq("TENANT_ID", req.tenantId)
    .eq("EMPLOYEE_ID", empId)
    .order("VALID_FROM", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data || [] });
});

router.post("/:id/cp-rates", requirePermission("employees.salary.edit"), async (req, res) => {
  const empId = Number(req.params.id);
  const { cp_rate, valid_from } = req.body;
  if (cp_rate == null || !valid_from) return res.status(400).json({ error: 'cp_rate und valid_from sind Pflichtfelder' });
  const { data, error } = await supabase
    .from("EMPLOYEE_CP_RATE")
    .insert([{ TENANT_ID: req.tenantId, EMPLOYEE_ID: empId, CP_RATE: Number(cp_rate), VALID_FROM: valid_from }])
    .select("ID, CP_RATE, VALID_FROM")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});

router.patch("/:id/cp-rates/:rid", requirePermission("employees.salary.edit"), async (req, res) => {
  const rid   = Number(req.params.rid);
  const empId = Number(req.params.id);
  const { cp_rate, valid_from } = req.body;
  const update = {};
  if (cp_rate != null)  update.CP_RATE    = Number(cp_rate);
  if (valid_from)       update.VALID_FROM = valid_from;
  const { data, error } = await supabase
    .from("EMPLOYEE_CP_RATE")
    .update(update)
    .eq("ID", rid)
    .eq("EMPLOYEE_ID", empId)
    .eq("TENANT_ID", req.tenantId)
    .select("ID, CP_RATE, VALID_FROM")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});

router.delete("/:id/cp-rates/:rid", requirePermission("employees.salary.edit"), async (req, res) => {
  const rid   = Number(req.params.rid);
  const empId = Number(req.params.id);
  const { error } = await supabase
    .from("EMPLOYEE_CP_RATE")
    .delete()
    .eq("ID", rid)
    .eq("EMPLOYEE_ID", empId)
    .eq("TENANT_ID", req.tenantId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Admin: set / clear employee password ─────────────────────────────────────
// PATCH /mitarbeiter/:id/set-password
// Body: { new_password: string } or { new_password: null } to clear
router.patch("/:id/set-password", requirePermission("employees.password.set"), async (req, res) => {
  const id = Number(req.params.id);
  const { new_password } = req.body || {};

  if (new_password !== null && new_password !== undefined && typeof new_password === 'string' && new_password.length > 0 && new_password.length < 8) {
    return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
  }

  let hashed = null;
  if (new_password && typeof new_password === 'string' && new_password.length >= 8) {
    hashed = await bcrypt.hash(new_password, 10);
  }

  const { error } = await supabase
    .from("EMPLOYEE")
    .update({ PASSWORD: hashed })
    .eq("ID", id)
    .eq("TENANT_ID", req.tenantId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Month-close per employee ───────────────────────────────────────────────────

router.get("/:id/month-close/:year/:month", async (req, res) => {
  const empId = Number(req.params.id);
  const year  = Number(req.params.year);
  const month = Number(req.params.month);
  const { data, error } = await supabase
    .from("EMPLOYEE_MONTH_CLOSE")
    .select("ID, YEAR, MONTH, CLOSED_AT, CLOSED_BY")
    .eq("TENANT_ID", req.tenantId)
    .eq("EMPLOYEE_ID", empId)
    .eq("YEAR", year)
    .eq("MONTH", month)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data ?? null });
});

router.post("/:id/month-close", requirePermission("employees.month_close.edit"), async (req, res) => {
  const empId = Number(req.params.id);
  const { year, month } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: "year und month sind Pflichtfelder" });
  const { data, error } = await supabase
    .from("EMPLOYEE_MONTH_CLOSE")
    .upsert([{
      TENANT_ID:   req.tenantId,
      EMPLOYEE_ID: empId,
      YEAR:        Number(year),
      MONTH:       Number(month),
      CLOSED_AT:   new Date().toISOString(),
      CLOSED_BY:   req.employeeId,
    }], { onConflict: "TENANT_ID,EMPLOYEE_ID,YEAR,MONTH" })
    .select("ID, YEAR, MONTH, CLOSED_AT, CLOSED_BY")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});

router.delete("/:id/month-close/:year/:month", requirePermission("employees.month_close.edit"), async (req, res) => {
  const empId = Number(req.params.id);
  const year  = Number(req.params.year);
  const month = Number(req.params.month);
  const { error } = await supabase
    .from("EMPLOYEE_MONTH_CLOSE")
    .delete()
    .eq("TENANT_ID", req.tenantId)
    .eq("EMPLOYEE_ID", empId)
    .eq("YEAR", year)
    .eq("MONTH", month);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Employee list report ───────────────────────────────────────────────────────
// GET /mitarbeiter/report-list?mode=now|as_of|period&as_of_date=&date_from=&date_to=&employee_id=
router.get("/report-list", requirePermission("employees.bookings.view_all"), async (req, res) => {
  const mode       = req.query.mode       || 'now';
  const asOfDate   = req.query.as_of_date || null;
  const dateFrom   = req.query.date_from  || null;
  const dateTo     = req.query.date_to    || null;
  const employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;
  try {
    const rows = await balanceSvc.buildEmployeeReportList(supabase, req.tenantId, { mode, asOfDate, dateFrom, dateTo, employeeId });
    res.json({ data: rows });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
});

// ── Balance / Reporting ────────────────────────────────────────────────────────

router.get("/:id/balance", async (req, res) => {
  const empId = Number(req.params.id);
  const year  = parseInt(req.query.year  || new Date().getFullYear(), 10);
  const month = parseInt(req.query.month || (new Date().getMonth() + 1), 10);
  try {
    const result = await balanceSvc.calculateMonthBalance(supabase, req.tenantId, empId, year, month);
    res.json({ data: result });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
});

router.get("/:id/balance/running", async (req, res) => {
  const empId = Number(req.params.id);
  try {
    const result = await balanceSvc.calculateRunningBalance(supabase, req.tenantId, empId);
    res.json({ data: result });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
});

  return router;
};
