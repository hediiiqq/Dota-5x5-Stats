#!/bin/sh
set -eu
export LC_ALL=C
cd "$(dirname "$0")/.."

web_role=${DOTA_WEB_DB_ROLE:-dota_web}
case "$web_role" in
  ''|*[!a-zA-Z0-9_]*) echo 'Invalid DOTA_WEB_DB_ROLE' >&2; exit 2 ;;
esac

generate_sql() {
  cat <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';
SELECT pg_advisory_xact_lock(1685025889, 1);
DO $baseline$
BEGIN
  IF to_regclass('public.matches') IS NULL
     OR to_regclass('public.match_players') IS NULL
     OR to_regclass('public.gc_sync_state') IS NULL
     OR to_regclass('public.match_metadata') IS NULL THEN
    RAISE EXCEPTION 'Baseline migrations 001-004 are missing';
  END IF;
END
$baseline$;
CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.app_schema_migrations FROM PUBLIC;
SQL

  previous_version=''
  for file in migrations/[0-9][0-9][0-9]_*.up.sql; do
    test -f "$file" || { echo 'Migration files are missing' >&2; exit 2; }
    filename=${file##*/}
    case "$filename" in
      *[!a-z0-9_.]*) echo 'Invalid migration filename' >&2; exit 2 ;;
    esac
    version=${filename%%_*}
    if [ "$version" = "$previous_version" ]; then
      echo "Duplicate migration version: $version" >&2
      exit 2
    fi
    previous_version=$version
    # These four migrations are the existing PostgreSQL initdb baseline.
    case "$version" in 000|001|002|003|004) continue ;; esac
    checksum=$(tr -d '\r' < "$file" | sha256sum)
    checksum=${checksum%% *}
    cat <<SQL
SELECT EXISTS (SELECT 1 FROM public.app_schema_migrations WHERE version = '$version') AS applied,
       EXISTS (SELECT 1 FROM public.app_schema_migrations WHERE version = '$version'
               AND filename = '$filename' AND checksum = '$checksum') AS unchanged
\gset
\if :applied
  \if :unchanged
    \echo Already applied: $filename
  \else
    DO \$changed\$ BEGIN RAISE EXCEPTION 'Applied migration has changed: $filename'; END \$changed\$;
  \endif
\else
  \echo Applying: $filename
SQL
    tr -d '\r' < "$file"
    printf '\n;\n'
    cat <<SQL
INSERT INTO public.app_schema_migrations(version, filename, checksum)
VALUES ('$version', '$filename', '$checksum');
\endif
SQL
  done

  cat <<SQL
GRANT USAGE ON SCHEMA public TO "$web_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.admin_sessions,
  public.admin_login_attempts,
  public.admin_openid_nonces,
  public.site_notices
TO "$web_role";
GRANT USAGE ON SEQUENCE public.site_notices_id_seq TO "$web_role";
COMMIT;
SQL
}

# Render the exact transaction for review and isolated PostgreSQL tests.
if [ "${1:-}" = '--sql' ] && [ "$#" = 1 ]; then
  generate_sql
  exit 0
fi
if [ "$#" != 0 ]; then
  echo 'Usage: sh deploy/migrate.sh [--sql]' >&2
  exit 2
fi

if [ "${DOTA_RELEASE_LOCK_HELD:-}" != 1 ]; then
  exec 9>/run/lock/dota-stats-release.lock
  flock -w 1200 9
fi
umask 077
migration_sql=$(mktemp)
trap 'rm -f "$migration_sql"' 0
# Finish generation before opening a DB connection: generation errors cannot
# leave a partial script executing against the database.
generate_sql > "$migration_sql"
docker compose --env-file /etc/dota-stats/release.env exec -T db sh -c '
  exec psql -X -w -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -
' < "$migration_sql"
