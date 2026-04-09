export function PathAllowlist() {
	return (
		<>
			<h1>Path Allowlist</h1>
			<p>
				The path allowlist is a client-side security feature that restricts which localhost endpoints the bridge can forward to.
			</p>

			<h2>How It Works</h2>
			<p>
				When you start a bridge, you specify allowed paths:
			</p>
			<pre><code>{`Allowed:
  ✓  /webhook/stripe
  ✓  /webhook/github

Blocked (never forwarded):
  ✗  /admin
  ✗  /api/users
  ✗  /api/delete-everything
  ✗  /`}</code></pre>

			<h2>Enforcement</h2>
			<p>
				Path filtering happens <strong>in your browser</strong>, not on the relay. Even if someone crafts a webhook targeting <code>/admin</code>, the browser simply drops it:
			</p>
			<pre><code>{`source.onmessage = async (event) => {
  const webhook = JSON.parse(event.data);

  // Security check — runs in YOUR browser
  if (!allowedPaths.some(p => webhook.path.startsWith(p))) {
    // Silently drop — never reaches localhost
    return;
  }

  // Only allowed paths reach here
  await fetch(\`http://localhost:\${port}\${webhook.path}\`, { ... });
};`}</code></pre>

			<h2>Why Client-Side?</h2>
			<p>
				Because the browser is the gatekeeper. The relay server doesn't know or care about your allowed paths — it just delivers events. Your browser makes the decision about what to forward. This means even a compromised relay can't force your browser to call endpoints you haven't allowed.
			</p>
		</>
	);
}
