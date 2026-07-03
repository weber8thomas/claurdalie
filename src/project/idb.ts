// Working-state persistence in IndexedDB.
//
// The whole active project (all snapshots + module state) is auto-saved here as
// the gzipped .clproj bytes, so a reload restores exactly where you left off.
// IndexedDB — not localStorage — because a real project (many snapshots, wide
// alignments) easily exceeds localStorage's ~5 MB quota, and IDB stores binary
// Blobs without a base64 tax.
//
// Every function is a no-op / null when IndexedDB is unavailable (SSR, tests,
// a hostile CSP), keeping the app offline- and test-safe.

const DB_NAME = 'claurdalie'
const STORE = 'projects'
const KEY = 'active'
const DB_VERSION = 1

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        t.oncomplete = () => {
          db.close()
          resolve(req.result)
        }
        t.onerror = () => {
          db.close()
          reject(t.error)
        }
      }),
  )
}

/** Persist the active project's gzipped bytes (best-effort; swallows errors). */
export async function saveProject(bytes: Uint8Array): Promise<void> {
  if (!hasIndexedDB()) return
  try {
    await tx('readwrite', (s) => s.put(bytes, KEY))
  } catch {
    // Quota / private-mode failures shouldn't break the editor.
  }
}

/** Load the previously saved project bytes, or null if none / unavailable. */
export async function loadProject(): Promise<Uint8Array | null> {
  if (!hasIndexedDB()) return null
  try {
    const val = await tx<unknown>('readonly', (s) => s.get(KEY))
    if (val == null) return null
    if (val instanceof Uint8Array) return val
    if (val instanceof ArrayBuffer) return new Uint8Array(val)
    return null
  } catch {
    return null
  }
}

/** Drop the saved working state (e.g. a "reset project" affordance). */
export async function clearProject(): Promise<void> {
  if (!hasIndexedDB()) return
  try {
    await tx('readwrite', (s) => s.delete(KEY))
  } catch {
    // ignore
  }
}
