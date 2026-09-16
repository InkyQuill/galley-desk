"""Run from the Desk root after package; no system zip required."""
import os
import stat
import zipfile
from pathlib import Path

root = Path('apps/desktop/out/Galley Desk-linux-x64')
output = Path('apps/desktop/out/make/zip/linux/x64/Galley Desk-linux-x64-0.1.0.zip')
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for item in sorted(root.rglob('*')):
        name = str(item.relative_to(root.parent))
        if item.is_symlink():
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, os.readlink(item))
        elif item.is_file():
            archive.write(item, name)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    executable = archive.getinfo('Galley Desk-linux-x64/Galley Desk')
    assert executable.external_attr >> 16 & stat.S_IXUSR
print(output)
