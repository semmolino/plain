"use strict";

/**
 * Jira-Übergabe (einseitig) — erstellt aus einem freigegebenen Vorschlag ein
 * Issue in der internen Roadmap. REST API v2 (Description = Plaintext, kein ADF).
 *
 * Konfiguration über ENV (owner-console):
 *   JIRA_BASE_URL    z. B. https://deinraum.atlassian.net
 *   JIRA_EMAIL       Atlassian-Konto-E-Mail
 *   JIRA_API_TOKEN   API-Token (id.atlassian.com → Security → API tokens)
 *   JIRA_PROJECT_KEY z. B. ROAD
 *   JIRA_ISSUE_TYPE  optional, Default "Task"
 *
 * Node 20 hat global fetch — keine zusätzliche Abhängigkeit nötig.
 */

function clean(v) {
  return v ? String(v).trim().replace(/^["']+|["']+$/g, "").trim() : "";
}

function jiraConfig() {
  const baseUrl = clean(process.env.JIRA_BASE_URL).replace(/\/$/, "");
  const email = clean(process.env.JIRA_EMAIL);
  const token = clean(process.env.JIRA_API_TOKEN);
  const projectKey = clean(process.env.JIRA_PROJECT_KEY);
  const issueType = clean(process.env.JIRA_ISSUE_TYPE) || "Task";
  if (!baseUrl || !email || !token || !projectKey) return null;
  return { baseUrl, email, token, projectKey, issueType };
}

/** Browse-URL zu einem Issue-Key (oder null, wenn keine Basis-URL gesetzt ist). */
function browseUrl(key) {
  const base = clean(process.env.JIRA_BASE_URL).replace(/\/$/, "");
  return base && key ? `${base}/browse/${key}` : null;
}

/**
 * Legt ein Jira-Issue an.
 * @returns {Promise<{ key: string, url: string }>}
 * @throws  {{ status, message }} bei fehlender Konfiguration oder API-Fehler
 */
async function createIssue({ summary, description, labels }) {
  const cfg = jiraConfig();
  if (!cfg) {
    throw { status: 400, message: "Jira ist nicht konfiguriert (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY)." };
  }
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  // Jira-Labels dürfen keine Leerzeichen enthalten.
  const safeLabels = (labels || []).map((l) => String(l).replace(/\s+/g, "-")).filter(Boolean);

  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/rest/api/2/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: cfg.projectKey },
          summary: summary.slice(0, 250),
          description,
          issuetype: { name: cfg.issueType },
          labels: safeLabels,
        },
      }),
    });
  } catch (e) {
    throw { status: 502, message: `Jira nicht erreichbar: ${e?.message || e}` };
  }

  let json = {};
  try { json = await res.json(); } catch { /* leere Antwort */ }
  if (!res.ok) {
    const detail =
      (json && json.errorMessages && json.errorMessages.join("; ")) ||
      (json && json.errors && JSON.stringify(json.errors)) ||
      `HTTP ${res.status}`;
    throw { status: res.status === 401 ? 401 : 400, message: `Jira: ${detail}` };
  }
  return { key: json.key, url: browseUrl(json.key) };
}

module.exports = { createIssue, jiraConfig, browseUrl };
