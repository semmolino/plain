const express      = require("express");
const bcrypt       = require("bcryptjs");
const balanceSvc   = require("../services/employeeBalance");

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

  // POST /api/mitarbeiter
  router.post("/", async (req, res) => {
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
      .select("ID, SHORT_NAME, TITLE, FIRST_NAME, LAST_NAME, MAIL, MOBILE, PERSONNEL_NUMBER, GENDER_ID, DEPARTMENT_ID, ACTIVE")
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
  router.delete("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID fehlt" });
    const { error } = await supabase.from("EMPLOYEE").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Update EMPLOYEE (for Mitarbeiterliste edit modal)
  // PATCH /api/mitarbeiter/:id
  router.patch("/:id", async (req, res) => {
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
      DEPARTMENT_ID:    body.department_id != null && body.department_id !== '' ? Number(body.department_id) : null,
      ACTIVE:           body.active != null ? Number(body.active) : undefined,
    };

    const { data: upd, error: updErr } = await supabase
      .from("EMPLOYEE")
      .update(updateObj)
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId)
      .select("ID, SHORT_NAME, TITLE, FIRST_NAME, LAST_NAME, MAIL, MOBILE, PERSONNEL_NUMBER, GENDER_ID")
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

router.post("/:id/work-models", async (req, res) => {
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

router.patch("/:id/work-models/:wid", async (req, res) => {
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

router.delete("/:id/work-models/:wid", async (req, res) => {
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

router.post("/:id/cp-rates", async (req, res) => {
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

router.patch("/:id/cp-rates/:rid", async (req, res) => {
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

router.delete("/:id/cp-rates/:rid", async (req, res) => {
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
