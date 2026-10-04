/* Advanced offline driver storage and sync. Caches only server responses; never fabricates route data. */
(function () {
  const DB_NAME = 'temo-aquaflow-driver';
  const DB_VERSION = 1;
  const QUEUE = 'operations';
  const CACHE = 'deliveryCache';
  const FALLBACK_KEY = 'temo_aquaflow_offline_driver_queue';
  let dbPromise;
  let listeners = [];

  function openDb() {
    if (!window.indexedDB) return Promise.resolve(null);
    if (!dbPromise) dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return dbPromise;
  }

  function notify() { return count().then((pending) => listeners.forEach((listener) => listener({ online: navigator.onLine, pending }))); }
  function fallbackRead() { try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]'); } catch (_) { return []; } }
  function fallbackWrite(items) { localStorage.setItem(FALLBACK_KEY, JSON.stringify(items)); }
  function transaction(store, mode, action) { return openDb().then((db) => new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    const request = action(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  })); }
  function all(store) { return transaction(store, 'readonly', (objectStore) => objectStore.getAll()).then((items) => items || []); }
  function put(store, value) { return transaction(store, 'readwrite', (objectStore) => objectStore.put(value)); }
  function remove(store, key) { return transaction(store, 'readwrite', (objectStore) => objectStore.delete(key)); }

  async function count() { const db = await openDb(); if (!db) return fallbackRead().length; return (await all(QUEUE)).length; }
  async function queueAction(operation) {
    const value = { ...operation, id: operation.id || `${operation.idempotencyKey}`, createdAt: operation.createdAt || new Date().toISOString(), state: 'pending' };
    const db = await openDb();
    if (!db) { const items = fallbackRead().filter((item) => item.id !== value.id); items.push(value); fallbackWrite(items); await notify(); return value; }
    await put(QUEUE, value); await notify(); return value;
  }
  async function cacheDeliveries(date, deliveries, history) {
    await put(CACHE, { key: `deliveries:${date}`, date, deliveries: deliveries || [], history: history || [], cachedAt: new Date().toISOString() });
  }
  async function getCachedDeliveries(date) { const db = await openDb(); if (!db) return fallbackRead().find((item) => item.key === `deliveries:${date}`) || null; return transaction(CACHE, 'readonly', (store) => store.get(`deliveries:${date}`)); }
  async function sync() {
    if (!navigator.onLine) return { synced: 0, conflicts: 0 };
    const db = await openDb();
    const items = db ? await all(QUEUE) : fallbackRead();
    if (!items.length) { await notify(); return { synced: 0, conflicts: 0 }; }
    const pending = items.filter((item) => item.state !== 'conflict');
    let synced = 0; let conflicts = 0;
    for (let index = 0; index < pending.length; index += 100) {
      const batch = pending.slice(index, index + 100);
      let response;
      try { response = await fetch('/api/driver/offline-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations: batch.map((item) => ({ idempotencyKey: item.idempotencyKey, operationType: item.operationType, deliveryId: item.deliveryId, payload: item.payload, baseUpdatedAt: item.baseUpdatedAt, clientTimestamp: item.createdAt })) }) }); }
      catch (_) { break; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207 && response.status !== 409) break;
      for (const result of (data.results || [])) {
        const item = batch.find((candidate) => candidate.idempotencyKey === result.idempotencyKey);
        if (!item) continue;
        if (result.status === 'conflict') { item.state = 'conflict'; item.error = result.message || result.code; conflicts += 1; if (db) await put(QUEUE, item); }
        else if (result.status === 'applied' || result.status === 'failed') { synced += result.status === 'applied' ? 1 : 0; if (db) await remove(QUEUE, item.id); }
      }
      if (!db) fallbackWrite(items.filter((item) => item.state === 'conflict'));
    }
    await notify(); return { synced, conflicts };
  }
  function subscribe(listener) { listeners.push(listener); return () => { listeners = listeners.filter((item) => item !== listener); }; }
  window.OfflineDriver = { queueAction, cacheDeliveries, getCachedDeliveries, sync, count, subscribe };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  window.addEventListener('online', () => { notify(); sync(); });
  window.addEventListener('offline', notify);
})();
