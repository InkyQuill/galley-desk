#!/usr/bin/env bash
# Download as the invoking user; elevate only to install verified local bytes.
set -euo pipefail
usage() {
  echo 'Usage: install.sh [--version X.Y.Z] [--download-only DIRECTORY] [--from-directory DIRECTORY]'
}
version=''
download_only=''
from_directory=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) version="${2:?Missing version}"; shift 2 ;;
    --download-only) download_only="${2:?Missing directory}"; shift 2 ;;
    --from-directory) from_directory="${2:?Missing directory}"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done
[ "$(uname -s)" = Linux ] || { echo 'This installer supports Linux only.' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo 'Supported architectures: x86_64 and aarch64.' >&2; exit 1 ;;
esac
for tool in curl python3 sha256sum; do
  command -v "$tool" >/dev/null || { echo "Please install $tool first." >&2; exit 1; }
done
if [ -n "$version" ] && [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Version must be X.Y.Z.' >&2; exit 1
fi
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
fetch() {
  if [ -n "$from_directory" ]; then
    cp -- "$from_directory/${1##*/}" "$2"
  else
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "$1" -o "$2"
  fi
}
base=https://github.com/InkyQuill/galley-desk/releases
if [ -z "$version" ]; then
  fetch "$base/latest/download/SHA256SUMS" "$work/SHA256SUMS"
  version=$(python3 - "$work/SHA256SUMS" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
versions = set(re.findall(r'  galley-desk-(\d+\.\d+\.\d+)-linux-(?:x64|arm64)\.zip$', text, re.M))
if len(versions) != 1:
    sys.exit('No unique release version in SHA256SUMS')
print(versions.pop())
PY
)
fi
# Pin both files to the same release even if latest changes during installation.
fetch "$base/download/v$version/SHA256SUMS" "$work/SHA256SUMS"
asset="galley-desk-$version-linux-$arch.zip"
fetch "$base/download/v$version/$asset" "$work/$asset"
python3 - "$work/SHA256SUMS" "$asset" > "$work/selected.sha256" <<'PY'
import re, sys
matches = [line for line in open(sys.argv[1]) if re.fullmatch(r'[0-9a-f]{64}  ' + re.escape(sys.argv[2]) + r'\n?', line)]
if len(matches) != 1:
    sys.exit('Missing or duplicate archive checksum')
print(matches[0].strip())
PY
(cd "$work" && sha256sum --check selected.sha256)
if [ -n "$download_only" ]; then
  mkdir -p -- "$download_only"
  cp -- "$work/$asset" "$work/selected.sha256" "$work/SHA256SUMS" "$download_only/"
  echo "Verified download: $download_only/$asset"
  exit 0
fi
if [ "$(id -u)" -eq 0 ]; then
  elevate=()
else
  command -v sudo >/dev/null || { echo 'sudo is required for /opt installation.' >&2; exit 1; }
  elevate=(sudo)
fi
# Python validates every entry before extraction and sets the sandbox permissions.
# No user-controlled prefix, archive symlinks, or shell interpolation under sudo.
"${elevate[@]}" python3 - "$work/$asset" "$version" "$arch" <<'PY'
import os, pathlib, shutil, stat, sys, tempfile, zipfile
archive, version, arch = sys.argv[1:]
root = pathlib.Path('/opt/galley-desk')
if root.is_symlink():
    sys.exit('/opt/galley-desk must not be a symlink')
root.mkdir(mode=0o755, parents=True, exist_ok=True)
if root.stat().st_uid != 0 or root.stat().st_mode & 0o022:
    sys.exit('/opt/galley-desk must be root-owned and not writable by other users')
launcher = pathlib.Path('/usr/local/bin/galley-desk')
if launcher.exists() or launcher.is_symlink():
    if not launcher.is_symlink() or os.readlink(launcher) != '/opt/galley-desk/current/galley-desk':
        sys.exit('Refusing to replace an unrelated /usr/local/bin/galley-desk')
stage = pathlib.Path(tempfile.mkdtemp(prefix='.install-', dir=root))
payload = stage / ('galley-desk-linux-' + arch)
try:
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            p = pathlib.PurePosixPath(item.filename)
            if not p.parts or p.parts[0] != payload.name:
                raise ValueError('Unexpected archive root')
            mode = item.external_attr >> 16
            if p.is_absolute() or '..' in p.parts or '\\' in item.filename or stat.S_ISLNK(mode):
                raise ValueError('Unsafe archive entry')
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode) or stat.S_IFMT(mode) == 0):
                raise ValueError('Unsupported archive entry')
        z.extractall(stage)
        for item in z.infolist():
            p = stage / item.filename
            p.chmod(0o755 if p.is_dir() or (item.external_attr >> 16) & 0o111 else 0o644)
    for name in ['galley-desk', 'chrome-sandbox', 'resources/app.asar']:
        if not (payload / name).is_file():
            raise ValueError('Incomplete Galley Desk archive: ' + name)
    (payload / 'chrome-sandbox').chmod(0o4755)
    payload.chmod(0o755)
    # Unique immutable directories allow reinstall/rollback without touching an
    # existing tree. Previous installations remain until explicitly removed.
    destination = root / (version + '-' + stage.name.removeprefix('.install-'))
    payload.rename(destination)
    link = root / ('.current-' + destination.name)
    link.symlink_to(destination.name)
    os.replace(link, root / 'current')
    pathlib.Path('/usr/local/bin').mkdir(parents=True, exist_ok=True)
    if not launcher.is_symlink():
        launcher.symlink_to('/opt/galley-desk/current/galley-desk')
    desktop = pathlib.Path('/usr/local/share/applications/galley-desk.desktop')
    desktop.parent.mkdir(parents=True, exist_ok=True)
    desktop.write_text('[Desktop Entry]\nType=Application\nName=Galley Desk\nComment=Review Markdown books\nExec=/opt/galley-desk/current/galley-desk %U\nIcon=/opt/galley-desk/current/resources/branding/generated/galley-desk-icon.png\nTerminal=false\nCategories=Office;TextEditor;\n')
    desktop.chmod(0o644)
finally:
    if stage.exists():
        shutil.rmtree(stage)
PY
echo "Installed Galley Desk $version. Open it from the application menu or run galley-desk."
echo 'Close the app before updating. Repeat this command to update; use --version X.Y.Z to roll back.'
