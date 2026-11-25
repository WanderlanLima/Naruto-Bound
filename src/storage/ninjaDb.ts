import type {
  GameCharacterManifest,
  GameCharacterRoles,
  NinjaRosterEntry,
  RawCombatJson,
} from '../types/shinobi';

const DB_NAME = 'shinobi_artillery_v2';
const DB_VERSION = 1;
const STORE_CHARACTERS = 'characters';
const STORE_BLOBS = 'blobs';

export interface StoredImportedNinjaRecord {
  id: string;
  name: string;
  source: 'imported-phaser' | 'imported-legacy';
  facing: 'right' | 'left';
  roles: GameCharacterRoles;
  manifest?: GameCharacterManifest;
  combatJson?: RawCombatJson | null;
  instructionsJson?: any;
  /** Map of normalized relative path -> IndexedDB blob key */
  fileBlobKeys: Record<string, string>;
  previewKeys: {
    face?: string;
    art?: string;
    ico?: string;
    idleSheet?: string;
    idleJson?: string;
  };
  idleFallbackMeta?: {
    fw: number;
    fh: number;
    n: number;
    cols: number;
    fps: number;
    durationMs: number;
  };
  warnings: string[];
  importedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHARACTERS)) {
        db.createObjectStore(STORE_CHARACTERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function makeBlobKey(ninjaId: string, relPath: string): string {
  const clean = relPath.replace(/^\/+/, '').replace(/\\/g, '/');
  return `${ninjaId}::${clean}`;
}

/**
 * Stores an imported ninja record + all its binary files as individual Blobs in IndexedDB.
 * Avoids huge single-key base64 transactions that crash Android Chrome.
 */
export async function saveImportedNinja(
  record: StoredImportedNinjaRecord,
  blobs: Array<{ key: string; blob: Blob }>
): Promise<void> {
  const db = await openDb();

  // Delete any old blobs for this ninja first so re-importing doesn't leak storage
  await deleteBlobsForNinja(db, record.id);

  // Write blobs in small batches (<= 16 blobs per transaction) for Android Chrome stability
  const BATCH_SIZE = 16;
  for (let i = 0; i < blobs.length; i += BATCH_SIZE) {
    const batch = blobs.slice(i, i + BATCH_SIZE);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      const store = tx.objectStore(STORE_BLOBS);
      for (const item of batch) {
        store.put(item.blob, item.key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  // Save lightweight character manifest record
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CHARACTERS, 'readwrite');
    tx.objectStore(STORE_CHARACTERS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteBlobsForNinja(db: IDBDatabase, ninjaId: string): Promise<void> {
  const prefix = `${ninjaId}::`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    const store = tx.objectStore(STORE_BLOBS);
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const cursorReq = store.openKeyCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listImportedNinjas(): Promise<StoredImportedNinjaRecord[]> {
  try {
    const db = await openDb();
    return await new Promise<StoredImportedNinjaRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CHARACTERS, 'readonly');
      const req = tx.objectStore(STORE_CHARACTERS).getAll();
      req.onsuccess = () => resolve((req.result || []) as StoredImportedNinjaRecord[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function getImportedNinjaRecord(id: string): Promise<StoredImportedNinjaRecord | null> {
  try {
    const db = await openDb();
    return await new Promise<StoredImportedNinjaRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_CHARACTERS, 'readonly');
      const req = tx.objectStore(STORE_CHARACTERS).get(id);
      req.onsuccess = () => resolve((req.result as StoredImportedNinjaRecord) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getNinjaBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readonly');
      const req = tx.objectStore(STORE_BLOBS).get(key);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteImportedNinja(id: string): Promise<void> {
  const db = await openDb();
  await deleteBlobsForNinja(db, id);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CHARACTERS, 'readwrite');
    tx.objectStore(STORE_CHARACTERS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Tracks ObjectURLs so they can be cleanly revoked when a match finishes or a preview refreshes.
 */
export class ObjectUrlPool {
  private urls = new Set<string>();

  create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  revoke(url?: string): void {
    if (!url || !this.urls.has(url)) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
    this.urls.delete(url);
  }

  revokeAll(): void {
    for (const url of this.urls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    this.urls.clear();
  }
}

const REPO_URL_STORAGE_KEY = 'shinobi_artillery_repo_url';

export function getSavedRepoBaseUrl(): string {
  try {
    return localStorage.getItem(REPO_URL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setSavedRepoBaseUrl(url: string): void {
  try {
    const clean = url.trim();
    if (clean) localStorage.setItem(REPO_URL_STORAGE_KEY, clean);
    else localStorage.removeItem(REPO_URL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function revokeRosterPreviewUrls(entries: NinjaRosterEntry[], pool: ObjectUrlPool): void {
  for (const e of entries) {
    if (e.previewFaceUrl?.startsWith('blob:')) pool.revoke(e.previewFaceUrl);
    if (e.previewArtUrl?.startsWith('blob:')) pool.revoke(e.previewArtUrl);
    if (e.previewIcoUrl?.startsWith('blob:')) pool.revoke(e.previewIcoUrl);
    if (e.previewIdleSheetUrl?.startsWith('blob:')) pool.revoke(e.previewIdleSheetUrl);
  }
}
