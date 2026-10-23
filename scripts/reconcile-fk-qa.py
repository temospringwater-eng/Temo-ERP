#!/usr/bin/env python3
"""Repair *only a separate QA snapshot* of known broken SQLite foreign keys.

Preserves audit logs and missing parent IDs in a reconciliation table.
Archives orphan currency settings. Revokes orphaned session/reset tokens.
Source database is opened read-only, never modified, and output cannot exist.
"""
import argparse
import hashlib
import json
import os
import sqlite3
import tempfile
from collections import Counter
from pathlib import Path

KNOWN = {
    ('audit_logs', 'users'), ('audit_logs', 'companies'),
    ('company_currency_settings', 'companies'),
    ('sessions', 'users'), ('password_reset_tokens', 'users')
}

def repair(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or output.exists():
        raise ValueError('Output must be a new, separate file')
    if not source.is_file():
        raise ValueError('Source database does not exist')
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as original:
        if original.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Source integrity check failed')
        violations = original.execute('PRAGMA foreign_key_check').fetchall()
        if any((table, parent) not in KNOWN for table, _, parent, _ in violations):
            raise RuntimeError('Unrecognized FK violation; manual review required')
        with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
            candidate = Path(tmp) / 'candidate.sqlite'
            with sqlite3.connect(candidate) as target:
                original.backup(target)
                target.row_factory = sqlite3.Row
                target.execute('PRAGMA foreign_keys=ON')
                target.execute("""CREATE TABLE IF NOT EXISTS integrity_reconciliation (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_table TEXT NOT NULL, record_ref TEXT NOT NULL,
                    parent_table TEXT NOT NULL, source_column TEXT NOT NULL,
                    old_parent_id TEXT, action_taken TEXT NOT NULL,
                    original_row_json TEXT,
                    reconciled_at TEXT DEFAULT CURRENT_TIMESTAMP)""")
                counts = Counter()
                for table, rowid, parent, fk_id in violations:
                    fk_def = target.execute(f'PRAGMA foreign_key_list({table})').fetchall()
                    column = fk_def[fk_id][3]
                    row = target.execute(f'SELECT rowid, * FROM {table} WHERE rowid=?', (rowid,)).fetchone()
                    if row is None:
                        raise RuntimeError('Source data changed')
                    data = dict(row)
                    old_parent = str(data[column])
                    if table == 'audit_logs':
                        target.execute(f'UPDATE audit_logs SET {column}=NULL WHERE rowid=?', (rowid,))
                        action = 'preserve_audit_detach_orphan'
                        ref, payload = str(row['id']), None
                    elif table == 'company_currency_settings':
                        target.execute('DELETE FROM company_currency_settings WHERE rowid=?', (rowid,))
                        action = 'archive_orphan_currency'
                        ref, payload = str(rowid), json.dumps(data, sort_keys=True)
                    else:
                        # Invalid login/reset tokens are revoked; do not store raw secrets.
                        ref = hashlib.sha256(str(row['token']).encode()).hexdigest()
                        target.execute(f'DELETE FROM {table} WHERE rowid=?', (rowid,))
                        action, payload = 'revoke_invalid_token', None
                    target.execute("""INSERT INTO integrity_reconciliation
                        (source_table,record_ref,parent_table,source_column,old_parent_id,action_taken,original_row_json)
                        VALUES (?,?,?,?,?,?,?)""",
                        (table,ref,parent,column,old_parent,action,payload))
                    counts[action] += 1
                target.commit()
                if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Restored copy failed integrity check')
                if target.execute('PRAGMA foreign_key_check').fetchall():
                    raise RuntimeError('Restored copy retains FK violations')
                n = target.execute('SELECT count(*) FROM integrity_reconciliation').fetchone()[0]
                if n != len(violations):
                    raise RuntimeError('Reconciliation audit count mismatch')
            os.replace(candidate, output)
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_sha:
        raise RuntimeError('Original source bytes changed unexpectedly')
    return {'original_unchanged': True, 'source_violations': len(violations),
            'qa_copy_violations': 0, 'reconciliation_entries': len(violations),
            'actions': dict(counts)}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(repair(args.source, args.output), sort_keys=True, indent=2))
