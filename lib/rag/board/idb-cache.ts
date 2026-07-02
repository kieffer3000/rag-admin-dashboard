// IndexedDB-backed board cache — replaces the periodic multi-MB synchronous
// localStorage write that stalled the main thread on every 60s autosave of a
// big board (3000-node project ≈ several MB → JSON.stringify + setItem froze
// the UI mid-import; the user saw it as "uncontrollable jitter"). IDB writes
// are async and use structured clone — no stringify, no sync stall.
//
// The pagehide/beforeunload flush still uses the legacy SYNC localStorage
// write (the user is leaving; a stall there is invisible and sync is the only
// thing guaranteed to finish) — so loads must take the NEWER of the two.

const DB_NAME = 'answersdoc-board-cache';
const STORE = 'boards';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Load a project's cached board doc (null on miss/any failure). */
export async function idbGetBoard(pid: string): Promise<any | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(pid);
      rq.onsuccess = () => resolve(rq.result ?? null);
      rq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Fire-and-forget cache write (async, structured clone — never blocks). */
export function idbPutBoard(pid: string, doc: unknown): void {
  void (async () => {
    try {
      const db = await openDb();
      db.transaction(STORE, 'readwrite').objectStore(STORE).put(doc, pid);
    } catch {
      /* quota / private mode — the DB save + pagehide localStorage still hold it */
    }
  })();
}
