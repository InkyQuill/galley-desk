#!/usr/bin/env bash
# Run only inside the disposable Arch container used by CI/local verification.
set -euo pipefail
cd /workspace
version=$(cat version.txt)
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
[[ "${BUILD_UID:?Missing builder UID}" =~ ^[0-9]+$ ]] || exit 1
[ "$BUILD_UID" -ne 0 ] || exit 1
pacman -Syu --noconfirm --needed nodejs npm xorg-server-xvfb xorg-xauth openbox xdotool xorg-xprop
useradd --create-home --uid "$BUILD_UID" builder
runuser -u builder -- scripts/release/make-arch.sh /workspace/apps/desktop/out/galley-desk-linux-x64 /output
pacman -U --noconfirm "/output/galley-desk-$version-1-x86_64.pkg.tar.zst"
pacman -Qkk galley-desk
test "$(stat -c '%u:%g:%a' /usr/lib/galley-desk/chrome-sandbox)" = '0:0:4755'
cmp apps/desktop/out/galley-desk-linux-x64/resources/app.asar /usr/lib/galley-desk/resources/app.asar
runuser -u builder -- env \
  GALLEY_PACKAGED_EXECUTABLE=/usr/lib/galley-desk/galley-desk \
  GALLEY_TEST_FORCE_SUID_SANDBOX=1 \
  scripts/gui-test.sh npx playwright test \
    tests/desktop/packaged-smoke.spec.ts tests/desktop/shell.spec.ts \
    --workers=1 --output=/tmp/galley-arch-tests
# Pacman removal must remove application files, not manuscripts or profiles.
pacman -R --noconfirm galley-desk
test ! -e /usr/lib/galley-desk
test ! -e /usr/bin/galley-desk
echo 'ARCH_PACKAGE_INSTALL_SMOKE_REMOVE_OK'
