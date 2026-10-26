'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('TDD: ERP must not duplicate the default Company Admin creation outside the non-production guard', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  const defaultAdminInsert = /db\.run\(`INSERT INTO users \(company_id, username, password_hash, name, role\) SELECT \(SELECT id FROM companies ORDER BY id LIMIT 1\), 'admin', \?, 'Company Admin', 'company_admin' WHERE NOT EXISTS \(SELECT 1 FROM users WHERE username = 'admin'\)`/g;
  const matches = Array.from(source.matchAll(defaultAdminInsert));
  assert.equal(matches.length, 1, 'Only one default Company Admin insertion may exist, inside the non-production guard');
  const guardStart = source.indexOf("if (process.env.NODE_ENV !== 'production') {", source.indexOf('function initializeDatabase'));
  assert.ok(guardStart >= 0, 'Demo account seeding must be disabled for production');
  const guardEnd = source.indexOf('\n    }', guardStart);
  assert.ok(matches[0].index > guardStart && matches[0].index < guardEnd, 'Demo Company Admin creation must stay within NODE_ENV !== production guard');
});