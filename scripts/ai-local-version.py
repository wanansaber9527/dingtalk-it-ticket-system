#!/usr/bin/env python3
"""Local source rollback. Does not restore a database or contact a server."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tarfile
import tempfile

EXCLUDED = {'.git', 'node_modules', '.codex-snapshots', '.local-dev', '.local-runtime', 'output', 'tmp', 'coverage', 'dist', 'build', '.npm-cache', '__pycache__'}

def source_files(root):
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in EXCLUDED and not d.startswith('.next')]
        for name in names:
            p = Path(base) / name
            if not p.is_symlink() and name != '.DS_Store' and not name.endswith(('.log', '.tsbuildinfo')):
                yield p

def archive_current(root, destination):
    destination.mkdir(parents=True, mode=0o700)
    files = list(source_files(root))
    manifest = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    with tarfile.open(destination / 'source.tar.gz', 'w:gz') as archive:
        for p in files:
            archive.add(p, arcname=str(p.relative_to(root)), recursive=False)
    (destination / 'source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    for p in destination.iterdir():
        if p.is_file(): p.chmod(0o600)
    return manifest

def verify(snapshot):
    manifest = json.loads((snapshot / 'source-manifest.json').read_text())
    with tarfile.open(snapshot / 'source.tar.gz') as archive:
        for name, digest in manifest.items():
            entry = archive.getmember(name)
            if Path(name).is_absolute() or '..' in Path(name).parts or not entry.isfile():
                raise RuntimeError('Unsafe archive entry')
            if hashlib.sha256(archive.extractfile(entry).read()).hexdigest() != digest:
                raise RuntimeError('Backup hash mismatch: ' + name)
    return manifest

def restore_files(root, snapshot, additions):
    verify(snapshot)
    with tarfile.open(snapshot / 'source.tar.gz') as archive:
        for entry in archive.getmembers():
            target = root / entry.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(entry).read())
            target.chmod(entry.mode & 0o777)
    for name in additions:
        p = root / name
        if p.is_file(): p.unlink()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['checkpoint', 'verify', 'rehearse', 'rollback'])
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--snapshot', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    if not (root / 'scripts/local-env.mjs').exists() or not (root / '.local-dev/runtime.json').exists():
        raise RuntimeError('Only the configured local workspace is supported')
    stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y%m%d-%H%M%S')
    if args.action == 'checkpoint':
        target = root / '.codex-snapshots' / ('ai-ready-' + stamp)
        manifest = archive_current(root, target)
        verify(target)
        print(json.dumps({'checkpoint': str(target), 'verifiedFiles': len(manifest)}, ensure_ascii=False))
        return
    if not args.snapshot: parser.error('--snapshot is required')
    snapshot = args.snapshot.resolve()
    manifest = verify(snapshot)
    current = {str(p.relative_to(root)) for p in source_files(root)}
    additions_file = snapshot / 'development-additions.json'
    if args.action == 'verify':
        print(json.dumps({'verified': True, 'files': len(manifest)}, ensure_ascii=False)); return
    if args.action == 'rehearse':
        additions = sorted(current - set(manifest))
        additions_file.write_text(json.dumps(additions, ensure_ascii=False, indent=2)); additions_file.chmod(0o600)
        with tempfile.TemporaryDirectory(prefix='itdesk-rollback-rehearsal-') as directory:
            destination = Path(directory)
            for p in source_files(root):
                target = destination / p.relative_to(root); target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(p, target)
            restore_files(destination, snapshot, additions)
            restored = {str(p.relative_to(destination)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files(destination)}
            if restored != manifest: raise RuntimeError('Rollback rehearsal did not reproduce baseline exactly')
        print(json.dumps({'rehearsalPassed': True, 'restoredFiles': len(manifest), 'managedAdditions': len(additions), 'database': 'unchanged'}, ensure_ascii=False)); return
    additions = json.loads(additions_file.read_text()) if additions_file.exists() else []
    if not args.apply:
        print('Preview only: restore the verified source version, preserve current database and uploads. Add --apply to execute.'); return
    rescue = root / '.codex-snapshots' / ('before-local-rollback-' + stamp)
    archive_current(root, rescue); verify(rescue)
    pid_file = root / '.local-dev/app.pid'
    if pid_file.exists():
        pid = int(pid_file.read_text())
        command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
        if 'next' in command:
            try: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError: pass
        pid_file.unlink()
    restore_files(root, snapshot, additions)
    cache = root / '.next-local'
    if cache.exists(): cache.rename(root / ('.next-local-before-rollback-' + stamp))
    print(json.dumps({'restored': str(snapshot), 'rescue': str(rescue), 'database': 'preserved', 'next': 'npm run local:start'}, ensure_ascii=False))

if __name__ == '__main__':
    main()
