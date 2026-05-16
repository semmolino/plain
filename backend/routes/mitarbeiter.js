const express = require("express");
const bcrypt  = require("bcryptjs");

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
        "CP_RATE": body.cp_rate != null && body.cp_rate !== '' ? Number(body.cp_rate) : null,
        "TENANT_ID": req.tenantId ?? null,
      }]);

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
      .select("ID, SHORT_NAME, TITLE, FIRST_NAME, LAST_NAME, MAIL, MOBILE, PERSONNEL_NUMBER, GENDER_ID, CP_RATE")
      .eq("TENANT_ID", req.tenantId)
      .order("SHORT_NAME", { ascending: true })
      .limit(limit);

    if (empErr) return res.status(500).json({ error: empErr.message });

    const { data: genders, error: genErr } = await supabase
      .from("GENDER")
      .select("ID, GENDER");

    if (genErr) return res.status(500).json({ error: genErr.message });

    const genMap = new Map((genders || []).map(g => [String(g.ID), g.GENDER]));

    const normalized = (employees || []).map(e => ({
      ...e,
      GENDER: genMap.get(String(e.GENDER_ID)) || "",
      NAME: `${e.FIRST_NAME || ""} ${e.LAST_NAME || ""}`.trim(),
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
      SHORT_NAME: body.short_name,
      TITLE: body.title || null,
      FIRST_NAME: body.first_name,
      LAST_NAME: body.last_name,
      MAIL: body.mail || null,
      MOBILE: body.mobile || null,
      PERSONNEL_NUMBER: body.personnel_number || null,
      GENDER_ID: body.gender_id,
      CP_RATE: body.cp_rate != null && body.cp_rate !== '' ? Number(body.cp_rate) : null,
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
    // Select only columns that exist in the EMPLOYEE table (avoid schema mismatches)
    .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME")
    .eq("TENANT_ID", req.tenantId)
    .or(`SHORT_NAME.ilike.%${q}%,FIRST_NAME.ilike.%${q}%,LAST_NAME.ilike.%${q}%`)
    .order("SHORT_NAME", { ascending: true })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});


  return router;
};
