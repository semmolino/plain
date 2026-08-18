#!/usr/bin/env bash
# =============================================================================
# 04_db_tunnel.sh — SSH-Tunnel zur Scalingo-Postgres oeffnen (fuer DBeaver o.ae.)
#
# AUSFUEHREN IN: Git-Bash
#   bash scripts/scalingo/04_db_tunnel.sh
#
# Danach lauscht 127.0.0.1:10000 — genau der Port, auf den die DBeaver-
# Verbindung 'planandsimp_3252' zeigt. Das Fenster MUSS offen bleiben:
# der Tunnel lebt nur so lange wie dieser Prozess. Beenden mit Strg+C.
#
# Zugangsdaten (User/Passwort/DB-Name) stehen in SCALINGO_POSTGRESQL_URL:
#   scalingo --app planandsimple env | grep POSTGRESQL
# =============================================================================

set -euo pipefail

APP="${APP:-planandsimple}"
PORT="${PORT:-10000}"

# Die CLI sucht per Default ~/.ssh/id_rsa. Hier liegt ein ed25519-Schluessel,
# deshalb wird er explizit mitgegeben — sonst: "fail to read SSH private key".
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
[ -f "$KEY" ] || KEY="$HOME/.ssh/id_rsa"

if ! command -v scalingo >/dev/null 2>&1; then
  export PATH="$HOME/bin:$PATH"
fi
command -v scalingo >/dev/null 2>&1 || {
  echo "FEHLER: scalingo-CLI nicht gefunden — erst 00_install_cli.sh laufen lassen." >&2
  exit 1
}

if [ ! -f "$KEY" ]; then
  echo "FEHLER: Kein SSH-Schluessel gefunden ($KEY)." >&2
  echo "  Neu anlegen:  ssh-keygen -t ed25519" >&2
  echo "  Dann hinterlegen unter https://dashboard.scalingo.com/account/keys" >&2
  exit 1
fi

echo "============================================================"
echo " DB-Tunnel: $APP  ->  127.0.0.1:$PORT"
echo " Schluessel: $KEY"
echo " Fenster offen lassen. Beenden mit Strg+C."
echo "============================================================"

exec scalingo --app "$APP" db-tunnel -i "$KEY" -p "$PORT" SCALINGO_POSTGRESQL_URL
