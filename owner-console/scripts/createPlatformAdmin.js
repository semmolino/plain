"use strict";

/**
 * Legt einen PLATFORM_ADMIN an (oder aktualisiert ihn) und generiert ein
 * TOTP-2FA-Secret. Das ausgegebene otpauth-URL/Secret in eine Authenticator-App
 * (Google Authenticator, 1Password, …) eintragen.
 *
 * Nutzung:
 *   npm run create-admin -- <email> <passwort>
 *   (oder ADMIN_EMAIL / ADMIN_PASSWORD als Env)
 *
 * Voraussetzung: Migration 0070 ist eingespielt (Tabelle PLATFORM_ADMIN) und
 * SUPABASE_URL / SUPABASE_SERVICE_KEY in .env gesetzt.
 */

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { authenticator } = require("otplib");
const { supabase } = require("../services/db");

async function main() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Usage: npm run create-admin -- <email> <passwort>");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Passwort sollte mindestens 12 Zeichen haben.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const totpSecret = authenticator.generateSecret();

  const { data, error } = await supabase.from("PLATFORM_ADMIN").upsert(
    [{ EMAIL: email, PASSWORD_HASH: passwordHash, TOTP_SECRET: totpSecret, IS_ACTIVE: true }],
    { onConflict: "EMAIL" }
  ).select("ID, EMAIL").single();

  if (error) {
    console.error("Fehler:", error.message);
    process.exit(1);
  }

  const otpauth = authenticator.keyuri(email, "PlaIn Owner Console", totpSecret);
  console.log(`\n✅ PLATFORM_ADMIN angelegt/aktualisiert: ${data.EMAIL} (ID ${data.ID})`);
  console.log("\n2FA einrichten — in eine Authenticator-App eintragen:");
  console.log(`   Secret:  ${totpSecret}`);
  console.log(`   otpauth: ${otpauth}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
