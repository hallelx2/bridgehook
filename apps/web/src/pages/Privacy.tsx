/**
 * Public /privacy page. Linked from the footer and supplied as the
 * required Privacy Policy URL on the Chrome Web Store listing.
 *
 * Plain English by design — reviewers (and users) read these.
 */
import { Footer } from "../components/Footer";
import { Nav } from "../components/Nav";

const LAST_UPDATED = "May 27, 2026";
const CONTACT_EMAIL = "hachiagoholdings@gmail.com";

export function Privacy() {
	return (
		<>
			<Nav />
			<main className="bg-background text-on-surface min-h-screen">
				<div className="max-w-3xl mx-auto px-6 py-24">
					<h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">Privacy Policy</h1>
					<p className="text-on-surface-muted text-xs font-bold tracking-[0.2em] uppercase mb-12">
						Last updated · {LAST_UPDATED}
					</p>

					<Section title="What BridgeHook does">
						<p>
							BridgeHook is a webhook-relay service. You point an external provider (Stripe,
							Paystack, GitHub, etc.) at a unique URL we give you; we receive the webhook on our
							servers and forward it to a local development server on your own machine through our
							browser extension or desktop app.
						</p>
					</Section>

					<Section title="What we collect">
						<p>We keep the smallest amount of data needed to run the service:</p>
						<ul className="list-disc pl-6 space-y-2 mt-3">
							<li>
								<strong>Account data</strong> — email address, display name, and a salted hash of
								your password. We do not see your password in plain text.
							</li>
							<li>
								<strong>Webhook payloads</strong> — the HTTP method, path, headers, and body of each
								webhook delivered to your channels, plus the response your local server returned.
								This is the core data the product operates on.
							</li>
							<li>
								<strong>Channel + device metadata</strong> — the local port you bridge, an optional
								label you give a channel, and the user-agent / OS of any device (extension, desktop,
								CLI) you sign in from.
							</li>
							<li>
								<strong>Session cookies</strong> — a single first-party cookie set by our
								authentication layer so you stay signed in.
							</li>
						</ul>
						<p className="mt-3">
							We do not run third-party analytics, ad trackers, fingerprinting libraries, or session
							replay. The extension does not read any web page you visit; its only host permissions
							are <code className="text-primary">localhost</code> (to forward webhooks to your dev
							server) and the BridgeHook relay (to fetch incoming events).
						</p>
					</Section>

					<Section title="How we use it">
						<ul className="list-disc pl-6 space-y-2">
							<li>To deliver webhooks from the public internet to your local machine.</li>
							<li>To show you a dashboard of events received, with replay and inspection.</li>
							<li>To authenticate you and enforce the limits of your plan.</li>
							<li>
								To send transactional email (password reset, billing receipts) — only when you take
								an action that requires it.
							</li>
						</ul>
						<p className="mt-3">
							We do not sell, rent, or share your data with advertisers, data brokers, or
							third-party marketers.
						</p>
					</Section>

					<Section title="Who we share it with">
						<p>
							We use the following subprocessors strictly to run the service. They process data on
							our behalf and are bound by their own data-protection terms:
						</p>
						<ul className="list-disc pl-6 space-y-2 mt-3">
							<li>
								<strong>Cloudflare</strong> — hosts the relay (Workers) and the dashboard (Pages).
							</li>
							<li>
								<strong>Neon</strong> — Postgres database where account and event data is stored.
							</li>
							<li>
								<strong>Polar</strong> — payment processor for paid plans, if and when you check
								out. Free-tier users never reach Polar.
							</li>
						</ul>
					</Section>

					<Section title="How long we keep it">
						<p>
							Webhook event bodies are retained according to your plan tier (free plans currently
							retain events for a limited number of days; self-hosted instances have no expiry).
							Account data is retained for as long as your account exists. When you delete your
							account we delete your account row, your channels, and all events on those channels
							within 30 days.
						</p>
					</Section>

					<Section title="Your rights">
						<ul className="list-disc pl-6 space-y-2">
							<li>
								You can delete any channel at any time from the dashboard — this also deletes every
								event ever received on that channel.
							</li>
							<li>You can revoke any paired device at any time.</li>
							<li>
								You can request export or deletion of all data we hold about you by emailing{" "}
								<a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">
									{CONTACT_EMAIL}
								</a>
								. We respond within 30 days.
							</li>
						</ul>
					</Section>

					<Section title="Children">
						<p>
							BridgeHook is a developer tool. We don't direct it at children under 13 and don't
							knowingly collect data from them.
						</p>
					</Section>

					<Section title="Changes to this policy">
						<p>
							If we materially change what we collect or how we use it, we'll update the date at the
							top of this page and notify active users by email.
						</p>
					</Section>

					<Section title="Contact">
						<p>
							Questions, requests, or concerns:{" "}
							<a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">
								{CONTACT_EMAIL}
							</a>
							.
						</p>
					</Section>
				</div>
			</main>
			<Footer />
		</>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="mb-12">
			<h2 className="text-xl font-bold mb-4 text-on-surface">{title}</h2>
			<div className="text-on-surface-variant text-sm leading-relaxed space-y-1">{children}</div>
		</section>
	);
}
