require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const helmet    = require("helmet");
const bodyParser = require("body-parser");
const path      = require("path");
const dbLayer = require("./db");

// ── Startup safety checks ────────────────────────────────────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "plain-dev-secret-change-me") {
  console.error("FATAL: JWT_SECRET is not set or is using the insecure default. Refusing to start.");
  console.error("Set JWT_SECRET to a long random string in your Railway environment variables.");
  process.exit(1);
}

// Dateiablage: bei STORAGE_DRIVER=s3 muessen Endpunkt, Bucket und Zugangsdaten
// vollstaendig sein. Fehlt eines davon, faellt das sonst erst beim ersten
// Datei-Upload auf — dann aber beim Kunden statt beim Deploy.
const objectStorage = require("./services/objectStorage");
try {
  objectStorage.assertConfigured();
  console.log(`📦 Dateiablage: ${objectStorage.driverName()}`);
} catch (e) {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
}

// Datenbankweg: direkt gegen Supabase (Service-Key) oder ueber PostgREST mit
// einem Mandanten-Claim je Request. Gleiche Begruendung wie oben — eine
// fehlende Variable soll den Deploy anhalten, nicht den ersten Nutzer.
try {
  dbLayer.assertConfigured();
  console.log(`🗄  Datenbankweg: ${dbLayer.mode()}`);
} catch (e) {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

// Hinter Railways Reverse-Proxy: korrekte Client-IP aus X-Forwarded-For lesen.
// Ohne das landen ALLE Requests im selben Rate-Limit-Bucket (Proxy-IP).
app.set("trust proxy", 1);

// Security-Header. CSP + COEP bewusst deaktiviert, damit SPA-Bundles und die
// PDF-/Asset-Auslieferung nicht brechen; HSTS, nosniff, frameguard,
// Referrer-Policy, X-Powered-By-Entfernung etc. greifen weiterhin.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS-Allowlist: kommagetrennt via CORS_ORIGINS, sonst FRONTEND_URL. In
// Nicht-Produktion ist localhost:* zusaetzlich erlaubt (Vite-Dev-Server).
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);
const isProd = process.env.NODE_ENV === "production";
const corsMw = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                 // Same-Origin / Server-zu-Server / curl
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (!isProd && /^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(null, false);                             // kein ACAO; NIE werfen (sonst 500)
  },
  credentials: true,
});
// WICHTIG: CORS NUR auf die API anwenden — niemals auf die statische SPA/Assets.
// Sonst kann ein nicht erlaubter Origin (Vite sendet wegen crossorigin auch bei
// Same-Origin einen Origin-Header) das Ausliefern der eigenen Bundles stoeren.
app.use("/api", corsMw);
app.use(bodyParser.json());

// Kein Client, sondern ein Stellvertreter: er loest bei jedem Zugriff auf, in
// wessen Auftrag gerade gearbeitet wird (siehe db.js). Ohne POSTGREST_URL ist
// das unveraendert der bisherige Client mit dem Service-Key — die 36 Router
// darunter und die 1.571 Aufrufstellen merken von der Umstellung nichts.
const { db: supabase, tenantScope, systemScope, runAsSystem } = dbLayer;

// Auth
const authRoutes    = require("./routes/auth")(supabase);
const authMiddleware = require("./middleware/auth")(supabase);


// Oeffentliche Router laufen an der authChain und damit an tenantScope vorbei —
// per Definition, denn dort gibt es noch keine Anmeldung. Ueber PostgREST
// braeuchten sie deshalb systemScope: ohne ihn landen sie im claimlosen
// Rueckfall, der keine Zeile liefert, und der Login faende den Benutzer nicht.
// Er MUSS mandantenuebergreifend suchen — die E-Mail ist der einzige
// Anhaltspunkt, der Mandant ergibt sich erst aus dem Fund.

// Public auth routes (no token required)
app.use("/api/v1/auth", systemScope, authRoutes);

// Public webhook routes (signature-verified, no JWT)
const webhookRoutes = require("./routes/webhooks");
app.use("/api/v1/webhooks", systemScope, webhookRoutes);

// Öffentliche, cookieless Landing-Page-Analytics (KEINE Auth, vor authChain).
// First-Party-Erfassung anonymer Besucher-Ereignisse der Marketing-Seite.
// Siehe routes/tracking.js, Migration 0084, docs/marketing/Analytics_Setup.md.
const trackingRoutes = require("./routes/tracking")(supabase);
app.use("/api/v1/track", systemScope, trackingRoutes);

// Public branding routes (no JWT -- liefert Login-Hero-Info via Slug)
const brandingRoutes = require("./routes/branding")(supabase);
app.use("/api/v1/branding", systemScope, brandingRoutes);

// All other API routes require a valid session
const stammdatenRoutes       = require("./routes/stammdaten")(supabase);
const mitarbeiterRoutes      = require("./routes/mitarbeiter")(supabase);
const projekteRoutes         = require("./routes/projekte")(supabase);
const buchungenRoutes        = require("./routes/buchungen")(supabase);
const employee2projectRoutes = require("./routes/employee2project")(supabase);
const abwesenheitRoutes      = require("./routes/abwesenheit")(supabase);
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
const pushRoutes             = require("./routes/push")(supabase);
const angeboteRoutes         = require("./routes/angebote")(supabase);
const nachtraegeRoutes       = require("./routes/nachtraege")(supabase);
const kostensatzRoutes       = require("./routes/kostensatz")(supabase);
const mahnungenRoutes        = require("./routes/mahnungen")(supabase);
const arbzgRoutes            = require("./routes/arbzg")(supabase);
const budgetWarningsRoutes   = require("./routes/budgetWarnings")(supabase);
const notificationConfigRoutes = require("./routes/notificationConfig")(supabase);
const notificationScheduleRoutes = require("./routes/notificationSchedule")(supabase);
const rolesRoutes                = require("./routes/roles")(supabase);
const recentsRoutes              = require("./routes/recents")(supabase);
const gamificationRoutes         = require("./routes/gamification")(supabase);
const tenantsRoutes              = require("./routes/tenants")(supabase);
const emailSettingsRoutes        = require("./routes/emailSettings")(supabase);
const emailTemplatesRoutes       = require("./routes/emailTemplates")(supabase);
const importRoutes               = require("./routes/import")(supabase);
const serviceRoutes              = require("./routes/service")(supabase);
const licenseRoutes              = require("./routes/license")(supabase);
const { makeMiddleware: makePermissionsMiddleware } = require("./middleware/permissions");
const permissionsMiddleware = makePermissionsMiddleware(supabase);
const { makeMiddleware: makeLicenseMiddleware } = require("./middleware/license");
const licenseMiddleware = makeLicenseMiddleware(supabase);
const { startDueDateChecker } = require("./services/dueDateChecker");
const { startMonatsabschlussChecker } = require("./services/monatsabschluss");
const { startMahnungChecker } = require("./services/mahnungChecker");
const { startLeistungsstandReminderChecker } = require("./services/leistungsstandReminderChecker");
const { startHoursBookingReminderChecker }   = require("./services/hoursBookingReminderChecker");
const { startNachtragFristenChecker }        = require("./services/nachtragFristenChecker");

// RBAC: permissionsMiddleware laeuft global nach authMiddleware und legt
// req.permissions + req.hasPermission ab. Soft-fail wenn Migration 0062 fehlt
// (req._permissionsUnrestricted = true) -- damit bleiben alle Routen ohne
// Migration voll nutzbar.
// Lizenz (L2): licenseMiddleware legt req.license + req.hasFeature ab. Soft-Fail
// wenn Migration 0070 fehlt / keine TENANT_LICENSE-Zeile -> unrestricted.
// L2 = nur Bereitstellung + Frontend-Soft-Gating; KEIN hartes Enforcement (das ist L3).
// licenseMiddleware MUSS vor permissionsMiddleware laufen: die Permissions-
// Suppression (L3) braucht req.license. licenseMiddleware haengt nicht von
// Permissions ab, daher unproblematisch.
// tenantScope MUSS direkt hinter authMiddleware stehen: davor gibt es noch
// keinen req.tenantId, und dahinter greifen bereits licenseMiddleware und
// permissionsMiddleware auf die Datenbank zu — die brauchen den Mandanten
// schon.
// sessionGuard MUSS hinter tenantScope stehen und nicht in authMiddleware: er
// liest EMPLOYEE, und ohne Mandanten-Claim liefert RLS null Zeilen — die
// Pruefung wuerde dann jeden aussperren statt nur zurueckgenommene Sitzungen.
// Er gehoert VOR licenseMiddleware und permissionsMiddleware, damit ein
// zurueckgenommenes Token gar nicht erst Rechte laedt.
const { makeMiddleware: makeSessionGuard } = require("./middleware/sessionGuard");
const sessionGuard = makeSessionGuard(supabase);

// Die Limiter gehoeren HINTER authMiddleware: sie zaehlen pro Mitarbeiter,
// nicht pro IP — ein Buero hinter einer NAT-Adresse wuerde sich sonst
// gegenseitig aussperren, und zwar am Monatsende beim Rechnungslauf. Vor
// authMiddleware gibt es noch keine req.employeeId.
// Und hinter sessionGuard: ein zurueckgenommenes Token soll kein Kontingent
// verbrauchen.
const { heavyLimiter, apiLimiter } = require("./middleware/rateLimit");

const authChain = [authMiddleware, tenantScope, sessionGuard, apiLimiter, heavyLimiter, licenseMiddleware, permissionsMiddleware];

app.use("/api/v1/stammdaten",        ...authChain, stammdatenRoutes);
app.use("/api/v1/mitarbeiter",       ...authChain, mitarbeiterRoutes);
app.use("/api/v1/projekte",          ...authChain, projekteRoutes);
app.use("/api/v1/buchungen",         ...authChain, buchungenRoutes);
app.use("/api/v1/employee2project",  ...authChain, employee2projectRoutes);
app.use("/api/v1/abwesenheit",       ...authChain, abwesenheitRoutes);
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
app.use("/api/v1/push",              ...authChain, pushRoutes);
app.use("/api/v1/angebote",          ...authChain, angeboteRoutes);
app.use("/api/v1/nachtraege",        ...authChain, nachtraegeRoutes);
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

// Engagement / Gamification (Tenant-Konfiguration)
app.use("/api/v1/gamification", ...authChain, gamificationRoutes);

// Tenant-Konfiguration (Slug fuer Login-Branding etc.)
app.use("/api/v1/tenants", ...authChain, tenantsRoutes);

// Per-Tenant SMTP-/E-Mail-Versand-Einstellungen
app.use("/api/v1/email-settings", ...authChain, emailSettingsRoutes);

// E-Mail-Textvorlagen (Rechnungen / Mahnungen) — lesen fuer alle, aendern via
// settings.text_templates.edit (Guard im Router).
app.use("/api/v1/email-templates", ...authChain, emailTemplatesRoutes);

// Geführter Datenimport (Onboarding) — alle Endpunkte via requirePermission('import.manage')
app.use("/api/v1/import", ...authChain, importRoutes);

// Service-Bereich (Vorschläge · Feedback · Unterstützung) — Phase 0: Consent-Gate + Sprecher
app.use("/api/v1/service", ...authChain, serviceRoutes);

// Lizenz-Entitlement des eingeloggten Tenants (fuer Frontend Soft-Gating)
app.use("/api/v1/license", ...authChain, licenseRoutes);




// ── Serve React frontend (SPA) ───────────────────────────────────────────────
const FRONTEND_DIST = path.join(__dirname, "../frontend-react/dist");
app.use(express.static(FRONTEND_DIST, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
      // Kein Caching von index.html -- darin stehen die Hashes der
      // aktuellen JS/CSS-Bundles. Sonst zeigt Railway/CDN/Browser
      // nach Deploys weiterhin alte Versionen.
      // sw.js (Service Worker) ebenso ungecacht ausliefern, damit
      // Aktualisierungen der Push-Logik zeitnah greifen.
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

  // Die periodischen Checker verschicken E-Mails (Mahnungen, Faelligkeits- und
  // Leistungsstand-Erinnerungen) an echte Empfaenger. Zeigen ZWEI Instanzen auf
  // dieselbe Datenbank -- etwa waehrend einer Migration oder beim Testen eines
  // zweiten Hosters -- laeuft jeder Versand doppelt.
  // Auf solchen Nebeninstanzen deshalb DISABLE_BACKGROUND_JOBS=true setzen.
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") {
    console.log("⏸  Hintergrund-Checker deaktiviert (DISABLE_BACKGROUND_JOBS=true)");
    return;
  }

  // Daily/periodic checkers
  //
  // Sie laufen ueber ALLE Mandanten und damit ausserhalb jedes Requests. Ohne
  // runAsSystem faenden sie keinen Mandanten-Claim vor und wuerden — richtig,
  // aber nutzlos — null Zeilen sehen. Der Kontext traegt bis in die Timer
  // hinein, die start… synchron plant; deshalb genuegt das Umhuellen hier.
  runAsSystem(() => {
    try { startDueDateChecker(supabase); }              catch (e) { console.error("startDueDateChecker:", e?.message || e); }
    try { startMonatsabschlussChecker(supabase); }      catch (e) { console.error("startMonatsabschlussChecker:", e?.message || e); }
    try { startMahnungChecker(supabase); }              catch (e) { console.error("startMahnungChecker:", e?.message || e); }
    try { startLeistungsstandReminderChecker(supabase); } catch (e) { console.error("startLeistungsstandReminderChecker:", e?.message || e); }
    try { startHoursBookingReminderChecker(supabase); }    catch (e) { console.error("startHoursBookingReminderChecker:", e?.message || e); }
    try { startNachtragFristenChecker(supabase); }         catch (e) { console.error("startNachtragFristenChecker:", e?.message || e); }
  });
});
