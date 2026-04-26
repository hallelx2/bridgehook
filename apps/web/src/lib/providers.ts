/**
 * Integration presets surfaced in the empty state.
 *
 * Each preset gives the user a short, specific recipe for configuring
 * webhook delivery from that provider into their BridgeHook URL. The
 * goal is to collapse "open the docs, hunt for the webhook page" into
 * a single card.
 */

export interface Preset {
	id: string;
	name: string;
	/** Short verb-first blurb for the card */
	blurb: string;
	/** Concrete steps the user should take in the provider's dashboard */
	steps: string[];
	/** Recommended events to subscribe to — strings the user can copy */
	events: string[];
	/** External docs link */
	docsUrl: string;
	/** Short accent color hex used on the card */
	accent: string;
}

export const PRESETS: Preset[] = [
	{
		id: "stripe",
		name: "Stripe",
		blurb: "Checkout, payment, and subscription events.",
		steps: [
			"Open Stripe → Developers → Webhooks",
			"Click “Add endpoint”, paste the webhook URL",
			"Select the events below and save",
			"Copy the signing secret to Settings → Secrets",
		],
		events: [
			"checkout.session.completed",
			"payment_intent.succeeded",
			"invoice.payment_failed",
			"customer.subscription.created",
		],
		docsUrl: "https://stripe.com/docs/webhooks",
		accent: "#635bff",
	},
	{
		id: "github",
		name: "GitHub",
		blurb: "Push, pull-request, and release events.",
		steps: [
			"Repo → Settings → Webhooks → Add webhook",
			"Paste the webhook URL, content type JSON",
			"Pick “Send me everything” or specific events",
			"Paste the secret into BridgeHook Secrets",
		],
		events: ["push", "pull_request", "release", "issues"],
		docsUrl: "https://docs.github.com/en/webhooks",
		accent: "#8b949e",
	},
	{
		id: "shopify",
		name: "Shopify",
		blurb: "Order, product, and customer lifecycle.",
		steps: [
			"Admin → Settings → Notifications → Webhooks",
			"Create a webhook, point it at the URL",
			"Use JSON format, API version 2024-04+",
		],
		events: ["orders/create", "orders/paid", "products/update", "customers/create"],
		docsUrl: "https://shopify.dev/docs/apps/webhooks",
		accent: "#95bf47",
	},
	{
		id: "clerk",
		name: "Clerk",
		blurb: "User sign-ups, sign-ins, and org changes.",
		steps: [
			"Clerk dashboard → Webhooks → Add endpoint",
			"Paste the URL, pick `user.*` events",
			"Copy the signing secret into Secrets",
		],
		events: ["user.created", "user.updated", "session.created", "organization.created"],
		docsUrl: "https://clerk.com/docs/integrations/webhooks/overview",
		accent: "#6c47ff",
	},
	{
		id: "linear",
		name: "Linear",
		blurb: "Issue, comment, and project updates.",
		steps: [
			"Workspace → Settings → API → Webhooks",
			"New webhook, paste the URL",
			"Select resource types: Issues, Comments",
		],
		events: ["Issue", "Comment", "Project", "Cycle"],
		docsUrl: "https://developers.linear.app/docs/graphql/webhooks",
		accent: "#5e6ad2",
	},
	{
		id: "slack",
		name: "Slack",
		blurb: "Events API + interactive components.",
		steps: [
			"api.slack.com → Your app → Event Subscriptions",
			"Enable events, paste the URL",
			"Add the bot-event scopes you need",
		],
		events: ["message.channels", "app_mention", "team_join", "reaction_added"],
		docsUrl: "https://api.slack.com/apis/events-api",
		accent: "#4a154b",
	},
];
