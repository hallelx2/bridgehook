import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Password tests run real scrypt (16 MiB, ~50-200 ms each) and the D1
		// tests start workerd; on a loaded machine the 5 s default is too tight.
		testTimeout: 30_000,
		hookTimeout: 60_000,
	},
});
