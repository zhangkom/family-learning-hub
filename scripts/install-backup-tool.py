#!/usr/bin/env python3
"""Plan/verify the fixed backup entry; mutate only with explicit --apply at cutover.

This helper never stops services, copies learning data or changes runtime/current.
The deployment operator must already have created a consistent private snapshot.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
from pathlib import Path
from uuid import uuid4

PROJECT = Path('/home/ubuntu/codex_project/workspace_own/family-learning-hub')


def digest(content):
    return hashlib.sha256(content).hexdigest()


def plain_file(path):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('Expected a regular backup script/snapshot file')
    return path.read_bytes()


def prepare(project, release_name, snapshot_name, expected_new, expected_old, apply=False):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9-]{1,120}', release_name):
        raise ValueError('Invalid release name')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9-]{1,140}', snapshot_name):
        raise ValueError('Invalid snapshot name')
    if not all(re.fullmatch(r'[a-f0-9]{64}', value) for value in [expected_new, expected_old]):
        raise ValueError('Invalid expected checksum')
    project = project.resolve()
    source = project / 'runtime/releases' / release_name / 'backup-family.mjs'
    target = project / 'runtime/tools/backup-family.mjs'
    snapshot = project / 'backups/releases' / snapshot_name
    for path in [source, target, snapshot]:
        if not path.resolve().is_relative_to(project) or path.absolute() != path.resolve():
            raise RuntimeError('Unexpected linked or external project path')
    new = plain_file(source)
    old = plain_file(target)
    if digest(new) != expected_new or b'model-audit' not in new:
        raise RuntimeError('Candidate backup script does not match the verified artifact')
    if digest(old) not in [expected_old, expected_new]:
        raise RuntimeError('Active backup script changed; re-check deployment state')
    report = {'source': str(source), 'target': str(target), 'sourceSha256': expected_new,
              'installedSha256': digest(old), 'replacementRequired': digest(old) != expected_new,
              'applied': False, 'runtimeLinkChanged': False, 'learningDataRead': False}
    if apply and report['replacementRequired']:
        plain_file(snapshot / 'manifest.json')  # Snapshot must already exist; never create it here.
        preserved = snapshot / 'backup-family-before.mjs'
        if preserved.exists() or preserved.is_symlink():
            if digest(plain_file(preserved)) != expected_old:
                raise RuntimeError('Snapshot backup-tool copy disagrees with expected old tool')
        else:
            with preserved.open('xb') as stream:
                stream.write(old)
                stream.flush()
                os.fsync(stream.fileno())
            preserved.chmod(0o600)
        temporary = target.with_name('.backup-family-' + uuid4().hex + '.pending')
        try:
            with temporary.open('xb') as stream:
                stream.write(new)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.chmod(0o644)
            if digest(plain_file(target)) != expected_old:
                raise RuntimeError('Active backup script changed during preparation')
            os.replace(temporary, target)
            if os.name == 'posix':
                directory_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            temporary.unlink(missing_ok=True)
        report['applied'] = True
        report['installedSha256'] = digest(plain_file(target))
        report['replacementRequired'] = False
    return report


def active(unit):
    return subprocess.check_output(['systemctl', 'show', unit, '-p', 'ActiveState', '--value'], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--expected-new-sha256', required=True)
    parser.add_argument('--expected-old-sha256', required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--check-installed', action='store_true')
    args = parser.parse_args()
    if os.name != 'posix' or os.geteuid() != 0:
        raise RuntimeError('Run on the designated Tencent Linux host as root')
    unit = subprocess.check_output(['systemctl', 'show', 'family-learning-backup.service', '-p', 'ExecStart', '--value'], text=True)
    expected_target = str(PROJECT / 'runtime/tools/backup-family.mjs')
    if 'argv[]=/usr/local/bin/node ' + expected_target + ' ;' not in unit:
        raise RuntimeError('Actual backup ExecStart differs from the reviewed fixed entry')
    if args.apply and any(active(u) != 'inactive' for u in ['family-learning-backup.timer', 'family-learning-backup.service']):
        raise RuntimeError('Stop the backup timer/oneshot as part of the approved maintenance window first')
    report = prepare(PROJECT, args.release, args.snapshot, args.expected_new_sha256, args.expected_old_sha256, args.apply)
    if args.check_installed and report['replacementRequired']:
        raise RuntimeError('The scheduled backup still points to an old script')
    if args.apply or args.check_installed:
        info = (PROJECT / 'runtime/tools/backup-family.mjs').stat()
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o644:
            raise RuntimeError('Installed backup script must be root-owned and mode 0644')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
