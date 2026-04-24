/**
 * BridgeHook Extension Popup
 * Communicates with background.js to manage services and display status.
 */

const RELAY_URL = "https://bridgehook-relay.halleluyaholudele.workers.dev";

const servicesList = document.getElementById("services-list");
const emptyState = document.getElementById("empty");
const addSection = document.getElementById("add-section");
const btnShowAdd = document.getElementById("btn-show-add");
const btnCancel = document.getElementById("btn-cancel");
const btnAdd = document.getElementById("btn-add");
const btnDetect = document.getElementById("btn-detect");
const detectSection = document.getElementById("detect-section");
const detectScanning = document.getElementById("detect-scanning");
const detectResults = document.getElementById("detect-results");
const toast = document.getElementById("toast");

// ── Render ───────────────────────────────────────────────────────────

function renderServices(services) {
	if (!services || services.length === 0) {
		servicesList.innerHTML = "";
		emptyState.style.display = "block";
		return;
	}
	emptyState.style.display = "none";

	servicesList.innerHTML = services
		.map(
			(s) => `
    <div class="service" data-id="${s.id}">
      <div class="service-header">
        <div class="service-name">
          <span class="dot ${s.active ? s.status : "inactive"}"></span>
          ${escapeHtml(s.name)}
        </div>
        <div class="service-actions">
          <button class="btn btn-copy" data-action="copy" data-url="${escapeHtml(s.webhookUrl)}">Copy URL</button>
          <button class="btn ${s.active ? "btn-pause" : "btn-resume"}" data-action="toggle" data-id="${s.id}">
            ${s.active ? "Pause" : "Resume"}
          </button>
          <button class="btn btn-remove" data-action="remove" data-id="${s.id}">&#x2715;</button>
        </div>
      </div>
      <div class="service-meta">
        <span>localhost:${s.port}${escapeHtml(s.path)}</span>
      </div>
      <div class="url-row">
        <span class="url">${escapeHtml(s.webhookUrl)}</span>
      </div>
      ${s.error ? `<div class="error-msg">${escapeHtml(s.error)}</div>` : ""}
      <div class="stats">
        Events: ${s.eventCount || 0} &nbsp;&middot;&nbsp; Errors: ${s.errorCount || 0}
      </div>
    </div>
  `,
		)
		.join("");
}

function escapeHtml(str) {
	const div = document.createElement("div");
	div.textContent = str;
	return div.innerHTML;
}

function showToast(msg = "Copied!") {
	toast.textContent = msg;
	toast.classList.add("show");
	setTimeout(() => toast.classList.remove("show"), 1500);
}

// ── Load Status (only re-render when data changes) ──────────────────

let lastStatusJson = "";

async function loadStatus() {
	chrome.runtime.sendMessage({ type: "get_status" }, (response) => {
		if (response?.services) {
			const json = JSON.stringify(response.services);
			if (json !== lastStatusJson) {
				lastStatusJson = json;
				renderServices(response.services);
			}
		}
	});
}

// Listen for live status updates
chrome.runtime.onMessage.addListener((msg) => {
	if (msg.type === "status") {
		const json = JSON.stringify(msg.services);
		if (json !== lastStatusJson) {
			lastStatusJson = json;
			renderServices(msg.services);
		}
	}
});

// ── Auto-Detect Servers ──────────────────────────────────────────────

/** Currently bridged ports (to avoid duplicating in detect results) */
function getBridgedPorts() {
	const ports = new Set();
	for (const el of servicesList.querySelectorAll(".service-meta span")) {
		const match = el.textContent.match(/localhost:(\d+)/);
		if (match) ports.add(Number(match[1]));
	}
	return ports;
}

btnDetect.addEventListener("click", async () => {
	// Show scanning state
	detectSection.style.display = "block";
	detectScanning.style.display = "block";
	detectResults.style.display = "none";
	btnDetect.textContent = "Scanning...";
	btnDetect.disabled = true;

	chrome.runtime.sendMessage({ type: "scan_ports" }, (response) => {
		btnDetect.textContent = "Detect";
		btnDetect.disabled = false;
		detectScanning.style.display = "none";
		detectResults.style.display = "block";

		const ports = response?.ports || [];
		// Get currently bridged ports to show "Already bridged" vs "Bridge" button
		chrome.runtime.sendMessage({ type: "get_status" }, (statusResp) => {
			const bridgedPorts = new Set((statusResp?.services || []).map((s) => s.port));

			if (ports.length === 0) {
				detectResults.innerHTML =
					'<div class="detect-none">No local servers detected on common ports.</div>';
				return;
			}

			detectResults.innerHTML = ports
				.map((p) => {
					const alreadyBridged = bridgedPorts.has(p.port);
					const serverLabel = p.server ? ` <small>(${escapeHtml(p.server)})</small>` : "";
					return `
          <div class="detect-port">
            <div class="detect-port-info">
              <span class="dot"></span>
              <span class="detect-port-label">localhost:${p.port}${serverLabel}</span>
            </div>
            ${
							alreadyBridged
								? '<span style="font-size:11px;color:#22c55e;">Already bridged</span>'
								: `<button class="btn-bridge" data-port="${p.port}" data-server="${escapeHtml(p.server || "")}">Bridge it</button>`
						}
          </div>`;
				})
				.join("");
		});
	});
});

// Handle "Bridge it" clicks in detect results
detectResults.addEventListener("click", async (e) => {
	const btn = e.target.closest(".btn-bridge");
	if (!btn) return;

	const port = Number(btn.dataset.port);
	const server = btn.dataset.server || "";
	const name = server ? `${server.split("/")[0].toLowerCase()}-${port}` : `localhost-${port}`;

	btn.textContent = "Creating...";
	btn.disabled = true;

	chrome.runtime.sendMessage({ type: "add_service", name, port, path: "/" }, (response) => {
		if (response?.ok) {
			btn.textContent = "Bridged!";
			btn.style.background = "#059669";

			// Copy URL
			if (response.service?.webhookUrl) {
				navigator.clipboard.writeText(response.service.webhookUrl);
				showToast(`Bridged localhost:${port} — URL copied!`);
			}

			loadStatus();
		} else {
			btn.textContent = "Failed";
			btn.style.background = "#991b1b";
		}
	});
});

// ── Event Delegation (Service Cards) ─────────────────────────────────

servicesList.addEventListener("click", async (e) => {
	const btn = e.target.closest("button[data-action]");
	if (!btn) return;

	const action = btn.dataset.action;

	if (action === "copy") {
		await navigator.clipboard.writeText(btn.dataset.url);
		showToast("Copied!");
	}

	if (action === "toggle") {
		chrome.runtime.sendMessage({ type: "toggle_service", serviceId: btn.dataset.id }, () =>
			loadStatus(),
		);
	}

	if (action === "remove") {
		chrome.runtime.sendMessage({ type: "remove_service", serviceId: btn.dataset.id }, () =>
			loadStatus(),
		);
	}
});

// ── Add Service Form ─────────────────────────────────────────────────

btnShowAdd.addEventListener("click", () => {
	addSection.style.display = "block";
	btnShowAdd.style.display = "none";
	detectSection.style.display = "none";
	document.getElementById("f-name").focus();
});

btnCancel.addEventListener("click", () => {
	addSection.style.display = "none";
	btnShowAdd.style.display = "block";
});

btnAdd.addEventListener("click", async () => {
	const name = document.getElementById("f-name").value.trim();
	const port = Number.parseInt(document.getElementById("f-port").value, 10);
	const path = document.getElementById("f-path").value.trim() || "/webhook";

	if (!name) {
		document.getElementById("f-name").focus();
		return;
	}

	btnAdd.textContent = "Creating...";
	btnAdd.disabled = true;

	chrome.runtime.sendMessage({ type: "add_service", name, port, path }, (response) => {
		btnAdd.textContent = "Add Service";
		btnAdd.disabled = false;

		if (response?.ok) {
			// Reset form
			document.getElementById("f-name").value = "";
			document.getElementById("f-port").value = "3000";
			document.getElementById("f-path").value = "/webhook";
			addSection.style.display = "none";
			btnShowAdd.style.display = "block";

			// Copy URL to clipboard
			if (response.service?.webhookUrl) {
				navigator.clipboard.writeText(response.service.webhookUrl);
				showToast("Service added — URL copied!");
			}

			loadStatus();
		} else {
			showToast("Failed to create service");
		}
	});
});

// Allow Enter key to submit
document.getElementById("f-path").addEventListener("keydown", (e) => {
	if (e.key === "Enter") btnAdd.click();
});

// ── Init ─────────────────────────────────────────────────────────────

loadStatus();

// Refresh every 5 seconds as a fallback (broadcastStatus pushes updates in real-time)
setInterval(loadStatus, 5000);
