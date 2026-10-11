/**
 * The CLI end to end, driving the real binary against a real relay.
 *
 *   node cli/e2e/cli.e2e.mjs            # production, with the QA account
 *   node cli/e2e/cli.e2e.mjs --local    # a throwaway local relay (wrangler dev)
 *
 * Checks, in order:
 *   1. `bridgehook login` pairs: the script approves the printed code with an
 *      account session, as a person would in the dashboard;
 *   2. `whoami` reports that account;
 *   3. `forward` prints a webhook URL; with nothing forwarding, 20 webhooks
 *      sent to it wait on the relay and all arrive at localhost, in order,
 *      once `forward` runs again;
 *   4. once the stream reports connected, live webhooks arrive within 2 s
 *      (the stream wakes the drain);
 *   5. with the local server down, webhooks wait and then arrive in order
 *      when it is back;
 *   6. a channel another client made on a port: refused to a script without
 *      `--adopt`; `--adopt --path` keeps its URL and applies the paths;
 *   7. Ctrl-C stops within 3 s; `login --force` revokes the token it
 *      replaces; `logout` revokes the token on the relay.
 *
 * Production needs the QA account in the repo's gitignored .env
 * (BRIDGEHOOK_TEST_EMAIL, BRIDGEHOOK_TEST_PASSWORD) or the environment. Setup
 * and teardown revoke the account's devices and delete its channels. Builds
 * the binary with cargo unless BRIDGEHOOK_BIN is set. Never prints a token
 * or a password.
 */
import { execFileSync, spawn } from "node:child_process";
import { createECDH } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const LOCAL = process.argv.includes("--local");
const PORT = 3457;
const OFFLINE_COUNT = 20;
const LIVE_LIMIT_MS = 2000;

const cleanup = [];
let failed = false;
const step = (s) => console.log(`• ${s}`);
function check(cond, message) {
	if (!cond) throw new Error(`check failed: ${message}`);
}

// ── the binary ───────────────────────────────────────────────────────────
let BIN = process.env.BRIDGEHOOK_BIN;
if (!BIN) {
	execFileSync("cargo", ["build", "-p", "bridgehook"], { cwd: ROOT, stdio: "inherit" });
	BIN = join(
		ROOT,
		"target",
		"debug",
		process.platform === "win32" ? "bridgehook.exe" : "bridgehook",
	);
}

// ── the relay and an account session ─────────────────────────────────────
let RELAY = "https://relay.bridgehook.dev";
let email;
let password;

function freePort() {
	return new Promise((resolve) => {
		const s = http.createServer().listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => resolve(port));
		});
	});
}

let localPersist;
async function startLocalRelay() {
	const port = await freePort();
	const persist = mkdtempSync(join(tmpdir(), "bh-cli-e2e-d1-"));
	localPersist = persist;
	cleanup.push(() => rmSync(persist, { recursive: true, force: true }));
	const relayDir = join(ROOT, "relay");
	execFileSync(
		"npx",
		["wrangler", "d1", "migrations", "apply", "bridgehook", "--local", "--persist-to", persist],
		{
			cwd: relayDir,
			stdio: "ignore",
			env: { ...process.env, CI: "1" },
		},
	);
	const secret = [...crypto.getRandomValues(new Uint8Array(32))]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const base = `http://localhost:${port}`;
	const wrangler = spawn(
		"npx",
		[
			"wrangler",
			"dev",
			"--port",
			String(port),
			"--persist-to",
			persist,
			// wrangler dev rewrites the request host and Origin to the route's
			// host; pin them to localhost (it drops the port from Origin).
			"--local-upstream",
			`localhost:${port}`,
			"--var",
			`BETTER_AUTH_SECRET:${secret}`,
			"--var",
			`BETTER_AUTH_URL:${base}`,
			"--var",
			`WEB_URL:${base}`,
			"--var",
			"AUTH_TRUSTED_ORIGINS:http://localhost",
		],
		{ cwd: relayDir, stdio: "ignore", detached: true, env: { ...process.env, CI: "1" } },
	);
	cleanup.push(() => {
		try {
			process.kill(-wrangler.pid, "SIGTERM");
		} catch {}
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${base}/health`)).status < 500) return base;
		} catch {}
		await sleep(500);
	}
	throw new Error("local relay did not start");
}

/** Fetch with the account's session cookie. */
let cookie = "";
async function api(path, init = {}) {
	const res = await fetch(`${RELAY}${path}`, {
		...init,
		headers: {
			"content-type": "application/json",
			// The dashboard's origin, as a browser on it sends (Better-Auth
			// refuses Node's fetch without one). Locally WEB_URL is the relay.
			origin: LOCAL ? RELAY : (process.env.BRIDGEHOOK_WEB_URL ?? "https://app.bridgehook.dev"),
			...(cookie ? { cookie } : {}),
			...(init.headers ?? {}),
		},
	});
	const set = res.headers.getSetCookie?.() ?? [];
	if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
	return res;
}

async function signIn() {
	if (LOCAL) {
		email = `cli-e2e-${Date.now()}@example.com`;
		password = `pw-${crypto.randomUUID()}`;
		const up = await api("/auth/sign-up/email", {
			method: "POST",
			body: JSON.stringify({ email, password, name: "CLI e2e" }),
		});
		check(up.ok, `local sign-up answered ${up.status}: ${(await up.text()).slice(0, 200)}`);
		// The free plan caps a day at 10 webhooks; the production QA account
		// is on Pro, so match it.
		execFileSync(
			"npx",
			[
				"wrangler",
				"d1",
				"execute",
				"bridgehook",
				"--local",
				"--persist-to",
				localPersist,
				"--command",
				`UPDATE user SET plan = 'pro' WHERE email = '${email}'`,
			],
			{ cwd: join(ROOT, "relay"), stdio: "ignore", env: { ...process.env, CI: "1" } },
		);
		return;
	}
	const env = { ...process.env };
	const envFile = join(ROOT, ".env");
	if (existsSync(envFile)) {
		for (const line of readFileSync(envFile, "utf8").split("\n")) {
			const m = line.match(/^(BRIDGEHOOK_TEST_(?:EMAIL|PASSWORD))=(.*)$/);
			if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
		}
	}
	email = env.BRIDGEHOOK_TEST_EMAIL;
	password = env.BRIDGEHOOK_TEST_PASSWORD;
	check(
		email && password,
		"QA credentials missing: set BRIDGEHOOK_TEST_EMAIL and BRIDGEHOOK_TEST_PASSWORD",
	);
	const res = await api("/auth/sign-in/email", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
	check(res.ok, `QA sign-in answered ${res.status}`);
}

async function resetAccount(label) {
	const { devices = [] } = await (await api("/api/me/devices")).json();
	const active = devices.filter((d) => !d.revokedAt);
	for (const d of active) await api(`/api/me/devices/${d.id}`, { method: "DELETE" });
	const { channels = [] } = await (await api("/api/me/channels")).json();
	for (const ch of channels) await api(`/api/me/channels/${ch.id}`, { method: "DELETE" });
	step(`${label}: revoked ${active.length} device(s), deleted ${channels.length} channel(s)`);
}

// ── the CLI as a child process, its --json lines as events ────────────────
const CONFIG = mkdtempSync(join(tmpdir(), "bh-cli-e2e-config-"));
cleanup.push(() => rmSync(CONFIG, { recursive: true, force: true }));

/** Every CLI run, so a failure can show what each one last reported. */
const runs = [];

function cli(args) {
	const env = {
		...process.env,
		BRIDGEHOOK_CONFIG_DIR: CONFIG,
		BRIDGEHOOK_VERBOSE: "true",
		BRIDGEHOOK_RELAY: RELAY,
		NO_COLOR: "1",
	};
	env.BRIDGEHOOK_TOKEN = "";
	const child = spawn(BIN, ["--json", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
	const record = { args, events: [], stderr: "" };
	runs.push(record);
	const events = record.events;
	const waiters = [];
	let stderr = "";
	child.stderr.on("data", (d) => {
		stderr += d;
		record.stderr += d;
	});
	createInterface({ input: child.stdout }).on("line", (line) => {
		let e;
		try {
			e = JSON.parse(line);
		} catch {
			return;
		}
		e.at = Date.now();
		events.push(e);
		for (const w of [...waiters]) if (w.match(e)) w.resolve(e);
	});
	const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
	return {
		child,
		events,
		exited,
		stderr: () => stderr,
		waitFor(match, ms = 30_000, what = "event") {
			const seen = events.find(match);
			if (seen) return Promise.resolve(seen);
			return new Promise((resolve, reject) => {
				const w = {
					match,
					resolve: (e) => {
						clearTimeout(t);
						resolve(e);
					},
				};
				const t = setTimeout(() => {
					waiters.splice(waiters.indexOf(w), 1);
					reject(
						new Error(
							`timed out waiting for ${what}; events: ${JSON.stringify(events.map((e) => e.event))}; stderr: ${stderr.slice(-500)}`,
						),
					);
				}, ms);
				waiters.push(w);
			});
		},
	};
}

async function run(args) {
	const p = cli(args);
	const code = await p.exited;
	return { code, events: p.events, stderr: p.stderr() };
}

// ── a local server that records what reaches it ──────────────────────────
const received = [];
let server = null;
function startServer() {
	return new Promise((resolve) => {
		server = http.createServer((req, res) => {
			let body = "";
			req.on("data", (d) => {
				body += d;
			});
			req.on("end", () => {
				if (req.method !== "HEAD") {
					received.push({
						at: Date.now(),
						method: req.method,
						url: req.url,
						body,
						header: req.headers["x-e2e"],
					});
				}
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			});
		});
		server.listen(PORT, "127.0.0.1", resolve);
	});
}
function stopServer() {
	return new Promise((resolve) => {
		if (!server) return resolve();
		server.closeAllConnections?.();
		server.close(() => resolve());
		server = null;
	});
}
cleanup.push(stopServer);

async function waitReceived(n, ms) {
	const until = Date.now() + ms;
	while (received.length < n && Date.now() < until) await sleep(100);
	check(received.length >= n, `expected ${n} webhooks at localhost, got ${received.length}`);
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/** The webhook URL the CLI printed. */
let sendBase;
async function sendWebhook(tag) {
	const res = await fetch(`${sendBase}/e2e?tag=${tag}`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-e2e": tag },
		body: JSON.stringify({ tag }),
	});
	check(res.status < 300, `webhook ${tag} answered ${res.status}`);
}

// ── the run ──────────────────────────────────────────────────────────────
try {
	if (LOCAL) {
		RELAY = await startLocalRelay();
		step(`local relay up at ${RELAY}`);
	}
	await signIn();
	step(`signed in to ${RELAY} (${LOCAL ? "throwaway account" : "QA account"})`);
	await resetAccount("setup");

	// 1. login: approve the code the CLI prints.
	const login = cli(["login", "--no-browser"]);
	const pairing = await login.waitFor((e) => e.event === "pairing", 30_000, "a pairing code");
	check(/^DV-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(pairing.code), "pairing code format");
	const approve = await api("/auth/device/approve", {
		method: "POST",
		body: JSON.stringify({ code: pairing.code }),
	});
	check(approve.ok, `approve answered ${approve.status}`);
	const signedIn = await login.waitFor((e) => e.event === "signed_in", 60_000, "signed_in");
	check((await login.exited) === 0, "login exits 0");
	check(signedIn.email === email, "login reports the approving account");
	step(`login: paired as device ${signedIn.deviceId}`);

	// 2. whoami
	const who = await run(["whoami"]);
	check(who.code === 0 && who.events[0]?.email === email, `whoami: ${who.stderr}`);
	step(`whoami: ${who.events[0].plan} plan`);

	// 3. offline queue: get the URL with nothing listening, stop, send 20.
	const first = cli(["forward", String(PORT)]);
	const ready = await first.waitFor((e) => e.event === "ready", 30_000, "ready");
	check(ready.channel === "created", `first forward creates a channel (got ${ready.channel})`);
	sendBase = ready.webhookUrl;
	first.child.kill("SIGINT");
	check((await first.exited) === 0, "forward stops cleanly on Ctrl-C");
	step(`forward: ${ready.webhookUrl}`);

	for (let i = 0; i < OFFLINE_COUNT; i++)
		await sendWebhook(`offline-${String(i).padStart(2, "0")}`);
	step(`sent ${OFFLINE_COUNT} webhooks while nothing was forwarding`);

	await startServer();
	const fwd = cli(["forward", String(PORT)]);
	const again = await fwd.waitFor((e) => e.event === "ready", 30_000, "ready");
	check(
		again.channelId === ready.channelId && again.channel === "reused",
		"the second run reuses the same channel and URL",
	);
	await waitReceived(OFFLINE_COUNT, 90_000);
	const tags = received.map((r) => r.header);
	const expected = Array.from(
		{ length: OFFLINE_COUNT },
		(_, i) => `offline-${String(i).padStart(2, "0")}`,
	);
	check(JSON.stringify(tags) === JSON.stringify(expected), `in order: ${tags.join(",")}`);
	check(
		received.every((r) => r.method === "POST" && r.url.startsWith("/e2e?tag=offline-")),
		"method, path and query reach localhost",
	);
	check(JSON.parse(received[0].body).tag === "offline-00", "body reaches localhost");
	await fwd.waitFor(
		(e) =>
			e.event === "delivered" &&
			e.id &&
			fwd.events.filter((x) => x.event === "delivered").length >= OFFLINE_COUNT,
		30_000,
		"delivered reports",
	);
	step(`all ${OFFLINE_COUNT} delivered in order`);

	// 4. live delivery latency. Wait for the stream: polling alone (every 2 s)
	// can land under 2 s by luck, so only a connected stream proves the wake-up.
	await fwd.waitFor(
		(e) => e.event === "stream" && e.connected === true,
		30_000,
		"stream connected",
	);
	// The criterion is the relay-to-localhost leg: from the relay storing the
	// webhook (its own receivedAt) to localhost getting it. A real sender
	// (Stripe, GitHub) posts from a data centre near Cloudflare; this
	// machine's own upload is reported beside it, not counted. Clocks are
	// NTP-synced; skew is a few ms.
	const live = [];
	for (let i = 0; i < 3; i++) {
		const before = received.length;
		const sent = Date.now();
		await sendWebhook(`live-${i}`);
		await waitReceived(before + 1, 15_000);
		live.push({ tag: `live-${i}`, sent, at: received[before].at });
	}
	const { events: history = [] } = await (
		await api(`/api/me/events?channel=${ready.channelId}&limit=50`)
	).json();
	const relayLeg = live.map((l) => {
		const evt = history.find((e) => e.path.includes(`tag=${l.tag}`));
		check(evt, `the relay's record of ${l.tag}`);
		return l.at - new Date(evt.receivedAt).getTime();
	});
	const endToEnd = live.map((l) => l.at - l.sent);
	check(
		Math.max(...relayLeg) < LIVE_LIMIT_MS,
		`live delivery under ${LIVE_LIMIT_MS} ms from the relay: ${relayLeg.join(", ")} ms`,
	);
	step(
		`live delivery: ${relayLeg.join(", ")} ms from the relay accepting it (${endToEnd.join(", ")} ms from this machine's send)`,
	);

	// 5. target down: webhooks wait, then arrive in order.
	await stopServer();
	const downFrom = received.length;
	await sendWebhook("down-0");
	await fwd.waitFor((e) => e.event === "target_down", 30_000, "target_down");
	await sendWebhook("down-1");
	await sleep(2000);
	check(received.length === downFrom, "nothing delivered while the server is down");
	await startServer();
	await fwd.waitFor((e) => e.event === "target_up", 60_000, "target_up");
	await waitReceived(downFrom + 2, 30_000);
	check(
		received[downFrom].header === "down-0" && received[downFrom + 1].header === "down-1",
		"held webhooks arrive in order",
	);
	step("server down: held, then delivered in order once back");

	// 6. taking over a channel another client made on a port: a script is
	// refused without --adopt; --adopt --path takes it (same URL) and applies
	// the paths.
	const takeoverPort = PORT + 1;
	const ecdh = createECDH("prime256v1");
	ecdh.generateKeys();
	const made = await api("/api/channels", {
		method: "POST",
		body: JSON.stringify({
			publicKey: ecdh.getPublicKey("hex"),
			port: takeoverPort,
			allowedPaths: [],
		}),
	});
	check(made.ok, `dashboard-style channel answered ${made.status}`);
	const other = await made.json();
	const refused = await run(["forward", String(takeoverPort)]);
	check(
		refused.code === 1 &&
			refused.events.some((e) => e.event === "error" && /--adopt/.test(e.message)),
		"a script is refused a takeover without --adopt",
	);
	const hits = [];
	const second = http.createServer((req, res) => {
		hits.push(req.url);
		res.writeHead(200).end("ok");
	});
	await new Promise((r) => second.listen(takeoverPort, "127.0.0.1", r));
	cleanup.push(() => new Promise((r) => second.close(() => r())));
	const adopt = cli(["forward", String(takeoverPort), "--adopt", "--path", "/only"]);
	const adopted = await adopt.waitFor((e) => e.event === "ready", 30_000, "ready (adopt)");
	check(
		adopted.channel === "adopted" && adopted.channelId === other.channelId,
		"--adopt keeps the same channel",
	);
	check(adopted.webhookUrl === other.webhookUrl, "--adopt keeps the same URL");
	const { channels: listedAfter = [] } = await (await api("/api/me/channels")).json();
	const paths = listedAfter.find((c) => c.id === other.channelId)?.allowedPaths;
	check(
		JSON.stringify(paths) === '["/only"]',
		`--path is applied to an adopted channel (got ${JSON.stringify(paths)})`,
	);
	const blocked = await fetch(`${other.webhookUrl}/elsewhere`, { method: "POST", body: "{}" });
	check(blocked.status === 403, `a path outside --path is refused (got ${blocked.status})`);
	const allowed = await fetch(`${other.webhookUrl}/only/x`, { method: "POST", body: "{}" });
	check(allowed.status < 300, `a path inside --path is accepted (got ${allowed.status})`);
	await adopt.waitFor((e) => e.event === "delivered", 15_000, "delivery on the adopted channel");
	check(hits.includes("/only/x"), "the adopted channel delivers to localhost");
	adopt.child.kill("SIGINT");
	check((await adopt.exited) === 0, "adopted forward stops cleanly");
	step("takeover: refused without --adopt; --adopt keeps the URL and applies --path");

	// 7. Ctrl-C stops promptly, then a second login revokes the token it
	// replaces, and logout revokes the token on the relay.
	const ctrlC = Date.now();
	fwd.child.kill("SIGINT");
	check((await fwd.exited) === 0, "forward stops cleanly");
	check(Date.now() - ctrlC < 3000, `Ctrl-C stops within 3 s (took ${Date.now() - ctrlC} ms)`);
	check(
		fwd.events.some((e) => e.event === "stopped"),
		"forward reports stopped",
	);

	const firstToken = JSON.parse(readFileSync(join(CONFIG, "token.json"), "utf8")).token;
	const relogin = cli(["login", "--no-browser", "--force"]);
	const code2 = (
		await relogin.waitFor((e) => e.event === "pairing", 30_000, "a second pairing code")
	).code;
	const approve2 = await api("/auth/device/approve", {
		method: "POST",
		body: JSON.stringify({ code: code2 }),
	});
	check(approve2.ok, `second approve answered ${approve2.status}`);
	check((await relogin.exited) === 0, "login --force exits 0");
	const replaced = await fetch(`${RELAY}/api/me`, {
		headers: { authorization: `Bearer ${firstToken}` },
	});
	check(
		replaced.status === 401,
		`login --force revokes the token it replaces (got ${replaced.status})`,
	);
	const { devices: devs = [] } = await (await api("/api/me/devices")).json();
	check(devs.filter((d) => !d.revokedAt).length === 1, "one active device after re-pairing");
	step("login --force: the replaced token is revoked, no orphan device");

	const token = JSON.parse(readFileSync(join(CONFIG, "token.json"), "utf8")).token;
	const out = await run(["logout"]);
	check(out.code === 0 && out.events[0]?.revoked === true, `logout revokes: ${out.stderr}`);
	check(!existsSync(join(CONFIG, "token.json")), "logout removes the local token");
	const after = await fetch(`${RELAY}/api/me`, { headers: { authorization: `Bearer ${token}` } });
	check(after.status === 401, `the old token is refused after logout (got ${after.status})`);
	step("logout: token revoked on the relay and removed locally");

	await resetAccount("teardown");
	console.log("\nPASS");
} catch (err) {
	failed = true;
	console.error(`\nFAIL: ${err.message}`);
	for (const r of runs.filter((r) => r.args[0] === "forward")) {
		const tail = r.events.slice(-12).map(({ at, ...e }) => JSON.stringify(e));
		const log = r.stderr.trim().split("\n").slice(-30);
		console.error(
			`  forward ${r.args.slice(1).join(" ")}: last events\n    ${tail.join("\n    ")}\n  verbose log\n    ${log.join("\n    ")}`,
		);
	}
	try {
		await resetAccount("teardown");
	} catch {}
} finally {
	for (const f of cleanup.reverse()) {
		try {
			await f();
		} catch {}
	}
	process.exit(failed ? 1 : 0);
}
