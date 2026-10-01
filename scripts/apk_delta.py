#!/usr/bin/env python3
"""Create and verify exact APK COPY/DATA deltas using only the Python standard library."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import struct
import tempfile
import zipfile
import zlib

FORMAT = 'zai-copy-v1'
MAGIC = b'ZAI-DLT1'
HEADER = struct.Struct('>8sQQ32s32sI')
MAX_APK_BYTES = 256 * 1024 * 1024
MAX_OPS = 100000
BUFFER = 65536
MIN_SAVING = 65536
COPY, DATA = 0, 1


class DeltaError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise DeltaError(message)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(BUFFER), b''):
            digest.update(chunk)
    return digest.hexdigest()


def checked_file(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), 'Expected a regular non-symlink file')
    size = path.stat().st_size
    require(0 < size <= MAX_APK_BYTES, 'File size exceeds the 256 MiB bound')
    return size


class StrictGzipReader:
    """Bounded output reads; exactly one gzip member, valid trailer, no suffix."""
    def __init__(self, source):
        self.source = source
        self.decoder = zlib.decompressobj(31)
        self.pending = source.read(10)
        require(len(self.pending) == 10 and self.pending[:4] == b'\x1f\x8b\x08\x00',
                'Expected gzip method 8, FLG=0, without optional fields')

    def read(self, size):
        require(0 < size <= BUFFER, 'Unbounded decompression read')
        result = bytearray()
        while len(result) < size and not self.decoder.eof:
            if not self.pending:
                self.pending = self.source.read(BUFFER)
                require(bool(self.pending), 'Truncated gzip stream')
            try:
                result.extend(self.decoder.decompress(self.pending, size - len(result)))
            except zlib.error as error:
                raise DeltaError('Invalid gzip stream or checksum') from error
            self.pending = self.decoder.unconsumed_tail
            if self.decoder.eof:
                require(not self.decoder.unused_data and not self.pending and not self.source.read(1),
                        'Trailing bytes or additional gzip members')
        return bytes(result)

    def exact(self, size):
        result = self.read(size)
        require(len(result) == size, 'Truncated patch operation')
        return result


def apply_delta(base, patch, output, *, patch_sha256, target_bytes, target_sha256):
    """Never overwrite inputs/output; only commit an independently validated target."""
    base, patch, output = Path(base), Path(patch), Path(output)
    base_size = checked_file(base)
    checked_file(patch)
    require(output.resolve() not in (base.resolve(), patch.resolve()) and not output.exists(),
            'Refusing to replace an input or existing output')
    require(isinstance(target_bytes, int) and 0 < target_bytes <= MAX_APK_BYTES, 'Invalid expected target size')
    require(sha256(patch) == patch_sha256.lower(), 'Patch SHA-256 mismatch')
    base_hash = sha256(base)
    temporary = None
    try:
        with patch.open('rb') as compressed, base.open('rb') as original:
            reader = StrictGzipReader(compressed)
            magic, before, after, before_hash, after_hash, count = HEADER.unpack(reader.exact(HEADER.size))
            require(magic == MAGIC, 'Unsupported patch format')
            require(before == base_size and before_hash.hex() == base_hash, 'Base APK mismatch')
            require(after == target_bytes and after_hash.hex() == target_sha256.lower(), 'Target manifest mismatch')
            require(0 < count <= MAX_OPS, 'Invalid operation count')
            with tempfile.NamedTemporaryFile(prefix='.delta-', suffix='.pending', dir=output.parent, delete=False) as target:
                temporary = Path(target.name)
                digest, written = hashlib.sha256(), 0
                for _ in range(count):
                    kind = reader.exact(1)[0]
                    require(kind in (COPY, DATA), 'Unknown patch opcode')
                    offset = struct.unpack('>Q', reader.exact(8))[0] if kind == COPY else 0
                    length = struct.unpack('>I', reader.exact(4))[0]
                    require(0 < length <= after - written, 'Invalid operation output length')
                    if kind == COPY:
                        require(offset <= before and length <= before - offset, 'COPY outside the base APK')
                        original.seek(offset)
                    remaining = length
                    while remaining:
                        size = min(BUFFER, remaining)
                        chunk = original.read(size) if kind == COPY else reader.exact(size)
                        require(len(chunk) == size, 'Truncated COPY source')
                        target.write(chunk)
                        digest.update(chunk)
                        written += size
                        remaining -= size
                require(written == after, 'Incomplete target APK')
                require(not reader.read(1), 'Trailing decompressed data')
                require(digest.hexdigest() == target_sha256.lower(), 'Reconstructed APK SHA-256 mismatch')
                target.flush()
                os.fsync(target.fileno())
            # Same-directory hard link atomically refuses an existing output.
            os.link(temporary, output)
        return {'bytes': written, 'sha256': digest.hexdigest(), 'operations': count, 'baseSha256': base_hash}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def zip_ranges(raw):
    """Read compressed byte ranges, never decompress or extract ZIP members."""
    found = {}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            require(len(archive.infolist()) <= MAX_OPS, 'Too many ZIP members')
            for entry in archive.infolist():
                require(entry.filename not in found, 'Duplicate ZIP member')
                header = entry.header_offset
                require(0 <= header <= len(raw) - 30 and raw[header:header + 4] == b'PK\x03\x04', 'Invalid ZIP local header')
                name, extra = struct.unpack_from('<HH', raw, header + 26)
                start = header + 30 + name + extra
                end = start + entry.compress_size
                require(header <= start <= end <= len(raw), 'ZIP payload outside APK')
                found[entry.filename] = (header, start, end)
    except (zipfile.BadZipFile, struct.error) as error:
        raise DeltaError('Not a valid APK ZIP container') from error
    previous = 0
    for header, _, end in sorted(found.values()):
        require(header >= previous, 'Overlapping ZIP members')
        previous = end
    return found


def operations(base, target):
    old, new = zip_ranges(base), zip_ranges(target)
    result, cursor = [], 0

    def emit(kind, offset, length):
        if not length:
            return
        if result and result[-1][0] == kind and result[-1][1] + result[-1][2] == offset:
            previous = result[-1]
            result[-1] = (kind, previous[1], previous[2] + length)
        else:
            result.append((kind, offset, length))

    for name, (header, start, end) in sorted(new.items(), key=lambda item: item[1][0]):
        previous = old.get(name)
        if previous is None or start == end:
            continue
        old_header, old_start, old_end = previous
        if target[start:end] != base[old_start:old_end]:
            continue
        if target[header:end] == base[old_header:old_end]:
            start, old_start = header, old_header
        emit(DATA, cursor, start - cursor)
        emit(COPY, old_start, end - start)
        cursor = end
    emit(DATA, cursor, len(target) - cursor)
    return result if len(result) <= MAX_OPS else [(DATA, 0, len(target))]


def worthwhile(patch_bytes, target_bytes):
    return patch_bytes * 5 < target_bytes * 4 and target_bytes - patch_bytes >= MIN_SAVING


def validate_publication(manifest_path, archive_dir, target, releases, public_dir, url_root):
    """Validate private inputs and exact reconstruction before any publication."""
    if manifest_path is None:
        return [], []
    manifest_path, archive_dir, public_dir = Path(manifest_path), Path(archive_dir), Path(public_dir)
    require(manifest_path.absolute() == manifest_path.resolve()
            and manifest_path.parent.resolve() == archive_dir.resolve(), 'Delta manifest must be in the target private archive')
    require(checked_file(manifest_path) <= 131072, 'Delta manifest is too large')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    require(type(manifest) is dict and manifest.get('schemaVersion') == 1, 'Invalid delta manifest schema')
    require(manifest.get('target') == target, 'Delta manifest target differs from the full APK')
    descriptors = manifest.get('deltas')
    require(type(descriptors) is list and 1 <= len(descriptors) <= 4, 'Expected 1 to 4 deltas')
    require(type(target['versionCode']) is int and 7 < target['versionCode'] <= 2100000000,
            'Bootstrap version 7 must be a full APK')
    require(type(target['bytes']) is int and 0 < target['bytes'] <= MAX_APK_BYTES, 'Invalid target APK size')
    require(isinstance(target['sha256'], str) and re.fullmatch('[a-f0-9]{64}', target['sha256']), 'Invalid target digest')
    output, files, seen = [], [], set()
    expected_keys = {'format', 'fromVersionCode', 'baseBytes', 'baseSha256', 'fileName', 'bytes', 'sha256'}
    for entry in descriptors:
        require(type(entry) is dict and set(entry) == expected_keys, 'Invalid private delta descriptor')
        code = entry['fromVersionCode']
        require(type(code) is int and 7 <= code < target['versionCode'] and code not in seen, 'Invalid or duplicate baseline version')
        seen.add(code)
        require(entry['format'] == FORMAT, 'Unsupported delta format')
        for key in ('bytes', 'baseBytes'):
            require(type(entry[key]) is int and 0 < entry[key] <= MAX_APK_BYTES, 'Invalid delta size')
        for key in ('sha256', 'baseSha256'):
            require(isinstance(entry[key], str) and re.fullmatch('[a-f0-9]{64}', entry[key]), 'Invalid delta digest')
        filename = f'family-learning-{code}-to-{target["versionCode"]}-{entry["sha256"][:16]}.zaidelta.gz'
        require(entry['fileName'] == filename, 'Unexpected delta filename')
        require(worthwhile(entry['bytes'], target['bytes']), 'Delta does not meet the saving threshold; publish the full APK only')
        patch = archive_dir / filename
        require(patch.absolute() == patch.resolve() and checked_file(patch) == entry['bytes']
                and sha256(patch) == entry['sha256'], 'Patch file does not match the descriptor')
        bases = [r for r in releases if r.get('versionCode') == code and r.get('channel') == 'release']
        require(len(bases) == 1, 'Expected a unique registered release baseline')
        baseline = bases[0]
        require(baseline['bytes'] == entry['baseBytes'] and baseline['sha256'] == entry['baseSha256'],
                'Baseline metadata mismatch')
        require(re.fullmatch(r'family-learning-[0-9]+(?:\.[0-9]+){1,3}-release-[a-f0-9]{7}\.apk', baseline['fileName']),
                'Unsafe baseline filename')
        base = public_dir / baseline['fileName']
        require(base.absolute() == base.resolve() and checked_file(base) == entry['baseBytes']
                and sha256(base) == entry['baseSha256'], 'Registered baseline file mismatch')
        with tempfile.TemporaryDirectory(prefix='.delta-verify-', dir=archive_dir) as temporary:
            apply_delta(base, patch, Path(temporary) / 'rebuilt.apk', patch_sha256=entry['sha256'],
                        target_bytes=target['bytes'], target_sha256=target['sha256'])
        output.append({**{key: value for key, value in entry.items() if key != 'fileName'}, 'downloadUrl': url_root + filename})
        files.append(patch)
    return output, files


def create_delta(base, target, directory, from_code, to_code):
    require(type(from_code) is int and type(to_code) is int and 0 < from_code < to_code <= 2100000000,
            'Version codes must increase')
    before, after = checked_file(base), checked_file(target)
    original, desired = Path(base).read_bytes(), Path(target).read_bytes()
    before_hash, after_hash = hashlib.sha256(original).digest(), hashlib.sha256(desired).digest()
    ops = operations(original, desired)
    compressed = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=compressed, mtime=0, compresslevel=9) as stream:
        stream.write(HEADER.pack(MAGIC, before, after, before_hash, after_hash, len(ops)))
        for kind, offset, length in ops:
            stream.write(bytes([kind]))
            if kind == COPY:
                stream.write(struct.pack('>QI', offset, length))
            else:
                stream.write(struct.pack('>I', length))
                stream.write(desired[offset:offset + length])
    payload = compressed.getvalue()
    require(len(payload) <= MAX_APK_BYTES, 'Patch exceeds download bound')
    digest = hashlib.sha256(payload).hexdigest()
    filename = f'family-learning-{from_code}-to-{to_code}-{digest[:16]}.zaidelta.gz'
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    patch = directory / filename
    if patch.exists():
        require(not patch.is_symlink() and patch.read_bytes() == payload, 'Refusing to replace an existing patch')
    else:
        with patch.open('xb') as out:
            out.write(payload)
    with tempfile.TemporaryDirectory(prefix='.delta-verify-', dir=directory) as temporary:
        proof = apply_delta(base, patch, Path(temporary) / 'rebuilt.apk', patch_sha256=digest,
                            target_bytes=after, target_sha256=after_hash.hex())
    descriptor = {'format': FORMAT, 'fromVersionCode': from_code, 'baseBytes': before,
                  'baseSha256': before_hash.hex(), 'fileName': filename, 'bytes': len(payload), 'sha256': digest}
    return {'schemaVersion': 1, 'target': {'versionCode': to_code, 'bytes': after, 'sha256': after_hash.hex()},
            'deltas': [descriptor], 'eligibleForPublication': from_code >= 7 and to_code > 7 and worthwhile(len(payload), after),
            'measurement': {'copyBytes': sum(length for kind, _, length in ops if kind == COPY),
                            'literalBytes': sum(length for kind, _, length in ops if kind == DATA),
                            'operations': len(ops), 'savedBytes': after - len(payload),
                            'savingPercent': round(100 * (after - len(payload)) / after, 3)},
            'reconstruction': proof}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest='mode', required=True)
    create = modes.add_parser('create')
    create.add_argument('--base', type=Path, required=True)
    create.add_argument('--target', type=Path, required=True)
    create.add_argument('--output-dir', type=Path, required=True)
    create.add_argument('--from-version-code', type=int, required=True)
    create.add_argument('--to-version-code', type=int, required=True)
    apply = modes.add_parser('apply')
    apply.add_argument('--base', type=Path, required=True)
    apply.add_argument('--patch', type=Path, required=True)
    apply.add_argument('--output', type=Path, required=True)
    apply.add_argument('--patch-sha256', required=True)
    apply.add_argument('--target-sha256', required=True)
    apply.add_argument('--target-bytes', type=int, required=True)
    args = parser.parse_args()
    if args.mode == 'create':
        report = create_delta(args.base, args.target, args.output_dir, args.from_version_code, args.to_version_code)
        manifest = args.output_dir / ('delta-' + str(args.from_version_code) + '-to-' + str(args.to_version_code) + '.json')
        if manifest.exists():
            require(json.loads(manifest.read_text()) == report, 'Refusing to replace a different delta manifest')
        else:
            manifest.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'manifest': str(manifest), **report}, indent=2))
    else:
        print(json.dumps(apply_delta(args.base, args.patch, args.output, patch_sha256=args.patch_sha256,
                                     target_bytes=args.target_bytes, target_sha256=args.target_sha256)))


if __name__ == '__main__':
    main()
