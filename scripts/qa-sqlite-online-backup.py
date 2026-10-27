#!/usr/bin/env python3
"""Create a private consistent SQLite QA snapshot using the SQLite online backup API.

This is an explicitly invoked, LOCAL operator tool. It never deploys, modifies
the ERP's source DB, uploads to cloud, or touches production financial records.
"""
import argparse
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import sys
import tempfile

_QA_NAME = re.compile(r"^[A-Za-z0-9._-]*qa[A-Za-z0-9._-]*\.db$", re.I)


def _ensure_private_dir(path, what):
    if path.is_symlink() or not path.is_dir():
        raise ValueError(what + " must be an existing private directory, not symlink")
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise ValueError(what + " permissions must exclude group and other users")
    if path.stat().st_uid != os.geteuid():
        raise ValueError(what + " must belong to current service user")


def _integrity(db):
    row = db.execute("PRAGMA integrity_check").fetchone()
    if not row or row[0] != "ok":
        raise ValueError("STOP: SQLite integrity check failed")
    if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise ValueError("STOP: SQLite foreign key check failed")


def _count_tables(db):
    rows = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return len(rows)


def _sha256(filepath):
    digest = hashlib.sha256()
    with filepath.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def backup_private_qa(source, dest):
    src = Path(source).expanduser().absolute()
    folder = Path(dest).expanduser().absolute()
    if src.is_symlink() or not src.is_file() or not _QA_NAME.fullmatch(src.name):
        raise ValueError("STOP: existing QA-only SQLite .db file required, no symlinks")
    if src.stat().st_nlink != 1:
        raise ValueError("STOP: hard-linked database refused")
    _ensure_private_dir(src.parent, "Source SQLite directory")
    _ensure_private_dir(folder, "Backup destination")
    if src.parent.resolve() == folder.resolve():
        raise ValueError("STOP: source and backup directories must be separate")
    # Only operator-owned, private, regular QA files are in scope. No other
    # SQLite source or production hayrila.db is eligible.
    if src.stat().st_size < 100:
        raise ValueError("STOP: QA source SQLite database too small")
    tmp_path = None
    try:
        fd, name = tempfile.mkstemp(prefix=".temo-qa-snapshot-", suffix=".tmp", dir=str(folder))
        os.close(fd)
        tmp_path = Path(name)
        source_uri = src.as_uri() + "?mode=ro"
        with contextlib.closing(sqlite3.connect(source_uri, uri=True, timeout=20)) as origin:
            origin.execute("PRAGMA query_only=ON")
            _integrity(origin)
            with contextlib.closing(sqlite3.connect(str(tmp_path), timeout=20)) as target:
                origin.backup(target, pages=128, sleep=0.1)
                _integrity(target)
                count = _count_tables(target)
        if stat.S_IMODE(tmp_path.stat().st_mode) != 0o600:
            raise ValueError("STOP: QA backup must have exact 0600 permissions")
        rawfd = os.open(tmp_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.fsync(rawfd)
        finally:
            os.close(rawfd)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        filename = "temo-erp-qa-" + stamp + "-" + secrets.token_hex(8) + ".db"
        final = folder / filename
        # link() is exclusive; never overwrite an existing backup. A full
        # ready-to-read SQLite image becomes visible atomically at 'final'.
        os.link(tmp_path, final, follow_symlinks=False)
        hash_value = _sha256(final)
        tmp_path.unlink()
        tmp_path = None
        dirfd = os.open(folder, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
        return {
            "success": True,
            "mode": "isolated-qa-online-sqlite-backup",
            "backup_path": str(final),
            "sha256": hash_value,
            "backup_permissions": "0600",
            "sqlite_integrity": "ok",
            "foreign_keys": "ok",
            "table_count": count,
        }
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Synthetic QA .db (never production ERP)")
    parser.add_argument("--backup-dir", required=True, help="Existing operator-owned chmod 700 directory")
    args = parser.parse_args()
    try:
        print(json.dumps(backup_private_qa(args.source, args.backup_dir), sort_keys=True))
    except (OSError, sqlite3.Error, ValueError) as exc:
        # Never print connection strings, tokens, customer rows or private paths.
        kind = type(exc).__name__
        print(json.dumps({"success": False, "error": "STOP: QA backup refused", "reason": kind}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
