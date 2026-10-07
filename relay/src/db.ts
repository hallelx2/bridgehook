/**
 * Database handle: Cloudflare D1 through Drizzle.
 *
 * D1 is a binding, so there is no connection to open or cache; a Drizzle
 * wrapper per request is cheap. Two D1 constraints shape the queries in this
 * codebase:
 *   - at most 100 bound parameters per statement: never pass an unbounded
 *     id list to inArray(); use a subquery instead
 *   - no interactive transactions: use db.batch() for multi-statement writes
 */
import * as schema from "@bridgehook/shared/db/schema";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";

export type DB = DrizzleD1Database<typeof schema>;

export function getDb(env: { DB: D1Database }): DB {
	return drizzle(env.DB, { schema });
}
