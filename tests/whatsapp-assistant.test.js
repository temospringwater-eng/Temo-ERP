const test = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('../services/whatsapp-assistant-service');

function service() {
  return createService({
    db: { run(_sql, _params, callback) { callback(null); } },
    query: async () => [],
    insert: async () => ({ id: 1 }),
    update: async () => ({ changes: 1 }),
    writeAudit: async () => {}
  });
}

test('WhatsApp intent detection covers supported customer intents', () => {
  const assistant = service();
  assert.equal(assistant.detectIntent('repeat my last order'), 'repeat_order');
  assert.equal(assistant.detectIntent('what is my outstanding balance'), 'balance');
  assert.equal(assistant.detectIntent('pause my subscription'), 'subscription_pause');
  assert.equal(assistant.detectIntent('please connect me to a human'), 'human_escalation');
  assert.equal(assistant.detectIntent('pickup 4 bottles'), 'bottle_pickup');
});

test('phone normalization removes formatting without guessing identity', () => {
  const assistant = service();
  assert.equal(assistant.normalizePhone('+92 (300) 123-4567'), '923001234567');
  assert.equal(assistant.normalizePhone('unknown'), '');
});
