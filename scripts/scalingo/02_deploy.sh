#!/usr/bin/env bash
# =============================================================================
# 02_deploy.sh — Code nach Scalingo pushen, Container dimensionieren, URL setzen
#
# AUSFUEHREN IN: Git-Bash, im WURZELVERZEICHNIS des Repositories
#   bash scripts/scalingo/02_deploy.sh
#
# Der erste Build dauert lange (zweimal npm ci, Vite-Build, Chromium-Download
# ~150 MB). 10-15 Minuten sind normal.
#
# Idempotent: erneut ausfuehrbar, um eine neue Version zu deployen.
# =============================================================================

set -euo pipefail

APP="${APP:-plain-test}"
SIZE="${SIZE:-M}"          # S=512MB reicht fuer Chromium nicht
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "============================================================"
echo " Deployment:  $APP     Branch: $BRANCH     Groesse: $SIZE"
echo "============================================================"

if [[ ! -f "package.json" || ! -d "backend" ]]; then
  echo "FEHLER: Bitte im Wurzelverzeichnis des Repositories ausfuehren." >&2
  exit 1
fi

if ! scalingo --app "$APP" apps-info >/dev/null 2>&1; then
  echo "FEHLER: App '$APP' existiert nicht." >&2
  echo "  Erst ausfuehren: bash scripts/scalingo/01_setup.sh" >&2
  exit 1
fi

# ── Buildpack-Dateien pruefen ───────────────────────────────────────────────
# Fehlt eine davon, scheitert der Build mit einer schwer deutbaren Meldung.
echo "→ Pruefe Buildpack-Dateien ..."
for f in package.json Procfile Aptfile .buildpacks; do
  if [[ -f "$f" ]]; then
    echo "    ✓ $f"
  else
    echo "    ✗ $f FEHLT" >&2
    exit 1
  fi
done

# CRLF wuerde den Build zum Scheitern bringen ("unable to locate package …\r")
for f in Procfile Aptfile .buildpacks; do
  if grep -qU $'\r' "$f" 2>/dev/null; then
    echo "FEHLER: $f enthaelt CRLF-Zeilenenden." >&2
    echo "  Beheben mit:  git rm --cached $f && git checkout $f" >&2
    exit 1
  fi
done
echo "    ✓ Zeilenenden korrekt (LF)"

# ── Nicht committete Aenderungen? ───────────────────────────────────────────
# Gepusht wird der COMMIT, nicht das Arbeitsverzeichnis.
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo ""
  echo "HINWEIS: Es gibt nicht committete Aenderungen."
  echo "         Scalingo baut den letzten Commit ($(git rev-parse --short HEAD))."
  read -rp "         Trotzdem fortfahren? [j/N] " a
  [[ "$a" =~ ^[jJyY]$ ]] || { echo "Abgebrochen."; exit 1; }
fi

# ── Git-Remote ──────────────────────────────────────────────────────────────
if git remote | grep -qx "scalingo"; then
  echo "→ Remote 'scalingo' vorhanden"
else
  echo "→ Richte Remote 'scalingo' ein ..."
  scalingo --app "$APP" git-setup
fi

# ── SSH-Zugang pruefen ──────────────────────────────────────────────────────
# git push laeuft ueber SSH. Der API-Token authentifiziert nur den CLI, NICHT
# Git — dafuer muss ein oeffentlicher Schluessel im Scalingo-Konto liegen.
# Ohne diese Vorpruefung bricht der Push erst nach dem Hostkey-Dialog ab, mit
# "Permission denied (publickey)", was leicht als Rechteproblem der App
# missverstanden wird.
echo "→ Pruefe SSH-Zugang ..."
SSH_OUT="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
            -T git@ssh.osc-fr1.scalingo.com 2>&1 || true)"
if grep -qi "successfully authenticated" <<<"$SSH_OUT"; then
  echo "    ✓ SSH-Schluessel akzeptiert"
else
  cat >&2 <<HINWEIS

FEHLER: SSH-Zugang zu Scalingo funktioniert nicht.
        Antwort des Servers: $(head -1 <<<"$SSH_OUT")

  git push nutzt SSH. Der API-Token gilt nur fuer den CLI, nicht fuer Git.
  Im Scalingo-Konto muss ein oeffentlicher Schluessel hinterlegt sein.

  1. Schluessel erzeugen (falls noch keiner da ist):
         ls ~/.ssh/*.pub                    # vorhanden?
         ssh-keygen -t ed25519 -C "scalingo"
     (dreimal Enter uebernimmt die Vorgaben; Passphrase optional)

  2. Oeffentlichen Teil anzeigen und vollstaendig kopieren:
         cat ~/.ssh/id_ed25519.pub
     Beginnt mit "ssh-ed25519".

  3. Im Dashboard hinterlegen:
         https://dashboard.scalingo.com/account/keys
     "Add a new key", Namen vergeben, Inhalt einfuegen.

  4. Pruefen:
         ssh -T git@ssh.osc-fr1.scalingo.com
     Erwartet: "You've successfully authenticated on Scalingo,
                but there is no shell access"

  5. Dieses Skript erneut starten.

  ALTERNATIVE ohne SSH — Bereitstellung ueber GitHub:
     Der Code liegt ohnehin auf GitHub. Dann entfaellt der Push nach
     Scalingo ganz:
         scalingo integrations-add github
         scalingo --app $APP integration-link-create \\
           --auto-deploy --branch main https://github.com/semmolino/plain
HINWEIS
  exit 1
fi

# ── Push = Build = Deploy ───────────────────────────────────────────────────
echo ""
echo "→ Pushe nach Scalingo. Der Build laeuft im Anschluss automatisch."
echo "  Das dauert beim ersten Mal 10-15 Minuten."
echo ""
git push scalingo "$BRANCH:main"

# ── Container dimensionieren ────────────────────────────────────────────────
# Steht die Groesse schon richtig, antwortet die API mit
# "400 Bad Request -> no change in containers formation". Das ist kein Fehler,
# darf den Ablauf also nicht abbrechen (das Skript laeuft unter set -e).
echo ""
echo "→ Setze Containergroesse auf $SIZE ..."
SCALE_OUT="$(scalingo --app "$APP" scale "web:1:$SIZE" 2>&1 || true)"
if grep -qi "no change in containers formation" <<<"$SCALE_OUT"; then
  echo "    ✓ bereits auf $SIZE"
else
  echo "$SCALE_OUT" | sed 's/^/    /'
fi

# ── URL ermitteln und eintragen ─────────────────────────────────────────────
URL="$(scalingo --app "$APP" apps-info 2>/dev/null | grep -oE 'https://[^ ]+scalingo\.io' | head -1)"
if [[ -n "$URL" ]]; then
  echo ""
  echo "→ Trage FRONTEND_URL und CORS_ORIGINS ein: $URL"
  scalingo --app "$APP" env-set FRONTEND_URL="$URL" CORS_ORIGINS="$URL" >/dev/null
  scalingo --app "$APP" restart >/dev/null
  echo "  ✓ Gesetzt, App neu gestartet"
else
  echo ""
  echo "HINWEIS: URL konnte nicht automatisch ermittelt werden."
  echo "  Manuell nachtragen:"
  echo "    scalingo --app $APP env-set FRONTEND_URL=\"https://…\" CORS_ORIGINS=\"https://…\""
fi

echo ""
echo "============================================================"
echo " Deployment abgeschlossen."
echo "   URL:    ${URL:-<siehe scalingo --app $APP apps-info>}"
echo "   Pruefen: bash scripts/scalingo/03_status.sh"
echo "============================================================"
