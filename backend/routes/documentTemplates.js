const express = require("express");

function isTableMissingErr(err, tableName) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("relation") && msg.includes(String(tableName).toLowerCase()) && msg.includes("does not exist");
}

function defaultTheme() {
  return {
    brand: { primaryColor: "#111827", accentColor: "#2563eb", fontFamily: "Inter", fontScale: 1.0 },
    header: { showLogo: true, logoMaxHeightMm: 18 },
    footer: { textLeft: "Vielen Dank für Ihren Auftrag.", textRight: "Seite {page} von {pages}", showPageNumbers: true },
    blocks: {
      showProject: true,
      showContract: true,
      showAddressBlock: true,
      showContactBlock: true,
      showPaymentTerms: true,
      showBankDetails: true,
      showTaxSummary: true,
    },
    table: { showPositionNumbers: true, compactRows: false, showExtrasPercent: true },
  };
}

module.exports = (supabase) => {
  const router = express.Router();

  // GET /api/document-templates?company_id=..&doc_type=INVOICE
  router.get("/", async (req, res) => {
    const companyId = parseInt(String(req.query.company_id || ""), 10);
    const docType = String(req.query.doc_type || "").toUpperCase().trim();

    if (!companyId || Number.isNaN(companyId)) return res.status(400).json({ error: "company_id is required" });
    if (!docType) return res.status(400).json({ error: "doc_type is required" });

    const { data, error } = await supabase
      .from("DOCUMENT_TEMPLATE")
      .select("*")
      .eq("COMPANY_ID", companyId)
      .eq("DOC_TYPE", docType)
      .order("IS_DEFAULT", { ascending: false })
      .order("NAME", { ascending: true });

    if (error) {
      if (isTableMissingErr(error, "document_template")) {
        return res.status(501).json({ error: "Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql" });
      }
      return res.status(500).json({ error: error.message });
    }

    res.json({ data: data || [] });
  });

  // POST /api/document-templates
  router.post("/", async (req, res) => {
    const { company_id, name, doc_type, layout_key, theme_json, logo_asset_id } = req.body || {};

    const companyId = parseInt(String(company_id || ""), 10);
    const docType = String(doc_type || "").toUpperCase().trim();
    const layoutKey = String(layout_key || "modern_a").trim();
    const tplName = String(name || "").trim() || `${docType} Vorlage`;

    if (!companyId || Number.isNaN(companyId)) return res.status(400).json({ error: "company_id is required" });
    if (!docType) return res.status(400).json({ error: "doc_type is required" });

    const theme = theme_json && typeof theme_json === "object" ? theme_json : defaultTheme();
    const logoId = logo_asset_id ? parseInt(String(logo_asset_id), 10) : null;

    const insertRow = {
      COMPANY_ID: companyId,
      NAME: tplName,
      DOC_TYPE: docType,
      // Stage B1 lifecycle
      STATUS: "DRAFT",
      VERSION: 1,
      FAMILY_ID: null,
      LAYOUT_KEY: layoutKey,
      THEME_JSON: theme,
      LOGO_ASSET_ID: logoId || null,
      IS_DEFAULT: false,
      IS_ACTIVE: true,
      PUBLISHED_AT: null,
      ARCHIVED_AT: null,
      UPDATED_AT: new Date().toISOString(),
    };

    const { data: created, error } = await supabase.from("DOCUMENT_TEMPLATE").insert([insertRow]).select("*").maybeSingle();
    if (error) {

      if (isTableMissingErr(error, "document_template")) {
        return res.status(501).json({ error: "Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql" });
      }
      return res.status(500).json({ error: error.message });
    }

    let data = created;

// Ensure FAMILY_ID is set to the first version's ID
if (data && (data.FAMILY_ID === null || data.FAMILY_ID === undefined)) {
  const { data: updated, error: famErr } = await supabase
    .from("DOCUMENT_TEMPLATE")
    .update({ FAMILY_ID: data.ID, UPDATED_AT: new Date().toISOString() })
    .eq("ID", data.ID)
    .select("*")
    .maybeSingle();
  if (!famErr && updated) data = updated;
}

res.json({ data });
  });

  // PATCH /api/document-templates/:id
  router.patch("/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });

    // Stage B1 lifecycle: only DRAFT can be edited
    const { data: existing, error: exErr } = await supabase
      .from("DOCUMENT_TEMPLATE")
      .select("ID, STATUS")
      .eq("ID", id)
      .maybeSingle();
    if (exErr) return res.status(500).json({ error: exErr.message });
    if (!existing) return res.status(404).json({ error: "not found" });
    const st = String(existing.STATUS || "").toUpperCase();
    if (st && st !== "DRAFT") {
      return res.status(409).json({ error: "Only DRAFT templates can be edited. Duplicate the template to create a new draft." });
    }

    const patch = {};
    const { name, layout_key, theme_json, logo_asset_id, is_active } = req.body || {};

    if (name !== undefined) patch.NAME = String(name || "").trim() || null;
    if (layout_key !== undefined) patch.LAYOUT_KEY = String(layout_key || "").trim() || null;
    if (theme_json !== undefined) patch.THEME_JSON = theme_json && typeof theme_json === "object" ? theme_json : {};
    if (logo_asset_id !== undefined) {
      const v = logo_asset_id === null || logo_asset_id === "" ? null : parseInt(String(logo_asset_id), 10);
      patch.LOGO_ASSET_ID = Number.isFinite(v) ? v : null;
    }
    if (is_active !== undefined) patch.IS_ACTIVE = !!is_active;
    patch.UPDATED_AT = new Date().toISOString();

    const { data, error } = await supabase.from("DOCUMENT_TEMPLATE").update(patch).eq("ID", id).select("*").maybeSingle();
    if (error) {
      if (isTableMissingErr(error, "document_template")) {
        return res.status(501).json({ error: "Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql" });
      }
      return res.status(500).json({ error: error.message });
    }
    res.json({ data });
  });


  // -------------------------------------------------------
  // Stage B1: Document Template Lifecycle (Draft/Publish/Archive)
  // -------------------------------------------------------

  // POST /api/document-templates/:id/duplicate
  // Creates a new DRAFT in the same FAMILY_ID with VERSION = max+1
  router.post("/:id/duplicate", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });

    const { data: src, error: srcErr } = await supabase.from("DOCUMENT_TEMPLATE").select("*").eq("ID", id).maybeSingle();
    if (srcErr) return res.status(500).json({ error: srcErr.message });
    if (!src) return res.status(404).json({ error: "not found" });

    const familyId = src.FAMILY_ID || src.ID;

    const { data: maxRow, error: maxErr } = await supabase
      .from("DOCUMENT_TEMPLATE")
      .select("VERSION")
      .eq("FAMILY_ID", familyId)
      .order("VERSION", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxErr) return res.status(500).json({ error: maxErr.message });

    const nextVersion = (parseInt(String(maxRow?.VERSION || 0), 10) || 0) + 1;
    const nowIso = new Date().toISOString();

    const copy = {
      COMPANY_ID: src.COMPANY_ID,
      NAME: `${String(src.NAME || "").trim()} (Entwurf)`,
      DOC_TYPE: src.DOC_TYPE,
      STATUS: "DRAFT",
      VERSION: nextVersion,
      FAMILY_ID: familyId,
      LAYOUT_KEY: src.LAYOUT_KEY,
      THEME_JSON: src.THEME_JSON,
      LOGO_ASSET_ID: src.LOGO_ASSET_ID || null,
      IS_DEFAULT: false,
      IS_ACTIVE: true,
      PUBLISHED_AT: null,
      ARCHIVED_AT: null,
      UPDATED_AT: nowIso,
    };

    const { data, error } = await supabase.from("DOCUMENT_TEMPLATE").insert([copy]).select("*").maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // POST /api/document-templates/:id/publish
  router.post("/:id/publish", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });

    const { data: tpl, error: tplErr } = await supabase.from("DOCUMENT_TEMPLATE").select("ID, STATUS").eq("ID", id).maybeSingle();
    if (tplErr) return res.status(500).json({ error: tplErr.message });
    if (!tpl) return res.status(404).json({ error: "not found" });

    const st = String(tpl.STATUS || "").toUpperCase();
    if (st !== "DRAFT") return res.status(409).json({ error: "Only DRAFT templates can be published." });

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("DOCUMENT_TEMPLATE")
      .update({ STATUS: "PUBLISHED", PUBLISHED_AT: nowIso, ARCHIVED_AT: null, UPDATED_AT: nowIso, IS_ACTIVE: true })
      .eq("ID", id)
      .select("*")
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });

    res.json({ data });
  });

  // POST /api/document-templates/:id/archive
  router.post("/:id/archive", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });

    const { data: tpl, error: tplErr } = await supabase.from("DOCUMENT_TEMPLATE").select("ID, STATUS").eq("ID", id).maybeSingle();
    if (tplErr) return res.status(500).json({ error: tplErr.message });
    if (!tpl) return res.status(404).json({ error: "not found" });

    const st = String(tpl.STATUS || "").toUpperCase();
    if (st === "ARCHIVED") return res.status(409).json({ error: "Template is already archived." });

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("DOCUMENT_TEMPLATE")
      .update({ STATUS: "ARCHIVED", ARCHIVED_AT: nowIso, IS_DEFAULT: false, IS_ACTIVE: false, UPDATED_AT: nowIso })
      .eq("ID", id)
      .select("*")
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });

    res.json({ data });
  });

  // POST /api/document-templates/:id/set-default
  router.post("/:id/set-default", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });

    const { data: tpl, error: tplErr } = await supabase.from("DOCUMENT_TEMPLATE").select("ID, COMPANY_ID, DOC_TYPE, STATUS, IS_ACTIVE").eq("ID", id).maybeSingle();
    if (tplErr) {
      if (isTableMissingErr(tplErr, "document_template")) {
        return res.status(501).json({ error: "Missing table DOCUMENT_TEMPLATE. Please run backend/sql/stageA_document_templates.sql" });
      }
      return res.status(500).json({ error: tplErr.message });
    }
    if (!tpl) return res.status(404).json({ error: "not found" });

    // Stage B1 lifecycle: only active PUBLISHED templates can be set as default
    const st = String(tpl.STATUS || "").toUpperCase();
    if (st !== "PUBLISHED" || tpl.IS_ACTIVE === false) {
      return res.status(409).json({ error: "Only active PUBLISHED templates can be set as default." });
    }

    const { error: clearErr } = await supabase
      .from("DOCUMENT_TEMPLATE")
      .update({ IS_DEFAULT: false })
      .eq("COMPANY_ID", tpl.COMPANY_ID)
      .eq("DOC_TYPE", tpl.DOC_TYPE);

    if (clearErr) return res.status(500).json({ error: clearErr.message });

    const { data, error } = await supabase.from("DOCUMENT_TEMPLATE").update({ IS_DEFAULT: true }).eq("ID", id).select("*").maybeSingle();
    if (error) return res.status(500).json({ error: error.message });

    res.json({ data });
  });

  return router;
};
