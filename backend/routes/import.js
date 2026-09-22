"use strict";

const express = require("express");
const multer = require("multer");
const ctrl = require("../controllers/importController");
const { requirePermission } = require("../middleware/permissions");
const { keepScope } = require("../db");

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

// multer liest den Rumpf aus Stream-Ereignissen und verliert dabei den
// Mandanten-Kontext (siehe keepScope in db.js). Ohne die Bruecke laeuft der
// gesamte Import claimlos: die Vorschau sieht keinen Bestand, der Commit wird
// von RLS abgewiesen.
const DATEI = keepScope(upload.single("file"));

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/domains",              GUARD, (req, res) => ctrl.getDomains(req, res));
  router.get("/batches",              GUARD, (req, res) => ctrl.getBatches(req, res, supabase));
  router.post("/batches/:id/rollback", GUARD, (req, res) => ctrl.postRollback(req, res, supabase));
  router.get("/project_structure/prefill", GUARD, (req, res) => ctrl.getStructurePrefill(req, res, supabase));
  router.get("/:domain/template",     GUARD, (req, res) => ctrl.getTemplate(req, res, supabase));
  router.post("/:domain/preview",     GUARD, DATEI, (req, res) => ctrl.postPreview(req, res, supabase));
  router.post("/:domain/commit",      GUARD, DATEI, (req, res) => ctrl.postCommit(req, res, supabase));
  // Zwei Sichten auf denselben Trockenlauf. Bewusst zwei Pfade statt eines
  // Musters: Express 5 kennt ":kind(errors|warnings)" nicht mehr und wirft
  // schon beim Registrieren — der Container kam damit gar nicht erst hoch.
  router.post("/:domain/errors",   GUARD, DATEI, (req, res) => ctrl.postErrorReport(req, res, supabase, "error"));
  router.post("/:domain/warnings", GUARD, DATEI, (req, res) => ctrl.postErrorReport(req, res, supabase, "warning"));

  return router;
};
