"""Verify non-destructive foreign-key reconciliation against synthetic QA data."""
import hashlib
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('temo_fk_repair', ROOT / 'scripts' / 'reconcile-fk-qa.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class ForeignKeyRepairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'original.sqlite'
        self.output = Path(self.temp.name) / 'qa-copy.sqlite'
        with sqlite3.connect(self.source) as db:
            db.executescript("""
                PRAGMA foreign_keys=OFF;
                CREATE TABLE companies(id INTEGER PRIMARY KEY);
                CREATE TABLE users(id INTEGER PRIMARY KEY);
                CREATE TABLE audit_logs(id INTEGER PRIMARY KEY, company_id INTEGER REFERENCES companies(id),
                    user_id INTEGER REFERENCES users(id), action TEXT NOT NULL);
                CREATE TABLE company_currency_settings(company_id INTEGER PRIMARY KEY REFERENCES companies(id),
                    base_currency TEXT NOT NULL, updated_by INTEGER REFERENCES users(id));
                CREATE TABLE sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id));
                CREATE TABLE password_reset_tokens(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id));
                INSERT INTO companies VALUES (1);
                INSERT INTO users VALUES (1);
                INSERT INTO audit_logs VALUES(1,101,201,'historical_login');
                INSERT INTO audit_logs VALUES(2,102,202,'historical_edit');
                INSERT INTO company_currency_settings VALUES(10,'PKR',NULL);
                INSERT INTO company_currency_settings VALUES(11,'SAR',NULL);
                INSERT INTO company_currency_settings VALUES(12,'GBP',NULL);
                INSERT INTO sessions VALUES ('orphan-secret-a',222);
                INSERT INTO sessions VALUES ('orphan-secret-b',223);
                INSERT INTO sessions VALUES ('active',1);
                INSERT INTO password_reset_tokens VALUES ('lost-secret',777);
            """)

    def test_ten_orphans_reconciled_on_clone_only(self):
        original = self.source.read_bytes()
        result = MODULE.repair(self.source, self.output)
        self.assertEqual(result['source_violations'], 10)
        self.assertEqual(result['qa_copy_violations'], 0)
        self.assertEqual(result['reconciliation_entries'], 10)
        self.assertEqual(self.source.read_bytes(), original)
        with sqlite3.connect(self.output) as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('SELECT count(*) FROM audit_logs').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT token FROM sessions').fetchone()[0], 'active')
            self.assertEqual(db.execute('SELECT count(*) FROM company_currency_settings').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM integrity_reconciliation').fetchone()[0], 10)
            archived = db.execute('SELECT original_row_json FROM integrity_reconciliation WHERE action_taken = ?', ('archive_orphan_currency',)).fetchall()
            self.assertEqual(len(archived), 3)
            self.assertNotIn('lost-secret', str(db.execute('SELECT * FROM integrity_reconciliation').fetchall()))
        with sqlite3.connect(self.source) as original_db:
            self.assertEqual(len(original_db.execute('PRAGMA foreign_key_check').fetchall()), 10)

    def test_output_cannot_overwrite_any_existing_file(self):
        self.output.write_text('important')
        with self.assertRaisesRegex(ValueError, 'new, separate'):
            MODULE.repair(self.source, self.output)
        self.assertEqual(self.output.read_text(), 'important')

    def test_unknown_fk_is_rejected_without_writing_output(self):
        with sqlite3.connect(self.source) as db:
            db.executescript('CREATE TABLE extra(x INTEGER REFERENCES companies(id)); INSERT INTO extra VALUES(999);')
        with self.assertRaisesRegex(RuntimeError, 'Unrecognized'):
            MODULE.repair(self.source, self.output)
        self.assertFalse(self.output.exists())

if __name__ == '__main__':
    unittest.main()
