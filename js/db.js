/* ===== আমার হিসাব — ডেটা স্টোরেজ (IndexedDB, fallback localStorage) ===== */

const DB = (() => {
  const NAME = 'amar-hishab';
  const VERSION = 1;
  const LS_KEY = 'amar-hishab-data';
  const STORES = ['products', 'customers', 'sales', 'purchases', 'entries', 'payments', 'meta'];
  let db = null;
  let lsData = null;
  let mode = 'idb';

  function lsLoad() {
    if (lsData) return lsData;
    try { lsData = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { lsData = {}; }
    STORES.forEach(s => { if (!Array.isArray(lsData[s])) lsData[s] = []; });
    return lsData;
  }

  function lsSave() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(lsData)); } catch (e) { /* পূর্ণ */ }
  }

  function open() {
    return new Promise(resolve => {
      let done = false;
      const fallback = () => {
        if (done) return;
        done = true;
        mode = 'ls';
        lsLoad();
        resolve();
      };
      if (!('indexedDB' in window)) return fallback();
      try {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = e => {
          const d = e.target.result;
          STORES.forEach(s => {
            if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
          });
        };
        req.onsuccess = e => { db = e.target.result; done = true; resolve(); };
        req.onerror = fallback;
        req.onblocked = fallback;
        setTimeout(fallback, 4000);
      } catch (e) { fallback(); }
    });
  }

  function idbAll(store) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  }

  function idbPut(store, obj) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }

  function idbDel(store, id) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }

  function idbClear(store) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }

  return {
    open,
    STORES,
    get usingFallback() { return mode === 'ls'; },
    all(store) {
      if (mode === 'ls') return Promise.resolve(lsLoad()[store].slice());
      return idbAll(store);
    },
    async get(store, id) {
      const arr = await this.all(store);
      return arr.find(o => o.id === id) || null;
    },
    put(store, obj) {
      if (mode === 'ls') {
        const arr = lsLoad()[store];
        const i = arr.findIndex(o => o.id === obj.id);
        if (i >= 0) arr[i] = obj; else arr.push(obj);
        lsSave();
        return Promise.resolve();
      }
      return idbPut(store, obj);
    },
    del(store, id) {
      if (mode === 'ls') {
        const arr = lsLoad()[store];
        const i = arr.findIndex(o => o.id === id);
        if (i >= 0) arr.splice(i, 1);
        lsSave();
        return Promise.resolve();
      }
      return idbDel(store, id);
    },
    async clearAll() {
      for (const s of STORES) {
        if (mode === 'ls') { lsData[s] = []; } else await idbClear(s);
      }
      if (mode === 'ls') lsSave();
    },
    async export() {
      const out = { app: 'amar-hishab', version: 1, exportedAt: new Date().toISOString() };
      for (const s of STORES) out[s] = await this.all(s);
      return out;
    },
    async import(data) {
      if (!data || typeof data !== 'object') throw new Error('অবৈধ ব্যাকআপ ফাইল');
      for (const s of STORES) {
        if (!Array.isArray(data[s])) continue;
        if (mode === 'ls') { lsData[s] = data[s]; }
        else await idbClear(s).then(() => Promise.all(data[s].map(o => idbPut(s, o))));
      }
      if (mode === 'ls') lsSave();
    }
  };
})();
