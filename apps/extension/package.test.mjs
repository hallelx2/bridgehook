import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPackage, collectFiles } from "./scripts/package.mjs";

describe("extension package", () => {
	it("contains exactly what the manifest, the popup and the module imports need", () => {
		expect(collectFiles()).toEqual([
			"background.js",
			"drain.js",
			"icons/icon-128.png",
			"icons/icon-32.png",
			"manifest.json",
			"pairing.js",
			"popup.html",
			"popup.js",
		]);
	});

	it("writes a zip that unzips to those files, byte for byte", () => {
		const out = mkdtempSync(join(tmpdir(), "bh-ext-"));
		const { zipPath, files } = buildPackage({ outDir: out });
		const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
			.trim()
			.split("\n");
		expect(listing).toEqual(files);
		const unpacked = mkdtempSync(join(tmpdir(), "bh-ext-x-"));
		execFileSync("unzip", ["-q", zipPath, "-d", unpacked]);
		for (const f of files) {
			expect(readFileSync(join(unpacked, f))).toEqual(
				readFileSync(new URL(`./${f}`, import.meta.url)),
			);
		}
		execFileSync("unzip", ["-tq", zipPath]);
	});

	it("names the zip after the manifest version and builds it reproducibly", () => {
		const a = buildPackage({ outDir: mkdtempSync(join(tmpdir(), "bh-ext-a-")) });
		const b = buildPackage({ outDir: mkdtempSync(join(tmpdir(), "bh-ext-b-")) });
		const { version } = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url)));
		expect(a.zipPath.endsWith(`bridgehook-extension-v${version}.zip`)).toBe(true);
		expect(readFileSync(a.zipPath)).toEqual(readFileSync(b.zipPath));
	});
});
