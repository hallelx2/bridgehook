/**
 * Builds the Chrome Web Store upload: dist/bridgehook-extension-v<version>.zip.
 *
 *   pnpm --filter @bridgehook/extension package
 *
 * The file list is derived, not hand-kept: manifest.json, everything the
 * manifest names (service worker, popup, icons), the popup's local
 * <script src>, and every JS module reachable through relative imports.
 * A missing file fails the build, so a new module (pairing.js was the first)
 * cannot be left out of a release. Tests, scripts and node_modules never
 * ship. The zip is written without dependencies (node:zlib) with fixed
 * timestamps, so the same sources always give the same bytes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
	const path = join(ROOT, rel);
	if (!existsSync(path)) throw new Error(`Package needs ${rel}, which does not exist`);
	return readFileSync(path);
}

function localRef(from, ref) {
	if (/^[a-z]+:/i.test(ref) || ref.startsWith("//")) return null; // remote URL
	return normalize(posix.join(posix.dirname(from), ref)).replaceAll("\\", "/");
}

/** Relative paths of every file the extension needs, sorted. */
export function collectFiles() {
	const manifest = JSON.parse(read("manifest.json").toString("utf8"));
	const files = new Set(["manifest.json"]);
	const modules = [];

	if (manifest.background?.service_worker) modules.push(manifest.background.service_worker);
	for (const icon of Object.values(manifest.icons ?? {})) files.add(icon);
	for (const icon of Object.values(manifest.action?.default_icon ?? {})) files.add(icon);

	const popup = manifest.action?.default_popup;
	if (popup) {
		files.add(popup);
		const html = read(popup).toString("utf8");
		for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
			const ref = localRef(popup, m[1]);
			if (ref) modules.push(ref);
		}
	}

	// Follow relative static imports and re-exports through the module graph.
	while (modules.length > 0) {
		const mod = modules.pop();
		if (files.has(mod)) continue;
		files.add(mod);
		const src = read(mod).toString("utf8");
		for (const m of src.matchAll(/(?:import|export)\s[^"']*?from\s*["'](\.{1,2}\/[^"']+)["']/g)) {
			modules.push(localRef(mod, m[1]));
		}
		for (const m of src.matchAll(/import\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
			modules.push(localRef(mod, m[1]));
		}
	}

	for (const f of files) read(f); // every file must exist
	return [...files].sort();
}

// ── Minimal deterministic zip writer (deflate, no dependencies) ──────────

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

// 1980-01-01 00:00:00 in DOS format: fixed so builds are reproducible.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(entries) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const { name, data } of entries) {
		const nameBuf = Buffer.from(name, "utf8");
		const compressed = deflateRawSync(data, { level: 9 });
		const crc = crc32(data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(8, 8); // deflate
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, nameBuf, compressed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4); // version made by
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBuf);

		offset += local.length + nameBuf.length + compressed.length;
	}
	const centralSize = centrals.reduce((n, b) => n + b.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, ...centrals, end]);
}

export function buildPackage({ outDir = join(ROOT, "dist") } = {}) {
	const files = collectFiles();
	const { version } = JSON.parse(read("manifest.json").toString("utf8"));
	const bytes = zip(files.map((name) => ({ name, data: read(name) })));
	mkdirSync(outDir, { recursive: true });
	const zipPath = join(outDir, `bridgehook-extension-v${version}.zip`);
	writeFileSync(zipPath, bytes);
	return { zipPath, files, version, bytes: bytes.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { zipPath, files, version, bytes } = buildPackage();
	console.log(`BridgeHook extension v${version}: ${files.length} files, ${bytes} bytes`);
	for (const f of files) console.log(`  ${f}`);
	console.log(zipPath);
}
