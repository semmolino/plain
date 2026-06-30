"use strict";
const express = require("express");
const { requirePermission, requireAnyPermission } = require("../middleware/permissions");

// ── Routen: Service-Bereich (Phase 0 — Fundament) ─────────────────────────────
// Liefert das Zugangs-Gate (Haftungs-/Nutzungsbestätigung) und die Verwaltung
// des „Produkt-Sprechers" (genau ein abstimmungs-/kommentarberechtigter
// Mitarbeiter pro Organisation). Die eigentlichen Vorschlags-/Feedback-/Support-
// Funktionen folgen in Phase 1/2. Siehe docs/SERVICE_AREA_CONCEPT.md.
//
// Tenant-Isolation: jede Query filtert auf req.tenantId.
module.exports = (supabase) => {
  const router = express.Router();

  // Version des Haftungs-/Nutzungshinweises. Bei Textänderung hochzählen →
  // erzwingt erneute Bestätigung (PORTAL_CONSENT ist je Version eindeutig).
  const CONSENT_VERSION = "2026-06-29";

  const DELEGATE_KEY = "suggestion_delegate_employee_id";

  function employeeName(e) {
    if (!e) return null;
    const full = [e.FIRST_NAME, e.LAST_NAME].filter(Boolean).join(" ").trim();
    return full || e.SHORT_NAME || `#${e.ID}`;
  }

  async function getDelegateId(tenantId) {
    const { data } = await supabase
      .from("TENANT_SETTINGS").select("VALUE")
      .eq("TENANT_ID", tenantId).eq("KEY", DELEGATE_KEY).maybeSingle();
    return data?.VALUE ? Number(data.VALUE) : null;
  }

  // Stimmen neu zählen und im denormalisierten Cache (SUGGESTION.VOTE_COUNT) ablegen.
  async function refreshVoteCount(suggestionId) {
    const { data } = await supabase
      .from("SUGGESTION_VOTE").select("ID").eq("SUGGESTION_ID", suggestionId);
    const count = (data || []).length;
    await supabase.from("SUGGESTION").update({ VOTE_COUNT: count }).eq("ID", suggestionId);
    return count;
  }

  const CATEGORIES = ["projekte", "rechnungen", "angebote", "reporting", "adressen", "mitarbeiter", "import", "einvoice", "sonstiges"];
  const PRIORITIES = ["nice", "important", "blocker"];

  // ── Zugangs-Gate: Haftungs-/Nutzungsbestätigung ─────────────────────────────
  // GET /consent → ob der aktuelle Mitarbeiter die aktuelle Textversion akzeptiert hat
  router.get("/consent", async (req, res) => {
    const { data, error } = await supabase
      .from("PORTAL_CONSENT")
      .select("DOC_VERSION, ACCEPTED_AT")
      .eq("EMPLOYEE_ID", req.employeeId)
      .eq("DOC_VERSION", CONSENT_VERSION)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      current_version: CONSENT_VERSION,
      accepted:        !!data,
      accepted_at:     data?.ACCEPTED_AT || null,
    });
  });

  // POST /consent → Bestätigung der aktuellen Textversion festhalten
  router.post("/consent", async (req, res) => {
    const row = {
      TENANT_ID:   req.tenantId,
      EMPLOYEE_ID: req.employeeId,
      DOC_VERSION: CONSENT_VERSION,
      ACCEPTED_AT: new Date().toISOString(),
    };
    // Idempotent: zweite Bestätigung derselben Version verändert nichts.
    const { error } = await supabase
      .from("PORTAL_CONSENT")
      .upsert([row], { onConflict: "EMPLOYEE_ID,DOC_VERSION" });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ accepted: true, current_version: CONSENT_VERSION });
  });

  // ── Produkt-Sprecher (eine Stimme pro Organisation) ─────────────────────────
  // GET /delegate → wer ist der abstimmungs-/kommentarberechtigte Mitarbeiter?
  router.get(
    "/delegate",
    requireAnyPermission("service.suggestions.view", "service.suggestions.admin"),
    async (req, res) => {
      const { data: setting } = await supabase
        .from("TENANT_SETTINGS")
        .select("VALUE")
        .eq("TENANT_ID", req.tenantId)
        .eq("KEY", DELEGATE_KEY)
        .maybeSingle();
      const delegateId = setting?.VALUE ? Number(setting.VALUE) : null;

      let name = null;
      if (delegateId) {
        const { data: emp } = await supabase
          .from("EMPLOYEE")
          .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME")
          .eq("ID", delegateId)
          .eq("TENANT_ID", req.tenantId)
          .maybeSingle();
        name = employeeName(emp);
      }
      res.json({
        employee_id:   delegateId,
        employee_name: name,
        is_me:         delegateId === req.employeeId,
      });
    }
  );

  // PUT /delegate → Produkt-Sprecher festlegen (nur Admin)
  router.put("/delegate", requirePermission("service.suggestions.admin"), async (req, res) => {
    const empId = req.body?.employee_id != null ? Number(req.body.employee_id) : null;

    if (empId != null) {
      // Mitarbeiter muss zur eigenen Organisation gehören.
      const { data: emp } = await supabase
        .from("EMPLOYEE")
        .select("ID")
        .eq("ID", empId)
        .eq("TENANT_ID", req.tenantId)
        .maybeSingle();
      if (!emp) return res.status(400).json({ error: "Mitarbeiter nicht gefunden" });
    }

    const { error } = await supabase.from("TENANT_SETTINGS").upsert(
      [{ TENANT_ID: req.tenantId, KEY: DELEGATE_KEY, VALUE: empId != null ? String(empId) : "", UPDATED_AT: new Date().toISOString() }],
      { onConflict: "TENANT_ID,KEY" }
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({ employee_id: empId });
  });

  // ── Vorschläge ──────────────────────────────────────────────────────────────
  // DATENSCHUTZ: Das Board spielt fremden Anwendern NUR die kuratierten PUBLIC_*-
  // Felder + Status + Stimmen aus — nie Name/E-Mail/Organisation. Einreicher-Namen
  // gibt es nur in der org-internen „Unsere Vorschläge"-Ansicht.

  // POST /suggestions — neuen Vorschlag einreichen
  router.post("/suggestions", requirePermission("service.suggestions.view"), async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    const body  = String(b.body || "").trim();
    if (!title || !body) return res.status(400).json({ error: "Titel und Beschreibung sind erforderlich" });
    const category = CATEGORIES.includes(b.category) ? b.category : "sonstiges";
    const priority = PRIORITIES.includes(b.priority_hint) ? b.priority_hint : null;
    const { data, error } = await supabase.from("SUGGESTION").insert([{
      TENANT_ID:        req.tenantId,
      EMPLOYEE_ID:      req.employeeId,
      TITLE:            title.slice(0, 200),
      BODY:             body,
      CATEGORY:         category,
      PRIORITY_HINT:    priority,
      MODERATION_STATE: "pending",
      LIFECYCLE_STATUS: "new",
    }]).select("*").single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // GET /suggestions/mine — eigene (bzw. org-weite für Sprecher/Admin) Einreichungen
  router.get("/suggestions/mine", requirePermission("service.suggestions.view"), async (req, res) => {
    const delegateId = await getDelegateId(req.tenantId);
    const orgView = req.hasPermission("service.suggestions.admin") || req.employeeId === delegateId;

    let q = supabase.from("SUGGESTION").select("*").eq("TENANT_ID", req.tenantId);
    if (!orgView) q = q.eq("EMPLOYEE_ID", req.employeeId);
    const { data, error } = await q.order("CREATED_AT", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];

    // Einreicher-Namen nur innerhalb der eigenen Org (datenschutz-unkritisch)
    let nameMap = {};
    if (orgView && rows.length) {
      const empIds = [...new Set(rows.map(r => r.EMPLOYEE_ID))];
      const { data: emps } = await supabase.from("EMPLOYEE")
        .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME").in("ID", empIds).eq("TENANT_ID", req.tenantId);
      nameMap = Object.fromEntries((emps || []).map(e => [e.ID, employeeName(e)]));
    }

    // Offizielle plan&simple-Antworten je Vorschlag
    const ids = rows.map(r => r.ID);
    const respMap = {};
    if (ids.length) {
      const { data: comments } = await supabase.from("SUGGESTION_COMMENT")
        .select("SUGGESTION_ID, BODY, CREATED_AT").in("SUGGESTION_ID", ids).eq("AUTHOR_KIND", "vendor");
      for (const c of comments || [])
        (respMap[c.SUGGESTION_ID] = respMap[c.SUGGESTION_ID] || []).push({ body: c.BODY, created_at: c.CREATED_AT });
    }

    res.json({
      org_view: orgView,
      data: rows.map(r => ({
        id:               r.ID,
        title:            r.TITLE,
        body:             r.BODY,
        category:         r.CATEGORY,
        priority_hint:    r.PRIORITY_HINT,
        moderation_state: r.MODERATION_STATE,
        lifecycle_status: r.LIFECYCLE_STATUS,
        vote_count:       r.VOTE_COUNT,
        created_at:       r.CREATED_AT,
        submitter:        orgView ? (nameMap[r.EMPLOYEE_ID] || null) : null,
        is_mine:          r.EMPLOYEE_ID === req.employeeId,
        vendor_responses: respMap[r.ID] || [],
      })),
    });
  });

  // GET /suggestions/board — veröffentlichte Vorschläge (pseudonym, mandantenübergreifend)
  router.get("/suggestions/board", requirePermission("service.suggestions.view"), async (req, res) => {
    const sort = req.query.sort === "new" ? "new" : "popular";
    let q = supabase.from("SUGGESTION").select("*")
      .eq("MODERATION_STATE", "published").is("MERGED_INTO_ID", null);
    q = sort === "new"
      ? q.order("PUBLISHED_AT", { ascending: false })
      : q.order("VOTE_COUNT", { ascending: false }).order("PUBLISHED_AT", { ascending: false });
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];
    const ids = rows.map(r => r.ID);

    const myVotes = new Set();
    const commentCount = {};
    if (ids.length) {
      const [{ data: votes }, { data: cs }] = await Promise.all([
        supabase.from("SUGGESTION_VOTE").select("SUGGESTION_ID").eq("TENANT_ID", req.tenantId).in("SUGGESTION_ID", ids),
        supabase.from("SUGGESTION_COMMENT").select("SUGGESTION_ID")
          .eq("MODERATION_STATE", "published").eq("VISIBILITY", "public").in("SUGGESTION_ID", ids),
      ]);
      for (const v of votes || []) myVotes.add(v.SUGGESTION_ID);
      for (const c of cs || []) commentCount[c.SUGGESTION_ID] = (commentCount[c.SUGGESTION_ID] || 0) + 1;
    }

    const delegateId = await getDelegateId(req.tenantId);
    res.json({
      can_vote: req.employeeId === delegateId,
      data: rows.map(r => ({
        id:               r.ID,
        title:            r.PUBLIC_TITLE || r.TITLE,
        body:             r.PUBLIC_BODY  || r.BODY,
        category:         r.CATEGORY,
        lifecycle_status: r.LIFECYCLE_STATUS,
        vote_count:       r.VOTE_COUNT,
        comment_count:    commentCount[r.ID] || 0,
        has_my_vote:      myVotes.has(r.ID),
        published_at:     r.PUBLISHED_AT,
      })),
    });
  });

  // GET /suggestions/:id — Detail (Board pseudonym ODER eigener Vorschlag)
  router.get("/suggestions/:id", requirePermission("service.suggestions.view"), async (req, res) => {
    const id = Number(req.params.id);
    const { data: s } = await supabase.from("SUGGESTION").select("*").eq("ID", id).maybeSingle();
    if (!s) return res.status(404).json({ error: "Nicht gefunden" });
    const isOwnOrg = s.TENANT_ID === req.tenantId;
    const isPublished = s.MODERATION_STATE === "published";
    if (!isPublished && !isOwnOrg) return res.status(404).json({ error: "Nicht gefunden" });

    const { data: comments } = await supabase.from("SUGGESTION_COMMENT")
      .select("BODY, AUTHOR_KIND, VISIBILITY, MODERATION_STATE, CREATED_AT")
      .eq("SUGGESTION_ID", id).order("CREATED_AT", { ascending: true });
    const visibleComments = (comments || []).filter(c =>
      c.AUTHOR_KIND === "vendor" || (c.MODERATION_STATE === "published" && c.VISIBILITY === "public")
    ).map(c => ({
      body:        c.BODY,
      author:      c.AUTHOR_KIND === "vendor" ? "plan&simple Team" : "Anwender",
      is_official: c.AUTHOR_KIND === "vendor",
      created_at:  c.CREATED_AT,
    }));

    const delegateId = await getDelegateId(req.tenantId);
    let hasMyVote = false;
    if (isPublished) {
      const { data: v } = await supabase.from("SUGGESTION_VOTE")
        .select("ID").eq("SUGGESTION_ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
      hasMyVote = !!v;
    }

    res.json({
      data: {
        id:               s.ID,
        title:            isPublished ? (s.PUBLIC_TITLE || s.TITLE) : s.TITLE,
        body:             isPublished ? (s.PUBLIC_BODY  || s.BODY)  : s.BODY,
        category:         s.CATEGORY,
        lifecycle_status: s.LIFECYCLE_STATUS,
        moderation_state: s.MODERATION_STATE,
        vote_count:       s.VOTE_COUNT,
        has_my_vote:      hasMyVote,
        can_vote:         req.employeeId === delegateId && isPublished,
        is_own_org:       isOwnOrg,
        comments:         visibleComments,
        created_at:       s.CREATED_AT,
      },
    });
  });

  // POST /suggestions/:id/vote — abstimmen (nur Produkt-Sprecher)
  router.post("/suggestions/:id/vote", requirePermission("service.suggestions.view"), async (req, res) => {
    const id = Number(req.params.id);
    const delegateId = await getDelegateId(req.tenantId);
    if (req.employeeId !== delegateId)
      return res.status(403).json({ error: "Nur der Produkt-Sprecher Ihrer Organisation kann abstimmen." });
    const { data: s } = await supabase.from("SUGGESTION").select("ID, MODERATION_STATE").eq("ID", id).maybeSingle();
    if (!s || s.MODERATION_STATE !== "published") return res.status(404).json({ error: "Vorschlag nicht verfügbar" });
    await supabase.from("SUGGESTION_VOTE").upsert(
      [{ SUGGESTION_ID: id, TENANT_ID: req.tenantId, EMPLOYEE_ID: req.employeeId }],
      { onConflict: "SUGGESTION_ID,TENANT_ID" }
    );
    const count = await refreshVoteCount(id);
    res.json({ has_my_vote: true, vote_count: count });
  });

  // DELETE /suggestions/:id/vote — Stimme zurückziehen
  router.delete("/suggestions/:id/vote", requirePermission("service.suggestions.view"), async (req, res) => {
    const id = Number(req.params.id);
    const delegateId = await getDelegateId(req.tenantId);
    if (req.employeeId !== delegateId)
      return res.status(403).json({ error: "Nur der Produkt-Sprecher Ihrer Organisation kann abstimmen." });
    await supabase.from("SUGGESTION_VOTE").delete().eq("SUGGESTION_ID", id).eq("TENANT_ID", req.tenantId);
    const count = await refreshVoteCount(id);
    res.json({ has_my_vote: false, vote_count: count });
  });

  // POST /suggestions/:id/comments — kommentieren (nur Sprecher; wird moderiert)
  router.post("/suggestions/:id/comments", requirePermission("service.suggestions.view"), async (req, res) => {
    const id = Number(req.params.id);
    const delegateId = await getDelegateId(req.tenantId);
    if (req.employeeId !== delegateId)
      return res.status(403).json({ error: "Nur der Produkt-Sprecher Ihrer Organisation kann kommentieren." });
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Kommentar darf nicht leer sein" });
    const { data: s } = await supabase.from("SUGGESTION").select("ID, MODERATION_STATE").eq("ID", id).maybeSingle();
    if (!s || s.MODERATION_STATE !== "published") return res.status(404).json({ error: "Vorschlag nicht verfügbar" });
    const { error } = await supabase.from("SUGGESTION_COMMENT").insert([{
      SUGGESTION_ID: id, TENANT_ID: req.tenantId, EMPLOYEE_ID: req.employeeId,
      BODY: body, AUTHOR_KIND: "user", VISIBILITY: "public", MODERATION_STATE: "pending",
    }]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, pending: true });
  });

  return router;
};
