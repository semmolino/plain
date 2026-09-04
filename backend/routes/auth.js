const express    = require("express");
const jwt        = require("jsonwebtoken");
const bcrypt     = require("bcryptjs");
const crypto     = require("crypto");
const { sendMail: _sendMail } = require("../services/emailService");
const {
  loginLimiter, passwordLimiter, resetRequestLimiter, resetConfirmLimiter, signupLimiter,
} = require("../middleware/rateLimit");
const { verifySessionToken } = require("../middleware/auth");
const { revokeSessions } = require("../middleware/sessionGuard");
const { bremsen, registriereFehlversuch, loescheFehlversuche } = require("../middleware/loginAttempts");

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET environment variable is required");
  return s;
}

function issueToken(payload) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: "8h" });
}

/**
 * One-Time-Fingerprint des aktuellen Passwort-Hashes. Wird in den Reset-Token
 * eingebettet und beim Bestätigen geprüft: ändert sich das Passwort, passt der
 * Fingerprint nicht mehr -> ein bereits benutzter Reset-Link (und alle anderen
 * ausstehenden) wird ungültig. Replay-/Wiederverwendungsschutz.
 */
function pwdFingerprint(passwordHashOrNull) {
  return crypto.createHash("sha256").update(String(passwordHashOrNull || "")).digest("hex").slice(0, 16);
}

/**
 * Neutralisiert LIKE-Platzhalter in einem Wert, der als ilike-Muster verwendet
 * wird. Ohne das ist "%" (bzw. "*" in PostgREST) ein Wildcard: eine Eingabe wie
 * "admin@%" wuerde einen fremden Account matchen.
 *
 * "_" ist in E-Mail-Adressen legitim (vorname_nachname@...) und muss deshalb
 * escaped statt verworfen werden, damit es weiterhin literal matcht.
 */
function likeEscape(value) {
  return String(value).replace(/([\\%_*])/g, "\\$1");
}

/**
 * Exakter, case-insensitiver Vergleich zweier E-Mail-Adressen.
 *
 * Zweite Verteidigungslinie hinter likeEscape(): selbst wenn das Escaping in
 * einer kuenftigen PostgREST-Version anders greift, kann ein Wildcard-Treffer
 * hier nicht durchrutschen. MAIL wird ungeeinheitlich gespeichert (keine
 * Normalisierung beim Schreiben), daher case-insensitiv statt ===.
 */
function mailMatches(storedMail, inputMail) {
  return String(storedMail || "").trim().toLowerCase() === String(inputMail || "").trim().toLowerCase();
}

/**
 * Legt fuer einen NEUEN Tenant die Standard-Rollen an (spiegelt Migration 0062)
 * und weist dem Erst-User die Administrator-Rolle zu.
 *
 * Hintergrund: Migration 0062 hat die Default-Rollen nur fuer die damals
 * existierenden Tenants erzeugt. Ein per Signup neu angelegter Tenant haette
 * sonst gar keine Rollen -> der Erst-User bekommt keine Permissions und ist
 * komplett ausgesperrt (kein UI zum Selbst-Zuweisen).
 *
 * Best-effort: faengt Fehler ab und blockiert die Registrierung nicht. Fehlt
 * der PERMISSION-Katalog (RBAC-Migration nicht eingespielt), laeuft die
 * Permissions-Middleware ohnehin im "unrestricted"-Modus -> No-Op hier.
 */
async function seedTenantRbacAndAssignAdmin(supabase, tenantId, employeeId) {
  try {
    const { data: perms, error: permErr } = await supabase
      .from("PERMISSION")
      .select("ID, KEY, MODULE, CATEGORY");
    if (permErr || !perms || perms.length === 0) return; // RBAC nicht aktiv -> nichts zu tun

    const uniq      = (arr) => [...new Set(arr)];
    const allIds    = perms.map(p => p.ID);
    const byCat     = (cat)  => perms.filter(p => p.CATEGORY === cat).map(p => p.ID);
    const byModule  = (mods) => perms.filter(p => mods.includes(p.MODULE)).map(p => p.ID);
    const byKey     = (keys) => perms.filter(p => keys.includes(p.KEY)).map(p => p.ID);

    const roleDefs = [
      { name: "Administrator",    long: "Voller Zugriff auf alle Funktionen",                          color: "#dc2626", isDefault: false, permIds: allIds },
      { name: "Geschäftsleitung", long: "Voller Lesezugriff, Rechnungen buchen, keine Konfiguration",  color: "#7c3aed", isDefault: false,
        permIds: uniq([...byCat("reading"), ...byKey(["invoices.book","invoices.send_email","dunning.send","reports.export"])]) },
      { name: "Projektleiter",    long: "Projekte/Angebote/Rechnungen voll, keine Mitarbeiterverwaltung", color: "#2563eb", isDefault: false,
        permIds: byModule(["dashboard","addresses","projects","reports","invoices","dunning","offers"]) },
      { name: "Buchhaltung",      long: "Rechnungen/Mahnungen voll, Projekte/Angebote nur lesen",       color: "#16a34a", isDefault: false,
        permIds: uniq([...byModule(["invoices","dunning","reports","addresses","dashboard"]), ...byKey(["projects.view","offers.view","employees.view"])]) },
      { name: "Mitarbeiter",      long: "Basis-Zugriff: Übersicht + eigene Stunden",                    color: "#6b7280", isDefault: true,
        permIds: byKey(["dashboard.view","addresses.view","addresses.contacts.view"]) },
    ];

    let adminRoleId = null;
    for (const rd of roleDefs) {
      const { data: role, error: roleErr } = await supabase
        .from("USER_ROLE")
        .insert([{ TENANT_ID: tenantId, NAME_SHORT: rd.name, NAME_LONG: rd.long, COLOR: rd.color, IS_SYSTEM: true, IS_DEFAULT: rd.isDefault }])
        .select("ID")
        .single();
      if (roleErr || !role) { console.error("[SIGNUP][ROLE]", rd.name, roleErr?.message); continue; }
      if (rd.name === "Administrator") adminRoleId = role.ID;
      if (rd.permIds.length) {
        const { error: rpErr } = await supabase
          .from("ROLE_PERMISSION")
          .insert(rd.permIds.map(pid => ({ ROLE_ID: role.ID, PERMISSION_ID: pid })));
        if (rpErr) console.error("[SIGNUP][ROLE_PERMISSION]", rd.name, rpErr.message);
      }
    }

    // Fallback: Administrator-Rolle nachladen, falls Insert oben fehlschlug
    if (!adminRoleId) {
      const { data: existing } = await supabase
        .from("USER_ROLE").select("ID")
        .eq("TENANT_ID", tenantId).eq("NAME_SHORT", "Administrator").maybeSingle();
      adminRoleId = existing?.ID ?? null;
    }

    if (adminRoleId) {
      const { error: erErr } = await supabase
        .from("EMPLOYEE_ROLE")
        .insert([{ EMPLOYEE_ID: employeeId, ROLE_ID: adminRoleId, ASSIGNED_BY: employeeId }]);
      if (erErr) console.error("[SIGNUP][EMPLOYEE_ROLE]", erErr.message);
    } else {
      console.error("[SIGNUP][EMPLOYEE_ROLE] Administrator-Rolle nicht gefunden — User ohne Rolle!");
    }
  } catch (e) {
    console.error("[SIGNUP][RBAC_SEED]", e?.message || e);
  }
}

/**
 * Weist einem frisch registrierten Mandanten den Standard-Lizenzplan zu.
 *
 * Ohne TENANT_LICENSE-Zeile behandelt middleware/license.js den Mandanten als
 * "unrestricted" (Soft-Fail) und die Owner-Konsole zeigte ihn frueher gar
 * nicht an. Der Standard-Plan traegt LICENSE_PLAN.IS_DEFAULT (Migration 0102);
 * fehlt er, wird ersatzweise der interne 'full'-Plan verwendet — damit bleibt
 * das Verhalten wie bisher (alles frei), nur eben explizit.
 *
 * Best-effort: Fehler blockieren die Registrierung nicht.
 */
async function assignDefaultLicense(supabase, tenantId) {
  try {
    let { data: plan } = await supabase
      .from("LICENSE_PLAN").select("ID, VERSION").eq("IS_DEFAULT", true).maybeSingle();
    if (!plan) {
      const fb = await supabase
        .from("LICENSE_PLAN").select("ID, VERSION").eq("KEY", "full").maybeSingle();
      plan = fb.data || null;
    }
    if (!plan) return; // Lizenz-Layer nicht eingespielt -> No-Op (wie bisher)

    const { error } = await supabase.from("TENANT_LICENSE").insert([{
      TENANT_ID: tenantId,
      PLAN_ID: plan.ID,
      PLAN_VERSION: plan.VERSION ?? 1,
      STATE: "active",
      STARTS_AT: new Date().toISOString(),
    }]);
    if (error && !/duplicate key/i.test(error.message)) {
      console.error("[SIGNUP][LICENSE]", error.message);
    }
  } catch (e) {
    console.error("[SIGNUP][LICENSE]", e?.message || e);
  }
}

module.exports = (supabase) => {
  const router = express.Router();

  // ── Login ─────────────────────────────────────────────────────────────────
  // Validates EMPLOYEE.MAIL + EMPLOYEE.PASSWORD and issues a JWT.
  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "E-Mail ist erforderlich." });
    }

    // Fehlversuchsbremse je Konto: das IP-Limit oben hilft nicht gegen einen
    // Angriff, der ueber viele Adressen verteilt auf EIN Konto zielt.
    // Bewusst nur bremsen, nicht sperren — eine Sperre waere ein Weg, einen
    // bekannten Nutzer gezielt auszusperren (siehe middleware/loginAttempts.js).
    await bremsen(email);

    // ALLE Treffer holen, nicht maybeSingle().
    //
    // WARUM: EMPLOYEE.MAIL hat keinen Unique-Index, und die Dublettenpruefung
    // beim Anlegen wirkt nur INNERHALB eines Mandanten — dieselbe Adresse in
    // zwei Bueros ist erlaubt und im Alltag normal (Freiberufler, Testkonto
    // des Administrators mit der eigenen Adresse). maybeSingle() liefert dann
    // aber keinen zweiten Treffer, sondern einen FEHLER, und der landete hier
    // in derselben Zeile wie "Benutzer unbekannt".
    //
    // Sichtbar war davon nichts: der Betroffene setzte sein Passwort ueber den
    // Einladungslink, bekam "Passwort gespeichert" — und wurde beim Anmelden
    // trotzdem mit "E-Mail oder Passwort falsch" abgewiesen, egal was er
    // eintippte. Von aussen sah das aus, als sei das Passwort nicht angekommen.
    const { data: kandidaten, error: empErr } = await supabase
      .from("EMPLOYEE")
      .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME, PASSWORD, TENANT_ID, MAIL, ACTIVE, DASHBOARD_ROLE")
      .ilike("MAIL", likeEscape(email.trim()))
      .limit(20);

    if (empErr) {
      console.error("[LOGIN] Lookup-Fehler:", empErr.message);
      registriereFehlversuch(email);
      return res.status(401).json({ error: "E-Mail oder Passwort falsch." });
    }

    // likeEscape ist die erste Schranke, der exakte Vergleich die zweite.
    const treffer = (kandidaten || []).filter((e) => mailMatches(e.MAIL, email));
    if (treffer.length === 0) {
      registriereFehlversuch(email);
      return res.status(401).json({ error: "E-Mail oder Passwort falsch." });
    }

    // Das Passwort entscheidet, welches Konto gemeint ist. Das ist kein Orakel:
    // wer hier ankommt, kennt das Passwort bereits.
    const passt = async (e) => {
      const stored = e.PASSWORD || null;
      // Ohne gesetztes Passwort ist KEINE Anmeldung moeglich. Erstzugang laeuft
      // ueber die Einladung bzw. /auth/reset-request.
      if (!stored) return false;
      return stored.startsWith("$2")
        ? await bcrypt.compare(password || "", stored)
        : stored === (password || "");
    };

    const passende = [];
    for (const kandidat of treffer) {
      if (await passt(kandidat)) passende.push(kandidat);
    }

    if (passende.length === 0) {
      registriereFehlversuch(email);
      return res.status(401).json({ error: "E-Mail oder Passwort falsch." });
    }

    // Gleiche Adresse UND gleiches Passwort in mehreren Mandanten: hier laesst
    // sich nicht entscheiden, wer gemeint ist. Lieber ehrlich melden als
    // willkuerlich einen der Mandanten waehlen.
    if (passende.length > 1) {
      console.warn(`[LOGIN] ${email}: ${passende.length} Konten mit gleicher Adresse und gleichem Passwort`);
      return res.status(409).json({
        error: "Diese E-Mail-Adresse gehört zu mehreren Konten mit demselben Passwort. "
             + "Bitte den Administrator bitten, eines der Passwörter zu ändern.",
      });
    }

    // Wer das richtige Passwort kennt, ist kein Rateangriff — Bremse aufheben.
    loescheFehlversuche(email);

    const employee = passende[0];

    if (employee.ACTIVE === 2) {
      return res.status(403).json({ error: "Dieser Benutzer ist inaktiv. Bitte Administrator kontaktieren." });
    }

    const tenantId = employee.TENANT_ID;
    if (!tenantId) {
      return res.status(403).json({ error: "Kein Mandant zugewiesen. Bitte Administrator kontaktieren." });
    }

    const token = issueToken({
      employee_id: employee.ID,
      tenant_id:   tenantId,
      email:       employee.MAIL,
      short_name:  employee.SHORT_NAME,
    });

    let companyName = null;
    const { data: company } = await supabase
      .from("COMPANY")
      .select("COMPANY_NAME_1")
      .eq("TENANT_ID", tenantId)
      .limit(1)
      .maybeSingle();
    companyName = company?.COMPANY_NAME_1 ?? null;

    return res.json({
      token,
      employee_id:    employee.ID,
      tenant_id:      tenantId,
      email:          employee.MAIL,
      short_name:     employee.SHORT_NAME,
      company_name:   companyName,
      dashboard_role: employee.DASHBOARD_ROLE ?? null,
    });
  });

  // ── Current user ──────────────────────────────────────────────────────────
  router.get("/me", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Nicht authentifiziert" });

    // Dieser Router laeuft VOR der authChain — die Zweckpruefung der
    // Middleware greift hier nicht. Deshalb dieselbe Funktion direkt: ein
    // Reset-Token ist keine Sitzung (Sicherheitsaudit 2026-09-03, M2).
    let decoded;
    try {
      decoded = verifySessionToken(token, jwtSecret());
    } catch {
      return res.status(401).json({ error: "Ungültiger Token" });
    }

    const { data: employee } = await supabase
      .from("EMPLOYEE")
      .select("ID, SHORT_NAME, MAIL, TENANT_ID")
      .eq("ID", decoded.employee_id)
      .eq("TENANT_ID", decoded.tenant_id)
      .maybeSingle();

    if (!employee) return res.status(401).json({ error: "Benutzer nicht gefunden." });

    let companyName = null;
    const { data: company } = await supabase
      .from("COMPANY")
      .select("COMPANY_NAME_1")
      .eq("TENANT_ID", employee.TENANT_ID)
      .limit(1)
      .maybeSingle();
    companyName = company?.COMPANY_NAME_1 ?? null;

    return res.json({
      employee_id:  employee.ID,
      tenant_id:    employee.TENANT_ID,
      email:        employee.MAIL,
      short_name:   employee.SHORT_NAME,
      company_name: companyName,
    });
  });

  // ── Change password ───────────────────────────────────────────────────────
  router.patch("/me/password", passwordLimiter, async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Nicht authentifiziert" });

    // Wie bei /me: die Zweckpruefung muss hier selbst erfolgen. Ohne sie
    // liesse sich ein Passwort-Reset-Token wie eine Sitzung verwenden.
    let decoded;
    try {
      decoded = verifySessionToken(token, jwtSecret());
    } catch {
      return res.status(401).json({ error: "Ungültiger Token" });
    }

    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Aktuelles und neues Passwort sind erforderlich." });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
    }

    const { data: employee } = await supabase
      .from("EMPLOYEE")
      .select("ID, PASSWORD")
      .eq("ID", decoded.employee_id)
      .maybeSingle();

    if (!employee) return res.status(404).json({ error: "Benutzer nicht gefunden." });

    const stored = employee.PASSWORD || "";
    const valid = stored.startsWith("$2") && await bcrypt.compare(current_password, stored);
    if (!valid) return res.status(401).json({ error: "Aktuelles Passwort ist falsch." });

    const hashed = await bcrypt.hash(new_password, 10);
    // .select() erzwingt eine Rueckmeldung ueber die geschriebenen Zeilen —
    // siehe Begruendung bei /reset-confirm.
    const { data: geaendert, error: updErr } = await supabase
      .from("EMPLOYEE")
      .update({ PASSWORD: hashed })
      .eq("ID", decoded.employee_id)
      .select("ID");

    if (updErr) return res.status(500).json({ error: updErr.message });
    if (!geaendert || geaendert.length !== 1) {
      console.error(`[CHANGE-PASSWORD] Kein Schreibvorgang fuer EMPLOYEE ${decoded.employee_id} (${geaendert?.length ?? 0} Zeilen)`);
      return res.status(500).json({ error: "Das Passwort konnte nicht gespeichert werden. Bitte Administrator kontaktieren." });
    }
    // Alte Sitzungen beenden. Wer sein Passwort aendert, erwartet, dass ein
    // mitgelesenes Token damit wertlos wird — und genau das war es bisher nicht
    // (Sicherheitsaudit 2026-09-03, M4). Der eigene aktuelle Token faellt
    // dabei mit; das Frontend meldet danach neu an.
    await revokeSessions(supabase, decoded.employee_id);
    return res.json({ success: true, reauth_required: true });
  });

  // ── Password reset request ────────────────────────────────────────────────
  router.post("/reset-request", resetRequestLimiter, async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "E-Mail ist erforderlich." });

    // Alle Treffer, nicht maybeSingle() — dieselbe Adresse darf in mehreren
    // Mandanten vorkommen, und maybeSingle() lieferte dafuer einen Fehler
    // statt Zeilen. Die Antwort war dann "success", ohne dass je eine Mail
    // rausging: Passwort-vergessen blieb fuer genau diese Nutzer wirkungslos.
    const { data: kandidaten } = await supabase
      .from("EMPLOYEE")
      .select("ID, MAIL, PASSWORD")
      .ilike("MAIL", likeEscape(email.trim()))
      .limit(20);

    // Wie beim Login: exakter Abgleich als zweite Schranke gegen Wildcard-
    // Treffer. Antwort bleibt in jedem Fall 200 (keine Existenz-Preisgabe).
    const treffer = (kandidaten || []).filter((e) => mailMatches(e.MAIL, email));
    if (treffer.length === 0) {
      return res.json({ success: true });
    }

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;

    // Je Konto ein eigener Link. Wem die Adresse gehoert, dem gehoeren auch
    // alle Konten dahinter — eine Auswahl waere hier weder moeglich noch noetig.
    for (const employee of treffer) {
      const resetToken = jwt.sign(
        { employee_id: employee.ID, email: employee.MAIL, purpose: "reset", pv: pwdFingerprint(employee.PASSWORD) },
        jwtSecret(),
        { expiresIn: "1h" }
      );
      const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

      try {
        // System-Mail -> Plattform-Absender (globale SMTP_*-ENV, z.B. Eusend),
        // bewusst OHNE tenantId. _sendMail wirft {status:503}, wenn gar kein
        // Versand konfiguriert ist.
        await _sendMail({
          to:      employee.MAIL,
          subject: "plan&simple – Passwort zurücksetzen",
          text:    `Klicken Sie auf folgenden Link, um Ihr Passwort zurückzusetzen (gültig 1 Stunde):\n\n${resetUrl}`,
          html:    `<p>Klicken Sie auf folgenden Link, um Ihr Passwort zurückzusetzen (gültig 1 Stunde):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
        });
      } catch (mailErr) {
        if (mailErr?.status === 503) {
          // Kein Versand konfiguriert — Link ins Log fuer Admin-Abruf.
          console.log(`[PASSWORD RESET] ${employee.MAIL}: ${resetUrl}`);
          return res.status(500).json({ error: "E-Mail-Versand nicht konfiguriert. Bitte Administrator kontaktieren." });
        }
        console.error("[PASSWORD RESET] Mail error:", mailErr?.message || mailErr);
        return res.status(500).json({ error: "E-Mail konnte nicht gesendet werden. Bitte Administrator kontaktieren." });
      }
    }

    return res.json({ success: true });
  });

  // ── Password reset confirm ────────────────────────────────────────────────
  router.post("/reset-confirm", resetConfirmLimiter, async (req, res) => {
    const { token, new_password } = req.body || {};
    if (!token || !new_password) {
      return res.status(400).json({ error: "Token und neues Passwort sind erforderlich." });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret());
    } catch {
      return res.status(400).json({ error: "Link ist ungültig oder abgelaufen." });
    }
    if (decoded.purpose !== "reset") {
      return res.status(400).json({ error: "Ungültiger Link." });
    }

    // One-Time-Schutz: Fingerprint muss zum AKTUELLEN Passwort passen. Wurde der
    // Link schon benutzt (Passwort geändert), schlägt das fehl -> kein Replay.
    const { data: emp } = await supabase
      .from("EMPLOYEE")
      .select("ID, PASSWORD")
      .eq("ID", decoded.employee_id)
      .maybeSingle();
    if (!emp) {
      return res.status(400).json({ error: "Link ist ungültig oder abgelaufen." });
    }
    if (decoded.pv !== pwdFingerprint(emp.PASSWORD)) {
      return res.status(400).json({ error: "Dieser Link wurde bereits verwendet oder ist nicht mehr gültig." });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    // .select() ist hier NICHT kosmetisch: ohne es antwortet PostgREST mit
    // 204 und supabase-js meldet weder Fehler noch Zeilenzahl. Ein Schreiben,
    // das an einer Policy oder einem Filter vorbeilaeuft, saehe damit exakt
    // aus wie ein erfolgreiches — der Nutzer bekaeme "Passwort gespeichert"
    // und stuende danach vor einem Konto, das er nicht betreten kann.
    const { data: geaendert, error: updErr } = await supabase
      .from("EMPLOYEE")
      .update({ PASSWORD: hashed })
      .eq("ID", decoded.employee_id)
      .select("ID");

    if (updErr) return res.status(500).json({ error: updErr.message });
    if (!geaendert || geaendert.length !== 1) {
      console.error(`[RESET-CONFIRM] Kein Schreibvorgang fuer EMPLOYEE ${decoded.employee_id} (${geaendert?.length ?? 0} Zeilen)`);
      return res.status(500).json({ error: "Das Passwort konnte nicht gespeichert werden. Bitte Administrator kontaktieren." });
    }
    // Der haeufigste Grund fuer ein Zuruecksetzen ist ein verlorenes oder
    // kompromittiertes Passwort. Dann muessen alle laufenden Sitzungen enden.
    await revokeSessions(supabase, decoded.employee_id);
    return res.json({ success: true });
  });

  // ── Sign up ───────────────────────────────────────────────────────────────
  // Creates a new tenant: TENANT + COMPANY + Supabase Auth user + first EMPLOYEE.
  router.post("/signup", signupLimiter, async (req, res) => {
    try {
      const { email, password, companyName, shortName } = req.body || {};

      if (!email || !password || !companyName || !shortName) {
        return res.status(400).json({ error: "E-Mail, Passwort, Firmenname und Kürzel sind erforderlich." });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben." });
      }

      // 1. E-Mail schon vergeben?
      //
      // Diese Pruefung ersetzt supabase.auth.admin.createUser, das hier frueher
      // stand. Der dort angelegte Auth-Benutzer wurde nie wieder gebraucht --
      // die Anmeldung laeuft ueber EMPLOYEE.PASSWORD und ein eigenes JWT --,
      // aber der Aufruf scheiterte bei bereits vergebener Adresse und war
      // damit nebenbei die Dublettenpruefung. Ohne Ersatz haette dieselbe
      // E-Mail in mehreren Mandanten angelegt werden koennen, und der Login
      // sucht mandantenuebergreifend: maybeSingle() haette dann bei jedem
      // Versuch einen Fehler geliefert und beide Konten unbrauchbar gemacht.
      const { data: vorhanden } = await supabase
        .from("EMPLOYEE")
        .select("ID")
        .ilike("MAIL", likeEscape(String(email).trim()))
        .maybeSingle();
      if (vorhanden) {
        return res.status(400).json({ error: "Diese E-Mail-Adresse ist bereits vergeben." });
      }

      // 2. Create TENANTS record
      const { data: tenant, error: tenantError } = await supabase
        .from("TENANTS")
        .insert([{ TENANT: companyName }])
        .select("ID")
        .single();

      if (tenantError) {
        return res.status(500).json({ error: "Mandant konnte nicht angelegt werden: " + tenantError.message });
      }
      const tenantId = tenant.ID;

      // 3. Create COMPANY record
      await supabase.from("COMPANY").insert([{ COMPANY_NAME_1: companyName, TENANT_ID: tenantId }]);

      // 4. Create the first EMPLOYEE so they can log in
      const hashedPw = await bcrypt.hash(password, 10);
      const { data: emp, error: empErr } = await supabase.from("EMPLOYEE").insert([{
        MAIL:       email,
        PASSWORD:   hashedPw,
        SHORT_NAME: shortName.trim().toUpperCase(),
        FIRST_NAME: "Administrator",
        LAST_NAME:  "",
        TENANT_ID:  tenantId,
      }]).select("ID").single();
      if (empErr) {
        console.error("[SIGNUP][EMPLOYEE]", empErr.message);
        // Mandant und Firma wieder wegraeumen. Frueher scheiterte der Signup
        // fast immer schon am Auth-Benutzer, also VOR diesen Zeilen; jetzt ist
        // dies der erste Schritt, der kippen kann. Ohne Aufraeumen bliebe ein
        // Mandant ohne einen einzigen Benutzer zurueck — unerreichbar, aber in
        // der Owner-Konsole und in jeder Mandantenliste sichtbar.
        await supabase.from("COMPANY").delete().eq("TENANT_ID", tenantId).catch(() => {});
        await supabase.from("TENANTS").delete().eq("ID", tenantId).catch(() => {});
        return res.status(500).json({ error: "Mitarbeiter konnte nicht angelegt werden: " + empErr.message });
      }

      // 5. RBAC: Standard-Rollen fuer den neuen Tenant anlegen + Erst-User als
      // Administrator. Ohne das waere der User komplett ohne Berechtigungen.
      await seedTenantRbacAndAssignAdmin(supabase, tenantId, emp.ID);

      // 6. Lizenz: Standard-Plan zuweisen. Ohne diese Zeile faellt die
      // Lizenzpruefung auf "unbeschraenkt" zurueck (Soft-Fail in
      // middleware/license.js) UND der Mandant fehlt in der Owner-Konsole.
      // Best-effort: eine fehlende Lizenz darf die Registrierung nicht kippen.
      await assignDefaultLicense(supabase, tenantId);

      return res.json({ success: true, message: "Konto erstellt. Bitte anmelden." });
    } catch (e) {
      console.error("[SIGNUP]", e?.message || e);
      return res.status(500).json({ error: e?.message || "Unbekannter Fehler beim Registrieren." });
    }
  });

  return router;
};

// Für Tests exponiert (pure Funktion, kein DB-Bezug).
module.exports._pwdFingerprint = pwdFingerprint;
