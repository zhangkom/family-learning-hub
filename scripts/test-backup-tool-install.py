"""Synthetic filesystem checks only; no SSH, systemctl or production paths."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('backup_install', Path(__file__).with_name('install-backup-tool.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupInstallTests(unittest.TestCase):
    def setUp(self):
        work = Path(__file__).resolve().parent.parent / 'work'
        work.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='backup-tool-', dir=work)
        self.project = Path(self.temp.name)
        self.source = self.project / 'runtime/releases/test-release/backup-family.mjs'
        self.target = self.project / 'runtime/tools/backup-family.mjs'
        self.snapshot = self.project / 'backups/releases/test-snapshot'
        for directory in [self.source.parent, self.target.parent, self.snapshot]:
            directory.mkdir(parents=True)
        self.old = b'// old backup tool\n'
        self.new = b'// model-audit included\n'
        self.source.write_bytes(self.new)
        self.target.write_bytes(self.old)
        (self.snapshot / 'manifest.json').write_text(json.dumps({'syntheticOnly': True}))
        self.old_hash, self.new_hash = module.digest(self.old), module.digest(self.new)

    def tearDown(self):
        self.temp.cleanup()

    def call(self, apply=False, **kwargs):
        return module.prepare(self.project, kwargs.get('release', 'test-release'), 'test-snapshot',
                              kwargs.get('new', self.new_hash), kwargs.get('old', self.old_hash), apply)

    def test_plan_is_read_only_and_apply_preserves_old_then_is_idempotent(self):
        self.assertTrue(self.call()['replacementRequired'])
        self.assertEqual(self.target.read_bytes(), self.old)
        self.assertFalse((self.snapshot / 'backup-family-before.mjs').exists())
        self.assertTrue(self.call(True)['applied'])
        self.assertEqual(self.target.read_bytes(), self.new)
        self.assertEqual((self.snapshot / 'backup-family-before.mjs').read_bytes(), self.old)
        self.assertFalse(self.call(True)['applied'])

    def test_refuses_checksum_changes_missing_snapshot_and_path_escape(self):
        for args in [{'new': '0' * 64}, {'old': '0' * 64}, {'release': '../../runtime/tools'}]:
            with self.assertRaises((RuntimeError, ValueError)):
                self.call(True, **args)
            self.assertEqual(self.target.read_bytes(), self.old)
        (self.snapshot / 'manifest.json').unlink()
        with self.assertRaises(RuntimeError):
            self.call(True)
        self.assertEqual(self.target.read_bytes(), self.old)


if __name__ == '__main__':
    unittest.main()
