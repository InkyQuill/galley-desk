#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
mkdir -p "$root/release-assets"
# No host display/socket is mounted. SYS_ADMIN permits Chromium's own sandbox
# namespaces inside the disposable container; the app still runs unprivileged.
docker run --rm --cap-add=SYS_ADMIN --security-opt seccomp=unconfined \
  --env "BUILD_UID=$(id -u)" \
  --mount "type=bind,source=$root,target=/workspace,readonly" \
  --mount "type=bind,source=$root/release-assets,target=/output" \
  archlinux:base-devel@sha256:996c3a1d6b0d87b01242f6fcd8cfa3ad3eece1a67ab5c8f108e20af1d7b97bdd \
  bash /workspace/scripts/release/check-arch-container.sh
