#!/bin/sh
set -eu
cd /opt/dota-stats
# Serializes scheduled imports, manual imports and deployments.
exec flock -n /run/lock/dota-stats-release.lock \
  docker compose --env-file /etc/dota-stats/release.env --profile import run --rm --no-deps importer "$@"
