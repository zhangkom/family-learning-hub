"""Offline synthetic delta/parser/publication tests; never touch a server."""
import copy
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import struct
import tempfile
import unittest
import zipfile

import apk_delta as delta

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-apk.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class DeltaTest(unittest.TestCase):
    def setUp(self):
        Path('work').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='delta-test-', dir=Path('work').resolve())
        self.root = Path(self.temporary.name)
        self.base = self.root / 'base.apk'
        self.target = self.root / 'target.apk'
        self.patch = self.root / 'patch.gz'
        self.output = self.root / 'output.apk'
        self.base.write_bytes(b'abcdefghij')
        self.target.write_bytes(b'abcXYZhij')

    def tearDown(self):
        self.temporary.cleanup()

    def header(self, **changes):
        fields = dict(magic=delta.MAGIC, before=10, after=9,
                      base=hashlib.sha256(self.base.read_bytes()).digest(),
                      target=hashlib.sha256(self.target.read_bytes()).digest(), count=3)
        fields.update(changes)
        return delta.HEADER.pack(*fields.values())

    def ops(self):
        return b'\0' + struct.pack('>QI', 0, 3) + b'\1' + struct.pack('>I', 3) + b'XYZ' + b'\0' + struct.pack('>QI', 7, 3)

    def apply(self, raw=None, compressed=None, **kwargs):
        if compressed is None:
            compressed = gzip.compress(raw if raw is not None else self.header() + self.ops(), mtime=0)
        self.patch.write_bytes(compressed)
        return delta.apply_delta(self.base, self.patch, self.output,
                                 patch_sha256=kwargs.get('patch_sha256', delta.sha256(self.patch)),
                                 target_bytes=kwargs.get('target_bytes', self.target.stat().st_size),
                                 target_sha256=kwargs.get('target_sha256', delta.sha256(self.target)))

    def rejected(self, **args):
        with self.assertRaises((delta.DeltaError, OSError)):
            self.apply(**args)
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.root.glob('.delta-*.pending')))
        self.assertEqual(self.base.read_bytes(), b'abcdefghij')

    def test_copy_data_reconstruct_exactly(self):
        proof = self.apply()
        self.assertEqual(self.output.read_bytes(), self.target.read_bytes())
        self.assertEqual(proof['operations'], 3)

    def test_reject_mismatching_inputs_and_manifest(self):
        for args in [dict(patch_sha256='0' * 64), dict(target_bytes=8), dict(target_sha256='0' * 64),
                     dict(raw=self.header(base=b'\0' * 32) + self.ops()), dict(raw=self.header(before=11) + self.ops())]:
            with self.subTest(args=args): self.rejected(**args)

    def test_bad_headers_and_counts(self):
        for change in [dict(magic=b'WRONG---'), dict(count=0), dict(count=100001), dict(count=2),
                       dict(after=2**64-1), dict(before=2**64-1)]:
            with self.subTest(change=change): self.rejected(raw=self.header(**change) + self.ops())

    def test_unknown_zero_or_unbounded_operations(self):
        for operation in [b'\2', b'\1' + struct.pack('>I', 0), b'\1' + struct.pack('>I', 2**32-1),
                          b'\0' + struct.pack('>QI', 2**64-1, 9), b'\0' + struct.pack('>QI', 9, 9),
                          b'\0' + struct.pack('>QI', 0, 0), b'\0' + struct.pack('>QI', 0, 8),
                          b'\1' + struct.pack('>I', 9) + b'badbytes!']:
            with self.subTest(operation=operation): self.rejected(raw=self.header(count=1) + operation)

    def test_truncation_extra_data_and_gzip_crc(self):
        good = gzip.compress(self.header() + self.ops(), mtime=0)
        bad_crc = bytearray(good)
        bad_crc[-8] ^= 1
        for compressed in [good[:9], good[:-1], good[:-9], bytes(bad_crc), good + b'extra',
                           good + gzip.compress(b'', mtime=0), good + gzip.compress(b'X', mtime=0),
                           gzip.compress(self.header() + self.ops() + b'X', mtime=0),
                           gzip.compress(self.header() + self.ops()[:-2], mtime=0)]:
            with self.subTest(length=len(compressed)): self.rejected(compressed=compressed)

    def test_optional_gzip_fields_rejected(self):
        good = bytearray(gzip.compress(self.header() + self.ops(), mtime=0))
        good[3] = 8
        self.rejected(compressed=bytes(good[:10]) + b'filename\0' + bytes(good[10:]))

    def test_preserve_existing_output(self):
        self.output.write_bytes(b'keep existing')
        with self.assertRaises(delta.DeltaError): self.apply()
        self.assertEqual(self.output.read_bytes(), b'keep existing')
        self.output = self.base
        with self.assertRaises(delta.DeltaError): self.apply()
        self.assertEqual(self.base.read_bytes(), b'abcdefghij')

    def zip_fixture(self):
        stable = random.Random(42).randbytes(200000)
        def write(path, entries):
            with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for name, data in entries:
                    archive.writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), data, compress_type=zipfile.ZIP_DEFLATED)
        write(self.base, [('old.txt', b'deleted'), ('classes.dex', stable), ('change.txt', b'old'), ('move.bin', stable[:1000])])
        write(self.target, [('new.txt', b'added'), ('move.bin', stable[:1000]), ('change.txt', b'new'), ('classes.dex', stable)])
        archive = self.root / 'archive'
        manifest = delta.create_delta(self.base, self.target, archive, 7, 8)
        return archive, manifest

    def test_zip_add_change_delete_reorder_and_determinism(self):
        archive, report = self.zip_fixture()
        second = delta.create_delta(self.base, self.target, archive, 7, 8)
        self.assertEqual(report, second)
        self.assertTrue(report['eligibleForPublication'])
        patch = archive / report['deltas'][0]['fileName']
        delta.apply_delta(self.base, patch, self.output, patch_sha256=delta.sha256(patch),
                          target_bytes=self.target.stat().st_size, target_sha256=delta.sha256(self.target))
        self.assertEqual(self.output.read_bytes(), self.target.read_bytes())

    def publication_fixture(self):
        archive, report = self.zip_fixture()
        self.manifest = archive / 'delta-7-to-8.json'
        self.manifest.write_text(json.dumps(report))
        public = self.root / 'public'
        public.mkdir()
        name = 'family-learning-0.2.5-release-abcdef0.apk'
        (public / name).write_bytes(self.base.read_bytes())
        self.releases = [dict(versionCode=7, channel='release', fileName=name, bytes=self.base.stat().st_size, sha256=delta.sha256(self.base))]
        self.report, self.archive, self.public = report, archive, public
        return self.validate()

    def validate(self):
        return delta.validate_publication(self.manifest, self.archive, self.report['target'], self.releases, self.public, publisher.URL_ROOT)

    def test_publication_validates_exact_reconstruction_and_sanitizes_private_paths(self):
        descriptors, files = self.publication_fixture()
        self.assertEqual(len(files), 1)
        self.assertNotIn('fileName', descriptors[0])
        self.assertNotIn(str(self.root), json.dumps(descriptors))
        self.assertEqual(descriptors[0]['downloadUrl'], publisher.URL_ROOT + files[0].name)
        self.assertFalse(list(self.archive.glob('.delta-verify-*')))
        entry = {**self.releases[0], 'deltas': descriptors, 'downloadUrl': publisher.URL_ROOT + self.releases[0]['fileName']}
        config = publisher.nginx_config([entry], entry).decode()
        self.assertIn('location = /family-learning/downloads/android/' + files[0].name, config)
        self.assertIn('default_type application/octet-stream;', config)
        self.assertIn('gzip off;', config)
        self.assertNotIn('Content-Encoding', config)

    def test_publication_rejects_mutated_descriptors_baselines_and_target(self):
        self.publication_fixture()
        original = copy.deepcopy(self.report)
        changes = [('format', 'other'), ('fromVersionCode', 6), ('fromVersionCode', 8), ('fromVersionCode', True),
                   ('fileName', '../patch.gz'), ('sha256', '0' * 64), ('baseSha256', '0' * 64),
                   ('bytes', self.report['target']['bytes']), ('baseBytes', 1)]
        for key, value in changes:
            data = copy.deepcopy(original)
            data['deltas'][0][key] = value
            self.manifest.write_text(json.dumps(data))
            with self.subTest(key=key), self.assertRaises(delta.DeltaError): self.validate()
        for entries in [[], original['deltas'] * 2, original['deltas'] * 5]:
            data = copy.deepcopy(original)
            data['deltas'] = entries
            self.manifest.write_text(json.dumps(data))
            with self.assertRaises(delta.DeltaError): self.validate()
        self.manifest.write_text(json.dumps(original))
        self.releases[0]['sha256'] = '0' * 64
        with self.assertRaises(delta.DeltaError): self.validate()
        self.releases[0]['sha256'] = delta.sha256(self.base)
        self.report['target']['versionCode'] = 7
        self.manifest.write_text(json.dumps(self.report))
        with self.assertRaises(delta.DeltaError): self.validate()

    def test_modified_patch_and_baseline_refused_before_publication(self):
        _, files = self.publication_fixture()
        original = files[0].read_bytes()
        files[0].write_bytes(original[:-1] + b'X')
        with self.assertRaises(delta.DeltaError): self.validate()
        files[0].write_bytes(original)
        (self.public / self.releases[0]['fileName']).write_bytes(b'wrong installed baseline')
        with self.assertRaises(delta.DeltaError): self.validate()

    def test_private_manifest_path_and_full_only_fallback(self):
        self.publication_fixture()
        self.manifest = self.root / 'outside.json'
        self.manifest.write_text(json.dumps(self.report))
        with self.assertRaises(delta.DeltaError): self.validate()
        self.assertEqual(delta.validate_publication(None, '', {}, [], '', ''), ([], []))
        self.assertFalse(delta.worthwhile(80000, 100000))
        self.assertFalse(delta.worthwhile(1, 65536))
        self.assertTrue(delta.worthwhile(1, 65537))


if __name__ == '__main__':
    unittest.main()
