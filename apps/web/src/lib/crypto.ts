/**
 * Per-channel ECDSA signing.
 *
 * Security model:
 *   - Client generates an ECDSA P-256 keypair on channel creation.
 *   - Public key is sent to the relay (stored in Neon).
 *   - Private key is re-imported as *non-extractable* and stored in IndexedDB.
 *     Once re-imported, crypto.subtle.exportKey() will throw for it — not even
 *     same-origin JavaScript can read its bytes.
 *   - Every authenticated request is signed:
 *         sig = ECDSA(key, "METHOD\nPATH\nTIMESTAMP\nSHA256(body)")
 *     Server verifies the signature with the channel's stored public key and
 *     rejects requests whose timestamp is outside a 60s window (replay guard).
 */

import { idbDelete, idbGet, idbPut } from "./idb";

const KEY_ALGORITHM: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALGORITHM: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

// ── Hex helpers ────────────────────────────────────────────────────────────
export function toHex(bytes: Uint8Array | ArrayBuffer): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let out = "";
	for (let i = 0; i < arr.length; i++) {
		out += arr[i].toString(16).padStart(2, "0");
	}
	return out;
}

export function fromHex(hex: string): Uint8Array {
	if (hex.length % 2 !== 0) throw new Error("Invalid hex length");
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
	}
	return out;
}

export async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return toHex(buf);
}

// ── Key lifecycle ──────────────────────────────────────────────────────────
const keyRecordFor = (channelId: string) => `channel-key:${channelId}`;

interface StoredKeyRecord {
	privateKey: CryptoKey; // non-extractable
	publicKeyHex: string; // for display/debugging; server has the canonical copy
}

/**
 * Generate a fresh keypair for a new channel. Returns the hex-encoded public
 * key (to send to the server) and persists the non-extractable private key
 * in IndexedDB under the channel id.
 */
export async function generateChannelKey(channelId: string): Promise<string> {
	// Step 1: generate as extractable so we can export the public key *and*
	// re-import the private key with extractable=false.
	const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);

	// Step 2: export the public key (raw, uncompressed form — 65 bytes for P-256).
	const pubRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
	const publicKeyHex = toHex(pubRaw);

	// Step 3: re-import the private key as non-extractable. From this point
	// on no JavaScript (not even our own) can read the key material.
	const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
	const nonExtractablePrivate = await crypto.subtle.importKey(
		"pkcs8",
		pkcs8,
		KEY_ALGORITHM,
		false, // ← the whole point
		["sign"],
	);

	// Best-effort: wipe the extractable pkcs8 bytes we held briefly.
	new Uint8Array(pkcs8).fill(0);

	const record: StoredKeyRecord = { privateKey: nonExtractablePrivate, publicKeyHex };
	await idbPut(keyRecordFor(channelId), record);

	return publicKeyHex;
}

export async function getChannelPrivateKey(channelId: string): Promise<CryptoKey | null> {
	const record = await idbGet<StoredKeyRecord>(keyRecordFor(channelId));
	return record?.privateKey ?? null;
}

export async function deleteChannelKey(channelId: string): Promise<void> {
	try {
		await idbDelete(keyRecordFor(channelId));
	} catch {
		/* storage cleanup is best-effort */
	}
}

// ── Request signing ────────────────────────────────────────────────────────
/**
 * Compute the canonical string that gets signed for every authenticated request.
 * Keep this identical on both client and server.
 *
 *   METHOD\nPATH\nTIMESTAMP\nSHA256(body)
 */
export async function canonicalRequestString(
	method: string,
	path: string,
	timestamp: string,
	body: string,
): Promise<string> {
	const bodyHash = await sha256Hex(body);
	return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

export async function signCanonical(privateKey: CryptoKey, canonical: string): Promise<string> {
	const sig = await crypto.subtle.sign(
		SIGN_ALGORITHM,
		privateKey,
		new TextEncoder().encode(canonical),
	);
	return toHex(sig);
}

/**
 * Sign and send an authenticated request. Adds `X-BH-Timestamp` and
 * `X-BH-Signature` headers. Throws if no key is stored for the channel.
 */
export async function signedFetch(
	channelId: string,
	url: string,
	init: RequestInit = {},
): Promise<Response> {
	const privateKey = await getChannelPrivateKey(channelId);
	if (!privateKey) throw new Error(`No signing key for channel ${channelId}`);

	const method = (init.method ?? "GET").toUpperCase();
	const pathname = new URL(url, window.location.origin).pathname;
	const timestamp = Date.now().toString();
	const bodyStr = typeof init.body === "string" ? init.body : "";

	const canonical = await canonicalRequestString(method, pathname, timestamp, bodyStr);
	const signature = await signCanonical(privateKey, canonical);

	const headers = new Headers(init.headers);
	headers.set("X-BH-Timestamp", timestamp);
	headers.set("X-BH-Signature", signature);

	return fetch(url, { ...init, headers });
}
