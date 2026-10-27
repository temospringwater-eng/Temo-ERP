'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('TDD: ERP must not duplicate the default Company Admin creation outside the non-production guard', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  const defaultAdminInsert = /db\.run\(`INSERT INTO users \(company_id, username, password_hash, name, role\) SELECT \(SELECT id FROM companies ORDER BY id LIMIT 1\), 'admin', \?, 'Company Admin', 'company_admin' WHERE NOT EXISTS \(SELECT 1 FROM users WHERE username = 'admin'\)`/g;
  const matches = Array.from(source.matchAll(defaultAdminInsert));
  assert.equal(matches.length, 1, 'Only one default Company Admin insertion may exist, inside the non-production guard');
  const guardStart = source.indexOf("if (process.env.NODE_ENV !== 'production' && !hostedQa) {", source.indexOf('function initializeDatabase'));
  assert.ok(guardStart >= 0, 'Demo account seeding must be disabled for production and hosted QA');
  const guardEnd = source.indexOf('\n    }', guardStart);
  assert.ok(matches[0].index > guardStart && matches[0].index < guardEnd, 'Demo Company Admin creation must stay inside local-only non-production guard');
});
test('TDD: hosted QA cannot auto-seed known default credentials',()=>{
 const source=fs.readFileSync('server.js','utf8');
 assert.match(source,/const hostedQa = process\.env\.TEMO_ERP_HOSTED_QA === '1'/);
 assert.match(source,/if \(process\.env\.NODE_ENV !== 'production' && !hostedQa\)/);
 assert.match(source,/process\.env\.NODE_ENV !== 'production' && !hostedQa\) return/);
});
