#!/usr/bin/env bash
# Canonical isolated-GUI wrapper (AGENTS.md, «Mandatory GUI test isolation»).
# Usage: scripts/gui-test.sh <command> [args...]
# Example: scripts/gui-test.sh npx playwright test tests/desktop/shell.spec.ts --workers=1
#
# Runs the given command inside its own Xvfb virtual display with a bare Openbox WM,
# with XAUTHORITY / WAYLAND_DISPLAY / NO_COLOR / FORCE_COLOR unset, so GUI processes
# can never touch the user's real desktop session.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/gui-test.sh <command> [args...]" >&2
  echo "example: scripts/gui-test.sh npx playwright test tests/desktop/shell.spec.ts --workers=1" >&2
  exit 2
fi

exec env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  xvfb-run -a sh -c '
    openbox >/tmp/galley-test-openbox.log 2>&1 &
    galley_wm_pid=$!
    trap "kill $galley_wm_pid 2>/dev/null || true" EXIT
    "$@"
  ' sh "$@"
