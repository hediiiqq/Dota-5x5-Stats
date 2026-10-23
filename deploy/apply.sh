#!/bin/sh
set -eu
image=${1:?Pass an image tag}
archive=${2:?Pass a release archive}
case "$archive" in
  /opt/dota-stats/incoming-*.tar.gz) ;;
  *) echo 'Expected a staged archive in /opt/dota-stats' >&2; exit 2 ;;
esac
exec 9>/run/lock/dota-stats-release.lock
flock -w 1200 9
cd /opt/dota-stats
# Configuration and application image are changed under the same lock.
tar -xzf "$archive"
export DOTA_RELEASE_LOCK_HELD=1
exec /bin/sh deploy/update.sh "$image"
