"use client";

/**
 * Pembungkus IndexedDB minimal (tanpa dependensi) untuk mode offline kasir.
 * Store: `packs` (paket katalog per cabang), `outbox` (transaksi offline menunggu sinkron),
 * `meta` (sesi kasir terakhir per cabang, untuk membuka ulang halaman saat offline).
 */
const DB_NAME = "konten-pos";
// Naikkan versi bila store berubah; onupgradeneeded membuat store yang belum ada (idempoten).
const VERSION = 3;
export type StoreName = "packs" | "outbox" | "meta";

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => {
      const db = req.result;
      // Tab lain membuka versi lebih baru → tutup agar upgrade tidak terblokir.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idbGet = <T>(store: StoreName, key: string) => run<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbSet = (store: StoreName, key: string, value: unknown) => run(store, "readwrite", (s) => s.put(value, key));
export const idbDelete = (store: StoreName, key: string) => run(store, "readwrite", (s) => s.delete(key));
export const idbAll = <T>(store: StoreName) => run<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
