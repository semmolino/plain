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

// ---------------------------------------------------------------------------
// Zusatzrecht fuer die Domaenen, die GEBUCHTE GELDDATEN erzeugen.
//
// `import.manage` heisst "darf Altbestand einspielen" und liegt bei Inhaber
// und Administrator. Ein Beleg-Import erzeugt daraus aber Forderungen,
// Umsatzzahlen und die Grundlage des Mahnwesens — dafuer soll zusaetzlich das
// Recht noetig sein, das in der Anwendung denselben Schritt erlaubt.
//
// Bewusst BESTEHENDE Rechte statt eines neuen `import.finance`:
// `invoices.book` heisst bereits exakt "darf einen Beleg in den gebuchten
// Zustand bringen", und es haengt schon an einer Rechnungs-Capability — ein
// Tarif ohne Rechnungsmodul sperrt den Beleg-Import damit von selbst. Ein neu
// angelegtes Recht ohne Zuordnung im Lizenz-Manifest wuerde dagegen in JEDEM
// Tarif wirken (fail-open).
// ---------------------------------------------------------------------------
const ZUSATZRECHT = {
  opening_balance:   "invoices.book",
  open_items:        "invoices.book",
  document_payments: "payments.create",
};

/** Guard fuer Routen, die die Domaene im Pfad tragen (Vorschau, Commit). */
function geldGuard(req, res, next) {
  const key = ZUSATZRECHT[req.params.domain];
  if (!key) return next();
  return requirePermission(key)(req, res, next);
}

/**
 * Dasselbe fuer den Rollback — dort steht die Domaene NICHT im Pfad, sondern
 * im Stapel. Ohne diese Pruefung duerfte jemand Umsatzzahlen loeschen, den er
 * nicht setzen darf.
 */
function geldGuardAusStapel(supabase) {
  return async (req, res, next) => {
    try {
      const { data } = await supabase
        .from("IMPORT_BATCH").select("DOMAIN")
        .eq("ID", parseInt(req.params.id, 10)).eq("TENANT_ID", req.tenantId).maybeSingle();
      const key = ZUSATZRECHT[data?.DOMAIN];
      if (!key) return next();
      return requirePermission(key)(req, res, next);
    } catch (e) {
      // Laesst sich die Domaene nicht lesen, wird nicht durchgewunken.
      return res.status(500).json({ error: "Stapel konnte nicht geprüft werden" });
    }
  };
}

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/domains",              GUARD, (req, res) => ctrl.getDomains(req, res));
  router.get("/batches",              GUARD, (req, res) => ctrl.getBatches(req, res, supabase));
  router.post("/batches/:id/rollback", GUARD, geldGuardAusStapel(supabase), (req, res) => ctrl.postRollback(req, res, supabase));
  router.get("/project_structure/prefill", GUARD, (req, res) => ctrl.getStructurePrefill(req, res, supabase));
  router.get("/:domain/template",     GUARD, (req, res) => ctrl.getTemplate(req, res, supabase));
  router.post("/:domain/preview",     GUARD, geldGuard, DATEI, (req, res) => ctrl.postPreview(req, res, supabase));
  router.post("/:domain/commit",      GUARD, geldGuard, DATEI, (req, res) => ctrl.postCommit(req, res, supabase));
  // Zwei Sichten auf denselben Trockenlauf. Bewusst zwei Pfade statt eines
  // Musters: Express 5 kennt ":kind(errors|warnings)" nicht mehr und wirft
  // schon beim Registrieren — der Container kam damit gar nicht erst hoch.
  router.post("/:domain/errors",   GUARD, DATEI, (req, res) => ctrl.postErrorReport(req, res, supabase, "error"));
  router.post("/:domain/warnings", GUARD, DATEI, (req, res) => ctrl.postErrorReport(req, res, supabase, "warning"));

  return router;
};
