#!/usr/bin/env bash
# Copies the publishable content out of a depman checkout into generated/.
#
#   ./scripts/pull-content.sh --from ../depman
#
# CI checks depman out with actions/checkout and runs this against it; locally,
# point it at any clone. It only reads from the checkout.
set -euo pipefail

site_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$site_root/node_modules" ]]; then
  echo "pull-content: node_modules is missing; run 'npm ci' first." >&2
  exit 1
fi

exec node "$site_root/scripts/pull-content.mjs" "$@"
