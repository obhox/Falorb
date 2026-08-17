#!/bin/sh
# Fetch the GeoIP database, then start the collector.
#
# This runs before the collector because `initGeo` opens the .mmdb once at boot
# and holds it in memory — a database that lands afterwards is not picked up
# until the next restart. Downloading here is what makes geo work on a fresh
# deploy without anyone shelling into the container.
#
# It must never prevent the collector from starting. Ingest sits in front of
# every pageview on every tracked site; losing that traffic because MaxMind is
# unreachable or a licence key expired would be a far worse failure than empty
# country fields. So every path below ends in `exec "$@"`.
#
# The database is not baked into the image on purpose: it is ~70MB, MaxMind's
# licence forbids redistribution, and it is stale within weeks. It belongs in a
# volume, fetched at run time.
set -u

GEOIP_DIR="${MAXMIND_DB_DIR:-/geoip}"
CITY_DB="$GEOIP_DIR/GeoLite2-City.mmdb"
# MaxMind publishes GeoLite2 twice a week. Monthly is a reasonable default:
# frequent enough that the data stays useful, rare enough that a restart loop
# cannot hammer their servers.
MAX_AGE_DAYS="${GEOIP_MAX_AGE_DAYS:-30}"
# A slow download must not hold the collector offline indefinitely.
TIMEOUT_SECONDS="${GEOIP_DOWNLOAD_TIMEOUT:-180}"

if [ -z "${MAXMIND_LICENSE_KEY:-}" ]; then
  echo "[geoip] MAXMIND_LICENSE_KEY not set — starting without geo enrichment."
  echo "[geoip] Country, region and city will be empty. Collection is unaffected."
  exec "$@"
fi

# `find -mtime` is the portable staleness test; -newermt is not in busybox.
if [ -f "$CITY_DB" ] && [ -z "$(find "$CITY_DB" -mtime "+$MAX_AGE_DAYS" 2>/dev/null)" ]; then
  echo "[geoip] $CITY_DB is present and under $MAX_AGE_DAYS days old — skipping download."
  exec "$@"
fi

if [ -f "$CITY_DB" ]; then
  echo "[geoip] $CITY_DB is older than $MAX_AGE_DAYS days — refreshing."
else
  echo "[geoip] No database at $CITY_DB — downloading."
fi

if ! mkdir -p "$GEOIP_DIR" 2>/dev/null || [ ! -w "$GEOIP_DIR" ]; then
  echo "[geoip] $GEOIP_DIR is not writable by $(id -un). Mount a volume there and"
  echo "[geoip] ensure it is owned by the container user. Starting without geo."
  exec "$@"
fi

# `bun`, not `node`: the runtime image is Bun-only. The script itself is plain
# ESM against node: builtins, which Bun runs unchanged.
if MAXMIND_DB_DIR="$GEOIP_DIR" timeout "$TIMEOUT_SECONDS" bun scripts/download-geoip.mjs; then
  echo "[geoip] Database ready at $CITY_DB."
else
  status=$?
  if [ "$status" -eq 124 ]; then
    echo "[geoip] Download timed out after ${TIMEOUT_SECONDS}s."
  else
    echo "[geoip] Download failed (exit $status)."
  fi
  # A stale database still beats none, and none still beats no collector.
  if [ -f "$CITY_DB" ]; then
    echo "[geoip] Continuing with the existing database."
  else
    echo "[geoip] Starting without geo enrichment; country will be empty."
  fi
fi

exec "$@"
