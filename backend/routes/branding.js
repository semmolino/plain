"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

module.exports = (supabase) => {
  const router = express.Router();

  /** Lookup tenant by slug, return null if not found. */
  async function lookupTenantBySlug(slug) {
    if (!SLUG_REGEX.test(slug)) return null;
    const { data } = await supabase
      .from("TENANTS")
      .select("ID, TENANT")
      .eq("SLUG", slug)
      .maybeSingle();
    return data || null;
  }

  /** Liest die fuer Login-Branding relevanten TENANT_SETTINGS. */
  async function readBrandingSettings(tenantId) {
    try {
      const { data } = await supabase
        .from("TENANT_SETTINGS")
        .select("KEY,VALUE")
        .eq("TENANT_ID", tenantId)
        .in("KEY", ["tenant.hero_asset_id", "tenant.theme_default"]);
      const map = new Map((data || []).map(r => [r.KEY, r.VALUE]));
      return {
        heroAssetId: map.get("tenant.hero_asset_id") ? parseInt(map.get("tenant.hero_asset_id"), 10) : null,
        themeDefault: map.get("tenant.theme_default") || null,
      };
    } catch (_) {
      return { heroAssetId: null, themeDefault: null };
    }
  }

  /**
   * GET /api/v1/branding/login/:slug
   * PUBLIC -- liefert die Login-Branding-Info fuer einen Tenant.
   *
   * Antwort:
   *   { tenant_name, hero_url }
   * hero_url ist entweder:
   *   - /api/v1/branding/login/<slug>/hero            (wenn Custom-Bild)
   *   - /themes/<theme>-foto/hero.jpg?v=2             (wenn Theme-Default-Foto)
   *   - null                                          (Theme ohne Foto)
   */
  router.get("/login/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").toLowerCase();
      const tenant = await lookupTenantBySlug(slug);
      if (!tenant) return res.status(404).json({ error: "Unbekannter Slug." });

      const { heroAssetId, themeDefault } = await readBrandingSettings(tenant.ID);

      let heroUrl = null;
      if (heroAssetId) {
        // Custom-Bild -- ueber Streaming-Endpoint
        heroUrl = `/api/v1/branding/login/${slug}/hero`;
      } else if (themeDefault && themeDefault.endsWith("-foto")) {
        // Theme-Default-Stockfoto via statisches Public-Asset
        heroUrl = `/themes/${themeDefault}/hero.jpg?v=2`;
      }

      res.json({
        data: {
          tenant_name: tenant.TENANT,
          hero_url:    heroUrl,
          theme:       themeDefault,
        },
      });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /**
   * GET /api/v1/branding/login/:slug/hero
   * PUBLIC -- streamt das Custom-Hero-Bild des Tenants.
   * 404 wenn kein Custom-Bild gesetzt oder Slug unbekannt.
   */
  router.get("/login/:slug/hero", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").toLowerCase();
      const tenant = await lookupTenantBySlug(slug);
      if (!tenant) return res.status(404).send("not found");

      const { heroAssetId } = await readBrandingSettings(tenant.ID);
      if (!heroAssetId) return res.status(404).send("kein custom-bild");

      const { data: asset, error } = await supabase
        .from("ASSET")
        .select("MIME_TYPE, STORAGE_KEY, FILE_NAME")
        .eq("ID", heroAssetId)
        .maybeSingle();
      if (error || !asset) return res.status(404).send("asset nicht gefunden");

      const uploadRoot = path.join(__dirname, "..", "uploads");
      const filePath = path.join(uploadRoot, asset.STORAGE_KEY);
      if (!fs.existsSync(filePath)) return res.status(404).send("file fehlt auf disk");

      res.setHeader("Content-Type", asset.MIME_TYPE || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=300"); // 5 min Cache OK
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      res.status(500).send(e?.message || String(e));
    }
  });

  return router;
};
