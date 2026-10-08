#!/bin/bash
# Run only in a disposable root container with this repository mounted at /src.
# Requires bash, Python 3 and coreutils; creates synthetic payloads, never a GUI.
set -euo pipefail
[ -f /.dockerenv ] && [ "$(id -u)" = 0 ] && [ -f /src/scripts/install.sh ] || {
  echo 'Run this check in a disposable root Docker container with the repo at /src.' >&2
  exit 1
}
for existing in /fixture /test-bin /opt/galley-desk /usr/local/bin/galley-desk /usr/local/share/applications/galley-desk.desktop; do
  if [ -e "$existing" ] || [ -L "$existing" ]; then
    echo "Refusing to overwrite existing path: $existing" >&2
    exit 1
  fi
done
mkdir /fixture
python3 - <<'PY'
import zipfile, pathlib, hashlib
p=pathlib.Path('/fixture/galley-desk-1.2.3-linux-x64.zip')
with zipfile.ZipFile(p,'w') as z:
 for name in ['galley-desk','chrome-sandbox','resources/app.asar']:
  z.writestr('galley-desk-linux-x64/'+name,'fixture')
pathlib.Path('/fixture/SHA256SUMS').write_text(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n')
PY
bash /src/scripts/install.sh --from-directory /fixture
test "$(stat -c '%u:%g:%a' /opt/galley-desk/current/chrome-sandbox)" = 0:0:4755
rm /usr/local/bin/galley-desk /usr/local/share/applications/galley-desk.desktop
rm -r /opt/galley-desk
mkdir /test-bin
printf '#!/bin/sh\necho 1000\n' > /test-bin/id
cat > /test-bin/sudo <<'STUB'
#!/bin/sh
printf tampered > "$3"
exec "$@"
STUB
chmod +x /test-bin/*
if PATH="/test-bin:$PATH" bash /src/scripts/install.sh --from-directory /fixture > /tmp/tamper.log 2>&1; then
 echo 'ERROR: tampered archive accepted'; exit 1
fi
cat /tmp/tamper.log
grep -q 'Archive changed before privileged installation' /tmp/tamper.log
test ! -e /opt/galley-desk/current
test -z "$(ls -A /opt/galley-desk)"
echo 'PASS: install permissions, handoff tampering rejected, failed stage cleaned'
