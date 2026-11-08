// IndexedDB wrapper. Three stores:
//   items  – text fields + small thumbnail (loaded for list & search)
//   photos – array of full compressed photos (first = cover), loaded only when needed
const DB = (() => {
  let dbp;
  function open() {
    dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('clothes', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('items', { keyPath: 'id' });
        req.result.createObjectStore('photos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function run(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const result = fn(tx);
      tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    allItems: () => run('items', 'readonly', tx => tx.objectStore('items').getAll()),
    // Always an array. Old items stored a single Blob.
    getPhotos: async id => {
      const v = await run('photos', 'readonly', tx => tx.objectStore('photos').get(id));
      return Array.isArray(v) ? v : v ? [v] : [];
    },
    // photos: array of full Blobs, or undefined to leave them unchanged.
    save: (item, photos) => run(['items', 'photos'], 'readwrite', tx => {
      tx.objectStore('items').put(item);
      if (photos) tx.objectStore('photos').put(photos, item.id);
    }),
    // Many items in ONE transaction, so import isn't one round trip per item.
    // list: [{ item, photos }]
    saveMany: list => run(['items', 'photos'], 'readwrite', tx => {
      const items = tx.objectStore('items'), photos = tx.objectStore('photos');
      for (const { item, photos: p } of list) {
        items.put(item);
        if (p) photos.put(p, item.id);
      }
    }),
    remove: id => run(['items', 'photos'], 'readwrite', tx => {
      tx.objectStore('items').delete(id);
      tx.objectStore('photos').delete(id);
    }),
  };
})();
