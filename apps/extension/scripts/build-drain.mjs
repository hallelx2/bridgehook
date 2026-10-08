/**
 * The extension forwards with the same QueueDrainer as the dashboard tab
 * (apps/web/src/lib/drain.ts), so the two can never disagree on ordering,
 * claims, retries or reporting. This compiles it to plain ESM for the
 * Manifest V3 service worker. Run after changing drain.ts:
 *
 *   pnpm --filter @bridgehook/extension build:drain
 *
 * drain.test.mjs fails if the committed drain.js is out of date.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCE = join(here, "../../web/src/lib/drain.ts");
export const OUTPUT = join(here, "../drain.js");

export async function compileDrain() {
	const { code } = await transform(readFileSync(SOURCE, "utf8"), {
		loader: "ts",
		format: "esm",
		target: "es2022",
	});
	return `// Generated from apps/web/src/lib/drain.ts by scripts/build-drain.mjs. Do not edit.\n${code}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(OUTPUT, await compileDrain());
	console.log(`wrote ${OUTPUT}`);
}
