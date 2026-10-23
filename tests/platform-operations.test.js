const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LocalBackupProvider, OffsiteBackupProvider } = require('../services/platform-operations-service');

const root = path.join(__dirname, '.artifacts');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('local backup provider writes and reads a controlled payload', async () => {
  const provider = new LocalBackupProvider(root);
  const stored = await provider.put('tenant/check.json', '{"format":"temo-aquaflow-backup"}');
  assert.equal(stored.provider, 'local');
  assert.equal(await provider.read(stored.key), '{"format":"temo-aquaflow-backup"}');
});

test('off-site provider fails closed when no provider is configured', async () => {
  await assert.rejects(() => new OffsiteBackupProvider().put('key', 'payload'), /not configured/);
});
