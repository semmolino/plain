require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const bodyParser = require("body-parser");
const path      = require("path");
const { createClient } = require("@supabase/supabase-js");

// ── Startup safety checks ────────────────────────────────────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "plain-dev-secret-change-me") {
  console.error("FATAL: JWT_SECRET is not set or is using the insecure default. Refusing to start.");
  console.error("Set JWT_SECRET to a long random string in your Railway environment variables.");
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(bodyParser.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Auth
const authRoutes    = require("./routes/auth")(supabase);
const authMiddleware = require("./middleware/auth")(supabase);


// Public auth routes (no token required)
app.use("/api/v1/auth", authRoutes);

// Public webhook routes (signature-verified, no JWT)
const webhookRoutes = require("./routes/webhooks");
app.use("/api/v1/webhooks", webhookRoutes);

// All other API routes require a valid session
const stammdatenRoutes       = require("./routes/stammdaten")(supabase);
const mitarbeiterRoutes      = require("./routes/mitarbeiter")(supabase);
const projekteRoutes         = require("./routes/projekte")(supabase);
const buchungenRoutes        = require("./routes/buchungen")(supabase);
const employee2projectRoutes = require("./routes/employee2project")(supabase);
const partialPaymentsRoutes  = require("./routes/partialPayments")(supabase);
const invoicesRoutes         = require("./routes/invoices")(supabase);
const paymentsRoutes         = require("./routes/payments")(supabase);
const assetsRoutes           = require("./routes/assets")(supabase);
const documentTemplatesRoutes = require("./routes/documentTemplates")(supabase);
const documentsRoutes        = require("./routes/documents")(supabase);
const numberRangesRoutes     = require("./routes/numberRanges")(supabase);
const reportsRoutes          = require("./routes/reports")(supabase);
const finalInvoicesRoutes    = require("./routes/finalInvoices")(supabase);
const notificationsRoutes    = require("./routes/notifications")(supabase);
const angeboteRoutes         = require("./routes/angebote")(supabase);
const kostensatzRoutes       = require("./routes/kostensatz")(supabase);
const mahnungenRoutes        = require("./routes/mahnungen")(supabase);
const arbzgRoutes            = require("./routes/arbzg")(supabase);
const budgetWarningsRoutes   = require("./routes/budgetWarnings")(supabase);
const notificationConfigRoutes = require("./routes/notificationConfig")(supabase);
const notificationScheduleRoutes = require("./routes/notificationSchedule")(supabase);
const rolesRoutes                = require("./routes/roles")(supabase);
const recentsRoutes              = require("./routes/recents")(supabase);
const { makeMiddleware: makePermissionsMiddleware } = require("./middleware/permissions");
const permissionsMiddleware = makePermissionsMiddleware(supabase);
const { startDueDateChecker } = require("./services/dueDateChecker");
const { startMonatsabschlussChecker } = require("./services/monatsabschluss");
const { startMahnungChecker } = require("./services/mahnungChecker");
const { startLeistungsstandReminderChecker } = require("./services/leistungsstandReminderChecker");
const { startHoursBookingReminderChecker }   = require("./services/hoursBookingReminderChecker");

// RBAC: permissionsMiddleware laeuft global nach authMiddleware und legt
// req.permissions + req.hasPermission ab. Soft-fail wenn Migration 0062 fehlt
// (req._permissionsUnrestricted = true) -- damit bleiben alle Routen ohne
// Migration voll nutzbar.
const authChain = [authMiddleware, permissionsMiddleware];

app.use("/api/v1/stammdaten",        ...authChain, stammdatenRoutes);
app.use("/api/v1/mitarbeiter",       ...authChain, mitarbeiterRoutes);
app.use("/api/v1/projekte",          ...authChain, projekteRoutes);
app.use("/api/v1/buchungen",         ...authChain, buchungenRoutes);
app.use("/api/v1/employee2project",  ...authChain, employee2projectRoutes);
app.use("/api/v1/partial-payments",  ...authChain, partialPaymentsRoutes);
app.use("/api/v1/invoices",          ...authChain, invoicesRoutes);
app.use("/api/v1/payments",          ...authChain, paymentsRoutes);
app.use("/api/v1/assets",            ...authChain, assetsRoutes);
app.use("/api/v1/document-templates",...authChain, documentTemplatesRoutes);
app.use("/api/v1/documents",         ...authChain, documentsRoutes);
app.use("/api/v1/number-ranges",     ...authChain, numberRangesRoutes);
app.use("/api/v1/reports",           ...authChain, reportsRoutes);
app.use("/api/v1/final-invoices",    ...authChain, finalInvoicesRoutes);
app.use("/api/v1/notifications",     ...authChain, notificationsRoutes);
app.use("/api/v1/angebote",          ...authChain, angeboteRoutes);
app.use("/api/v1/kostensatz",        ...authChain, kostensatzRoutes);
app.use("/api/v1/mahnungen",         ...authChain, mahnungenRoutes);
app.use("/api/v1/arbzg",             ...authChain, arbzgRoutes);
app.use("/api/v1/budget-warnings",   ...authChain, budgetWarningsRoutes);
app.use("/api/v1/notification-config", ...authChain, notificationConfigRoutes);
app.use("/api/v1/notification-schedule", ...authChain, notificationScheduleRoutes);

// Rollen + Mitarbeiter-Rollen-Zuweisung (eigene Routes mit eigenen Guards)
app.use("/api/v1", ...authChain, rolesRoutes);

// Zuletzt verwendet (pro Mitarbeiter)
app.use("/api/v1/recents", ...authChain, recentsRoutes);




// ── Serve React frontend (SPA) ───────────────────────────────────────────────
const FRONTEND_DIST = path.join(__dirname, "../frontend-react/dist");
app.use(express.static(FRONTEND_DIST, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      // Kein Caching von index.html -- darin stehen die Hashes der
      // aktuellen JS/CSS-Bundles. Sonst zeigt Railway/CDN/Browser
      // nach Deploys weiterhin alte Versionen.
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    } else {
      // Gehashte Assets duerfen aggressiv gecacht werden -- bei einem
      // Deploy aendert sich der Filename, daher unschaedlich.
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));

// SPA fallback — all non-API routes return index.html
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

app.listen(port, () => {
  console.log(`✅ Backend läuft auf Port ${port}`);
  // Daily/periodic checkers
  try { startDueDateChecker(supabase); }              catch (e) { console.error("startDueDateChecker:", e?.message || e); }
  try { startMonatsabschlussChecker(supabase); }      catch (e) { console.error("startMonatsabschlussChecker:", e?.message || e); }
  try { startMahnungChecker(supabase); }              catch (e) { console.error("startMahnungChecker:", e?.message || e); }
  try { startLeistungsstandReminderChecker(supabase); } catch (e) { console.error("startLeistungsstandReminderChecker:", e?.message || e); }
  try { startHoursBookingReminderChecker(supabase); }    catch (e) { console.error("startHoursBookingReminderChecker:", e?.message || e); }
});
