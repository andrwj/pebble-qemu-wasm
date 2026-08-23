#!/usr/bin/env bash
set -euo pipefail

# 1. Refresh bundle (new default proxy + store fallback + PKJS runtime)
rm -rf /tmp/pebble-bundle
git clone --depth 1 -b claude/pebbleos-agent-swarm-iviybe \
  https://github.com/coredevices/PebbleOS /tmp/pebble-bundle

# 2. Apply to checkout
cd "$(dirname "$0")"
bash /tmp/pebble-bundle/tools/qemu-wasm/site-dist/apply.sh "$(pwd)"

# 3. Run locally
# python3 -m http.server 8080
