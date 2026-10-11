/**
 * Wraps every legacy PBKDF2 password hash in D1 as scrypt over its PBKDF2
 * output (see src/password.ts), so accounts whose owners never sign in again
 * still get scrypt's strength.
 *
 *   node scripts/wrap-legacy-hashes.ts --local            dry run, local D1
 *   node scripts/wrap-legacy-hashes.ts --remote --apply   wrap production rows
 *
 * Run from relay/. Deploy the relay that understands `scrypt-pbkdf2` hashes
 * BEFORE applying to production, or wrapped accounts cannot sign in.
 *
 * Safety: the old rows are written to a 0600 backup file outside the repo
 * before anything changes; each UPDATE matches the old hash, so a row that
 * changed since it was read (a sign-in rewrote it) is left alone; the script
 * re-reads afterwards and fails if any plain PBKDF2 row remains.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { wrapLegacyHash } from "../src/password.ts";

const args = new Set(process.argv.slice(2));
const target = args.has("--remote") ? "--remote" : args.has("--local") ? "--local" : null;
if (!target) {
	console.error("Choose --local or --remote (add --apply to write).");
	process.exit(2);
}
const apply = args.has("--apply");

function d1(sqlOrFile: { command: string } | { file: string }): Array<Record<string, unknown>> {
	const flag =
		"command" in sqlOrFile ? ["--command", sqlOrFile.command] : ["--file", sqlOrFile.file];
	const out = execFileSync(
		"npx",
		["wrangler", "d1", "execute", "bridgehook", target as string, "--json", ...flag],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	const parsed = JSON.parse(out) as Array<{ results?: Array<Record<string, unknown>> }>;
	return parsed.flatMap((r) => r.results ?? []);
}

const sqlString = (v: string) => `'${v.replaceAll("'", "''")}'`;

const legacyQuery = "SELECT id, password FROM account WHERE password LIKE 'pbkdf2-sha256$%'";
const rows = d1({ command: legacyQuery }) as Array<{ id: string; password: string }>;
console.log(`${rows.length} plain PBKDF2 hash(es) on ${target.slice(2)} D1.`);
if (rows.length === 0) process.exit(0);

const updates: string[] = [];
let skipped = 0;
for (const row of rows) {
	const wrapped = await wrapLegacyHash(row.password);
	if (!wrapped) {
		// Out-of-range or malformed: it cannot verify today, so wrapping gains nothing.
		console.warn(`  skip ${row.id}: not a hash this relay can verify`);
		skipped++;
		continue;
	}
	updates.push(
		`UPDATE account SET password = ${sqlString(wrapped)} WHERE id = ${sqlString(row.id)} AND password = ${sqlString(row.password)};`,
	);
	console.log(`  ${row.id}: pbkdf2-sha256 -> scrypt-pbkdf2`);
}

if (!apply) {
	console.log("Dry run. Re-run with --apply to write.");
	process.exit(0);
}
if (updates.length === 0) {
	console.log("Nothing to wrap.");
	process.exit(0);
}

const dir = join(homedir(), ".cache", "bridgehook");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(dir, `legacy-hashes-${target.slice(2)}-${stamp}.json`);
writeFileSync(backup, JSON.stringify(rows, null, 2), { mode: 0o600 });
console.log(`Backup of the old rows: ${backup}`);

const sqlFile = join(dir, `wrap-legacy-hashes-${stamp}.sql`);
writeFileSync(sqlFile, `${updates.join("\n")}\n`, { mode: 0o600 });
d1({ file: sqlFile });

const remaining = d1({ command: legacyQuery }).length;
const wrappedCount = d1({
	command: "SELECT count(*) AS n FROM account WHERE password LIKE 'scrypt-pbkdf2$%'",
})[0]?.n;
console.log(
	`Wrapped rows now: ${wrappedCount}. Plain PBKDF2 rows left: ${remaining} (${skipped} skipped as unverifiable).`,
);
if (remaining > skipped) {
	console.error(
		"Some rows were not wrapped (a sign-in changed them since they were read?). Re-run.",
	);
	process.exit(1);
}
