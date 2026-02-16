const express = require("express");

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

    const { data, error } = await supabase
      .from("EMPLOYEE")
      .insert([{
        "SHORT_NAME": body.short_name,
        "TITLE": body.title,
        "FIRST_NAME": body.first_name,
        "LAST_NAME": body.last_name,
        "PASSWORD": body.password,
        // EMPLOYEE schema uses MAIL (not EMAIL)
        "MAIL": body.email,
        "MOBILE": body.mobile,
        "PERSONNEL_NUMBER": body.personnel_number,
        "GENDER_ID": body.gender_id
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
      .select("ID, SHORT_NAME, TITLE, FIRST_NAME, LAST_NAME, MAIL, MOBILE, PERSONNEL_NUMBER, GENDER_ID")
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

  // Update EMPLOYEE (for Mitarbeiterliste edit modal)
  // PATCH /api/mitarbeiter/:id
  router.patch("/:id", async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};

    if (!body.short_name || !body.first_name || !body.last_name || !body.gender_id) {
      return res.status(400).json({ error: "Pflichtfelder fehlen" });
    }

    const updateObj = {
      SHORT_NAME: body.short_name,
      TITLE: body.title || null,
      FIRST_NAME: body.first_name,
      LAST_NAME: body.last_name,
      MAIL: body.mail || null,
      MOBILE: body.mobile || null,
      PERSONNEL_NUMBER: body.personnel_number || null,
      GENDER_ID: body.gender_id,
    };

    const { data: upd, error: updErr } = await supabase
      .from("EMPLOYEE")
      .update(updateObj)
      .eq("ID", id)
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
    .or(`SHORT_NAME.ilike.%${q}%,FIRST_NAME.ilike.%${q}%,LAST_NAME.ilike.%${q}%`)
    .order("SHORT_NAME", { ascending: true })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});


  return router;
};
