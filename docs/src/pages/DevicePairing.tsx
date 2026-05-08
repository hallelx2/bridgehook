import { Callout } from "../components/Illustrations";

export function DevicePairing() {
	return (
		<>
			<h1>Device Pairing</h1>
			<p>
				The browser tab is a perfectly good executor for casual webhook testing — but it has to stay
				open. For longer-running flows BridgeHook ships an extension and a desktop tray app that
				pair to your account once and forward webhooks as long as they're running. The pairing flow
				is OAuth's "device authorization grant" pattern, adapted for our shape.
			</p>

			<Callout icon="🔌" title="Why a paired device?" color="#9093ff">
				A device token survives across browser sessions. Close the dashboard tab — the extension
				keeps forwarding. Reboot — the extension reconnects. Hand a co-worker access to a shared
				channel — pair their machine, revoke when they leave. Sessions and per-device tokens are
				orthogonal axes of "who is this connection."
			</Callout>

			<h2>Flow</h2>
			<ol>
				<li>
					Extension calls <code>POST /auth/device/start</code> with its kind (<code>extension</code>
					, <code>desktop</code>, <code>cli</code>, <code>web</code>) and an optional label hint.
				</li>
				<li>
					Relay generates a human-typeable code like <code>DV-A4F2-9KX7</code> (alphabet excludes
					0/O/1/I), stores a pending row with a 15-minute TTL, and returns:
					<pre>
						<code>{`{
  "deviceCode": "DV-A4F2-9KX7",
  "verificationUrl": "https://app.example.com/connect?code=DV-A4F2-9KX7",
  "pollInterval": 5,
  "expiresIn": 900
}`}</code>
					</pre>
				</li>
				<li>
					Extension opens <code>verificationUrl</code> in a new browser tab. The user signs in (if
					not already), reviews the device label, and clicks Approve.
				</li>
				<li>
					Web client calls <code>POST /auth/device/approve {"{ code }"}</code> with the session
					cookie. The relay validates the code, runs the plan/quota gate (device cap), and flips the
					row to <code>approved</code>.
				</li>
				<li>
					Extension is polling <code>POST /auth/device/exchange {"{ code }"}</code> every{" "}
					<code>pollInterval</code> seconds. Once the row is approved it returns:
					<pre>
						<code>{`{
  "token": "dvc_<32 hex>",
  "deviceId": "dev_<20 alphanum>",
  "userId": "usr_<20 alphanum>",
  "label": "Halleluyah's MacBook",
  "kind": "extension"
}`}</code>
					</pre>
				</li>
				<li>
					The relay re-checks quotas at exchange time (the user might have hit their cap between
					approve and exchange in a parallel tab) and consumes the code so it can't be used again.
				</li>
			</ol>

			<h2>What the device persists</h2>
			<p>
				The token is shown to the device <strong>exactly once</strong>, in the exchange response.
				Only its SHA-256 hash hits the database (<code>devices.token_hash</code>, with a unique
				index on non-revoked rows). The device stores the plaintext locally — typically:
			</p>
			<ul>
				<li>
					Browser extension → <code>chrome.storage.local</code>
				</li>
				<li>
					Desktop tray → OS keychain (macOS Keychain, Windows Credential Manager, libsecret on
					Linux)
				</li>
				<li>
					CLI → <code>~/.config/bridgehook/token</code> (mode 0600)
				</li>
			</ul>
			<p>
				Subsequent requests carry <code>Authorization: Bearer dvc_…</code>. The relay hashes and
				looks it up — at most one row matches.
			</p>

			<h2>Revoking</h2>
			<p>
				Two paths. From the dashboard, <code>/dashboard/devices</code> shows every non-revoked row;
				clicking <strong>Revoke</strong> calls <code>DELETE /api/me/devices/:id</code> which sets{" "}
				<code>revoked_at = now()</code>. The unique index on <code>token_hash</code> filters by{" "}
				<code>WHERE revoked_at IS NULL</code> so revoked rows immediately stop authenticating
				without an audit-trail-destroying delete.
			</p>
			<p>
				From a device, calling <code>POST /auth/sign-out</code> with the bearer token revokes that
				device's row directly.
			</p>

			<h2>Quota interaction</h2>
			<p>
				The device cap is per-plan: 2 on Hobby/Trial, unlimited on Pro/Team/Selfhost. The cap counts
				only non-revoked rows. Hitting the cap returns <code>402 Payment Required</code> with{" "}
				<code>{'{"code":"quota","error":"Device quota reached..."}'}</code> — the dashboard surfaces
				this on the Approve action.
			</p>

			<Callout icon="🧹" title="Cron sweep" color="#28c840">
				Pending device codes expire after 15 minutes. The hourly cron deletes any{" "}
				<code>device_codes</code> rows past <code>expires_at</code>; the same cron also runs the
				per-plan event retention sweep. Both run only when <code>BETTER_AUTH_SECRET</code> is set —
				self-host instances skip both branches.
			</Callout>

			<h2>Self-host mode</h2>
			<p>
				Device pairing requires auth. When <code>BETTER_AUTH_SECRET</code> is unset every route
				under <code>/auth/device/*</code> returns 404. Self-hosters who want multiple executors
				should either run BridgeHook in hosted shape (just set the secret) or rely on the
				per-channel ECDSA scheme — every executor that has the channel id and the IDB-stored private
				key can already forward.
			</p>
		</>
	);
}
