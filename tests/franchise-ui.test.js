const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(projectRoot, 'public', 'styles.css'), 'utf8');

test('franchise navigation and management markup are present and accessible', () => {
  assert.match(html, /<button[^>]+id="franchiseNav"[^>]+data-tab="franchiseManagement"/);
  assert.match(html, /<section[^>]+id="franchiseManagement"/);
  assert.match(html, /id="franchiseAccessState"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="franchiseWorkspace"[^>]+class="franchise-workspace hidden"/);
  assert.match(html, /id="franchiseConsolidatedReportPanel"[^>]+class="panel franchise-section hidden"/);
  assert.match(html, /Shown only when the selected relationship grants consolidated report access/);
});

test('franchise UI exposes relationship, scope, finance, and report controls', () => {
  const requiredIds = [
    'franchiseCreateForm', 'franchiseRelationshipForm', 'franchiseBranchForm',
    'franchiseAgreementForm', 'franchiseFeeForm', 'franchiseRevenueShareForm',
    'franchiseAssignmentForm', 'franchiseScopeForm', 'franchiseReportPermissionForm',
    'franchiseConsolidatedReportForm', 'franchiseConsolidatedReportKey',
    'franchiseEmployeeScopeBody', 'franchiseConsolidatedBody'
  ];
  for (const id of requiredIds) assert.match(html, new RegExp(`id="${id}"`), `Missing #${id}`);
  for (const value of ['manager', 'employee', 'customers', 'inventory', 'financial', 'reports', 'consolidated_reports']) {
    assert.match(html, new RegExp(`(?:value|data-scope)="${value}"`), `Missing ${value} option`);
  }
});

test('franchise UI gates authorization and calls tenant-scoped APIs', () => {
  assert.match(app, /state\.franchise\?\.authorized/);
  assert.match(app, /franchiseNav.*classList\.toggle\('hidden'/);
  assert.match(app, /franchiseRequest\('\/api\/franchise-scope'/);
  assert.match(app, /franchiseRequest\('\/api\/franchises'/);
  assert.match(app, /\/api\/franchises\/\$\{detail\.id\}\/report-permissions/);
  assert.match(app, /\/api\/franchises\/\$\{detail\.parent_company_id\}\/consolidated-reports/);
});

test('franchise workspace has responsive layouts for narrow screens', () => {
  assert.match(styles, /\.franchise-workspace\{display:grid/);
  assert.match(styles, /@media\s*\(max-width:760px\)\{[^}]*\.franchise-workspace\{grid-template-columns:1fr\}/s);
  assert.match(styles, /@media\s*\(max-width:440px\)\{[^}]*\.franchise-meta-grid\{grid-template-columns:1fr\}/s);
  assert.match(styles, /\.franchise-section table\{min-width:/);
});
