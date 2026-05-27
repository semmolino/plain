/**
 * Shared email service using nodemailer.
 * Configure via Railway env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
const nodemailer = require("nodemailer");

function createMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Send an email.
 * @param {object} opts
 * @param {string}   opts.to          – recipient address
 * @param {string}   opts.subject
 * @param {string}   [opts.html]      – HTML body (preferred)
 * @param {string}   [opts.text]      – plain-text fallback
 * @param {Array}    [opts.attachments] – nodemailer attachment objects
 * @throws {{ status: 503, message: string }} when SMTP is not configured
 */
async function sendMail({ to, subject, html, text, attachments }) {
  const mailer = createMailer();
  if (!mailer) {
    throw { status: 503, message: "SMTP nicht konfiguriert. Bitte SMTP_HOST in den Railway-Umgebungsvariablen setzen." };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await mailer.sendMail({ from, to, subject, html: html || text, attachments });
}

module.exports = { sendMail };
