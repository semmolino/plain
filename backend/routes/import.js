"use strict";

const express = require("express");
const multer = require("multer");
const ctrl = require("../controllers/importController");
const { requirePermission } = require("../middleware/permissions");

// Datei im Speicher halten (kein Schreiben auf Platte); 5 MB Limit; nur Tabellen.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname || "");
    cb(ok ? null : { status: 400, message: "Nur CSV-, XLSX- oder XLS-Dateien werden unterstützt" }, ok);
  },
});

const GUARD = requirePermission("import.manage");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/domains",              GUARD, (req, res) => ctrl.getDomains(req, res));
  router.get("/batches",              GUARD, (req, res) => ctrl.getBatches(req, res, supabase));
  router.post("/batches/:id/rollback", GUARD, (req, res) => ctrl.postRollback(req, res, supabase));
  router.get("/:domain/template",     GUARD, (req, res) => ctrl.getTemplate(req, res));
  router.post("/:domain/preview",     GUARD, upload.single("file"), (req, res) => ctrl.postPreview(req, res, supabase));
  router.post("/:domain/commit",      GUARD, upload.single("file"), (req, res) => ctrl.postCommit(req, res, supabase));

  return router;
};
