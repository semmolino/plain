const express = require("express");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/statuses", async (req, res) => {
    const { data, error } = await supabase
      .from("PROJECT_STATUS")
      .select("ID, NAME_SHORT");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  router.get("/types", async (req, res) => {
    const { data, error } = await supabase
      .from("PROJECT_TYPE")
      .select("ID, NAME_SHORT");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  router.get("/managers", async (req, res) => {
    const { data, error } = await supabase
      .from("EMPLOYEE")
      .select("ID, SHORT_NAME"); // uppercase names
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });



  // Active employees for project assignment
  router.get("/employees/active", async (req, res) => {
    // Prefer ACTIVE=1, but some schemas may not have ACTIVE column
    let q = supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME").eq("ACTIVE", 1);
    let { data, error } = await q;
    if (error && String(error.message || "").toLowerCase().includes("active")) {
      // Fallback: load without filter, then filter client-side if ACTIVE exists
      const r = await supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME, ACTIVE");
      data = r.data;
      error = r.error;
      if (!error && Array.isArray(data)) data = data.filter((e) => String(e.ACTIVE) === "1" || e.ACTIVE === true);
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  // Active roles for project assignment
  router.get("/roles/active", async (req, res) => {
    let q = supabase.from("ROLE").select("ID, NAME_SHORT, NAME_LONG").eq("ACTIVE", 1);
    let { data, error } = await q;
    if (error && String(error.message || "").toLowerCase().includes("active")) {
      const r = await supabase.from("ROLE").select("ID, NAME_SHORT, NAME_LONG, ACTIVE");
      data = r.data;
      error = r.error;
      if (!error && Array.isArray(data)) data = data.filter((r0) => String(r0.ACTIVE) === "1" || r0.ACTIVE === true);
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  router.post("/", async (req, res) => {
    const b = req.body;
    if (!b.company_id || !b.name_long || !b.project_status_id || !b.project_manager_id) {
      return res.status(400).json({ error: "Pflichtfelder fehlen" });
    }

    // Invoice address/contact (saved on PROJECT and mirrored to CONTRACT)
    const parsedAddressId = b.address_id !== undefined && b.address_id !== null ? parseInt(b.address_id, 10) : NaN;
    const parsedContactId = b.contact_id !== undefined && b.contact_id !== null ? parseInt(b.contact_id, 10) : NaN;

    if (!parsedAddressId || Number.isNaN(parsedAddressId) || !parsedContactId || Number.isNaN(parsedContactId)) {
      return res.status(400).json({ error: "Rechnungsadresse und Kontakt sind erforderlich" });
    }


    const companyId = parseInt(b.company_id, 10);
    if (!companyId || Number.isNaN(companyId)) {
      return res.status(400).json({ error: "Firma ist erforderlich" });
    }

    // Allocate project number on final create (P-YY-CCC)
    const { data: num, error: numErr } = await supabase.rpc("next_project_number", {
      p_company_id: companyId,
    });
    if (numErr || !num) {
      return res.status(500).json({ error: `Nummernkreis konnte nicht geladen werden: ${numErr?.message || "unknown error"}` });
    }


    let project = null;
    let projectError = null;

    const projectInsertBase = {
      NAME_SHORT: num,
      NAME_LONG: b.name_long,
      COMPANY_ID: companyId,
      PROJECT_STATUS_ID: b.project_status_id,
      PROJECT_TYPE_ID: b.project_type_id || null,
      PROJECT_MANAGER_ID: b.project_manager_id,
      ADDRESS_ID: parsedAddressId,
      CONTACT_ID: parsedContactId,
    };

    const tryInsertProject = async (row) => {
      const r = await supabase
        .from("PROJECT")
        .insert([row])
        .select("ID, NAME_SHORT, NAME_LONG, ADDRESS_ID, CONTACT_ID")
        .single();
      return r;
    };

    // Some schemas may not have PROJECT.COMPANY_ID yet → fallback without it
    {
      const r1 = await tryInsertProject(projectInsertBase);
      project = r1.data;
      projectError = r1.error;

      if (projectError && String(projectError.message || "").includes("COMPANY_ID")) {
        const row2 = { ...projectInsertBase };
        delete row2.COMPANY_ID;
        const r2 = await tryInsertProject(row2);
        project = r2.data;
        projectError = r2.error;
      }
    }

    if (projectError) return res.status(500).json({ error: projectError.message });

    // Create EMPLOYEE2PROJECT rows (optional)
    if (Array.isArray(b.employee2project) && b.employee2project.length) {
      const rows = b.employee2project.map((r0) => ({
        EMPLOYEE_ID: r0.employee_id,
        PROJECT_ID: project.ID,
        ROLE_ID: r0.role_id || null,
        ROLE_NAME_SHORT: r0.role_name_short || "",
        ROLE_NAME_LONG: r0.role_name_long || "",
        SP_RATE: r0.sp_rate === "" || r0.sp_rate === undefined ? null : r0.sp_rate,
      }));

      const { error: e2pErr } = await supabase.from("EMPLOYEE2PROJECT").insert(rows);
      if (e2pErr) {
        return res.status(500).json({
          error: "Projekt wurde gespeichert, aber Mitarbeiter konnten nicht zugeordnet werden: " + (e2pErr.message || e2pErr),
        });
      }
    }



// Create PROJECT_STRUCTURE rows from wizard (optional)
// Expected payload: project_structure: [{ tmp_key, father_tmp_key, NAME_SHORT, NAME_LONG, BILLING_TYPE_ID }]
if (Array.isArray(b.project_structure) && b.project_structure.length) {
  const draft = b.project_structure;

  // Validate uniqueness of tmp_key
  const tmpKeys = new Set();
  for (const n of draft) {
    const tk = String(n.tmp_key || "").trim();
    if (!tk) return res.status(400).json({ error: "PROJECT_STRUCTURE: tmp_key fehlt" });
    if (tmpKeys.has(tk)) return res.status(400).json({ error: "PROJECT_STRUCTURE: tmp_key muss eindeutig sein" });
    tmpKeys.add(tk);
  }

  // First pass: insert all nodes as roots (FATHER_ID null), capture created IDs
  const tmpToId = new Map();
  const insertRows = draft.map((n) => ({
    NAME_SHORT: String(n.NAME_SHORT || "").trim(),
    NAME_LONG: String(n.NAME_LONG || "").trim(),
    PROJECT_ID: project.ID,
    BILLING_TYPE_ID: n.BILLING_TYPE_ID ? parseInt(n.BILLING_TYPE_ID, 10) : null,
    FATHER_ID: null,
    // Keep other fields empty/zero (safer for NOT NULL schemas)
    REVENUE: 0,
    EXTRAS_PERCENT: 0,
    EXTRAS: 0,
    REVENUE_COMPLETION_PERCENT: 0,
    EXTRAS_COMPLETION_PERCENT: 0,
    REVENUE_COMPLETION: 0,
    EXTRAS_COMPLETION: 0,
  }));

  // Ensure billing type is set
  for (let i = 0; i < insertRows.length; i++) {
    if (!insertRows[i].BILLING_TYPE_ID || Number.isNaN(insertRows[i].BILLING_TYPE_ID)) {
      return res.status(400).json({ error: `PROJECT_STRUCTURE: Abrechnungsart fehlt (Zeile ${i + 1})` });
    }
  }

  const { data: createdNodes, error: psErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .insert(insertRows)
    .select("ID, NAME_SHORT, NAME_LONG");

  if (psErr) {
    return res.status(500).json({ error: "Projekt wurde gespeichert, aber Projektstruktur konnte nicht angelegt werden: " + psErr.message });
  }

  // Map tmp_key -> created ID by position (same order as insertRows)
  (createdNodes || []).forEach((row, i) => {
    const tk = String(draft[i].tmp_key || "").trim();
    if (tk) tmpToId.set(tk, row.ID);
  });

  // Second pass: update FATHER_ID where father_tmp_key was provided
  const updates = [];
  draft.forEach((n) => {
    const tk = String(n.tmp_key || "").trim();
    const fk = n.father_tmp_key ? String(n.father_tmp_key).trim() : "";
    if (!fk) return;
    const childId = tmpToId.get(tk);
    const fatherId = tmpToId.get(fk);
    if (!childId || !fatherId) return;
    updates.push({ id: childId, father_id: fatherId });
  });

  for (const u of updates) {
    const { error: uErr } = await supabase.from("PROJECT_STRUCTURE").update({ FATHER_ID: u.father_id }).eq("ID", u.id);
    if (uErr) {
      return res.status(500).json({ error: "Projekt wurde gespeichert, aber FATHER_ID konnte nicht gesetzt werden: " + uErr.message });
    }
  }

  // Create PROJECT_PROGRESS snapshots (optional; ignore if table missing)
  try {
    const progressRows = (createdNodes || []).map((r) => ({
      STRUCTURE_ID: r.ID,
      REVENUE: 0,
      EXTRAS_PERCENT: 0,
      EXTRAS: 0,
      REVENUE_COMPLETION_PERCENT: 0,
      EXTRAS_COMPLETION_PERCENT: 0,
      REVENUE_COMPLETION: 0,
      EXTRAS_COMPLETION: 0,
    }));
    if (progressRows.length) await supabase.from("PROJECT_PROGRESS").insert(progressRows);
  } catch (e) {
    // ignore
  }
}

// Create matching CONTRACT row (table name can be CONTRACT or CONTRACTS depending on schema)
    const contractRow = {
      NAME_SHORT: project.NAME_SHORT,
      NAME_LONG: project.NAME_LONG,
      PROJECT_ID: project.ID,
      INVOICE_ADDRESS_ID: project.ADDRESS_ID,
      INVOICE_CONTACT_ID: project.CONTACT_ID,
    };

    let contractInsertError = null;
    // Try CONTRACT first
    {
      const { error } = await supabase.from("CONTRACT").insert([contractRow]);
      if (error) contractInsertError = error;
      else contractInsertError = null;
    }

    if (contractInsertError) {
      // Fallback: some schemas use CONTRACTS
      const { error } = await supabase.from("CONTRACTS").insert([contractRow]);
      if (error) {
        return res.status(500).json({
          error:
            "Projekt wurde gespeichert, aber Vertrag konnte nicht angelegt werden: " +
            (error.message || contractInsertError.message),
        });
      }
    }

    res.json({ data: project });
  });

	router.get("/", async (req, res) => {
	  // Some environments do not have FK relationships declared in Postgres.
	  // In that case, a relational select (STATUS:..., TYPE:..., MANAGER:...)
	  // throws and breaks all project dropdowns across the UI.
	  // We therefore attempt the enriched select first and fall back to a minimal
	  // select (ID, NAME_SHORT, NAME_LONG) if the relationship select fails.
	  try {
		const { data, error } = await supabase
		  .from("PROJECT")
		  .select(`
			ID, NAME_SHORT, NAME_LONG,
			STATUS:PROJECT_STATUS_ID(NAME_SHORT),
			TYPE:PROJECT_TYPE_ID(NAME_SHORT),
			MANAGER:PROJECT_MANAGER_ID(SHORT_NAME)
		  `);

		if (error) throw error;
		return res.json({ data });
	  } catch (err) {
		// Fallback: return at least the essentials so dropdowns work.
		const { data, error } = await supabase
		  .from("PROJECT")
		  .select("ID, NAME_SHORT, NAME_LONG")
		  .order("NAME_SHORT", { ascending: true });
		if (error) return res.status(500).json({ error: error.message });
		return res.json({ data });
	  }
	});



// List PROJECT for list views (robust: does not depend on FK relationships)
// GET /api/projekte/list?limit=...
router.get("/list", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || "2000"), 10) || 2000, 5000);

  const { data: projects, error: pErr } = await supabase
    .from("PROJECT")
    .select("ID, NAME_SHORT, NAME_LONG, PROJECT_STATUS_ID, PROJECT_TYPE_ID, PROJECT_MANAGER_ID")
    .order("NAME_SHORT", { ascending: true })
    .limit(limit);

  if (pErr) return res.status(500).json({ error: pErr.message });

  const statusIds = [...new Set((projects || []).map(p => p.PROJECT_STATUS_ID).filter(Boolean))];
  const typeIds = [...new Set((projects || []).map(p => p.PROJECT_TYPE_ID).filter(Boolean))];
  const mgrIds = [...new Set((projects || []).map(p => p.PROJECT_MANAGER_ID).filter(Boolean))];

  const [stRes, tyRes, mgRes] = await Promise.all([
    statusIds.length ? supabase.from("PROJECT_STATUS").select("ID, NAME_SHORT").in("ID", statusIds) : Promise.resolve({ data: [] }),
    typeIds.length ? supabase.from("PROJECT_TYPE").select("ID, NAME_SHORT").in("ID", typeIds) : Promise.resolve({ data: [] }),
    mgrIds.length ? supabase.from("EMPLOYEE").select("ID, SHORT_NAME").in("ID", mgrIds) : Promise.resolve({ data: [] }),
  ]);

  const statusMap = new Map((stRes.data || []).map(x => [String(x.ID), x.NAME_SHORT]));
  const typeMap = new Map((tyRes.data || []).map(x => [String(x.ID), x.NAME_SHORT]));
  const mgrMap = new Map((mgRes.data || []).map(x => [String(x.ID), x.SHORT_NAME]));

  const rows = (projects || []).map(p => ({
    ...p,
    STATUS_NAME: statusMap.get(String(p.PROJECT_STATUS_ID)) || "",
    TYPE_NAME: typeMap.get(String(p.PROJECT_TYPE_ID)) || "",
    MANAGER_NAME: mgrMap.get(String(p.PROJECT_MANAGER_ID)) || "",
  }));

  res.json({ data: rows });
});

// Update a PROJECT (core fields)
// PATCH /api/projekte/:id
router.patch("/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "Projekt-ID fehlt" });

  const b = req.body || {};

  const upd = {};
  if (b.name_short !== undefined) upd.NAME_SHORT = String(b.name_short || "").trim();
  if (b.name_long !== undefined) upd.NAME_LONG = String(b.name_long || "").trim();

  if (b.project_status_id !== undefined) {
    upd.PROJECT_STATUS_ID = b.project_status_id ? parseInt(String(b.project_status_id), 10) : null;
  }
  if (b.project_type_id !== undefined) {
    upd.PROJECT_TYPE_ID = b.project_type_id ? parseInt(String(b.project_type_id), 10) : null;
  }
  if (b.project_manager_id !== undefined) {
    upd.PROJECT_MANAGER_ID = b.project_manager_id ? parseInt(String(b.project_manager_id), 10) : null;
  }

  if (upd.NAME_SHORT !== undefined && !upd.NAME_SHORT) {
    return res.status(400).json({ error: "NAME_SHORT ist erforderlich" });
  }

  const { data: updated, error: uErr } = await supabase
    .from("PROJECT")
    .update(upd)
    .eq("ID", id)
    .select("ID, NAME_SHORT, NAME_LONG, PROJECT_STATUS_ID, PROJECT_TYPE_ID, PROJECT_MANAGER_ID")
    .single();

  if (uErr) return res.status(500).json({ error: uErr.message });

  // Enrich response with display names
  const [st, ty, mg] = await Promise.all([
    updated.PROJECT_STATUS_ID ? supabase.from("PROJECT_STATUS").select("ID, NAME_SHORT").eq("ID", updated.PROJECT_STATUS_ID).single() : Promise.resolve({ data: null }),
    updated.PROJECT_TYPE_ID ? supabase.from("PROJECT_TYPE").select("ID, NAME_SHORT").eq("ID", updated.PROJECT_TYPE_ID).single() : Promise.resolve({ data: null }),
    updated.PROJECT_MANAGER_ID ? supabase.from("EMPLOYEE").select("ID, SHORT_NAME").eq("ID", updated.PROJECT_MANAGER_ID).single() : Promise.resolve({ data: null }),
  ]);

  res.json({
    data: {
      ...updated,
      STATUS_NAME: st.data?.NAME_SHORT || "",
      TYPE_NAME: ty.data?.NAME_SHORT || "",
      MANAGER_NAME: mg.data?.SHORT_NAME || "",
    },
  });
});
// Search PROJECT by NAME_SHORT / NAME_LONG (for wizard)
  // GET /api/projekte/search?q=...
  router.get("/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    if (!q || q.length < 2) return res.json({ data: [] });

    const { data, error } = await supabase
      .from("PROJECT")
      .select("ID, NAME_SHORT, NAME_LONG")
      .or(`NAME_SHORT.ilike.%${q}%,NAME_LONG.ilike.%${q}%`)
      .order("NAME_SHORT", { ascending: true })
      .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // Search CONTRACT by NAME_SHORT / NAME_LONG filtered by PROJECT_ID (for wizard)
  // GET /api/projekte/contracts/search?project_id=..&q=..
  router.get("/contracts/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    const projectIdRaw = (req.query.project_id || "").toString().trim();
    if (!projectIdRaw) return res.json({ data: [] });
    if (!q || q.length < 2) return res.json({ data: [] });

    // Try CONTRACT then fallback to CONTRACTS
    const query = (table) => supabase
      .from(table)
      .select("ID, NAME_SHORT, NAME_LONG, PROJECT_ID, CURRENCY_ID")
      .eq("PROJECT_ID", projectIdRaw)
      .or(`NAME_SHORT.ilike.%${q}%,NAME_LONG.ilike.%${q}%`)
      .order("NAME_SHORT", { ascending: true })
      .limit(20);

    let { data, error } = await query("CONTRACT");
    if (error) {
      // fallback
      ({ data, error } = await query("CONTRACTS"));
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

	router.get("/:id/structure", async (req, res) => {
	  const { id } = req.params;

	  const { data: structures, error } = await supabase
		.from("PROJECT_STRUCTURE")
		.select("*")
		.eq("PROJECT_ID", id);

	  if (error) return res.status(500).json({ error: error.message });

	  if (!Array.isArray(structures) || structures.length === 0) {
		return res.json({ data: [] });
	  }

	  // If BILLING_TYPE_ID = 2, "Honorar" is derived from TEC (sum of SP_TOT per STRUCTURE_ID).
	  const billingType2Ids = structures
		.filter((s) => Number(s.BILLING_TYPE_ID) === 2)
		.map((s) => s.ID);

	  const tecSums = {};
	  if (billingType2Ids.length > 0) {
		const { data: tecRows, error: tecError } = await supabase
		  .from("TEC")
		  .select("STRUCTURE_ID, SP_TOT")
		  .in("STRUCTURE_ID", billingType2Ids);

		if (tecError) return res.status(500).json({ error: tecError.message });

		(tecRows || []).forEach((r) => {
		  const sid = String(r.STRUCTURE_ID);
		  const val = Number(r.SP_TOT ?? 0);
		  tecSums[sid] = (tecSums[sid] ?? 0) + (Number.isFinite(val) ? val : 0);
		});
	  }

	  const enriched = structures.map((s) => ({
		...s,
		TEC_SP_TOT_SUM: tecSums[String(s.ID)] ?? 0,
	  }));

	  res.json({ data: enriched });
	});


  // Update completion percents only (no compute/snapshot)
  // PATCH /api/projekte/structure/:id/completion-percents
  router.patch("/structure/:id/completion-percents", async (req, res) => {
    const { id } = req.params;
    const structureId = String(id || "").trim();
    if (!structureId) return res.status(400).json({ error: "ID fehlt" });

    const b = req.body || {};
    const revPctRaw = b.REVENUE_COMPLETION_PERCENT;
    const exPctRaw = b.EXTRAS_COMPLETION_PERCENT;

    // Accept numbers and numeric strings; default to 0
    const revPct = revPctRaw === undefined || revPctRaw === null || String(revPctRaw) === "" ? 0 : Number(revPctRaw);
    const exPct = exPctRaw === undefined || exPctRaw === null || String(exPctRaw) === "" ? 0 : Number(exPctRaw);

    if (!Number.isFinite(revPct) || !Number.isFinite(exPct)) {
      return res.status(400).json({ error: "Ungültige Prozentwerte" });
    }

    const { error } = await supabase
      .from("PROJECT_STRUCTURE")
      .update({
        REVENUE_COMPLETION_PERCENT: revPct,
        EXTRAS_COMPLETION_PERCENT: exPct,
      })
      .eq("ID", structureId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Finalize: compute completion values and write PROJECT_PROGRESS snapshot rows for the whole project
  // POST /api/projekte/:id/progress-snapshot
  router.post("/:id/progress-snapshot", async (req, res) => {
    const { id } = req.params;
    const projectId = String(id || "").trim();
    if (!projectId) return res.status(400).json({ error: "Projekt-ID fehlt" });

    const { data: structures, error: sErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, BILLING_TYPE_ID, REVENUE, EXTRAS, EXTRAS_PERCENT, REVENUE_COMPLETION_PERCENT, EXTRAS_COMPLETION_PERCENT")
      .eq("PROJECT_ID", projectId);

    if (sErr) return res.status(500).json({ error: sErr.message });

    const rows = Array.isArray(structures) ? structures : [];
    if (!rows.length) return res.json({ success: true, updated: 0, inserted: 0 });

    // BILLING_TYPE_ID = 2: derive REVENUE from TEC sum(SP_TOT) per STRUCTURE_ID.
    const bt2Ids = rows.filter((r) => Number(r.BILLING_TYPE_ID) === 2).map((r) => r.ID);
    const tecSums = {};
    if (bt2Ids.length) {
      const { data: tecRows, error: tecErr } = await supabase
        .from("TEC")
        .select("STRUCTURE_ID, SP_TOT")
        .in("STRUCTURE_ID", bt2Ids);

      if (tecErr) return res.status(500).json({ error: tecErr.message });

      (tecRows || []).forEach((t) => {
        const sid = String(t.STRUCTURE_ID);
        const v = Number(t.SP_TOT ?? 0);
        tecSums[sid] = (tecSums[sid] ?? 0) + (Number.isFinite(v) ? v : 0);
      });
    }

    const updates = [];
    const progressRows = [];

    for (const r of rows) {
      const sid = String(r.ID);
      const btId = Number(r.BILLING_TYPE_ID ?? 0) || 0;

      // Base values
      const storedRevenue = Number(r.REVENUE ?? 0) || 0;
      const storedExtras = Number(r.EXTRAS ?? 0) || 0;
      const extrasPercent = Number(r.EXTRAS_PERCENT ?? 0) || 0;

      // BILLING_TYPE_ID = 2: revenue is derived from TEC; extras are derived from revenue * extrasPercent / 100
      const revenue = btId === 2 ? (Number(tecSums[sid] ?? 0) || 0) : storedRevenue;
      const extras = btId === 2 ? (revenue * extrasPercent) / 100 : storedExtras;

      const revPct = Number(r.REVENUE_COMPLETION_PERCENT ?? 0) || 0;
      const exPct = Number(r.EXTRAS_COMPLETION_PERCENT ?? 0) || 0;

      const revenueCompletion = (revPct * revenue) / 100;
      const extrasCompletion = (exPct * extras) / 100;

      // For BT=2 we also refresh stored REVENUE/EXTRAS to keep PROJECT_STRUCTURE consistent (important when TEC rows were changed/deleted).
      updates.push({ sid, btId, revenue, extras, revenueCompletion, extrasCompletion });

      progressRows.push({
        STRUCTURE_ID: sid,
        REVENUE: revenue,
        EXTRAS_PERCENT: extrasPercent,
        EXTRAS: extras,
        REVENUE_COMPLETION_PERCENT: revPct,
        EXTRAS_COMPLETION_PERCENT: exPct,
        REVENUE_COMPLETION: revenueCompletion,
        EXTRAS_COMPLETION: extrasCompletion,
      });
    }

    // Update PROJECT_STRUCTURE completion fields (sequential, chunked)
    for (const u of updates) {
      const payload = {
        REVENUE_COMPLETION: u.revenueCompletion,
        EXTRAS_COMPLETION: u.extrasCompletion,
      };

      // Keep BT=2 nodes consistent with TEC-derived values
      if (Number(u.btId) === 2) {
        payload.REVENUE = u.revenue;
        payload.EXTRAS = u.extras;
      }

      const { error: uErr } = await supabase.from("PROJECT_STRUCTURE").update(payload).eq("ID", u.sid);
      if (uErr) return res.status(500).json({ error: uErr.message });
    }

    // Insert PROJECT_PROGRESS rows (chunked)
    const chunk = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    for (const part of chunk(progressRows, 200)) {
      const { error: pErr } = await supabase.from("PROJECT_PROGRESS").insert(part);
      if (pErr) return res.status(500).json({ error: "PROJECT_PROGRESS konnte nicht geschrieben werden: " + pErr.message });
    }

    res.json({ success: true, updated: updates.length, inserted: progressRows.length });
  });


	// Sum of TEC.SP_TOT per STRUCTURE_ID (used for BILLING_TYPE_ID = 2)
	router.get("/structure/:id/tec-sum", async (req, res) => {
	  const { id } = req.params;
	  const structureId = id;

	  const { data: tecRows, error } = await supabase
		.from("TEC")
		.select("SP_TOT")
		.eq("STRUCTURE_ID", structureId);

	  if (error) return res.status(500).json({ error: error.message });

	  const sum = (tecRows || []).reduce((acc, r) => {
		const v = Number(r.SP_TOT ?? 0);
		return acc + (Number.isFinite(v) ? v : 0);
	  }, 0);

	  res.json({ sum });
	});


router.post("/:id/structure", async (req, res) => {
  const { id: projectId } = req.params;
  const node = req.body || {};

  const nameShort = String(node.NAME_SHORT || "").trim();
  const nameLong = String(node.NAME_LONG || "").trim();

  if (!nameShort) return res.status(400).json({ error: "NAME_SHORT ist erforderlich" });

  // Mandatory: BILLING_TYPE_ID (FK -> BILLING_TYPE)
  const billingTypeId =
    typeof node.BILLING_TYPE_ID === "number"
      ? node.BILLING_TYPE_ID
      : parseInt(String(node.BILLING_TYPE_ID || ""), 10);

  if (!billingTypeId || Number.isNaN(billingTypeId)) {
    return res.status(400).json({ error: "BILLING_TYPE_ID ist erforderlich" });
  }

  // Optional: parent (root if null/0)
  const fatherIdRaw = node.FATHER_ID;
  const fatherIdParsed =
    fatherIdRaw === undefined || fatherIdRaw === null || String(fatherIdRaw) === "" || String(fatherIdRaw) === "0"
      ? null
      : parseInt(String(fatherIdRaw), 10);

  if (fatherIdParsed !== null && (Number.isNaN(fatherIdParsed) || fatherIdParsed <= 0)) {
    return res.status(400).json({ error: "FATHER_ID ist ungültig" });
  }

  // Validate parent belongs to same project (if provided)
  if (fatherIdParsed !== null) {
    const { data: parent, error: pErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, PROJECT_ID")
      .eq("ID", fatherIdParsed)
      .maybeSingle();

    if (pErr) return res.status(500).json({ error: pErr.message });
    if (!parent) return res.status(400).json({ error: "Übergeordnetes Element nicht gefunden" });
    if (String(parent.PROJECT_ID) !== String(projectId)) {
      return res.status(400).json({ error: "FATHER_ID gehört nicht zum Projekt" });
    }
  }

  const extrasPercent =
    node.EXTRAS_PERCENT !== undefined && node.EXTRAS_PERCENT !== null && String(node.EXTRAS_PERCENT) !== ""
      ? Number(node.EXTRAS_PERCENT)
      : 0;

  let revenue =
    node.REVENUE !== undefined && node.REVENUE !== null && String(node.REVENUE) !== ""
      ? Number(node.REVENUE)
      : 0;

  // For billing type 2, revenue is derived from TEC. New rows typically have none, so 0.
  if (Number(billingTypeId) === 2) revenue = 0;

  const extras = (revenue * extrasPercent) / 100;

  const revenuePct =
    node.REVENUE_COMPLETION_PERCENT !== undefined && node.REVENUE_COMPLETION_PERCENT !== null && String(node.REVENUE_COMPLETION_PERCENT) !== ""
      ? Number(node.REVENUE_COMPLETION_PERCENT)
      : 0;

  const extrasPct =
    node.EXTRAS_COMPLETION_PERCENT !== undefined && node.EXTRAS_COMPLETION_PERCENT !== null && String(node.EXTRAS_COMPLETION_PERCENT) !== ""
      ? Number(node.EXTRAS_COMPLETION_PERCENT)
      : 0;

  const revenueCompletion = (revenuePct * revenue) / 100;
  const extrasCompletion = (extrasPct * extras) / 100;

  const insertPayload = {
    NAME_SHORT: nameShort,
    NAME_LONG: nameLong,
    FATHER_ID: fatherIdParsed,
    PROJECT_ID: projectId,
    BILLING_TYPE_ID: billingTypeId,
    REVENUE: revenue,
    EXTRAS_PERCENT: extrasPercent,
    EXTRAS: extras,
    REVENUE_COMPLETION_PERCENT: revenuePct,
    EXTRAS_COMPLETION_PERCENT: extrasPct,
    REVENUE_COMPLETION: revenueCompletion,
    EXTRAS_COMPLETION: extrasCompletion,
  };

  const { data: created, error: cErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .insert([insertPayload])
    .select("*")
    .single();

  if (cErr) return res.status(500).json({ error: cErr.message });

  // Create progress snapshot
  const progressRow = {
    STRUCTURE_ID: created.ID,
    REVENUE: created.REVENUE,
    EXTRAS_PERCENT: created.EXTRAS_PERCENT,
    EXTRAS: created.EXTRAS,
    REVENUE_COMPLETION_PERCENT: created.REVENUE_COMPLETION_PERCENT,
    EXTRAS_COMPLETION_PERCENT: created.EXTRAS_COMPLETION_PERCENT,
    REVENUE_COMPLETION: created.REVENUE_COMPLETION,
    EXTRAS_COMPLETION: created.EXTRAS_COMPLETION,
  };

  const { error: prErr } = await supabase.from("PROJECT_PROGRESS").insert([progressRow]);
  if (prErr) return res.status(500).json({ error: "Element angelegt, aber PROJECT_PROGRESS fehlgeschlagen: " + prErr.message });

  res.json({ data: created });
});


router.patch("/structure/:id", async (req, res) => {
  const { id } = req.params;
  const update = req.body || {};

  // IDs are often bigint/int8 in Supabase schemas. Supabase/PostgREST can handle
  // these IDs as strings, so we keep the path param as-is.
  const structureId = id;

  // Read current row to avoid unintentionally overwriting fields the UI does not edit
  const { data: current, error: currentErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select(
      "NAME_SHORT, NAME_LONG, BILLING_TYPE_ID, REVENUE, EXTRAS_PERCENT, REVENUE_COMPLETION_PERCENT, EXTRAS_COMPLETION_PERCENT"
    )
    .eq("ID", structureId)
    .maybeSingle();

  if (currentErr) return res.status(500).json({ error: currentErr.message });
  if (!current) return res.status(404).json({ error: "PROJECT_STRUCTURE nicht gefunden" });

  // Determine new billing type
  let billingTypeId =
    update.BILLING_TYPE_ID !== undefined && update.BILLING_TYPE_ID !== null && String(update.BILLING_TYPE_ID) !== ""
      ? parseInt(update.BILLING_TYPE_ID, 10)
      : parseInt(current.BILLING_TYPE_ID, 10);

  if (!billingTypeId || Number.isNaN(billingTypeId)) {
    return res.status(400).json({ error: "BILLING_TYPE_ID ist erforderlich" });
  }

  // Name fields (optional)
  const nameShort =
    update.NAME_SHORT !== undefined && update.NAME_SHORT !== null
      ? String(update.NAME_SHORT)
      : current.NAME_SHORT;

  const nameLong =
    update.NAME_LONG !== undefined && update.NAME_LONG !== null
      ? String(update.NAME_LONG)
      : current.NAME_LONG;

  // Completion percents (keep existing if not provided)
  const revenuePct =
    update.REVENUE_COMPLETION_PERCENT !== undefined && update.REVENUE_COMPLETION_PERCENT !== null && String(update.REVENUE_COMPLETION_PERCENT) !== ""
      ? Number(update.REVENUE_COMPLETION_PERCENT)
      : Number(current.REVENUE_COMPLETION_PERCENT ?? 0);

  const extrasPct =
    update.EXTRAS_COMPLETION_PERCENT !== undefined && update.EXTRAS_COMPLETION_PERCENT !== null && String(update.EXTRAS_COMPLETION_PERCENT) !== ""
      ? Number(update.EXTRAS_COMPLETION_PERCENT)
      : Number(current.EXTRAS_COMPLETION_PERCENT ?? 0);

  // Extras percent (keep existing if not provided)
  const extrasPercent =
    update.EXTRAS_PERCENT !== undefined && update.EXTRAS_PERCENT !== null && String(update.EXTRAS_PERCENT) !== ""
      ? Number(update.EXTRAS_PERCENT)
      : Number(current.EXTRAS_PERCENT ?? 0);

  // Revenue
  let revenue =
    update.REVENUE !== undefined && update.REVENUE !== null && String(update.REVENUE) !== ""
      ? Number(update.REVENUE)
      : Number(current.REVENUE ?? 0);

  // --- Business logic on save ---
  // If BILLING_TYPE_ID = 2:
  //   - "Honorar" (REVENUE) is derived from TEC: sum(SP_TOT) where STRUCTURE_ID = this row.
  if (Number(billingTypeId) === 2) {
    const { data: tecRows, error: tecError } = await supabase
      .from("TEC")
      .select("SP_TOT")
      .eq("STRUCTURE_ID", structureId);

    if (tecError) return res.status(500).json({ error: tecError.message });

    revenue = (tecRows || []).reduce((acc, r) => {
      const v = Number(r.SP_TOT ?? 0);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
  }

  // EXTRAS is computed on save from (REVENUE * EXTRAS_PERCENT / 100)
  const extras = (revenue * extrasPercent) / 100;

  // Completion values
  const revenueCompletion = (revenuePct * revenue) / 100;
  const extrasCompletion = (extrasPct * extras) / 100;

  const updatePayload = {
    // persist editable fields
    NAME_SHORT: nameShort,
    NAME_LONG: nameLong,
    BILLING_TYPE_ID: billingTypeId,
    REVENUE: revenue,
    EXTRAS_PERCENT: extrasPercent,

    // keep/allow completion percents
    REVENUE_COMPLETION_PERCENT: revenuePct,
    EXTRAS_COMPLETION_PERCENT: extrasPct,

    // computed fields
    EXTRAS: extras,
    REVENUE_COMPLETION: revenueCompletion,
    EXTRAS_COMPLETION: extrasCompletion,
  };

  const { error: updateError } = await supabase
    .from("PROJECT_STRUCTURE")
    .update(updatePayload)
    .eq("ID", structureId);

  if (updateError) return res.status(500).json({ error: updateError.message });

  // Add a progress snapshot row
  const progressRow = {
    STRUCTURE_ID: structureId,
    REVENUE: revenue,
    EXTRAS_PERCENT: extrasPercent,
    EXTRAS: extras,
    REVENUE_COMPLETION_PERCENT: revenuePct,
    EXTRAS_COMPLETION_PERCENT: extrasPct,
    REVENUE_COMPLETION: revenueCompletion,
    EXTRAS_COMPLETION: extrasCompletion,
  };

  const { error: progressError } = await supabase
    .from("PROJECT_PROGRESS")
    .insert([progressRow]);

  if (progressError) {
    return res.status(500).json({
      error:
        "Projektstruktur gespeichert, aber PROJECT_PROGRESS konnte nicht geschrieben werden: " +
        progressError.message,
    });
  }

  // Return computed values so the frontend can update view-only fields.
  res.json({
    success: true,
    computed: {
      BILLING_TYPE_ID: billingTypeId,
      REVENUE: revenue,
      EXTRAS: extras,
      REVENUE_COMPLETION: revenueCompletion,
      EXTRAS_COMPLETION: extrasCompletion,
    },
  });
});

// Inherit fields (billing type / extras percent) to all descendants
// PATCH /api/projekte/structure/:id/inherit  { BILLING_TYPE_ID?: number, EXTRAS_PERCENT?: number }
router.patch("/structure/:id/inherit", async (req, res) => {
  const { id } = req.params;
  const structureId = String(id || "").trim();
  if (!structureId) return res.status(400).json({ error: "ID fehlt" });

  const body = req.body || {};
  const hasBt = body.BILLING_TYPE_ID !== undefined && body.BILLING_TYPE_ID !== null && String(body.BILLING_TYPE_ID) !== "";
  const hasExtras = body.EXTRAS_PERCENT !== undefined && body.EXTRAS_PERCENT !== null && String(body.EXTRAS_PERCENT) !== "";
  if (!hasBt && !hasExtras) return res.status(400).json({ error: "Keine Felder zum Vererben übergeben" });

  const inheritBt = hasBt ? parseInt(body.BILLING_TYPE_ID, 10) : null;
  if (hasBt && (!inheritBt || Number.isNaN(inheritBt))) {
    return res.status(400).json({ error: "BILLING_TYPE_ID ungültig" });
  }
  const inheritExtras = hasExtras ? Number(body.EXTRAS_PERCENT) : null;
  if (hasExtras && !Number.isFinite(inheritExtras)) {
    return res.status(400).json({ error: "EXTRAS_PERCENT ungültig" });
  }

  // Load root node to get project
  const { data: root, error: rootErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, PROJECT_ID")
    .eq("ID", structureId)
    .maybeSingle();
  if (rootErr) return res.status(500).json({ error: rootErr.message });
  if (!root) return res.status(404).json({ error: "PROJECT_STRUCTURE nicht gefunden" });

  // Load all nodes in this project
  const { data: all, error: allErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, FATHER_ID, BILLING_TYPE_ID, REVENUE, EXTRAS_PERCENT, REVENUE_COMPLETION_PERCENT, EXTRAS_COMPLETION_PERCENT")
    .eq("PROJECT_ID", root.PROJECT_ID);
  if (allErr) return res.status(500).json({ error: allErr.message });

  const childrenByParent = new Map();
  (all || []).forEach((n) => {
    const pid = n.FATHER_ID === null || n.FATHER_ID === undefined ? null : String(n.FATHER_ID);
    const arr = childrenByParent.get(pid) || [];
    arr.push(String(n.ID));
    childrenByParent.set(pid, arr);
  });

  // Collect descendants (exclude self)
  const descendants = [];
  const stack = [...(childrenByParent.get(String(structureId)) || [])];
  const seen = new Set();
  while (stack.length) {
    const cur = String(stack.pop() || "");
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    descendants.push(cur);
    const kids = childrenByParent.get(cur) || [];
    kids.forEach((k) => stack.push(k));
  }

  if (!descendants.length) {
    return res.json({ success: true, updated: 0, updated_ids: [] });
  }

  const nodeById = new Map((all || []).map((n) => [String(n.ID), n]));

  // Determine which nodes need TEC recompute (effective BT=2)
  const bt2Ids = descendants.filter((sid) => {
    const n = nodeById.get(String(sid));
    if (!n) return false;
    const effBt = inheritBt !== null ? inheritBt : parseInt(n.BILLING_TYPE_ID, 10);
    return Number(effBt) === 2;
  });

  // Fetch TEC sums in chunks
  const tecSumByStructure = new Map();
  const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  try {
    for (const part of chunk(bt2Ids, 100)) {
      const { data: tecRows, error: tecErr } = await supabase
        .from("TEC")
        .select("STRUCTURE_ID, SP_TOT")
        .in("STRUCTURE_ID", part);
      if (tecErr) return res.status(500).json({ error: tecErr.message });
      (tecRows || []).forEach((r) => {
        const sid = String(r.STRUCTURE_ID);
        const v = Number(r.SP_TOT ?? 0);
        const prev = tecSumByStructure.get(sid) || 0;
        tecSumByStructure.set(sid, prev + (Number.isFinite(v) ? v : 0));
      });
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Fehler beim Laden der TEC-Summen" });
  }

  const progressRows = [];
  const updatedIds = [];

  for (const sid of descendants) {
    const n = nodeById.get(String(sid));
    if (!n) continue;

    const effBt = inheritBt !== null ? inheritBt : parseInt(n.BILLING_TYPE_ID, 10);
    const effExtrasPercent = inheritExtras !== null ? inheritExtras : Number(n.EXTRAS_PERCENT ?? 0);

    let revenue = Number(n.REVENUE ?? 0);
    if (Number(effBt) === 2) {
      revenue = Number(tecSumByStructure.get(String(sid)) ?? 0);
    }

    const extras = (revenue * effExtrasPercent) / 100;
    const revenuePct = Number(n.REVENUE_COMPLETION_PERCENT ?? 0);
    const extrasPct = Number(n.EXTRAS_COMPLETION_PERCENT ?? 0);
    const revenueCompletion = (revenuePct * revenue) / 100;
    const extrasCompletion = (extrasPct * extras) / 100;

    const upd = {
      BILLING_TYPE_ID: effBt,
      EXTRAS_PERCENT: effExtrasPercent,
      REVENUE: revenue,
      EXTRAS: extras,
      REVENUE_COMPLETION: revenueCompletion,
      EXTRAS_COMPLETION: extrasCompletion,
    };

    const { error: uErr } = await supabase.from("PROJECT_STRUCTURE").update(upd).eq("ID", sid);
    if (uErr) return res.status(500).json({ error: uErr.message });

    updatedIds.push(String(sid));
    progressRows.push({
      STRUCTURE_ID: sid,
      REVENUE: revenue,
      EXTRAS_PERCENT: effExtrasPercent,
      EXTRAS: extras,
      REVENUE_COMPLETION_PERCENT: revenuePct,
      EXTRAS_COMPLETION_PERCENT: extrasPct,
      REVENUE_COMPLETION: revenueCompletion,
      EXTRAS_COMPLETION: extrasCompletion,
    });
  }

  // Insert progress snapshots (best effort; chunked)
  for (const part of chunk(progressRows, 200)) {
    const { error: pErr } = await supabase.from("PROJECT_PROGRESS").insert(part);
    if (pErr) return res.status(500).json({ error: "PROJECT_PROGRESS konnte nicht geschrieben werden: " + pErr.message });
  }

  res.json({ success: true, updated: updatedIds.length, updated_ids: updatedIds });
});







// Move a structure node (change parent)
// PATCH /api/projekte/structure/:id/move  { father_id: <id|null|0> }
router.patch("/structure/:id/move", async (req, res) => {
  const { id } = req.params;
  const structureId = String(id || "").trim();
  if (!structureId) return res.status(400).json({ error: "ID fehlt" });

  const fatherRaw = (req.body || {}).father_id;
  const newFatherId =
    fatherRaw === undefined || fatherRaw === null || String(fatherRaw) === "" || String(fatherRaw) === "0"
      ? null
      : String(fatherRaw);

  const { data: current, error: curErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, PROJECT_ID, FATHER_ID")
    .eq("ID", structureId)
    .maybeSingle();

  if (curErr) return res.status(500).json({ error: curErr.message });
  if (!current) return res.status(404).json({ error: "PROJECT_STRUCTURE nicht gefunden" });

  if (newFatherId !== null && String(newFatherId) === String(structureId)) {
    return res.status(400).json({ error: "Ein Element kann nicht sich selbst untergeordnet werden" });
  }

  // Validate new parent exists and is in same project
  if (newFatherId !== null) {
    const { data: parent, error: pErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, PROJECT_ID, FATHER_ID")
      .eq("ID", newFatherId)
      .maybeSingle();

    if (pErr) return res.status(500).json({ error: pErr.message });
    if (!parent) return res.status(400).json({ error: "Ziel-Element nicht gefunden" });
    if (String(parent.PROJECT_ID) !== String(current.PROJECT_ID)) {
      return res.status(400).json({ error: "Ziel-Element gehört nicht zum selben Projekt" });
    }
  }

  // Prevent cycles: walk up from newFatherId to root, ensure we never hit structureId
  if (newFatherId !== null) {
    const { data: all, error: aErr } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID, FATHER_ID")
      .eq("PROJECT_ID", current.PROJECT_ID);

    if (aErr) return res.status(500).json({ error: aErr.message });

    const map = new Map((all || []).map(n => [String(n.ID), n.FATHER_ID === null ? null : String(n.FATHER_ID)]));
    let cursor = String(newFatherId);
    let guard = 0;
    while (cursor && guard++ < 5000) {
      if (cursor === String(structureId)) {
        return res.status(400).json({ error: "Ungültige Verschiebung (Zyklus in der Struktur)" });
      }
      const next = map.get(cursor);
      if (!next) break;
      cursor = next ? String(next) : null;
    }
  }

  const { error: uErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .update({ FATHER_ID: newFatherId })
    .eq("ID", structureId);

  if (uErr) return res.status(500).json({ error: uErr.message });

  res.json({ success: true });
});

// Delete a structure node
// DELETE /api/projekte/structure/:id?cascade=1
router.delete("/structure/:id", async (req, res) => {
  const { id } = req.params;
  const structureId = String(id || "").trim();
  if (!structureId) return res.status(400).json({ error: "ID fehlt" });

  const cascade = String(req.query.cascade || "") === "1";

  const { data: current, error: curErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, PROJECT_ID")
    .eq("ID", structureId)
    .maybeSingle();

  if (curErr) return res.status(500).json({ error: curErr.message });
  if (!current) return res.status(404).json({ error: "PROJECT_STRUCTURE nicht gefunden" });

  const { data: all, error: aErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, FATHER_ID")
    .eq("PROJECT_ID", current.PROJECT_ID);

  if (aErr) return res.status(500).json({ error: aErr.message });

  const childrenByParent = new Map();
  (all || []).forEach(n => {
    const pid = n.FATHER_ID === null || n.FATHER_ID === undefined ? null : String(n.FATHER_ID);
    const arr = childrenByParent.get(pid) || [];
    arr.push(String(n.ID));
    childrenByParent.set(pid, arr);
  });

  const directChildren = childrenByParent.get(String(structureId)) || [];
  if (directChildren.length && !cascade) {
    return res.status(409).json({ error: "Element hat Unterelemente. Bitte zuerst verschieben/löschen oder 'Unterstruktur mitlöschen' wählen." });
  }

  const toDelete = [];
  const stack = [String(structureId)];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (toDelete.includes(cur)) continue;
    toDelete.push(cur);
    const kids = childrenByParent.get(cur) || [];
    kids.forEach(k => stack.push(k));
  }

  // Block delete if referenced by TEC or invoice structures
  const hasRefs = async (table, col) => {
    try {
      const { data, error } = await supabase.from(table).select("ID").in(col, toDelete).limit(1);
      if (error) return false; // ignore missing tables
      return Array.isArray(data) && data.length > 0;
    } catch (_) {
      return false;
    }
  };

  const tecRef = await hasRefs("TEC", "STRUCTURE_ID");
  const ppsRef = await hasRefs("PARTIAL_PAYMENT_STRUCTURE", "STRUCTURE_ID");
  const invsRef = await hasRefs("INVOICE_STRUCTURE", "STRUCTURE_ID");

  if (tecRef || ppsRef || invsRef) {
    return res.status(409).json({ error: "Element kann nicht gelöscht werden, da Buchungen/Rechnungen darauf verweisen." });
  }

  // Delete progress snapshots first (if any)
  {
    const { error } = await supabase.from("PROJECT_PROGRESS").delete().in("STRUCTURE_ID", toDelete);
    if (error) return res.status(500).json({ error: error.message });
  }

  // Delete nodes
  {
    const { error } = await supabase.from("PROJECT_STRUCTURE").delete().in("ID", toDelete);
    if (error) return res.status(500).json({ error: error.message });
  }

  res.json({ success: true, deleted_ids: toDelete });
});


  return router;
};
