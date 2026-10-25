#!/bin/sh
set -eu
image=${1:?Pass an immutable ghcr.io image tag}
case "$image" in
  ghcr.io/*:sha-*) ;;
  *) echo 'Expected ghcr.io/...:sha-<commit>' >&2; exit 2 ;;
esac
case "$image" in
  *[!a-z0-9./:_-]*) echo 'Invalid image reference' >&2; exit 2 ;;
esac

cd /opt/dota-stats
if [ "${DOTA_RELEASE_LOCK_HELD:-}" != "1" ]; then
  exec 9>/run/lock/dota-stats-release.lock
  flock -w 1200 9
fi
export DOTA_RELEASE_LOCK_HELD=1
umask 077
release=/etc/dota-stats/release.env
previous=$(sed -n 's/^DOTA_IMAGE=//p' "$release")
test -n "$previous"
compose() { docker compose --env-file "$release" "$@"; }

# Pull before changing the running release.
docker pull "$image"
# Migrate and grant auth permissions before switching the application image.
# A failure leaves the previous web container and release.env in place.
compose up -d --no-build --wait --wait-timeout 120 db
/bin/sh deploy/migrate.sh
cp "$release" "$release.previous"
sed '/^DOTA_IMAGE=/d' "$release" > "$release.next"
printf 'DOTA_IMAGE=%s\n' "$image" >> "$release.next"
mv "$release.next" "$release"
if compose up -d --no-build --wait --wait-timeout 120 db web proxy \
  && compose exec -T proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
  && compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile \
  && compose exec -T web wget -q -T 10 -O /dev/null 'http://127.0.0.1:8080/api/matches?limit=1' \
  && public_ip=$(compose exec -T proxy printenv DOTA_PUBLIC_IP) \
  && curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors \
    --connect-timeout 5 --max-time 10 "https://$public_ip/api/matches?limit=1" >/dev/null; then
  echo "Deployed $image"
else
  echo 'Deployment failed; restoring the previous application image' >&2
  cp "$release.previous" "$release.next"
  mv "$release.next" "$release"
  compose up -d --no-build --wait --wait-timeout 120 db web proxy
  exit 1
fi
