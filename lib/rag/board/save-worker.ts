// Board save worker — jitter round 4.
// (No webworker lib reference — the DOM lib's `self` typings suffice, and a
// triple-slash lib reference would leak WebWorker globals into the whole
// tsc program, conflicting with DOM declarations.)
//
// Rounds 1-3 moved the periodic cache write to IndexedDB and deferred the
// save to an idle frame, but the save path STILL ran two heavy jobs on the
// main thread: JSON.stringify of the multi-MB board doc (the PUT body) and
// the IDB structured-clone write. On a 3,000+ node board each autosave —
// and every chat/research answer schedules one — blocked rendering long
// enough to drop frames ("items disappear for a fraction of a second and
// return", correlated by the user with the save indicator). This worker
// takes the whole tail off the main thread: the only remaining main-thread
// cost is the postMessage structured clone, which is far cheaper than a
// stringify and doesn't touch layout.
//
// PUTs are SERIALIZED through a promise chain so two in-flight saves can
// never reach the server out of order (the CineFable duration-revert
// lesson: out-of-order PUTs make the older doc win). Same-origin fetch
// from a dedicated worker carries cookies (credentials: 'same-origin' is
// the default), so Clerk auth works unchanged.
//
// Data-safety: this worker only WRITES the doc it is handed — every guard
// stays where it was (blank-board check on the main thread before posting;
// anti-shrink/overflow/union, snapshots and the event ledger on the server).

const DB_NAME = 'answersdoc-board-cache';
const STORE = 'boards';

function idbPut(pid: string, doc: unknown): void {
  try {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => {
      try {
        req.result.transaction(STORE, 'readwrite').objectStore(STORE).put(doc, pid);
      } catch {
        /* quota / private mode — the network save + pagehide LS still hold it */
      }
    };
  } catch {
    /* IDB unavailable — non-fatal */
  }
}

let chain: Promise<void> = Promise.resolve();

self.onmessage = (ev: MessageEvent<{ seq: number; pid: string; doc: unknown }>) => {
  const { seq, pid, doc } = ev.data;
  idbPut(pid, doc);
  chain = chain.then(async () => {
    let ok = false;
    try {
      const res = await fetch('/api/board', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid, data: doc })
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    (self as unknown as Worker).postMessage({ seq, ok });
  });
};
