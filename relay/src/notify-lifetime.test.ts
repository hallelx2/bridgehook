/**
 * A Durable Object notify left floating can be cancelled once the handler
 * returns its response, and live clients then miss the frame (HAL-2721). Every
 * `https://do/notify` fetch must be awaited, or handed to ctx.waitUntil
 * (`background(...)` / `notifier.background`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = __dirname;
const KEPT_ALIVE = /(await\s|background\(\s*$|const notified = )/m;

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return sourceFiles(p);
		return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
	});
}

describe("Durable Object notifies outlive the response", () => {
	it("awaits every do/notify fetch or passes it to waitUntil", () => {
		const floating: string[] = [];
		for (const file of sourceFiles(SRC)) {
			const lines = readFileSync(file, "utf8").split("\n");
			lines.forEach((line, i) => {
				if (!line.includes('"https://do/notify"')) return;
				// The statement that starts the fetch chain: up to 4 lines above.
				const head = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
				if (!KEPT_ALIVE.test(head)) floating.push(`${file.slice(SRC.length + 1)}:${i + 1}`);
			});
		}
		expect(floating).toEqual([]);
	});
});
