/**
 * Device pairing: poll POST /auth/device/exchange until the user approves the
 * code in the dashboard.
 *
 *   202  pending: poll again after the interval
 *   200  approved: return the minted device ({ token, deviceId, userId, ... })
 *   410  code expired or already used: stop
 *   429  rate limited (the relay limits exchanges per IP, so several people
 *        pairing behind one office IP can hit it): wait Retry-After, keep going
 *   5xx or network error: back off and retry; the relay keeps an approved
 *        code when minting fails, so a later poll can still succeed
 *   other 4xx: stop with the relay's message
 *
 * fetch, sleep and the clock are injectable for tests (pairing.test.mjs).
 */

const MAX_WAIT_MS = 60_000;

export async function pollDeviceExchange({
	relayUrl,
	deviceCode,
	intervalMs,
	deadline,
	fetchImpl = fetch,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now = Date.now,
}) {
	let waitMs = intervalMs;
	let failures = 0;
	while (now() < deadline) {
		await sleep(Math.min(waitMs, Math.max(0, deadline - now())));
		if (now() >= deadline) break;
		waitMs = intervalMs;

		let res;
		try {
			res = await fetchImpl(`${relayUrl}/auth/device/exchange`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code: deviceCode }),
			});
		} catch {
			failures++;
			waitMs = Math.min(intervalMs * 2 ** failures, MAX_WAIT_MS);
			continue;
		}

		if (res.status === 202) {
			failures = 0;
			continue;
		}
		if (res.status === 410) throw new Error("Pairing code expired or already used");
		if (res.status === 429) {
			const retryAfter = Number(res.headers.get("retry-after"));
			waitMs =
				Number.isFinite(retryAfter) && retryAfter > 0
					? Math.min(retryAfter * 1000, MAX_WAIT_MS)
					: MAX_WAIT_MS;
			continue;
		}
		if (res.status >= 500) {
			failures++;
			waitMs = Math.min(intervalMs * 2 ** failures, MAX_WAIT_MS);
			continue;
		}
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`Device exchange failed (${res.status})${text ? `: ${text}` : ""}`);
		}
		return res.json();
	}
	throw new Error("Pairing timed out. Try again.");
}
