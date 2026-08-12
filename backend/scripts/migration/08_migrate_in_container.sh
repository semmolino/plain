#!/usr/bin/env bash
# =============================================================================
# 08_migrate_in_container.sh — Supabase → Scalingo, komplett im Container
#
#   scalingo --app planandsimple run "bash backend/scripts/migration/08_migrate_in_container.sh"
#
# WARUM DIESER WEG UND NICHT SKRIPT 04
#   04 laeuft auf einem Arbeitsrechner und war deshalb umstaendlich: Port 5432
#   zu Supabase ist im Arbeitsnetz gesperrt (Hotspot noetig), zum Ziel braucht
#   es einen SSH-Tunnel, und pg_dump muss lokal installiert sein.
#
#   Aus dem Scalingo-Container entfaellt das alles. Beide Datenbanken sind von
#   dort direkt erreichbar, das Ziel steht als SCALINGO_POSTGRESQL_URL bereits
#   in der Umgebung, und die Postgres-Werkzeuge liefert der apt-Buildpack.
#   Nebenbei wandern keine Kundendaten ueber einen privaten Rechner.
#
#   04 bleibt als Rueckfallebene, falls der Container einmal nicht taugt.
#
# VORAUSSETZUNGEN
#   MIGRATION_SRC_URI   Verbindungszeichenfolge zu Supabase, "Session pooler"
#                       (Port 5432). Vor dem Lauf setzen, danach wieder
#                       entfernen — sie enthaelt das Datenbankpasswort:
#                         scalingo --app <app> env-set MIGRATION_SRC_URI="…"
#                         scalingo --app <app> env-unset MIGRATION_SRC_URI
#   postgresql-client-17 im Aptfile. Das Image bringt nur 16 mit, und Supabase
#   laeuft auf 17.6 — pg_dump liest nicht von einem neueren Server.
#
# WIEDERHOLBAR
#   Die Zielschemas werden vorher verworfen. Ein abgebrochener Lauf kann also
#   einfach neu gestartet werden.
#
# ⚠ REIHENFOLGE
#   ERST dieses Skript, DANN 05_rls_scalingo.sql. Mit aktivem FORCE RLS
#   scheitert der Datenimport, weil er als Eigentuemer laeuft.
# =============================================================================

set -euo pipefail

SRC="${MIGRATION_SRC_URI:-}"
DST="${SCALINGO_POSTGRESQL_URL:-}"

say() { echo ""; echo "── $* ────────────────────────────────"; }

[[ -n "$SRC" ]] || { echo "FEHLER: MIGRATION_SRC_URI ist nicht gesetzt." >&2; exit 1; }
[[ -n "$DST" ]] || { echo "FEHLER: SCALINGO_POSTGRESQL_URL fehlt — Addon angelegt?" >&2; exit 1; }

# ── Werkzeuge ───────────────────────────────────────────────────────────────
# Den Pfad explizit waehlen: /usr/bin/pg_dump zeigt auf Version 16, und die
# liest nicht von einem 17er-Server. Die Fehlermeldung ("server version
# mismatch") nennt zwar die Ursache, aber nicht, dass daneben ein passendes
# Binary liegt.
PGBIN17="/usr/lib/postgresql/17/bin"
if [[ -x "$PGBIN17/pg_dump" ]]; then
  PG_DUMP="$PGBIN17/pg_dump"; PSQL="$PGBIN17/psql"
else
  PG_DUMP="$(command -v pg_dump)"; PSQL="$(command -v psql)"
  echo "WARNUNG: $PGBIN17 fehlt — nutze $($PG_DUMP --version)." >&2
  echo "         Steht postgresql-client-17 im Aptfile und wurde neu gebaut?" >&2
fi
echo "Werkzeug : $("$PG_DUMP" --version)"

# ── Verbindungen pruefen ────────────────────────────────────────────────────
say "Verbindungen"
SRC_VER="$("$PSQL" "$SRC" -Atc "select version();" 2>&1 | head -1 || true)"
[[ "$SRC_VER" == PostgreSQL* ]] || { echo "  ✗ Quelle nicht erreichbar: $SRC_VER" >&2; exit 1; }
echo "  Quelle : ${SRC_VER:0:45}…"
DST_VER="$("$PSQL" "$DST" -Atc "select version();" 2>&1 | head -1 || true)"
[[ "$DST_VER" == PostgreSQL* ]] || { echo "  ✗ Ziel nicht erreichbar: $DST_VER" >&2; exit 1; }
echo "  Ziel   : ${DST_VER:0:45}…"

# ── Schemas ermitteln ───────────────────────────────────────────────────────
# Nicht auf "public" festlegen: die Datenbank enthaelt ein Schema REPORTING mit
# Views, auf die Views in public per JOIN zugreifen. Fehlt es, bricht der
# Import mit "relation REPORTING.VW_… does not exist" ab.
say "Schemas"
mapfile -t SCHEMAS < <("$PSQL" "$SRC" -Atc "
  SELECT nspname FROM pg_namespace
  WHERE nspname NOT LIKE 'pg\_%'
    AND nspname NOT IN ('information_schema','auth','storage','graphql',
                        'graphql_public','realtime','realtime_dev','vault',
                        'extensions','supabase_functions','supabase_migrations',
                        'pgsodium','pgsodium_masks','net','cron','_analytics',
                        '_realtime','pgbouncer')
  ORDER BY nspname" | tr -d '\r')
[[ ${#SCHEMAS[@]} -gt 0 ]] || { echo "FEHLER: keine Schemas gefunden." >&2; exit 1; }

ARGS=()
for s in "${SCHEMAS[@]}"; do
  [[ -z "$s" ]] && continue
  # Anfuehrungszeichen sind ZWINGEND: pg_dump wertet --schema wie ein
  # psql-Muster aus und faltet unquotierte Namen auf Kleinschreibung.
  # --schema=REPORTING sucht sonst nach "reporting", findet nichts, und das
  # Schema fehlt im Dump — stillschweigend.
  ARGS+=(--schema="\"$s\"")
  echo "  • $s"
done

# ── Zielschemas verwerfen ───────────────────────────────────────────────────
# Der Dump enthaelt CREATE SCHEMA public. Das Schema existiert in jeder
# frischen Datenbank bereits, der Befehl scheitert also — und mit
# ON_ERROR_STOP=1 bricht psql beim ERSTEN Fehler ab, in Zeile 26, mit leerer
# Zieldatenbank und ohne erkennbare Ursache.
say "Zielschemas leeren"
for s in "${SCHEMAS[@]}"; do
  [[ -z "$s" ]] && continue
  "$PSQL" "$DST" -Atc "DROP SCHEMA IF EXISTS \"$s\" CASCADE;" >/dev/null
  echo "  • $s verworfen"
done

# ── Uebertragen ─────────────────────────────────────────────────────────────
# In drei Abschnitten. Die Daten laufen, solange es noch keine Fremdschluessel
# gibt — damit spielt die Ladereihenfolge der Tabellen keine Rolle und es
# braucht keine Superuser-Rechte auf der Zielseite. Beides sind die Fallstricke,
# an denen solche Migrationen ueblicherweise scheitern.
#
# Direkt durch die Pipe statt ueber Dateien: der Container hat wenig Platz, und
# ein Zwischenstand auf Platte waere nach dem Lauf ohnehin verloren.
uebertrage() {
  local abschnitt="$1"; shift
  say "Uebertrage: $abschnitt"
  "$PG_DUMP" "$SRC" --no-owner --no-privileges --no-comments "${ARGS[@]}" "$@" \
    | "$PSQL" "$DST" -v ON_ERROR_STOP=1 -q
  echo "  ✓"
}

uebertrage "Tabellen"               --schema-only --section=pre-data
uebertrage "Daten und Sequenzen"    --data-only                       # enthaelt setval()
uebertrage "Constraints, Indizes"   --schema-only --section=post-data

# ── Kontrolle ───────────────────────────────────────────────────────────────
# Zeilenzahlen beider Seiten mit count(*), nicht mit den geschaetzten reltuples
# aus dem Planner.
say "Kontrolle"
printf "  %-42s %10s %10s\n" "TABELLE" "QUELLE" "ZIEL"
ABWEICHUNG=0
while IFS='|' read -r sch tbl; do
  [[ -z "$sch" ]] && continue
  A="$("$PSQL" "$SRC" -Atc "SELECT count(*) FROM \"$sch\".\"$tbl\"" 2>/dev/null | tr -d '\r')"
  B="$("$PSQL" "$DST" -Atc "SELECT count(*) FROM \"$sch\".\"$tbl\"" 2>/dev/null | tr -d '\r')"
  MARK=""; [[ "$A" != "$B" ]] && { MARK="  ← ABWEICHUNG"; ABWEICHUNG=1; }
  printf "  %-42s %10s %10s%s\n" "$sch.$tbl" "${A:-?}" "${B:-?}" "$MARK"
done < <("$PSQL" "$SRC" -Atc "
  SELECT n.nspname||'|'||c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ($(printf "'%s'," "${SCHEMAS[@]}" | sed "s/,$//")) AND c.relkind='r'
  ORDER BY n.nspname, c.relname" | tr -d '\r')

say "Struktur im Ziel"
for was in "Tabellen:tables" "Views:views"; do
  printf "  %-12s %s\n" "${was%%:*}" \
    "$("$PSQL" "$DST" -Atc "select count(*) from information_schema.${was##*:} where table_schema='public'")"
done
printf "  %-12s %s\n" "Funktionen" "$("$PSQL" "$DST" -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")"
printf "  %-12s %s\n" "Sequenzen"  "$("$PSQL" "$DST" -Atc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'")"

echo ""
if [[ $ABWEICHUNG -eq 0 ]]; then
  echo "═══ Migration abgeschlossen — alle Zeilenzahlen stimmen ueberein. ═══"
  echo ""
  echo " Naechste Schritte:"
  echo "   1. MIGRATION_SRC_URI wieder entfernen (enthaelt das Passwort)"
  echo "   2. RLS scharf schalten: 05_rls_scalingo.sql"
  echo "   3. POSTGREST_ENABLED / POSTGREST_URL / PGRST_JWT_SECRET setzen"
else
  echo "═══ ABWEICHUNGEN bei den Zeilenzahlen — oben markiert. ═══"
  exit 1
fi
