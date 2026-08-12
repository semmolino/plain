const express = require("express");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { checkStorageLimit } = require("../middleware/limits");
const objectStorage = require("../services/objectStorage");

function isTableMissingErr(err, tableName) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("relation") && msg.includes(String(tableName).toLowerCase()) && msg.includes("does not exist");
}

module.exports = (supabase) => {
  const router = express.Router();

  async function resolveCompanyId(tenantId) {
    const { data, error } = await supabase
      .from("COMPANY")
      .select("ID")
      .eq("TENANT_ID", tenantId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.ID ?? null;
  }

  // Speicherablage statt Plattenablage: die Datei geht direkt vom Request in
  // den Objektspeicher, ohne Zwischenstation im Dateisystem. Das ist nicht nur
  // noetig (auf Scalingo gibt es keine dauerhafte Platte), es entfernt auch die
  // Aufraeumpflicht — eine abgewiesene Datei muss nicht mehr geloescht werden,
  // weil sie nie irgendwo lag. Die Obergrenze von 10 MB unten begrenzt zugleich,
  // was maximal im Arbeitsspeicher liegen kann.
  const storage = multer.memoryStorage();

  // Schluessel wie bisher: "<tenantId>/<uuid><endung>". Bewusst unveraendert,
  // damit bestehende ASSET-Zeilen nach dem Umzug weiter aufloesen.
  const buildStorageKey = (req, originalName) =>
    `${String(req.tenantId || "0")}/${crypto.randomUUID()}${path.extname(originalName || "") || ""}`;

  const ALLOWED_MIME = new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]);

  const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
      else cb(new Error(`Dateityp nicht erlaubt: ${file.mimetype}`));
    },
  });

  // POST /api/assets/upload
  // multipart/form-data: file, asset_type
  router.post("/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });

      let companyId;
      try {
        companyId = await resolveCompanyId(req.tenantId);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
      if (!companyId) return res.status(404).json({ error: "Kein Unternehmen für diesen Mandanten gefunden." });

      // Speicherlimit (metered): inkrementell prüfen, bevor die Datei abgelegt
      // wird. Die Datei liegt zu diesem Zeitpunkt nur im Arbeitsspeicher — bei
      // Überschreitung ist deshalb nichts aufzuräumen.
      const storageCheck = await checkStorageLimit(supabase, req, req.file.size);
      if (!storageCheck.allowed) {
        return res.status(402).json({
          error:
            `Speicherlimit erreicht: ${storageCheck.limitMb} MB (belegt: ${storageCheck.usedMb} MB, ` +
            `diese Datei: ${storageCheck.incomingMb} MB). Für mehr bitte den Tarif erweitern.`,
          limit_reached: true,
          capability: "limits.storage_mb",
          limit: storageCheck.limitMb,
          used: storageCheck.usedMb,
        });
      }

      const assetType = String(req.body.asset_type || "OTHER").toUpperCase().trim();

      const storageKey = buildStorageKey(req, req.file.originalname);
      const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      await objectStorage.put(storageKey, req.file.buffer, { contentType: req.file.mimetype });

      const insertRow = {
        COMPANY_ID: companyId,
        ASSET_TYPE: assetType,
        FILE_NAME: req.file.originalname,
        MIME_TYPE: req.file.mimetype,
        FILE_SIZE: req.file.size,
        STORAGE_KEY: storageKey,
        SHA256: sha256,
      };

      const { data, error } = await supabase.from("ASSET").insert([insertRow]).select("*").maybeSingle();
      if (error) {
        // Das Objekt liegt schon im Speicher, die Zeile fehlt. Ohne Aufräumen
        // bliebe eine Datei zurück, auf die nichts verweist — unauffindbar,
        // aber sie zählt weiter gegen das Speicherlimit des Mandanten.
        await objectStorage.remove(storageKey).catch(() => {});
        if (isTableMissingErr(error, "asset")) {
          return res.status(501).json({ error: "Missing table ASSET. Please run backend/sql/stageA_document_templates.sql" });
        }
        return res.status(500).json({ error: error.message });
      }

      res.json({
        data,
        url: `/api/assets/${data.ID}`,
      });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // GET /api/assets/:id
  router.get("/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });

      let companyId;
      try { companyId = await resolveCompanyId(req.tenantId); } catch (e) { return res.status(500).json({ error: e.message }); }

      const { data, error } = await supabase.from("ASSET").select("*").eq("ID", id).eq("COMPANY_ID", companyId).maybeSingle();
      if (error) {
        if (isTableMissingErr(error, "asset")) {
          return res.status(501).json({ error: "Missing table ASSET. Please run backend/sql/stageA_document_templates.sql" });
        }
        return res.status(500).json({ error: error.message });
      }
      if (!data) return res.status(404).json({ error: "not found" });

      const obj = await objectStorage.getStream(data.STORAGE_KEY);
      if (!obj) return res.status(404).json({ error: "file missing on disk" });

      res.setHeader("Content-Type", data.MIME_TYPE || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(data.FILE_NAME || "asset")}"`);
      obj.stream.pipe(res);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  return router;
};
