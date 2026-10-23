"""Regression tests for disposable SQLite restore verification."""
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "sqlite-restore-drill.py"


class SQLiteRestoreDrillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db_path = Path(self.temp.name) / "fixture.db"

    def run_tool(self):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--source", str(self.db_path)],
            capture_output=True, text=True, timeout=30
        )

    def test_snapshot_is_restored_and_matches_without_touching_source(self):
        with sqlite3.connect(str(self.db_path)) as db:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT)")
            db.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), amount REAL)")
            db.execute("INSERT INTO companies VALUES (1, 'Synthetic Water Company')")
            db.execute("INSERT INTO orders VALUES (10, 1, 123.45)")
            db.commit()
        original_bytes = self.db_path.read_bytes()
        proc = self.run_tool()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        report = json.loads(proc.stdout)
        self.assertTrue(report["success"])
        self.assertTrue(report["source_unchanged"])
        self.assertEqual(report["sqlite_integrity"], "ok")
        self.assertEqual(report["table_count"], 2)
        self.assertEqual(report["row_count"], 2)
        self.assertFalse(report["restored_copy_retained"])
        self.assertEqual(self.db_path.read_bytes(), original_bytes)

    def test_invalid_database_fails_closed(self):
        self.db_path.write_bytes(b"not a sqlite database")
        proc = self.run_tool()
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(json.loads(proc.stderr)["success"])

    def test_missing_database_cannot_create_source(self):
        proc = self.run_tool()
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(self.db_path.exists())

    def test_symlink_source_rejected(self):
        actual = Path(self.temp.name) / "real.db"
        with sqlite3.connect(str(actual)) as db:
            db.execute("CREATE TABLE safe (id INTEGER)")
        self.db_path.symlink_to(actual)
        proc = self.run_tool()
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(json.loads(proc.stderr)["success"])


if __name__ == "__main__":
    unittest.main()
