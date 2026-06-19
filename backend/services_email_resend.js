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

const RESEND_ENDPOINT = "https://api.resend.com/emails";

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
    // 401 = falscher Key, 403 = Domain nicht verifiziert / nicht erlaubt
    const status = (res.status === 401 || res.status === 403) ? 401 : 502;
    throw { status, message: `E-Mail-Versand abgelehnt (Resend): ${detail}` };
  }

  try { return await res.json(); }
  catch { return {}; }
}

module.exports = { sendViaResend };
