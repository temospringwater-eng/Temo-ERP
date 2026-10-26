'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Companies & Users form exposes the existing authorized driver role', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const select = html.match(/<select\s+id="userRole"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, 'Expected user-role dropdown');
  const matches = select[1].match(/<option\s+value="driver">Delivery Driver<\/option>/g) || [];
  assert.equal(matches.length, 1, 'Driver role must be selectable exactly once');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /allowedRoles = req\.user\.role === 'super_admin'[\s\S]*?'driver'/);
});

test('Creating users passes the selected role unchanged to the backend', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /document\.getElementById\('userRole'\)\.value/);
});
