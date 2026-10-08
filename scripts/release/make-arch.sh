#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
[ "$(uname -m)" = x86_64 ] || { echo 'Arch package currently supports x86_64 only.' >&2; exit 1; }
[ "$(id -u)" -ne 0 ] || { echo 'Run makepkg as an unprivileged user.' >&2; exit 1; }
version=$(cat "$root/version.txt")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
source_dir=$(realpath -- "${1:-$root/apps/desktop/out/galley-desk-linux-x64}")
output_dir=$(realpath -m -- "${2:-$root/release-assets}")
for file in galley-desk chrome-sandbox resources/app.asar; do
  test -f "$source_dir/$file" || { echo "Missing packaged file: $file" >&2; exit 1; }
done
mkdir -p -- "$output_dir"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cp -- "$root/packaging/arch/PKGBUILD" "$root/packaging/arch/galley-desk.desktop" "$work/"
(
  cd "$work"
  # No compilation occurs here. Runtime dependencies are resolved and verified
  # by pacman during the clean-container installation gate, not on the builder.
  GALLEY_ARCH_SOURCE="$source_dir" GALLEY_ARCH_VERSION="$version" \
    PKGDEST="$output_dir" makepkg --nodeps --force --cleanbuild --noconfirm
)
package="$output_dir/galley-desk-$version-1-x86_64.pkg.tar.zst"
test -s "$package"
# Read actual pacman metadata, rather than treating any tar.zst as a package.
bsdtar -xOf "$package" .PKGINFO | grep -Fx "pkgver = $version-1"
bsdtar -xOf "$package" .PKGINFO | grep -Fx 'arch = x86_64'
printf 'Arch package: %s\n' "$package"
