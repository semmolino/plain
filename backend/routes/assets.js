const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

function isTableMissingErr(err, tableName) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("relation") && msg.includes(String(tableName).toLowerCase()) && msg.includes("does not exist");
}

module.exports = (supabase) => {
  const router = express.Router();

  const uploadRoot = path.join(__dirname, "..", "uploads");
  if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const companyId = String(req.body.company_id || "0");
      const dir = path.join(uploadRoot, companyId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "") || "";
      const name = `${crypto.randomUUID()}${ext}`;
      cb(null, name);
    },
  });

  const upload = multer({ storage });

  // POST /api/assets/upload
  // multipart/form-data: file, company_id, asset_type
  router.post("/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });

      const companyId = parseInt(String(req.body.company_id || ""), 10);
      if (!companyId || Number.isNaN(companyId)) return res.status(400).json({ error: "company_id is required" });

      const assetType = String(req.body.asset_type || "OTHER").toUpperCase().trim();

      const storageKey = path.relative(uploadRoot, req.file.path).replace(/\\/g, "/");
      const fileBuf = fs.readFileSync(req.file.path);
      const sha256 = crypto.createHash("sha256").update(fileBuf).digest("hex");

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

      const { data, error } = await supabase.from("ASSET").select("*").eq("ID", id).maybeSingle();
      if (error) {
        if (isTableMissingErr(error, "asset")) {
          return res.status(501).json({ error: "Missing table ASSET. Please run backend/sql/stageA_document_templates.sql" });
        }
        return res.status(500).json({ error: error.message });
      }
      if (!data) return res.status(404).json({ error: "not found" });

      const filePath = path.join(uploadRoot, data.STORAGE_KEY);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "file missing on disk" });

      res.setHeader("Content-Type", data.MIME_TYPE || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(data.FILE_NAME || "asset")}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  return router;
};
