#!/usr/bin/env bash
# Ship cubes to Cloudflare from this machine, using wrangler's OAuth login.
# No API token needed: if wrangler isn't logged in, it opens the browser once.
#
#   scripts/deploy.sh            # rooms Worker, then the Pages site, then a check
#   scripts/deploy.sh --site     # just the site (no Rust changes)
#   scripts/deploy.sh --smoke    # also play a real online game against production
#
# DEPLOY_DIRTY=1 lets you ship uncommitted changes (you probably don't want to).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="https://playcubes.pages.dev"
WRANGLER=(npx -y wrangler@4)
ROOMS=1
SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --site) ROOMS=0 ;;
    --smoke) SMOKE=1 ;;
    -h | --help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }

# Builds are heavy; keep the machine usable while they run.
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
NICE=(nice -n 10)

cd "$ROOT"
if [ -z "${DEPLOY_DIRTY:-}" ] && [ -n "$(git status --porcelain)" ]; then
  echo "The working tree has uncommitted changes. Commit them, or set DEPLOY_DIRTY=1." >&2
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"

say "Checking the Cloudflare login"
if ! "${WRANGLER[@]}" whoami 2>&1 | grep -q "You are logged in"; then
  echo "Not logged in. Opening the browser for wrangler's OAuth login."
  "${WRANGLER[@]}" login
fi

if [ "$ROOMS" = 1 ]; then
  say "Deploying the rooms Worker (Rust Durable Object) at $COMMIT"
  (cd crates/rooms && "${NICE[@]}" "${WRANGLER[@]}" deploy)
fi

say "Building the site at $COMMIT"
(cd web && "${NICE[@]}" bun run wasm && "${NICE[@]}" bun run build:site)

say "Deploying the Pages site"
(cd web && "${WRANGLER[@]}" pages deploy dist --project-name playcubes --branch main \
  --commit-hash "$(git rev-parse HEAD)" --commit-message "$(git log -1 --format=%s)" --commit-dirty=true)

say "Checking the live site"
fail=0
for path in / /play /daily /learn /robots.txt /sitemap.xml; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$SITE$path")"
  printf '  %-14s %s\n' "$path" "$code"
  [ "$code" = 200 ] || fail=1
done
[ "$fail" = 0 ] || { echo "Some pages didn't answer 200." >&2; exit 1; }

if [ "$SMOKE" = 1 ]; then
  say "Playing an online game against production"
  (cd web && ROOM_BASE="wss://${SITE#https://}" SKIP_HEALTH=1 bun run scripts/room-smoke.ts)
fi

say "Live: $SITE ($COMMIT)"
