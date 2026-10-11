/**
 * A Durable Object notify left floating can be cancelled once the handler
 * returns its response, and live clients then miss the frame (HAL-2721). Every
 * `do/notify` fetch must be awaited, or handed to ctx.waitUntil
 * (`background(...)` / `notifier.background`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = __dirname;

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return sourceFiles(p);
		return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
	});
}

/**
 * The statement that opens the fetch chain containing line `i`: the nearest
 * line at or above it that is not a `.method(` continuation. It is kept alive
 * when it awaits or stores the promise for waitUntil, or when the line before
 * it opens a `background(` call.
 */
export function keptAlive(lines: string[], i: number): boolean {
	let open = i;
	while (open > 0 && lines[open].trim().startsWith(".")) open--;
	const head = lines[open].trim();
	if (/^(return\s+)?await\s/.test(head) || /^const notified = /.test(head)) return true;
	if (/background\??\.?\($/.test(head)) return true;
	return open > 0 && /background\??\.?\(\s*$/.test(lines[open - 1]);
}

const NOTIFY = /do\/notify/;

describe("Durable Object notifies outlive the response", () => {
	it("awaits every do/notify fetch or passes it to waitUntil", () => {
		const floating: string[] = [];
		for (const file of sourceFiles(SRC)) {
			const lines = readFileSync(file, "utf8").split("\n");
			lines.forEach((line, i) => {
				if (NOTIFY.test(line) && !keptAlive(lines, i))
					floating.push(`${file.slice(SRC.length + 1)}:${i + 1}`);
			});
		}
		expect(floating).toEqual([]);
	});

	it("flags a floating fetch even right after an awaited statement", () => {
		const src = [
			"\tawait touchDevice(db, id);",
			"\tstub",
			'\t\t.fetch(new Request("https://do/notify", { method: "POST" }))',
			"\t\t.catch(() => {});",
			"\tvoid stub.fetch(`https://do/notify`);",
			"\tbackground(",
			"\t\tstub",
			'\t\t\t.fetch(new Request("https://do/notify"))',
			"\t);",
			'\tawait stub.fetch(new Request("https://do/notify"));',
		];
		expect(keptAlive(src, 2)).toBe(false);
		expect(keptAlive(src, 4)).toBe(false);
		expect(keptAlive(src, 7)).toBe(true);
		expect(keptAlive(src, 9)).toBe(true);
	});
});
