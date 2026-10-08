export function ChannelSecrets() {
	return (
		<>
			<h1>Channel Keys</h1>
			<p>
				Anyone can <em>send</em> to a webhook URL, which is the point of one. Only the forwarder
				that owns the channel can <em>read</em> its events, claim them and report answers. That
				ownership is an ECDSA P-256 key pair per channel.
			</p>

			<h2>How it works</h2>
			<ol>
				<li>
					When a forwarder (the extension or a dashboard tab) creates a channel, it generates a key
					pair with WebCrypto and sends only the public key to the relay.
				</li>
				<li>
					The private key is re-imported as <strong>non-extractable</strong> and kept in IndexedDB.
					Not even the page&apos;s own JavaScript can read its bytes back.
				</li>
				<li>Every channel request the forwarder makes is signed:</li>
			</ol>
			<pre>
				<code>{`message   = METHOD + "\\n" + PATH + "\\n" + TIMESTAMP + "\\n" + SHA256(body)
signature = ECDSA_P256_SHA256(privateKey, message)

X-BH-Timestamp: 1759900000000
X-BH-Signature: <128 hex chars, r || s>`}</code>
			</pre>
			<p>
				The relay verifies the signature against the stored public key and rejects a timestamp more
				than 60 seconds away from its clock, so a captured request cannot be replayed.
			</p>

			<h2>What is signed</h2>
			<table>
				<thead>
					<tr>
						<th>Request</th>
						<th>Why</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Reading events and the delivery queue</td>
						<td>Webhook bodies can carry customer data</td>
					</tr>
					<tr>
						<td>Claiming an event</td>
						<td>Decides which forwarder delivers it</td>
					</tr>
					<tr>
						<td>Reporting your server&apos;s answer</td>
						<td>In sync mode this answer is returned to the sender</td>
					</tr>
				</tbody>
			</table>

			<h2>Moving a channel to another forwarder</h2>
			<p>
				Your account owns the channel, so the URL for a port stays the same whichever forwarder you
				use. A forwarder that does not hold the key (a new browser profile, the extension adopting a
				channel your agent created) rotates in a fresh public key while signed in. The old
				forwarder&apos;s signatures stop verifying at that moment.
			</p>

			<h2>Where things live</h2>
			<table>
				<thead>
					<tr>
						<th>Where</th>
						<th>What</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Your browser (IndexedDB)</td>
						<td>Private key, non-extractable</td>
					</tr>
					<tr>
						<td>Relay (D1)</td>
						<td>Public key only</td>
					</tr>
				</tbody>
			</table>
		</>
	);
}
