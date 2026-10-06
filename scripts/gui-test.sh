#!/usr/bin/env bash
# Canonical isolated-GUI wrapper (AGENTS.md, «Mandatory GUI test isolation»).
# Usage: scripts/gui-test.sh <command> [args...]
# Example: scripts/gui-test.sh npx playwright test tests/desktop/shell.spec.ts --workers=1
#
# Runs the given command inside its own Xvfb virtual display with a bare Openbox WM,
# with XAUTHORITY / WAYLAND_DISPLAY / XDG_SESSION_TYPE / NO_COLOR / FORCE_COLOR unset,
# and ELECTRON_OZONE_PLATFORM_HINT=x11 pinned, so GUI processes can never reach the
# user's real desktop session — not even via Electron's ozone Wayland fallback.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/gui-test.sh <command> [args...]" >&2
  echo "example: scripts/gui-test.sh npx playwright test tests/desktop/shell.spec.ts --workers=1" >&2
  exit 2
fi

exec env -u XAUTHORITY -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE -u NO_COLOR -u FORCE_COLOR \
  ELECTRON_OZONE_PLATFORM_HINT=x11 \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  xvfb-run -a -s '-screen 0 1920x1080x24' sh -c '
    openbox >/tmp/galley-test-openbox.log 2>&1 &
    galley_wm_pid=$!
    trap "kill $galley_wm_pid 2>/dev/null || true" EXIT
    galley_ready=0
    for galley_attempt in $(seq 1 50); do
      if ! kill -0 "$galley_wm_pid" 2>/dev/null; then
        echo "Openbox exited before becoming ready" >&2
        exit 1
      fi
      if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q "window id # 0x[1-9a-fA-F]"; then
        galley_ready=1
        break
      fi
      sleep 0.1
    done
    if [ "$galley_ready" -ne 1 ]; then
      echo "Openbox did not become ready within 5 seconds" >&2
      exit 1
    fi
    "$@"
  ' sh "$@"
