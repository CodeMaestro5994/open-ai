// Attachment bytes kept in the browser (IndexedDB). Used for Claude, whose Files
// API cannot be called from a browser, so files are sent inline with each request.

const DB = 'prompt-studio'
const STORE = 'attachments'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Browser storage is unavailable.'))
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('Browser storage failed.'))
    })
  } finally {
    db.close()
  }
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  await run('readwrite', (s) => s.put(blob, id))
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return run<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>)
}

export async function deleteBlob(id: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(id))
  } catch {
    // best effort
  }
}

/** Base64 without the data: URL prefix. */
export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsDataURL(blob)
  })
}
