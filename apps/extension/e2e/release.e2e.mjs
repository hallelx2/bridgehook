/**
 * Release check: the packaged extension, end to end, against production.
 *
 *   pnpm --filter @bridgehook/extension e2e
 *
 * Loads exactly the files that go into the store zip (scripts/package.mjs)
 * into Chromium, then, clicking through the real UI:
 *   pair (Pair device → sign in → Approve) → add a port → a live webhook
 *   reaches a local server → close the browser, send three more → reopen →
 *   all four delivered in order.
 * Also saves step screenshots and 1280×800 JPEG store screenshots (no alpha,
 * as the Chrome Web Store requires) to dist/e2e/.
 *
 * Needs the QA account in the repo's gitignored .env (BRIDGEHOOK_TEST_EMAIL,
 * BRIDGEHOOK_TEST_PASSWORD) or the environment, a Chromium (CHROMIUM_PATH,
 * default /usr/bin/chromium; Google Chrome no longer loads unpacked
 * extensions from the command line) and port 3456 free. Setup and teardown
 * revoke the QA account's devices and channels, so runs do not accumulate.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request as apiRequest, chromium } from "playwright";
import { collectFiles } from "../scripts/package.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = join(HERE, "..");
const SHOTS = join(EXT_ROOT, "dist", "e2e");
mkdirSync(SHOTS, { recursive: true });

// The unpacked build: the same files, from the same list, as the store zip.
const EXT = mkdtempSync(join(tmpdir(), "bh-ext-build-"));
for (const f of collectFiles()) {
	mkdirSync(dirname(join(EXT, f)), { recursive: true });
	copyFileSync(join(EXT_ROOT, f), join(EXT, f));
}

const envFile = join(EXT_ROOT, "..", "..", ".env");
const env = {
	BRIDGEHOOK_TEST_EMAIL: process.env.BRIDGEHOOK_TEST_EMAIL,
	BRIDGEHOOK_TEST_PASSWORD: process.env.BRIDGEHOOK_TEST_PASSWORD,
};
if (existsSync(envFile)) {
	for (const line of readFileSync(envFile, "utf8").split("\n")) {
		const m = line.match(/^(BRIDGEHOOK_TEST_(?:EMAIL|PASSWORD))=(.*)$/);
		// Strip one pair of surrounding quotes, as dotenv does.
		if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
	}
}
if (!env.BRIDGEHOOK_TEST_EMAIL || !env.BRIDGEHOOK_TEST_PASSWORD) {
	throw new Error("QA credentials missing: set BRIDGEHOOK_TEST_EMAIL and BRIDGEHOOK_TEST_PASSWORD");
}

// Revoke the QA account's devices and delete its channels, so every run starts
// from the free plan's empty slots and leaves nothing behind.
async function resetQaAccount(label) {
	const api = await apiRequest.newContext({ baseURL: "https://relay.bridgehook.dev" });
	const signIn = await api.post("/auth/sign-in/email", {
		data: { email: env.BRIDGEHOOK_TEST_EMAIL, password: env.BRIDGEHOOK_TEST_PASSWORD },
	});
	if (!signIn.ok()) throw new Error(`QA sign-in failed: ${signIn.status()}`);
	const { devices = [] } = await (await api.get("/api/me/devices")).json();
	for (const d of devices) if (!d.revokedAt) await api.delete(`/api/me/devices/${d.id}`);
	const { channels = [] } = await (await api.get("/api/me/channels")).json();
	for (const ch of channels) await api.delete(`/api/me/channels/${ch.id}`);
	console.log(
		`• ${label}: revoked ${devices.filter((d) => !d.revokedAt).length} device(s), deleted ${channels.length} channel(s)`,
	);
	await api.dispose();
}
await resetQaAccount("setup");

const PORT = 3456;
const received = [];
const server = http.createServer((req, res) => {
	let body = "";
	req.on("data", (d) => {
		body += d;
	});
	req.on("end", () => {
		// Only deliveries count: the extension also sends bodyless HEAD probes
		// to check the local server is up before retrying a failed forward.
		if (req.method === "POST" && body) received.push({ method: req.method, url: req.url, body });
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true, seen: received.length }));
	});
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const step = (msg) => console.log(`• ${msg}`);
const fail = (msg) => {
	console.log(`FAIL: ${msg}`);
	process.exitCode = 1;
};
const profile = mkdtempSync(join(tmpdir(), "bh-ext-profile-"));
const launch = () =>
	chromium.launchPersistentContext(profile, {
		executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
		headless: true,
		viewport: { width: 1280, height: 800 },
		args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
	});
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const until = async (fn, ms, label) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await fn()) return true;
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`timed out: ${label}`);
};

let ctx = await launch();
try {
	const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
	const extId = new URL(sw.url()).host;
	const version = await sw.evaluate(() => chrome.runtime.getManifest().version);
	step(`extension loaded: version ${version}`);

	const popup = await ctx.newPage();
	await popup.setViewportSize({ width: 400, height: 640 });
	await popup.goto(`chrome-extension://${extId}/popup.html`);
	await popup.waitForSelector("#btn-pair-device", { state: "visible" });
	await shot(popup, "1-popup-signed-out");
	step("popup shows the signed-out state with Pair device");

	// Pair: the extension opens app.bridgehook.dev/connect?code=...
	const [web] = await Promise.all([
		ctx.waitForEvent("page", { predicate: (p) => p !== popup, timeout: 20_000 }),
		popup.click("#btn-pair-device"),
	]);
	web.on("console", (m) => {
		if (m.type() === "error") console.log(`  [web console] ${m.text().slice(0, 200)}`);
	});
	web.on("pageerror", (e) => console.log(`  [web pageerror] ${String(e).slice(0, 200)}`));
	await web.waitForURL(/bridgehook\.dev\/(login|connect)/, { timeout: 30_000 });
	const code =
		new URL(web.url()).searchParams.get("code") ??
		decodeURIComponent(web.url()).match(/DV-[A-Z0-9-]+/)?.[0];
	step(`pairing tab opened at ${new URL(web.url()).pathname} with code ${code ?? "(in next)"}`);
	// The connect page redirects to /login after a moment when signed out, so
	// wait for whichever settles: the sign-in form or the Approve button.
	const approveBtn = web.getByRole("button", { name: /approve/i });
	await Promise.race([
		web.waitForSelector('input[type="email"]', { timeout: 30_000 }),
		approveBtn.waitFor({ timeout: 30_000 }),
	]);
	if (await web.locator('input[type="email"]').isVisible()) {
		await web.fill('input[type="email"]', env.BRIDGEHOOK_TEST_EMAIL);
		await web.fill('input[type="password"]', env.BRIDGEHOOK_TEST_PASSWORD);
		await shot(web, "2-login");
		await web.click('form button[type="submit"]');
		step("signed in with the QA account");
	}
	await web.waitForURL(/\/connect/, { timeout: 30_000 });
	await web.getByRole("button", { name: /approve/i }).waitFor({ timeout: 20_000 });
	await shot(web, "3-connect");
	await web.getByRole("button", { name: /approve/i }).click();
	await web.getByRole("heading", { name: /device approved/i }).waitFor({ timeout: 20_000 });
	await shot(web, "4-approved");
	step("approved the device in the dashboard");

	await until(
		async () => {
			await popup.reload();
			await popup.waitForTimeout(800);
			return (await popup.textContent("#identity"))?.includes(
				env.BRIDGEHOOK_TEST_EMAIL.split("@")[0],
			);
		},
		60_000,
		"popup shows the paired account",
	);
	await shot(popup, "5-popup-paired");
	step("popup shows the paired QA account");

	// Add a port.
	await popup.click("#btn-show-add");
	await popup.fill("#f-name", "QA e2e");
	await popup.fill("#f-port", String(PORT));
	await popup.click("#btn-add");
	let webhookUrl = null;
	await until(
		async () => {
			webhookUrl = await popup.evaluate(
				() => document.querySelector("#services-list .url")?.textContent?.trim() ?? null,
			);
			return Boolean(webhookUrl);
		},
		30_000,
		"service row with a webhook URL",
	);
	await shot(popup, "6-service-added");
	if (/^https:\/\/[a-z0-9]+\.bridgehook\.dev\/?$/.test(webhookUrl))
		step(`service shows ${webhookUrl}`);
	else fail(`webhook URL is not a <id>.bridgehook.dev URL: ${webhookUrl}`);

	// Live delivery.
	const post = (n) =>
		fetch(`${webhookUrl.replace(/\/$/, "")}/webhook`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ n }),
		}).then((r) => r.status);
	step(`sent webhook 1 → relay answered ${await post(1)}`);
	await until(
		() => received.some((r) => r.body.includes('"n":1')),
		45_000,
		"webhook 1 reaches localhost",
	);
	const first = received.find((r) => r.body.includes('"n":1'));
	step(`localhost received ${first.method} ${first.url} ${first.body}`);
	await popup.reload();
	await popup.waitForTimeout(1500);
	await shot(popup, "7-delivered");

	// Offline backlog: close the browser, send three, reopen.
	await ctx.close();
	step("browser closed");
	for (const n of [2, 3, 4])
		step(`sent webhook ${n} while offline → relay answered ${await post(n)}`);
	ctx = await launch();
	step("browser reopened");
	await until(
		() => [2, 3, 4].every((n) => received.some((r) => r.body.includes(`"n":${n}`))),
		90_000,
		"offline webhooks reach localhost",
	);
	const order = received.map((r) => JSON.parse(r.body).n);
	if (JSON.stringify(order) === JSON.stringify([1, 2, 3, 4]))
		step(`backlog delivered in order: ${order.join(", ")}`);
	else fail(`delivery order was ${order.join(", ")}`);
	const p2 = await ctx.newPage();
	await p2.setViewportSize({ width: 400, height: 640 });
	await p2.goto(`chrome-extension://${extId}/popup.html`);
	await p2.waitForTimeout(2000);
	await shot(p2, "8-after-backlog");

	// Store screenshots: 1280×800 JPEG, so there is no alpha channel. Sample
	// webhooks with realistic, brand-free payloads (the store once rejected the
	// listing for naming providers); the headers tree is collapsed in the
	// detail shot so the sender's IP address never appears.
	const samples = [
		[
			"orders",
			{ type: "order.paid", data: { id: "ord_8f2k1", amount: 4900, currency: "usd", items: 2 } },
		],
		[
			"invoices",
			{ type: "invoice.finalized", data: { id: "inv_31x9a", total: 12000, due: "2026-11-01" } },
		],
		["users", { type: "user.created", data: { id: "usr_m4q7", plan: "pro", source: "signup" } }],
	];
	const before = received.length;
	for (const [path, body] of samples) {
		await fetch(`${webhookUrl.replace(/\/$/, "")}/webhook/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", "user-agent": "webhook-sender/1.0" },
			body: JSON.stringify(body),
		});
	}
	await until(
		() => received.length >= before + samples.length,
		60_000,
		"sample webhooks delivered",
	);
	const store = (page, name) =>
		page.screenshot({ path: join(SHOTS, `store-${name}.jpg`), type: "jpeg", quality: 92 });
	const dash = await ctx.newPage();
	await dash.setViewportSize({ width: 1280, height: 800 });
	await dash.goto("https://app.bridgehook.dev/dashboard/events");
	await dash.getByText("/webhook/orders").first().waitFor({ timeout: 30_000 });
	await dash.waitForTimeout(1000);
	await store(dash, "1-events");
	await dash.getByText("/webhook/orders").first().click();
	await dash.locator('button[aria-expanded="true"]').first().waitFor({ timeout: 30_000 });
	await dash.locator('button[aria-expanded="true"]').first().click(); // collapse request headers
	await dash.waitForTimeout(800);
	const shown = await dash.textContent("body");
	if (/cf-connecting-ip|\b\d{1,3}(\.\d{1,3}){3}\b/.test(shown ?? "")) {
		fail("event detail still shows an IP address; not saving the store screenshot");
	} else {
		await store(dash, "2-event-detail");
	}
	const popupPng = readFileSync(join(SHOTS, "8-after-backlog.png")).toString("base64");
	const card = await ctx.newPage();
	await card.setViewportSize({ width: 1280, height: 800 });
	await card.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;display:flex;align-items:center;justify-content:center;gap:72px;background:#05070d;font-family:system-ui,sans-serif;color:#e7ecf3">
		<div style="max-width:440px"><div style="font-size:44px;font-weight:700;line-height:1.15">A permanent webhook URL for every localhost port</div>
		<div style="margin-top:20px;font-size:20px;color:#9aa6b8;line-height:1.5">Webhooks reach your local server. Ones that arrive while you are away wait, then arrive in order.</div></div>
		<img src="data:image/png;base64,${popupPng}" style="width:400px;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.6);border:1px solid #1d2533"></body></html>`);
	await store(card, "3-popup");
	step("store screenshots saved (1280×800 JPEG)");
	console.log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
} catch (err) {
	fail(err.message);
	for (const p of ctx.pages())
		await p.screenshot({ path: join(SHOTS, `error-${Date.now()}.png`) }).catch(() => {});
	console.log("RESULT: FAIL");
} finally {
	await ctx.close().catch(() => {});
	server.close();
	await resetQaAccount("teardown").catch((e) => console.log(`teardown failed: ${e.message}`));
}
