#!/usr/bin/env bash
# =============================================================================
# 02_deploy.sh — Deployment ueber GitHub anstossen und begleiten
#
# AUSFUEHREN IN: Git-Bash, im WURZELVERZEICHNIS des Repositories
#   bash scripts/scalingo/02_deploy.sh
#
# -----------------------------------------------------------------------------
# WARUM UEBER GITHUB UND NICHT PER DIREKT-PUSH
#
# Scalingo ist per Auto-Deploy an semmolino/plain gekoppelt: jeder Push nach
# origin/main loest dort automatisch einen Build aus. Ein zusaetzlicher
# 'git push scalingo main' baute deshalb JEDES MAL ein zweites Mal dasselbe --
# doppelte Buildzeit ohne Nutzen.
#
# Deshalb pusht dieses Skript nur nach origin und begleitet danach den Build,
# den Scalingo von selbst startet. Der Ablauf ist damit derselbe wie bei
# Railway: ein Push, ein Deploy.
# -----------------------------------------------------------------------------

set -euo pipefail

APP="${APP:-plain-test}"
SIZE="${SIZE:-M}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "============================================================"
echo " Deployment:  $APP     Branch: $BRANCH     Groesse: $SIZE"
echo "============================================================"

[[ -f package.json && -d backend ]] || { echo "FEHLER: Bitte im Wurzelverzeichnis des Repositories ausfuehren." >&2; exit 1; }
scalingo --app "$APP" apps-info >/dev/null 2>&1 || {
  echo "FEHLER: App '$APP' existiert nicht. Erst 01_setup.sh ausfuehren." >&2; exit 1; }

# ── Buildpack-Dateien ───────────────────────────────────────────────────────
echo "→ Pruefe Buildpack-Dateien ..."
for f in package.json Procfile Aptfile .buildpacks; do
  [[ -f "$f" ]] && echo "    ✓ $f" || { echo "    ✗ $f FEHLT" >&2; exit 1; }
done
# CRLF wuerde den Build zum Scheitern bringen ("unable to locate package …\r")
for f in Procfile Aptfile .buildpacks; do
  grep -qU $'\r' "$f" 2>/dev/null && {
    echo "FEHLER: $f enthaelt CRLF-Zeilenenden." >&2
    echo "  Beheben mit:  git rm --cached $f && git checkout $f" >&2
    exit 1; }
done
echo "    ✓ Zeilenenden korrekt (LF)"

# ── Auto-Deploy pruefen ─────────────────────────────────────────────────────
echo "→ Pruefe GitHub-Kopplung ..."
LINK="$(scalingo --app "$APP" integration-link 2>&1 || true)"
if grep -q "Automatic deployment: ✔" <<<"$LINK"; then
  echo "    ✓ Auto-Deploy aktiv auf $(grep -oE 'Automatic deployment: ✔, .*' <<<"$LINK" | sed 's/.*, //')"
else
  cat >&2 <<HINWEIS
    ✗ Auto-Deploy ist nicht aktiv.
      Einrichten mit:
        scalingo integrations-add github
        scalingo --app $APP integration-link-create \\
          --auto-deploy --branch main https://github.com/semmolino/plain
HINWEIS
  exit 1
fi

# ── Push ────────────────────────────────────────────────────────────────────
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo ""
  echo "HINWEIS: Es gibt nicht committete Aenderungen — gebaut wird der letzte Commit."
  read -rp "         Trotzdem fortfahren? [j/N] " a
  [[ "$a" =~ ^[jJyY]$ ]] || { echo "Abgebrochen."; exit 1; }
fi

SHA="$(git rev-parse HEAD)"
echo ""
echo "→ Pushe nach origin/$BRANCH (loest den Scalingo-Build aus) ..."
git push origin "$BRANCH"

# ── Build begleiten ─────────────────────────────────────────────────────────
echo ""
echo "→ Warte auf den Build von ${SHA:0:8} ..."
STATUS=""
for _ in $(seq 1 60); do
  LINE="$(scalingo --app "$APP" deployments 2>/dev/null | grep -F "${SHA:0:8}" | head -1 || true)"
  if [[ -n "$LINE" ]]; then
    STATUS="$(grep -oE 'building|success|build-error|aborted|starting' <<<"$LINE" | head -1)"
    printf "\r    Status: %-14s" "$STATUS"
    [[ "$STATUS" == "success" || "$STATUS" == "build-error" || "$STATUS" == "aborted" ]] && break
  fi
  sleep 10
done
echo ""
case "$STATUS" in
  success) echo "    ✓ Build erfolgreich" ;;
  build-error|aborted)
    echo "    ✗ Build fehlgeschlagen. Log:" >&2
    scalingo --app "$APP" deployment-logs 2>/dev/null | tail -30 >&2
    exit 1 ;;
  *) echo "    ! Status unklar ($STATUS) — mit 'scalingo --app $APP deployments' nachsehen." ;;
esac

# ── Containergroesse ────────────────────────────────────────────────────────
# Steht die Groesse schon richtig, antwortet die API mit
# "400 Bad Request -> no change in containers formation". Kein Fehler.
echo ""
echo "→ Setze Containergroesse auf $SIZE ..."
SCALE_OUT="$(scalingo --app "$APP" scale "web:1:$SIZE" 2>&1 || true)"
if grep -qi "no change in containers formation" <<<"$SCALE_OUT"; then
  echo "    ✓ bereits auf $SIZE"
else
  echo "$SCALE_OUT" | sed 's/^/    /'
fi

# ── URL eintragen ───────────────────────────────────────────────────────────
URL="$(scalingo --app "$APP" apps-info 2>/dev/null | grep -oE 'https://[^ ]+scalingo\.io' | head -1)"
if [[ -n "$URL" ]]; then
  CUR="$(scalingo --app "$APP" env 2>/dev/null | grep '^FRONTEND_URL=' | cut -d= -f2- | tr -d '\r')"
  if [[ "$CUR" != "$URL" ]]; then
    echo ""
    echo "→ Trage FRONTEND_URL und CORS_ORIGINS ein: $URL"
    scalingo --app "$APP" env-set FRONTEND_URL="$URL" CORS_ORIGINS="$URL" >/dev/null
    scalingo --app "$APP" restart >/dev/null
    echo "    ✓ gesetzt, App neu gestartet"
  fi
fi

echo ""
echo "============================================================"
echo " Fertig.   URL: ${URL:-<siehe apps-info>}"
echo " Pruefen:  bash scripts/scalingo/03_status.sh"
echo "============================================================"
