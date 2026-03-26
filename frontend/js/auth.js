// auth.js — Supabase auth, fetch interceptor, account & team management
import { API_BASE } from "./config.js";
import { showView } from "./navigation.js";
import { showMessage } from "./utils.js";
import { loadDashboard } from "./dashboard.js";

// Supabase client (initialised in initAuth)
let __supabase = null;
// Current session — updated via onAuthStateChange
let __authSession = null;
// Tenant ID from JWT app_metadata — single source of truth
let __tenantId = null;

// Exported getters so other modules read the current values
export function getAuthSession() { return __authSession; }
export function getTenantId()    { return __tenantId; }
export function getSupabase()    { return __supabase; }

// Intercept all fetch() calls to API_BASE and inject Authorization header.
// Using a native reference so signup can call backend without a session.
const _nativeFetch = window.fetch.bind(window);
window.fetch = function (url, options = {}) {
  if (__authSession?.access_token && typeof url === "string" && url.startsWith(API_BASE)) {
    options = {
      ...options,
      headers: { Authorization: `Bearer ${__authSession.access_token}`, ...(options.headers || {}) },
    };
  }
  return _nativeFetch(url, options);
};

export async function initAuth() {
  // Fetch public Supabase config from backend
  let config;
  try {
    const res = await _nativeFetch(`${API_BASE}/auth/config`);
    config = await res.json();
  } catch {
    console.error("Backend nicht erreichbar. Auth konnte nicht initialisiert werden.");
    document.getElementById("auth-loading")?.classList.add("hidden");
    showView("view-login");
    return;
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error("SUPABASE_ANON_KEY fehlt in der .env des Backends.");
    document.getElementById("auth-loading")?.classList.add("hidden");
    showView("view-login");
    return;
  }

  // Read URL hash *before* createClient so Supabase doesn't consume it first
  const _hashParams = new URLSearchParams(window.location.hash.slice(1));
  const _urlFlowType = _hashParams.get("type"); // "invite", "recovery", or null

  __supabase = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  // React to auth state changes
  __supabase.auth.onAuthStateChange((event, session) => {
    __authSession = session;
    __tenantId = session?.user?.app_metadata?.tenant_id ?? null;
    if (event === "PASSWORD_RECOVERY") {
      document.getElementById("auth-loading")?.classList.add("hidden");
      showView("view-reset-password");
    } else if (event === "SIGNED_IN") {
      document.getElementById("auth-loading")?.classList.add("hidden");
      if (_urlFlowType === "invite") {
        showView("view-reset-password");
      } else {
        showView("main-menu");
        loadDashboard();
      }
    } else if (event === "SIGNED_OUT") {
      __tenantId = null;
      document.getElementById("auth-loading")?.classList.add("hidden");
      showView("view-login");
    }
  });

  // Check for an existing session (e.g. page refresh)
  const { data: { session } } = await __supabase.auth.getSession();
  __authSession = session;
  __tenantId = session?.user?.app_metadata?.tenant_id ?? null;

  document.getElementById("auth-loading")?.classList.add("hidden");

  if (session) {
    showView("main-menu");
    loadDashboard();
  } else {
    showView("view-login");
  }
}

// Login
document.getElementById("btn-login")?.addEventListener("click", async () => {
  const email    = document.getElementById("login-email")?.value.trim();
  const password = document.getElementById("login-password")?.value;
  const msg      = document.getElementById("login-msg");
  if (!email || !password) return showMessage(msg, "Bitte E-Mail und Passwort eingeben.", "error");

  showMessage(msg, "Anmelden …", "info");
  const { error } = await __supabase.auth.signInWithPassword({ email, password });
  if (error) return showMessage(msg, error.message, "error");
});

document.getElementById("login-password")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-login")?.click();
});

// Sign up
document.getElementById("btn-signup")?.addEventListener("click", async () => {
  const company  = document.getElementById("signup-company")?.value.trim();
  const email    = document.getElementById("signup-email")?.value.trim();
  const password = document.getElementById("signup-password")?.value;
  const msg      = document.getElementById("signup-msg");

  if (!company || !email || !password) return showMessage(msg, "Bitte alle Felder ausfüllen.", "error");
  if (password.length < 8) return showMessage(msg, "Passwort muss mindestens 8 Zeichen haben.", "error");

  showMessage(msg, "Konto wird erstellt …", "info");

  const res = await _nativeFetch(`${API_BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, companyName: company }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return showMessage(msg, json.error || "Fehler beim Registrieren.", "error");

  showMessage(msg, "Konto erstellt. Melden Sie sich an …", "success");
  const { error } = await __supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showMessage(msg, "Konto erstellt. Bitte jetzt anmelden.", "success");
    showView("view-login");
  }
});

// Forgot password
document.getElementById("link-forgot-password")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email")?.value.trim();
  const msg   = document.getElementById("login-msg");
  if (!email) return showMessage(msg, "Bitte zuerst E-Mail eingeben.", "error");
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await __supabase.auth.resetPasswordForEmail(email, { redirectTo });
  showMessage(msg, error ? error.message : "Reset-Link wurde an Ihre E-Mail gesendet.", error ? "error" : "success");
});

// Set new password (after clicking reset link in email)
document.getElementById("btn-reset-save")?.addEventListener("click", async () => {
  const pw1 = document.getElementById("reset-password")?.value;
  const pw2 = document.getElementById("reset-password2")?.value;
  const msg = document.getElementById("reset-msg");

  if (!pw1) return showMessage(msg, "Bitte neues Passwort eingeben.", "error");
  if (pw1.length < 8) return showMessage(msg, "Passwort muss mindestens 8 Zeichen haben.", "error");
  if (pw1 !== pw2) return showMessage(msg, "Passwörter stimmen nicht überein.", "error");

  showMessage(msg, "Speichere …", "info");
  const { error } = await __supabase.auth.updateUser({ password: pw1 });
  if (error) return showMessage(msg, error.message, "error");

  showMessage(msg, "Passwort gesetzt. Sie werden angemeldet …", "success");
  setTimeout(() => {
    showView("main-menu");
    loadDashboard();
  }, 1500);
});

document.getElementById("reset-password2")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-reset-save")?.click();
});

// View toggles (login <-> signup)
document.getElementById("link-to-signup")?.addEventListener("click", (e) => { e.preventDefault(); showView("view-signup"); });
document.getElementById("link-to-login")?.addEventListener("click",  (e) => { e.preventDefault(); showView("view-login");  });

// Logout
document.getElementById("btn-logout")?.addEventListener("click", async () => {
  await __supabase?.auth.signOut();
});

// Account / Settings
document.getElementById("btn-account")?.addEventListener("click", async () => {
  showView("view-account");
  await Promise.all([loadAccountData(), loadTeamMembers()]);
});

async function loadAccountData() {
  const msg = document.getElementById("acc-msg");
  const emailEl = document.getElementById("acc-email");
  const companyEl = document.getElementById("acc-company");
  if (!emailEl || !companyEl) return;

  try {
    const res = await fetch(`${API_BASE}/auth/me`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden");
    if (emailEl)   emailEl.value   = json.email       || "";
    if (companyEl) companyEl.value = json.companyName  || "";
  } catch (e) {
    if (msg) showMessage(msg, e.message, "error");
  }
}

document.getElementById("acc-save")?.addEventListener("click", async () => {
  const msg      = document.getElementById("acc-msg");
  const email    = document.getElementById("acc-email")?.value.trim();
  const company  = document.getElementById("acc-company")?.value.trim();
  const pw1      = document.getElementById("acc-password")?.value;
  const pw2      = document.getElementById("acc-password2")?.value;

  if (pw1 && pw1 !== pw2) {
    return showMessage(msg, "Passwörter stimmen nicht überein.", "error");
  }

  const body = {};
  if (email)   body.email       = email;
  if (company) body.companyName = company;
  if (pw1)     body.password    = pw1;

  try {
    showMessage(msg, "Speichere …", "info");
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Speichern");

    document.getElementById("acc-password").value  = "";
    document.getElementById("acc-password2").value = "";
    showMessage(msg, "Gespeichert.", "success");
  } catch (e) {
    showMessage(msg, e.message, "error");
  }
});

// Team invite
document.getElementById("team-invite-btn")?.addEventListener("click", async () => {
  const emailEl = document.getElementById("team-invite-email");
  const msg     = document.getElementById("team-msg");
  const email   = emailEl?.value.trim();
  if (!email) return showMessage(msg, "Bitte E-Mail-Adresse eingeben.", "error");

  try {
    showMessage(msg, "Sende Einladung …", "info");
    const res = await fetch(`${API_BASE}/auth/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirectTo: window.location.origin + window.location.pathname }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Einladen");
    if (emailEl) emailEl.value = "";
    showMessage(msg, json.message || "Einladung gesendet.", "success");
    await loadTeamMembers();
  } catch (e) {
    showMessage(msg, e.message, "error");
  }
});

async function loadTeamMembers() {
  const tbody = document.getElementById("team-tbody");
  const msg   = document.getElementById("team-msg");
  if (!tbody) return;

  try {
    const res  = await fetch(`${API_BASE}/auth/team`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Fehler beim Laden");

    tbody.innerHTML = "";
    (json.data || []).forEach((m) => {
      const lastSeen = m.last_sign_in_at
        ? new Date(m.last_sign_in_at).toLocaleDateString("de-DE")
        : "–";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.email}${m.is_self ? ' <span style="opacity:.5">(Sie)</span>' : ""}</td>
        <td>${lastSeen}</td>
        <td>${m.is_self ? "" : `<button class="btn-remove-member" data-id="${m.id}" type="button" style="color:var(--color-error,#dc2626);background:none;border:none;cursor:pointer;">Entfernen</button>`}</td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-remove-member").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Teammitglied wirklich entfernen?")) return;
        try {
          const r = await fetch(`${API_BASE}/auth/team/${btn.dataset.id}`, { method: "DELETE" });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || "Fehler");
          await loadTeamMembers();
        } catch (e) {
          showMessage(msg, e.message, "error");
        }
      });
    });
  } catch (e) {
    showMessage(msg, e.message, "error");
  }
}
