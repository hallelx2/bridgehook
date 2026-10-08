import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUTPUT, compileDrain } from "./scripts/build-drain.mjs";

describe("drain.js", () => {
	it("matches apps/web/src/lib/drain.ts (run pnpm build:drain after changing it)", async () => {
		expect(readFileSync(OUTPUT, "utf8")).toBe(await compileDrain());
	});

	it("exports the drainer the service worker imports", async () => {
		const mod = await import("./drain.js");
		expect(typeof mod.QueueDrainer).toBe("function");
		expect(mod.MAX_ATTEMPTS).toBe(3);
	});
});
