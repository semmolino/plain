"use strict";

/**
 * Resend-Transport (HTTPS-API).
 *
 * Sendet E-Mails ueber https://api.resend.com/emails statt SMTP. Vorteil:
 * laeuft ueber Port 443 und funktioniert daher auch dort, wo ausgehender
 * SMTP-Verkehr blockiert ist (z.B. Railway Free/Hobby). Zudem bessere
 * Zustellbarkeit fuer transaktionale Mails (Rechnungen/Mahnungen).
 *
 * Konfiguration ueber ENV:
 *   RESEND_API_KEY  — API-Key aus dem Resend-Dashboard
 *   EMAIL_FROM      — verifizierter Absender, z.B. "PlaIn <noreply@deine-domain.de>"
 *
 * Node 20 hat global fetch — keine zusaetzliche Abhaengigkeit noetig.
 */

const RESEND_BASE     = "https://api.resend.com";
const RESEND_ENDPOINT = `${RESEND_BASE}/emails`;

/** Generischer Resend-Request fuer die Domains-API. */
async function resendRequest(method, path, apiKey, body) {
  let res;
  try {
    res = await fetch(`${RESEND_BASE}${path}`, {
      method,
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw { status: 502, message: `E-Mail-Dienst (Resend) nicht erreichbar: ${e?.message || e}` };
  }
  let json = {};
  try { json = await res.json(); } catch { /* 204 o.ae. */ }
  if (!res.ok) {
    const detail = (json && json.message) || `HTTP ${res.status}`;
    const status = res.status === 401 ? 401 : (res.status === 422 || res.status === 400 ? 400 : 502);
    throw { status, message: `Resend: ${detail}` };
  }
  return json;
}

/** Registriert eine Domain im Resend-Account. @returns {id,name,status,records,...} */
const createDomain = (apiKey, name, region) =>
  resendRequest("POST", "/domains", apiKey, region ? { name, region } : { name });

/** Liest eine Domain inkl. aktuellem Status + DNS-Records. */
const getDomain = (apiKey, id) =>
  resendRequest("GET", `/domains/${id}`, apiKey);

/** Stoesst die DNS-Verifizierung an. */
const verifyDomain = (apiKey, id) =>
  resendRequest("POST", `/domains/${id}/verify`, apiKey);

/** Entfernt eine Domain aus dem Resend-Account. */
const deleteDomain = (apiKey, id) =>
  resendRequest("DELETE", `/domains/${id}`, apiKey);

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.from            – "Name <addr@domain>" (Domain muss verifiziert sein)
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @param {string} [opts.replyTo]
 * @param {Array}  [opts.attachments]   – nodemailer-Style: { filename, content(Buffer|string) }
 * @returns {Promise<object>} Resend-Antwort (u.a. { id })
 */
async function sendViaResend({ apiKey, from, to, subject, html, text, replyTo, attachments }) {
  const body = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
  };
  if (html) body.html = html;
  if (text) body.text = text;
  if (replyTo) body.reply_to = replyTo;
  if (attachments && attachments.length) {
    body.attachments = attachments.map(a => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content)
        ? a.content.toString("base64")
        : Buffer.from(a.content || "").toString("base64"),
    }));
  }

  let res;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw { status: 502, message: `E-Mail-Dienst (Resend) nicht erreichbar: ${e?.message || e}` };
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.message) detail = j.message;
    } catch { /* ignore */ }

    if (res.status === 401) {
      throw { status: 401, message: `E-Mail-Versand abgelehnt (Resend): ${detail}. Pruefe: RESEND_API_KEY in Railway korrekt gespeichert UND danach deployt, ohne Leerzeichen/Anfuehrungszeichen, vollstaendig kopiert, und der Key wurde seit dem Kopieren nicht erneut neu generiert.` };
    }
    if (res.status === 403) {
      throw { status: 403, message: `E-Mail-Versand abgelehnt (Resend): ${detail}. Vermutlich ist die Absender-Domain aus EMAIL_FROM nicht verifiziert — oder du nutzt die Sandbox (onboarding@resend.dev), die nur an die eigene Resend-Konto-Adresse zustellt.` };
    }
    throw { status: 502, message: `E-Mail-Versand abgelehnt (Resend): ${detail}` };
  }

  try { return await res.json(); }
  catch { return {}; }
}

module.exports = { sendViaResend, createDomain, getDomain, verifyDomain, deleteDomain };
