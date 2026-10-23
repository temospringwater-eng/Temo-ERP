async function loadPlatformOperations() {
  const role = state.currentUser?.role;
  if (!['super_admin', 'company_admin', 'manager'].includes(role)) return;
  try {
    const [backups, diagnostics, metadata, integrations] = await Promise.all([fetch('/api/backups').then((r) => r.json()), fetch('/api/security/diagnostics').then((r) => r.json()), fetch('/api/v1/metadata').then((r) => r.json()), fetch('/api/integrations').then((r) => r.json())]);
    document.getElementById('opsBackupCount').textContent = backups.length;
    document.getElementById('opsSecurityStatus').textContent = (diagnostics.checks || []).some((item) => item.status === 'fail') ? 'Review' : 'Healthy';
    document.getElementById('opsSecurityMessage').textContent = `Checked ${diagnostics.checks?.length || 0} controls`;
    document.getElementById('opsApiMetadata').textContent = `${metadata.name} ${metadata.version} · ${metadata.status}`;
    document.getElementById('opsBackupBody').innerHTML = backups.map((row) => `<tr><td>${row.id}</td><td>${row.scope}</td><td>${row.provider}</td><td><code>${String(row.checksum_sha256).slice(0, 12)}…</code></td><td>${row.status}</td><td>${row.validation_status}</td><td><button class="action-btn ops-validate" data-id="${row.id}" type="button">Validate</button></td></tr>`).join('') || '<tr><td colspan="7">No backups yet.</td></tr>';
    document.getElementById('opsDiagnostics').innerHTML = (diagnostics.checks || []).map((item) => `<li><strong>${item.key}</strong>: ${item.status} (${item.count})</li>`).join('');
    document.getElementById('opsIntegrationsBody').innerHTML = integrations.map((row) => `<tr><td>${row.name}</td><td>${row.kind}</td><td>${row.endpoint || 'not configured'}</td><td>${row.enabled ? 'yes' : 'no'}</td></tr>`).join('') || '<tr><td colspan="4">No adapters configured.</td></tr>';
    document.querySelectorAll('.ops-validate').forEach((button) => button.addEventListener('click', async () => { const result = await fetch(`/api/backups/${button.dataset.id}/validate`, { method: 'POST' }).then((r) => r.json()); alert(result.valid ? 'Backup checksum is valid.' : (result.message || 'Backup validation failed.')); await loadPlatformOperations(); }));
  } catch (error) { document.getElementById('opsSecurityMessage').textContent = error.message; }
}

document.getElementById('createTenantBackup')?.addEventListener('click', async () => { const response = await fetch('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'tenant' }) }); const result = await response.json(); alert(response.ok ? `Backup ${result.id} created.` : result.message); if (response.ok) loadPlatformOperations(); });
document.getElementById('createFullBackup')?.addEventListener('click', async () => { const response = await fetch('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'full' }) }); const result = await response.json(); alert(response.ok ? `Full backup ${result.id} created.` : result.message); if (response.ok) loadPlatformOperations(); });
document.getElementById('runSecurityDiagnostics')?.addEventListener('click', loadPlatformOperations);
document.querySelector('[data-tab="operations"]')?.addEventListener('click', loadPlatformOperations);
