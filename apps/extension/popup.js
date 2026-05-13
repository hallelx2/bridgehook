/**
 * BridgeHook Extension Popup
 *
 * Thin UI layer over background.js. Responsibilities:
 *   - Show the current identity (signed-in via dashboard / paired device / anonymous)
 *   - Today's usage chip (X/Y from /api/me)
 *   - Service cards with status pills (connected / disconnected / limit / error)
 *   - Sign-in handoff: opens dashboard /login or /login?signup=1 in a new tab.
 *     When the user signs in there, the relay's SameSite=None session
 *     cookie is set on workers.dev — our background fetches pick it up on
 *     the next refresh (heartbeat alarm or this popup opening).
 */

const RELAY_URL = "https://bridgehook-relay.halleluyaholudele.workers.dev";

const $ = (id) => document.getElementById(id);

const identityEl = $("identity");
const signinCard = $("signin-card");
const usageEl = $("usage");
const usageUsed = $("usage-used");
const usageCap = $("usage-cap");
const usageBarFill = $("usage-bar-fill");
const empty = $("empty");
const servicesList = $("services-list");
const addSection = $("add-section");
const detectSection = $("detect-section");
const detectScanning = $("detect-scanning");
const detectResults = $("detect-results");
const toast = $("toast");

// ── Render: identity + usage ─────────────────────────────────────

function renderAccount(account) {
	if (!account || account.source === null) {
		identityEl.innerHTML = `
			<span class="who">
				<span class="avatar" style="background:linear-gradient(135deg,#3f3f46,#52525b);">?</span>
				<span style="color:var(--text-fade);">Not signed in</span>
			</span>
		`;
		signinCard.style.display = "block";
		usageEl.style.display = "none";
		return;
	}

	// Signed-in shape (session or device)
	const email = account.user?.email || account.user?.name || "Signed in";
	const initial = (email[0] || "?").toUpperCase();
	const sourceLabel = account.source === "session" ? "Web session" : "Paired device";

	identityEl.innerHTML = `
		<span class="who">
			<span class="avatar">${escapeHtml(initial)}</span>
			<span class="email">${escapeHtml(email)}</span>
		</span>
		<span class="source-chip" title="${escapeHtml(account.source === "session" ? "Using the bridgehook.dev session cookie" : "Paired with a device token")}">${escapeHtml(sourceLabel)}</span>
	`;
	signinCard.style.display = "none";

	// Usage chip: only show when there's a finite daily cap
	if (typeof account.eventsPerDay === "number" && account.eventsPerDay > 0) {
		usageEl.style.display = "flex";
		const used = Math.max(0, Number(account.eventsToday) || 0);
		const cap = Number(account.eventsPerDay);
		usageUsed.textContent = String(used);
		usageCap.textContent = ` / ${cap}`;
		const pct = Math.min(100, (used / cap) * 100);
		usageBarFill.style.width = `${pct}%`;
		usageBarFill.classList.toggle("warn", used >= cap);
	} else {
		// Unlimited (selfhost / paid) — hide the chip rather than show "/ ∞"
		usageEl.style.display = "none";
	}
}

// ── Render: services ─────────────────────────────────────────────

function renderServices(services) {
	if (!services || services.length === 0) {
		servicesList.innerHTML = "";
		empty.style.display = "block";
		return;
	}
	empty.style.display = "none";

	servicesList.innerHTML = services
		.map((s) => {
			const statusLabel =
				s.status === "limit"
					? "Daily cap"
					: s.status === "connected"
						? "Connected"
						: s.status === "error"
							? "Error"
							: s.active
								? "Connecting"
								: "Paused";
			const statusClass = !s.active ? "disconnected" : s.status;
			return `
		<div class="service" data-id="${s.id}">
			<div class="service-header">
				<div class="service-name">
					<span class="name">${escapeHtml(s.name)}</span>
					<span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span>
				</div>
				<div class="service-actions">
					<button class="btn btn-copy" data-action="copy" data-url="${escapeHtml(s.webhookUrl)}">Copy URL</button>
					<button class="btn ${s.active ? "btn-pause" : "btn-resume"}" data-action="toggle" data-id="${s.id}">${s.active ? "Pause" : "Resume"}</button>
					<button class="btn btn-remove" data-action="remove" data-id="${s.id}" title="Remove bridge">&times;</button>
				</div>
			</div>
			<div class="service-meta">localhost:${s.port}${escapeHtml(s.path)}</div>
			<div class="url-row"><span class="url" title="${escapeHtml(s.webhookUrl)}">${escapeHtml(s.webhookUrl)}</span></div>
			${s.status === "limit" && s.error ? `<div class="limit-msg">${escapeHtml(s.error)}</div>` : ""}
			${s.status === "error" && s.error ? `<div class="err-msg">${escapeHtml(s.error)}</div>` : ""}
			<div class="stats">
				<span class="stat">↗ ${s.eventCount || 0} events</span>
				<span class="stat ${s.errorCount ? "err" : ""}">⚠ ${s.errorCount || 0} errors</span>
			</div>
		</div>
		`;
		})
		.join("");
}

function escapeHtml(str) {
	const div = document.createElement("div");
	div.textContent = String(str ?? "");
	return div.innerHTML;
}

function showToast(msg = "Copied!") {
	toast.textContent = msg;
	toast.classList.add("show");
	setTimeout(() => toast.classList.remove("show"), 1500);
}

// ── Status fetch + cache ─────────────────────────────────────────

let lastServicesJson = "";
let lastAccountJson = "";

function applyStatus(payload) {
	if (!payload) return;
	if (Array.isArray(payload.services)) {
		const j = JSON.stringify(payload.services);
		if (j !== lastServicesJson) {
			lastServicesJson = j;
			renderServices(payload.services);
		}
	}
	if (payload.account) {
		const j = JSON.stringify(payload.account);
		if (j !== lastAccountJson) {
			lastAccountJson = j;
			renderAccount(payload.account);
		}
	}
}

function loadStatus() {
	chrome.runtime.sendMessage({ type: "get_status" }, (resp) => applyStatus(resp));
}

function refreshAccount() {
	chrome.runtime.sendMessage({ type: "refresh_account" }, (resp) => applyStatus(resp));
}

chrome.runtime.onMessage.addListener((msg) => {
	if (msg.type === "status") applyStatus(msg);
});

// ── Header actions ───────────────────────────────────────────────

$("btn-dashboard").addEventListener("click", () => {
	chrome.runtime.sendMessage({ type: "open_dashboard" });
});

// ── Sign-in card ─────────────────────────────────────────────────

$("btn-signin").addEventListener("click", () => {
	chrome.runtime.sendMessage({ type: "open_login" });
});

$("btn-signup").addEventListener("click", () => {
	chrome.runtime.sendMessage({ type: "open_signup" });
});

$("btn-pair-device").addEventListener("click", () => {
	const btn = $("btn-pair-device");
	btn.textContent = "Waiting for approval…";
	btn.disabled = true;
	chrome.runtime.sendMessage({ type: "connect_device" }, (resp) => {
		if (resp?.ok) {
			showToast("Paired!");
			refreshAccount();
		} else {
			showToast(resp?.error || "Pairing failed");
		}
		btn.textContent = "Or pair this device with a code →";
		btn.disabled = false;
	});
});

// ── Service card actions ─────────────────────────────────────────

servicesList.addEventListener("click", async (e) => {
	const btn = e.target.closest("button[data-action]");
	if (!btn) return;
	const action = btn.dataset.action;
	if (action === "copy") {
		await navigator.clipboard.writeText(btn.dataset.url);
		showToast("Copied!");
		return;
	}
	if (action === "toggle") {
		chrome.runtime.sendMessage({ type: "toggle_service", serviceId: btn.dataset.id }, loadStatus);
		return;
	}
	if (action === "remove") {
		chrome.runtime.sendMessage({ type: "remove_service", serviceId: btn.dataset.id }, loadStatus);
	}
});

// ── Detect ────────────────────────────────────────────────────────

$("btn-detect").addEventListener("click", () => {
	detectSection.style.display = "block";
	addSection.style.display = "none";
	detectScanning.style.display = "block";
	detectResults.innerHTML = "";
	const btn = $("btn-detect");
	btn.textContent = "Scanning…";
	btn.disabled = true;

	chrome.runtime.sendMessage({ type: "scan_ports" }, (resp) => {
		btn.textContent = "⚡ Detect";
		btn.disabled = false;
		detectScanning.style.display = "none";

		const ports = resp?.ports || [];
		chrome.runtime.sendMessage({ type: "get_status" }, (status) => {
			const bridged = new Set((status?.services || []).map((s) => s.port));
			if (ports.length === 0) {
				detectResults.innerHTML = `<div class="detect-none">No local servers detected on common ports.</div>`;
				return;
			}
			detectResults.innerHTML = ports
				.map((p) => {
					const already = bridged.has(p.port);
					const serverLabel = p.server ? ` <small>(${escapeHtml(p.server)})</small>` : "";
					return `
				<div class="detect-port">
					<div class="detect-port-info">
						<span class="dot"></span>
						<span class="detect-port-label">localhost:${p.port}${serverLabel}</span>
					</div>
					${
						already
							? `<span style="font-size:10px;color:var(--ok);font-weight:600;">Already bridged</span>`
							: `<button class="btn-bridge" data-port="${p.port}" data-server="${escapeHtml(p.server || "")}">Bridge it</button>`
					}
				</div>`;
				})
				.join("");
		});
	});
});

detectResults.addEventListener("click", async (e) => {
	const btn = e.target.closest(".btn-bridge");
	if (!btn) return;
	const port = Number(btn.dataset.port);
	const server = btn.dataset.server || "";
	const name = server ? `${server.split("/")[0].toLowerCase()}-${port}` : `localhost-${port}`;

	btn.textContent = "Creating…";
	btn.disabled = true;

	chrome.runtime.sendMessage({ type: "add_service", name, port, path: "/" }, (resp) => {
		if (resp?.ok) {
			btn.textContent = "Bridged!";
			btn.style.background = "var(--ok)";
			if (resp.service?.webhookUrl) {
				navigator.clipboard.writeText(resp.service.webhookUrl);
				showToast(`Bridged localhost:${port} — URL copied!`);
			}
			loadStatus();
		} else {
			btn.textContent = "Failed";
			btn.style.background = "var(--error)";
			showToast(resp?.error || "Could not create channel");
		}
	});
});

// ── Add form ─────────────────────────────────────────────────────

$("btn-show-add").addEventListener("click", () => {
	addSection.style.display = "block";
	detectSection.style.display = "none";
	$("f-name").focus();
});

$("btn-cancel").addEventListener("click", () => {
	addSection.style.display = "none";
});

$("btn-add").addEventListener("click", () => {
	const name = $("f-name").value.trim();
	const port = Number.parseInt($("f-port").value, 10);
	const path = $("f-path").value.trim() || "/webhook";
	if (!name) {
		$("f-name").focus();
		return;
	}
	const btn = $("btn-add");
	btn.textContent = "Creating…";
	btn.disabled = true;
	chrome.runtime.sendMessage({ type: "add_service", name, port, path }, (resp) => {
		btn.textContent = "Add bridge";
		btn.disabled = false;
		if (resp?.ok) {
			$("f-name").value = "";
			$("f-port").value = "3000";
			$("f-path").value = "/webhook";
			addSection.style.display = "none";
			if (resp.service?.webhookUrl) {
				navigator.clipboard.writeText(resp.service.webhookUrl);
				showToast("Service added — URL copied!");
			}
			loadStatus();
		} else {
			showToast(resp?.error || "Could not create channel");
		}
	});
});

$("f-path").addEventListener("keydown", (e) => {
	if (e.key === "Enter") $("btn-add").click();
});

// ── Init ─────────────────────────────────────────────────────────

loadStatus();
refreshAccount();

// Light periodic refresh — background broadcasts live status pushes, but
// account state (signed-in via dashboard) refreshes only on alarm ticks.
// Re-probe from the popup every 15s while it's open so a fresh dashboard
// sign-in shows up without manual reload.
setInterval(refreshAccount, 15_000);
setInterval(loadStatus, 5_000);
