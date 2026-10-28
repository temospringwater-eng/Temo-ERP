import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

// RED contract gates: implementation is intentionally absent until a
// company-scoped, atomic D1 ledger implementation is reviewed.
const migration = new URL('../migrations/d1-qa/0002_canonical_van_stock.sql', import.meta.url);
const handler = new URL('../services/d1-canonical-stock.mjs', import.meta.url);

test('D1 van ledger migration is present and never overwrites products.stock', () => {
  assert.ok(existsSync(migration), 'Missing D1 van-stock migration');
  const sql = readFileSync(migration, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS van_stock_movements/i);
  assert.match(sql, /company_id/i);
  assert.match(sql, /idempotency_key/i);
  assert.doesNotMatch(sql, /UPDATE\s+products\s+SET\s+stock/i);
});

test('D1 transactional stock handler exists for atomic warehouse-to-van movements', () => {
  assert.ok(existsSync(handler), 'Missing canonical D1 stock handler');
  const code = readFileSync(handler, 'utf8');
  assert.match(code, /batch\s*\(|transaction\s*\(/i);
  assert.match(code, /idempotency/i);
});
