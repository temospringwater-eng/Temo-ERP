'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = (part) => fs.readFileSync(path.join(__dirname, '..', 'android-driver', part), 'utf8');

test('native driver app cannot load the ERP admin WebView or accept admin roles', () => {
  const ui = source('app/src/main/java/com/temo/aquaflow/driver/MainActivity.java');
  const api = source('app/src/main/java/com/temo/aquaflow/driver/DriverApi.java');
  const gradle = source('app/build.gradle');
  assert.doesNotMatch(ui, /android\.webkit|\bWebView\b|openPortal\s*\(/);
  assert.doesNotMatch(ui, /\/index\.html/);
  assert.match(api, /"driver"\.equals\(role\)/);
  assert.match(api, /"delivery_driver"\.equals\(role\)/);
  assert.match(api, /Only Driver accounts can open this app/);
  assert.match(gradle, /applicationId 'com\.temo\.aquaflow\.driver\.nativeapp'/);
});

test('native app exposes dedicated assigned deliveries, cash, bottles and offline sync', () => {
  const ui = source('app/src/main/java/com/temo/aquaflow/driver/MainActivity.java');
  const api = source('app/src/main/java/com/temo/aquaflow/driver/DriverApi.java');
  const queue = source('app/src/main/java/com/temo/aquaflow/driver/DriverCache.java');
  for (const label of ['MY DELIVERIES','START DELIVERY','COMPLETE DELIVERY','Cash collected','Bottles returned','Sync Offline Updates','Sign below']) {
    assert.ok(ui.includes(label), label + ' must be visible/available in native UI');
  }
  assert.match(api, /\/api\/driver\/deliveries/);
  assert.match(queue, /UUID\.randomUUID/);
  assert.match(queue, /"pending"\.equals/);
});

test('pending driver updates retry on reconnect without loading the ERP website', () => {
  const ui = source('app/src/main/java/com/temo/aquaflow/driver/MainActivity.java');
  const manifest = source('app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android.permission.ACCESS_NETWORK_STATE/);
  assert.match(ui, /registerDefaultNetworkCallback\(networkCallback\)/);
  assert.match(ui, /unregisterNetworkCallback\(networkCallback\)/);
  assert.match(ui, /syncWhenConnected\(\)/);
  assert.match(ui, /currentCache\.applyResults/);
  assert.match(ui, /Retain pending entries/);
});

test('driver can review unsynced and rejected operations without clearing their records', () => {
  const ui = source('app/src/main/java/com/temo/aquaflow/driver/MainActivity.java');
  const queue = source('app/src/main/java/com/temo/aquaflow/driver/DriverCache.java');
  assert.match(ui, /Review Saved Updates/);
  assert.match(ui, /private void offlineStatus\(\)/);
  assert.match(ui, /Needs review:/);
  assert.match(ui, /Rejected updates are kept for manager review/);
  assert.match(queue, /Could not save offline update to this device/);
  assert.match(queue, /if \(!prefs\.edit\(\)\.putString\("pending", old\.toString\(\)\)\.commit\(\)\)/);
});

test('native app never requests broad camera storage or insecure HTTP permissions', () => {
  const manifest = source('app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /TEMO Driver Native/);
  assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|android:usesCleartextTraffic="true"/);
});
