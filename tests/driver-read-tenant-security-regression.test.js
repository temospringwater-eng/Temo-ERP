'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDriverReadContractQa } = require('../services/driver-read-contract-qa');

function fixture() {
  const routes = new Map();
  let queries = 0;
  const app = { get(path, ...handlers) { routes.set(path, handlers); }, post() {} };
  createDriverReadContractQa({ app, qaEnabled: true, query: async () => { queries++; return []; } });
  function auth(path, user, companyId) {
    const [middleware] = routes.get(path);
    let status = null;
    const req = { user, companyId };
    const res = {
      setHeader() {},
      status(value) { status = value; return this; },
      json(body) { return body; }
    };
    let next = false;
    middleware(req, res, () => { next = true; });
    return { status, next, req };
  }
  return { auth, queryCount: () => queries };
}

test('QA driver routes deny unauthenticated access before database access', () => {
  const f = fixture();
  const result = f.auth('/api/driver/permissions', null, 1);
  assert.equal(result.status, 401);
  assert.equal(result.next, false);
  assert.equal(f.queryCount(), 0);
});

test('QA driver routes reject cross-company identity and non-driver roles', () => {
  const f = fixture();
  for (const user of [
    { id: 5, company_id: 2, role: 'driver' },
    { id: 5, company_id: 1, role: 'company_admin' },
    { id: 0, company_id: 1, role: 'driver' }
  ]) {
    const result = f.auth('/api/driver/bottle-types', user, 1);
    assert.equal(result.status, 403);
    assert.equal(result.next, false);
  }
  assert.equal(f.queryCount(), 0);
});

test('QA driver routes allow only valid same-company driver identity', () => {
  const f = fixture();
  const result = f.auth('/api/driver/permissions', { id: 5, company_id: 1, role: 'driver' }, 1);
  assert.equal(result.status, null);
  assert.equal(result.next, true);
  assert.deepEqual(result.req.qaDriverActor, { userId: 5, companyId: 1 });
});
