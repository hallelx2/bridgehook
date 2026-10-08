export function PathAllowlist() {
	return (
		<>
			<h1>Path Allowlist</h1>
			<p>
				A webhook URL is public, so anyone can send to any path under it. The allowlist decides
				which of those paths may reach your server.
			</p>

			<h2>Rules</h2>
			<pre>
				<code>{`Allowed paths: /api/webhooks

  ✓  /api/webhooks             exact match
  ✓  /api/webhooks/stripe      below an allowed path
  ✗  /api/webhooks-old         a prefix of the name is not enough
  ✗  /admin                    403, never stored or forwarded`}</code>
			</pre>
			<ul>
				<li>
					An empty list, or <code>/</code>, allows every path.
				</li>
				<li>A trailing slash on an entry is ignored.</li>
				<li>
					The extension asks for one path prefix per port (default <code>/webhook</code>); the
					dashboard&apos;s browser bridge takes several, one per line. Channels an agent creates
					allow every path.
				</li>
			</ul>

			<h2>Enforcement</h2>
			<p>
				The relay checks the path on arrival. A request outside the list gets{" "}
				<code>403 Path not allowed for this channel</code> and is not stored, queued or forwarded,
				so a probe for <code>/admin</code> never reaches your machine and never counts against your
				daily event cap.
			</p>
			<p>
				Matching uses the path alone, everything after the host. The query string is not part of the
				match but is forwarded with the request, so <code>?token=…</code> reaches your server
				intact.
			</p>

			<h2>Changing it</h2>
			<p>
				Send <code>PATCH /api/me/channels/:id</code> with <code>{`{ "allowedPaths": [...] }`}</code>{" "}
				while signed in. Paths are validated, and an invalid list is rejected with <code>400</code>.
			</p>
		</>
	);
}
