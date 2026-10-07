import { defineConfig } from "drizzle-kit";

// Generates D1 (SQLite) migrations into ./migrations, which is where
// `wrangler d1 migrations apply` reads them from:
//   pnpm --filter @bridgehook/relay db:generate
//   npx wrangler d1 migrations apply bridgehook --local|--remote
export default defineConfig({
	schema: "../packages/shared/src/db/schema.ts",
	out: "./migrations",
	dialect: "sqlite",
});
