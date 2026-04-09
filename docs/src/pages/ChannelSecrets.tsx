export function ChannelSecrets() {
	return (
		<>
			<h1>Channel Secrets</h1>
			<p>Each channel has a cryptographic secret that authenticates the browser that created it.</p>

			<h2>How It Works</h2>
			<pre>
				<code>{`// Client-side (your browser):
const secret = crypto.randomUUID();           // "f47ac10b-58cc-4372..."
const hash = await sha256(secret);            // "a1b2c3d4..."

// Sent to relay:
POST /api/channels { secretHash: "a1b2c3d4..." }

// Relay stores only the hash — never sees the raw secret
// Browser stores raw secret in localStorage`}</code>
			</pre>

			<h2>What the Secret Protects</h2>
			<p>
				The secret is used to prove ownership of a channel. In the current implementation, the
				channel ID itself serves as the primary routing key — the secret adds an additional layer
				for future features like channel recovery and team sharing.
			</p>

			<h2>Storage</h2>
			<table>
				<thead>
					<tr>
						<th>Where</th>
						<th>What's Stored</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Your browser (localStorage)</td>
						<td>Raw secret</td>
					</tr>
					<tr>
						<td>Relay server (Neon DB)</td>
						<td>SHA-256 hash only</td>
					</tr>
				</tbody>
			</table>
			<p>
				If the relay database is compromised, the attacker gets hashes — not secrets. They cannot
				impersonate your browser.
			</p>
		</>
	);
}
