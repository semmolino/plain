"use strict";
const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const { requirePermission, requireAnyPermission } = require("../middleware/permissions");
const { sendMail } = require("../services/emailService");
const { stripImageMetadata } = require("../services/imageStrip");
const objectStorage = require("../services/objectStorage");
const { sendeDateiSicher } = require("../services/fileResponse");

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

  // Best-effort interne Benachrichtigung an plan&simple bei neuen Einträgen.
  // Nur aktiv, wenn SERVICE_NOTIFY_EMAIL gesetzt ist; bricht nie die Anfrage ab.
  function notifyVendorNewItem({ kind, subject, category }) {
    const to = String(process.env.SERVICE_NOTIFY_EMAIL || "").trim();
    if (!to) return;
    sendMail({
      supabase,
      to,
      subject: `[plan&simple Service] Neu: ${kind} — ${subject}`,
      text: `Es ist ein neuer Eintrag im Service-Bereich eingegangen.\n\nArt: ${kind}\nKategorie: ${category || "-"}\nBetreff/Titel: ${subject}\n\nBitte in der Owner-Konsole bearbeiten.`,
    }).catch((e) => console.warn("[service] vendor notify failed:", e?.message || e));
  }

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

  // ── Organisationsinterne Freigabe ───────────────────────────────────────────
  //
  // Einreichen darf jeder mit service.suggestions.view. Nach aussen geht ein
  // Vorschlag aber erst, wenn der Produkt-Sprecher ihn freigegeben hat: er
  // spricht damit fuer das ganze Buero, und der Originaltext kann Projekt-,
  // Bauherren- oder Kollegennamen enthalten.
  //
  // RBAC: bewusst KEINE neue Permission. Wer freigeben darf, haengt — wie beim
  // Abstimmen und Kommentieren — an der Rolle "Produkt-Sprecher" aus
  // TENANT_SETTINGS, nicht am Rechtekatalog. service.suggestions.admin (der
  // Administrator, der den Sprecher bestimmt) darf zusaetzlich freigeben,
  // sonst steht das Verfahren still, solange kein Sprecher benannt oder dieser
  // im Urlaub ist.
  async function darfFreigeben(req) {
    if (req.hasPermission("service.suggestions.admin")) return true;
    const delegateId = await getDelegateId(req.tenantId);
    return delegateId != null && req.employeeId === delegateId;
  }

  // POST /suggestions — neuen Vorschlag einreichen
  router.post("/suggestions", requirePermission("service.suggestions.view"), async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    const body  = String(b.body || "").trim();
    if (!title || !body) return res.status(400).json({ error: "Titel und Beschreibung sind erforderlich" });
    const category = CATEGORIES.includes(b.category) ? b.category : "sonstiges";
    const priority = PRIORITIES.includes(b.priority_hint) ? b.priority_hint : null;

    // Reicht der Sprecher selbst ein, ist die Freigabe bereits erteilt — er
    // muesste sonst seinen eigenen Vorschlag ein zweites Mal bestaetigen.
    // Ein Administrator ist nicht automatisch der Sprecher: seine Einreichung
    // wartet wie jede andere.
    const delegateId = await getDelegateId(req.tenantId);
    const selbstFreigegeben = delegateId != null && req.employeeId === delegateId;
    const jetzt = new Date().toISOString();

    const { data, error } = await supabase.from("SUGGESTION").insert([{
      TENANT_ID:        req.tenantId,
      EMPLOYEE_ID:      req.employeeId,
      TITLE:            title.slice(0, 200),
      BODY:             body,
      CATEGORY:         category,
      PRIORITY_HINT:    priority,
      MODERATION_STATE: "pending",
      LIFECYCLE_STATUS: "new",
      ORG_STATE:        selbstFreigegeben ? "released" : "draft",
      ORG_RELEASED_AT:  selbstFreigegeben ? jetzt : null,
      ORG_RELEASED_BY:  selbstFreigegeben ? req.employeeId : null,
    }]).select("*").single();
    if (error) return res.status(500).json({ error: error.message });

    // plan&simple erfaehrt erst bei der Freigabe davon.
    if (selbstFreigegeben) notifyVendorNewItem({ kind: "Vorschlag", subject: title, category });

    res.json({ data, org_state: selbstFreigegeben ? "released" : "draft" });
  });

  // POST /suggestions/:id/release — Freigabe durch den Produkt-Sprecher
  // POST /suggestions/:id/reject  — Ablehnung, mit Begruendung fuer den Einreicher
  for (const aktion of ["release", "reject"]) {
    router.post(`/suggestions/:id/${aktion}`, requirePermission("service.suggestions.view"), async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Ungültige ID" });

      if (!(await darfFreigeben(req))) {
        return res.status(403).json({ error: "Nur der Produkt-Sprecher Ihrer Organisation kann Vorschläge freigeben." });
      }

      const grund = String(req.body?.reason || "").trim();
      if (aktion === "reject" && !grund) {
        return res.status(400).json({ error: "Bitte begründen Sie kurz, warum der Vorschlag nicht rausgeht — der Einreicher sieht diesen Text." });
      }

      // .eq TENANT_ID: eine Freigabe wirkt nur im eigenen Haus.
      const { data: s } = await supabase
        .from("SUGGESTION").select("ID, TITLE, CATEGORY, ORG_STATE")
        .eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
      if (!s) return res.status(404).json({ error: "Vorschlag nicht gefunden" });
      if (s.ORG_STATE !== "draft") {
        return res.status(409).json({ error: "Über diesen Vorschlag wurde bereits entschieden." });
      }

      const jetzt = new Date().toISOString();
      const { data: geaendert, error } = await supabase.from("SUGGESTION").update({
        ORG_STATE:         aktion === "release" ? "released" : "rejected",
        ORG_RELEASED_AT:   jetzt,
        ORG_RELEASED_BY:   req.employeeId,
        ORG_DECIDE_REASON: grund || null,
        UPDATED_AT:        jetzt,
      }).eq("ID", id).eq("TENANT_ID", req.tenantId).select("ID");
      if (error) return res.status(500).json({ error: error.message });
      if (!geaendert || geaendert.length !== 1) {
        return res.status(500).json({ error: "Die Entscheidung konnte nicht gespeichert werden." });
      }

      // Erst jetzt verlaesst der Vorschlag das Haus.
      if (aktion === "release") {
        notifyVendorNewItem({ kind: "Vorschlag", subject: s.TITLE, category: s.CATEGORY });
      }

      res.json({ ok: true, org_state: aktion === "release" ? "released" : "rejected" });
    });
  }

  // GET /suggestions/mine — eigene (bzw. org-weite für Sprecher/Admin) Einreichungen
  router.get("/suggestions/mine", requirePermission("service.suggestions.view"), async (req, res) => {
    const delegateId = await getDelegateId(req.tenantId);
    const orgView = req.hasPermission("service.suggestions.admin") || req.employeeId === delegateId;

    let q = supabase.from("SUGGESTION").select("*").eq("TENANT_ID", req.tenantId);
    if (!orgView) q = q.eq("EMPLOYEE_ID", req.employeeId);
    const { data, error } = await q.order("CREATED_AT", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];

    // Einreicher-Namen nur innerhalb der eigenen Org (datenschutz-unkritisch).
    // Der Name dessen, der ueber die Freigabe entschieden hat, gehoert dazu:
    // ein Einreicher soll sehen, WER seinen Vorschlag nicht rausgehen liess.
    let nameMap = {};
    const empIds = [...new Set(rows.flatMap(r => [
      ...(orgView ? [r.EMPLOYEE_ID] : []),
      ...(r.ORG_RELEASED_BY != null ? [r.ORG_RELEASED_BY] : []),
    ]))];
    if (empIds.length) {
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
      org_view:     orgView,
      // Steuert, ob die Oberflaeche die Freigabe-Knoepfe zeigt.
      can_release:  await darfFreigeben(req),
      data: rows.map(r => ({
        id:               r.ID,
        title:            r.TITLE,
        body:             r.BODY,
        category:         r.CATEGORY,
        priority_hint:    r.PRIORITY_HINT,
        moderation_state: r.MODERATION_STATE,
        lifecycle_status: r.LIFECYCLE_STATUS,
        // Bestandszeilen vor Migration 0132 gelten als freigegeben — sie waren
        // bereits uebermittelt.
        org_state:        r.ORG_STATE || "released",
        org_decided_by:   r.ORG_RELEASED_BY != null ? (nameMap[r.ORG_RELEASED_BY] || null) : null,
        org_decide_reason: r.ORG_DECIDE_REASON || null,
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

  // ── Feedback & Unterstützung (SERVICE_REQUEST, privat: Org ↔ plan&simple) ───
  const REQUEST_KINDS = ["feedback", "support"];
  const FEEDBACK_CATEGORIES = ["lob", "kritik", "frage", "sonstiges"];
  const SUPPORT_CATEGORIES = ["datenimport", "ersteinrichtung", "rechnungen", "projekte", "benutzer", "technik", "sonstiges"];
  const URGENCIES = ["question", "impaired", "blocker"];

  function permForKind(kind) {
    return kind === "feedback" ? "service.feedback.use" : "service.support.use";
  }

  // GET /requests/contact — Vorbelegung aus Login (Name, E-Mail, Organisation)
  router.get("/requests/contact", async (req, res) => {
    const [{ data: emp }, { data: comp }] = await Promise.all([
      supabase.from("EMPLOYEE").select("FIRST_NAME, LAST_NAME, SHORT_NAME, MAIL").eq("ID", req.employeeId).eq("TENANT_ID", req.tenantId).maybeSingle(),
      supabase.from("COMPANY").select("COMPANY_NAME_1").eq("TENANT_ID", req.tenantId).order("ID", { ascending: true }).limit(1).maybeSingle(),
    ]);
    res.json({
      name:  emp ? ([emp.FIRST_NAME, emp.LAST_NAME].filter(Boolean).join(" ").trim() || emp.SHORT_NAME || "") : "",
      email: emp?.MAIL || "",
      org:   comp?.COMPANY_NAME_1 || "",
    });
  });

  // POST /requests — Feedback- oder Support-Anfrage anlegen
  router.post("/requests", async (req, res) => {
    const b = req.body || {};
    const kind = REQUEST_KINDS.includes(b.kind) ? b.kind : null;
    if (!kind) return res.status(400).json({ error: "Ungültige Anfrageart" });
    if (!req.hasPermission(permForKind(kind)))
      return res.status(403).json({ error: `Fehlende Berechtigung: ${permForKind(kind)}` });

    const subject = String(b.subject || "").trim();
    const body    = String(b.body || "").trim();
    if (!subject || !body) return res.status(400).json({ error: "Betreff und Nachricht sind erforderlich" });

    const allowedCats = kind === "feedback" ? FEEDBACK_CATEGORIES : SUPPORT_CATEGORIES;
    const category = allowedCats.includes(b.category) ? b.category : null;
    const urgency  = kind === "support" && URGENCIES.includes(b.urgency) ? b.urgency : null;

    const { data, error } = await supabase.from("SERVICE_REQUEST").insert([{
      TENANT_ID:     req.tenantId,
      EMPLOYEE_ID:   req.employeeId,
      KIND:          kind,
      CATEGORY:      category,
      SUBJECT:       subject.slice(0, 200),
      BODY:          body,
      CONTACT_NAME:  b.contact_name ? String(b.contact_name).slice(0, 200) : null,
      CONTACT_EMAIL: b.contact_email ? String(b.contact_email).slice(0, 200) : null,
      WANTS_REPLY:   b.wants_reply !== false,
      URGENCY:       urgency,
      STATUS:        "new",
    }]).select("ID").single();
    if (error) return res.status(500).json({ error: error.message });
    notifyVendorNewItem({ kind: kind === "feedback" ? "Feedback" : "Unterstützung", subject, category });
    res.json({ data });
  });

  // GET /requests/mine?kind= — eigene Anfragen
  router.get("/requests/mine", async (req, res) => {
    const kind = REQUEST_KINDS.includes(req.query.kind) ? req.query.kind : null;
    // Sichtbar nur, wenn man das jeweilige Recht hat (Feedback/Support).
    let q = supabase.from("SERVICE_REQUEST").select("*")
      .eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", req.employeeId);
    if (kind) q = q.eq("KIND", kind);
    const { data, error } = await q.order("CREATED_AT", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      data: (data || []).map(r => ({
        id: r.ID, kind: r.KIND, category: r.CATEGORY, subject: r.SUBJECT, body: r.BODY,
        status: r.STATUS, urgency: r.URGENCY, wants_reply: r.WANTS_REPLY, created_at: r.CREATED_AT,
      })),
    });
  });

  // GET /requests/:id — eigene Anfrage inkl. Nachrichten-Thread
  router.get("/requests/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { data: r } = await supabase.from("SERVICE_REQUEST").select("*")
      .eq("ID", id).eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", req.employeeId).maybeSingle();
    if (!r) return res.status(404).json({ error: "Nicht gefunden" });
    const { data: msgs } = await supabase.from("SERVICE_REQUEST_MESSAGE")
      .select("AUTHOR_KIND, BODY, CREATED_AT").eq("REQUEST_ID", id).order("CREATED_AT", { ascending: true });
    res.json({
      data: {
        id: r.ID, kind: r.KIND, category: r.CATEGORY, subject: r.SUBJECT, body: r.BODY,
        status: r.STATUS, urgency: r.URGENCY, created_at: r.CREATED_AT,
        messages: (msgs || []).map(m => ({
          body: m.BODY,
          author: m.AUTHOR_KIND === "vendor" ? "plan&simple Team" : "Sie",
          is_vendor: m.AUTHOR_KIND === "vendor",
          created_at: m.CREATED_AT,
        })),
      },
    });
  });

  // POST /requests/:id/messages — Nachricht zum eigenen Vorgang hinzufügen
  router.post("/requests/:id/messages", async (req, res) => {
    const id = Number(req.params.id);
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Nachricht darf nicht leer sein" });
    const { data: r } = await supabase.from("SERVICE_REQUEST").select("ID")
      .eq("ID", id).eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", req.employeeId).maybeSingle();
    if (!r) return res.status(404).json({ error: "Nicht gefunden" });
    const { error } = await supabase.from("SERVICE_REQUEST_MESSAGE").insert([{
      REQUEST_ID: id, AUTHOR_KIND: "user", EMPLOYEE_ID: req.employeeId, BODY: body,
    }]);
    if (error) return res.status(500).json({ error: error.message });
    // Anwender meldet sich erneut → Vorgang wieder „offen" (waiting/resolved -> new), aber nicht closed reaktivieren.
    await supabase.from("SERVICE_REQUEST")
      .update({ STATUS: "new", UPDATED_AT: new Date().toISOString() })
      .eq("ID", id).in("STATUS", ["waiting", "resolved"]);
    res.json({ ok: true });
  });

  // ── Anhänge (Screenshots) — NIE öffentlich, nur eigene Org + plan&simple ────
  // Nur Bilder (png/jpeg), max. 5 MB, max. 3 je Eintrag. Metadaten werden beim
  // Upload entfernt (EXIF/GPS-Strip). Siehe docs/SERVICE_AREA_CONCEPT.md §1.2.
  const ATT_ALLOWED = new Set(["image/png", "image/jpeg"]);
  const ATT_MAX_BYTES = 5 * 1024 * 1024;
  const ATT_MAX_COUNT = 3;

  const attUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATT_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (ATT_ALLOWED.has(file.mimetype)) cb(null, true);
      else cb(Object.assign(new Error("Nur PNG- oder JPEG-Bilder erlaubt."), { status: 400 }));
    },
  });
  // Multer-Fehler (z. B. zu groß / falscher Typ) sauber als 400 zurückgeben.
  function withUpload(handler) {
    return (req, res) => attUpload.single("file")(req, res, (err) => {
      if (err) return res.status(err.status || 400).json({ error: err.message || "Upload fehlgeschlagen" });
      handler(req, res).catch((e) => res.status(e?.status || 500).json({ error: e?.message || String(e) }));
    });
  }

  const ATT = {
    suggestion: { parent: "SUGGESTION", child: "SUGGESTION_ATTACHMENT", fk: "SUGGESTION_ID" },
    request:    { parent: "SERVICE_REQUEST", child: "SERVICE_REQUEST_ATTACHMENT", fk: "REQUEST_ID" },
  };

  // Lädt den Eltern-Datensatz, sofern er zur eigenen Organisation gehört.
  async function loadParent(kind, id, req, ownerOnly) {
    const cfg = ATT[kind];
    const { data } = await supabase.from(cfg.parent).select("ID, TENANT_ID, EMPLOYEE_ID").eq("ID", id).maybeSingle();
    if (!data || data.TENANT_ID !== req.tenantId) return null;
    if (ownerOnly && data.EMPLOYEE_ID !== req.employeeId) return null;
    return data;
  }

  function makeAttachmentRoutes(kind, basePath) {
    const cfg = ATT[kind];

    // POST upload (nur Eigentümer)
    router.post(`${basePath}/:id/attachments`, withUpload(async (req, res) => {
      const id = Number(req.params.id);
      if (!req.file) return res.status(400).json({ error: "Datei fehlt" });
      const parent = await loadParent(kind, id, req, true);
      if (!parent) return res.status(404).json({ error: "Nicht gefunden" });

      const { data: existing } = await supabase.from(cfg.child).select("ID").eq(cfg.fk, id);
      if ((existing || []).length >= ATT_MAX_COUNT)
        return res.status(400).json({ error: `Maximal ${ATT_MAX_COUNT} Anhänge je Eintrag.` });

      // Metadaten entfernen, dann unter <tenant>/service/<uuid>.<ext> ablegen.
      const cleaned = stripImageMetadata(req.file.buffer, req.file.mimetype);
      const ext = req.file.mimetype === "image/png" ? ".png" : ".jpg";
      const storageKey = `${req.tenantId}/service/${crypto.randomUUID()}${ext}`;
      await objectStorage.put(storageKey, cleaned, { contentType: req.file.mimetype });

      const { data, error } = await supabase.from(cfg.child).insert([{
        [cfg.fk]: id, TENANT_ID: req.tenantId, STORAGE_KEY: storageKey,
        FILENAME: (req.file.originalname || "screenshot").slice(0, 200),
        MIME_TYPE: req.file.mimetype, SIZE_BYTES: cleaned.length, CREATED_BY: req.employeeId,
      }]).select("ID, FILENAME, MIME_TYPE, SIZE_BYTES").single();
      if (error) {
        // Sonst bliebe ein Bild ohne zugehörige Zeile liegen (siehe assets.js).
        await objectStorage.remove(storageKey).catch(() => {});
        return res.status(500).json({ error: error.message });
      }
      res.json({ data: { id: data.ID, filename: data.FILENAME, mime_type: data.MIME_TYPE, size_bytes: data.SIZE_BYTES } });
    }));

    // GET Liste (eigene Org — Sichtbarkeit erzwingt loadParent)
    router.get(`${basePath}/:id/attachments`, async (req, res) => {
      const id = Number(req.params.id);
      const parent = await loadParent(kind, id, req, false);
      if (!parent) return res.json({ data: [] });
      const { data } = await supabase.from(cfg.child)
        .select("ID, FILENAME, MIME_TYPE, SIZE_BYTES, CREATED_AT").eq(cfg.fk, id).order("CREATED_AT", { ascending: true });
      res.json({ data: (data || []).map(a => ({ id: a.ID, filename: a.FILENAME, mime_type: a.MIME_TYPE, size_bytes: a.SIZE_BYTES, created_at: a.CREATED_AT })) });
    });

    // GET Datei (eigene Org) — streamt das Bild
    router.get(`${basePath}/:id/attachments/:attId/file`, async (req, res) => {
      const id = Number(req.params.id);
      const attId = Number(req.params.attId);
      const parent = await loadParent(kind, id, req, false);
      if (!parent) return res.status(404).json({ error: "Nicht gefunden" });
      const { data: att } = await supabase.from(cfg.child)
        .select("STORAGE_KEY, MIME_TYPE, FILENAME, TENANT_ID").eq("ID", attId).eq(cfg.fk, id).maybeSingle();
      if (!att || att.TENANT_ID !== req.tenantId) return res.status(404).json({ error: "Nicht gefunden" });
      const obj = await objectStorage.getStream(att.STORAGE_KEY);
      if (!obj) return res.status(404).json({ error: "Datei fehlt" });
      sendeDateiSicher(res, obj.stream, att.MIME_TYPE, att.FILENAME);
    });

    // DELETE (nur Eigentümer)
    router.delete(`${basePath}/:id/attachments/:attId`, async (req, res) => {
      const id = Number(req.params.id);
      const attId = Number(req.params.attId);
      const parent = await loadParent(kind, id, req, true);
      if (!parent) return res.status(404).json({ error: "Nicht gefunden" });
      const { data: att } = await supabase.from(cfg.child).select("STORAGE_KEY").eq("ID", attId).eq(cfg.fk, id).maybeSingle();
      if (att?.STORAGE_KEY) {
        try { await objectStorage.remove(att.STORAGE_KEY); } catch { /* Datei evtl. schon weg */ }
      }
      await supabase.from(cfg.child).delete().eq("ID", attId).eq(cfg.fk, id).eq("TENANT_ID", req.tenantId);
      res.json({ ok: true });
    });
  }

  makeAttachmentRoutes("suggestion", "/suggestions");
  makeAttachmentRoutes("request", "/requests");

  return router;
};
