/**
 * Tiny promise wrapper over IndexedDB for storing non-extractable CryptoKeys.
 *
 * Why IndexedDB (not localStorage):
 *   - IndexedDB can store CryptoKey objects directly (structured clone preserves
 *     the non-extractable bit), localStorage cannot.
 *   - A non-extractable private key stored here is unreadable even to same-origin
 *     JavaScript — scripts can only use it via crypto.subtle.sign().
 */

const DB_NAME = "bridgehook";
const DB_VERSION = 1;
const STORE = "channel-keys";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
		req.onblocked = () => reject(new Error("IndexedDB open blocked"));
	});
	// Reset the cached promise on failure so callers can retry.
	dbPromise.catch(() => {
		dbPromise = null;
	});
	return dbPromise;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
	return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
	});
}

export async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
	const store = await tx("readonly");
	return wrap<T | undefined>(store.get(key) as IDBRequest<T | undefined>);
}

export async function idbPut(key: string, value: unknown): Promise<void> {
	const store = await tx("readwrite");
	await wrap(store.put(value, key));
}

export async function idbDelete(key: string): Promise<void> {
	const store = await tx("readwrite");
	await wrap(store.delete(key));
}

export async function idbHas(key: string): Promise<boolean> {
	const store = await tx("readonly");
	const result = await wrap(store.getKey(key));
	return result !== undefined;
}
