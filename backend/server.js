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
const { startDueDateChecker } = require("./services/dueDateChecker");
const { startMonatsabschlussChecker } = require("./services/monatsabschluss");
const { startMahnungChecker } = require("./services/mahnungChecker");
const { startLeistungsstandReminderChecker } = require("./services/leistungsstandReminderChecker");
const { startHoursBookingReminderChecker }   = require("./services/hoursBookingReminderChecker");

app.use("/api/v1/stammdaten",        authMiddleware, stammdatenRoutes);
app.use("/api/v1/mitarbeiter",       authMiddleware, mitarbeiterRoutes);
app.use("/api/v1/projekte",          authMiddleware, projekteRoutes);
app.use("/api/v1/buchungen",         authMiddleware, buchungenRoutes);
app.use("/api/v1/employee2project",  authMiddleware, employee2projectRoutes);
app.use("/api/v1/partial-payments",  authMiddleware, partialPaymentsRoutes);
app.use("/api/v1/invoices",          authMiddleware, invoicesRoutes);
app.use("/api/v1/payments",          authMiddleware, paymentsRoutes);
app.use("/api/v1/assets",            authMiddleware, assetsRoutes);
app.use("/api/v1/document-templates",authMiddleware, documentTemplatesRoutes);
app.use("/api/v1/documents",         authMiddleware, documentsRoutes);
app.use("/api/v1/number-ranges",     authMiddleware, numberRangesRoutes);
app.use("/api/v1/reports",           authMiddleware, reportsRoutes);
app.use("/api/v1/final-invoices",    authMiddleware, finalInvoicesRoutes);
app.use("/api/v1/notifications",     authMiddleware, notificationsRoutes);
app.use("/api/v1/angebote",          authMiddleware, angeboteRoutes);
app.use("/api/v1/kostensatz",        authMiddleware, kostensatzRoutes);
app.use("/api/v1/mahnungen",         authMiddleware, mahnungenRoutes);
app.use("/api/v1/arbzg",             authMiddleware, arbzgRoutes);
app.use("/api/v1/budget-warnings",   authMiddleware, budgetWarningsRoutes);
app.use("/api/v1/notification-config", authMiddleware, notificationConfigRoutes);
app.use("/api/v1/notification-schedule", authMiddleware, notificationScheduleRoutes);




// ── Serve React frontend (SPA) ───────────────────────────────────────────────
const FRONTEND_DIST = path.join(__dirname, "../frontend-react/dist");
app.use(express.static(FRONTEND_DIST));

// SPA fallback — all non-API routes return index.html
app.get(/^(?!\/api\/).*/, (req, res) => {
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
