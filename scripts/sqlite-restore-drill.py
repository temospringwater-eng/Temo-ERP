#!/usr/bin/env python3
"""Read-only SQLite backup -> isolated restore verification for TEMO ERP.

This tool does not modify the original database and does not restore into a
running application. The isolated restored copy is destroyed after checks.
It does NOT restore the redacted JSON metadata exports from /api/backups.
"""
import argparse
import hashlib
import json
import sqlite3
import sys
import tempfile
from pathlib import Path


def _integrity(db):
    result = db.execute("PRAGMA integrity_check").fetchone()
    if not result or result[0] != "ok":
        raise ValueError("SQLite integrity_check failed")
    bad_fk = db.execute("PRAGMA foreign_key_check").fetchone()
    if bad_fk is not None:
        raise ValueError("SQLite foreign_key_check failed")


def _manifest(db):
    names = [row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]
    result = {}
    for name in names:
        quoted = '"' + name.replace('"', '""') + '"'
        result[name] = db.execute("SELECT COUNT(*) FROM " + quoted).fetchone()[0]
    return result


def run_drill(source_path):
    src = Path(source_path).expanduser()
    if src.is_symlink() or not src.is_file():
        raise ValueError("Source must be an existing regular SQLite file, not a symlink")
    with tempfile.TemporaryDirectory(prefix="temo-sqlite-restore-drill-") as temp:
        restored_path = Path(temp) / "restored.sqlite"
        source_uri = src.resolve().as_uri() + "?mode=ro"
        # A read-only SQLite connection can still read a live WAL database;
        # this verification is intended for disposable/staging snapshots.
        with sqlite3.connect(source_uri, uri=True, timeout=20) as original:
            _integrity(original)
            before = _manifest(original)
            with sqlite3.connect(str(restored_path)) as restored:
                original.backup(restored, pages=100, sleep=0.1)
                _integrity(restored)
                after = _manifest(restored)
            if before != after:
                raise ValueError("Restored table row counts differ from source (source may have changed)")
        digest = hashlib.sha256(restored_path.read_bytes()).hexdigest()
        return {
            "success": True,
            "mode": "isolated-read-only-restore-drill",
            "source_unchanged": True,
            "restored_copy_retained": False,
            "sqlite_integrity": "ok",
            "foreign_keys": "ok",
            "table_count": len(after),
            "row_count": sum(after.values()),
            "restored_sha256": digest,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Path to a private SQLite backup/snapshot")
    args = parser.parse_args()
    try:
        print(json.dumps(run_drill(args.source), sort_keys=True))
    except (OSError, sqlite3.Error, ValueError) as exc:
        print(json.dumps({"success": False, "message": str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
