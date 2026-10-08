import { Check, ChevronDown, Copy, PlugZap, ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { LocalhostState } from "../../lib/drain";

interface LocalhostBannerProps {
	state: LocalhostState;
	message: string | null;
	port: number | null;
	/** Events waiting in the relay queue for this tab to deliver. */
	queued: number;
}

/**
 * What a dashboard-only user needs to know about their local server: it is
 * down (webhooks wait in the queue and go out in order once it is back), or it
 * is up but does not let this page read its responses (CORS), with the line
 * to add for their framework.
 */
export function LocalhostBanner({ state, message, port, queued }: LocalhostBannerProps) {
	if (state === "ok") return null;
	const queuedText =
		queued > 0 ? `${queued} webhook${queued === 1 ? "" : "s"} queued` : "Webhooks will queue";

	if (state === "down") {
		return (
			<output className="flex items-center gap-2 px-5 py-2 bg-warning/10 border-b border-warning/20 text-[12px] text-warning font-medium">
				<PlugZap size={13} strokeWidth={2} />
				<span>
					{message ?? `Can't reach localhost:${port}.`} {queuedText}; they go out in order once it
					answers.
				</span>
			</output>
		);
	}

	return <CorsGuide message={message} queuedText={queuedText} />;
}

const ORIGIN = typeof location === "undefined" ? "https://app.bridgehook.dev" : location.origin;

const SNIPPETS: { id: string; label: string; code: string }[] = [
	{
		id: "express",
		label: "Express",
		code: `import cors from "cors";\napp.use(cors({ origin: "${ORIGIN}" }));`,
	},
	{
		id: "hono",
		label: "Hono",
		code: `import { cors } from "hono/cors";\napp.use("*", cors({ origin: "${ORIGIN}" }));`,
	},
	{
		id: "next",
		label: "Next.js",
		code: `// next.config.js\nheaders: async () => [{\n  source: "/api/:path*",\n  headers: [\n    { key: "Access-Control-Allow-Origin", value: "${ORIGIN}" },\n    { key: "Access-Control-Allow-Methods", value: "*" },\n    { key: "Access-Control-Allow-Headers", value: "*" },\n  ],\n}],`,
	},
	{
		id: "fastapi",
		label: "FastAPI",
		code: `from fastapi.middleware.cors import CORSMiddleware\napp.add_middleware(CORSMiddleware, allow_origins=["${ORIGIN}"],\n                   allow_methods=["*"], allow_headers=["*"])`,
	},
	{
		id: "flask",
		label: "Flask",
		code: `from flask_cors import CORS\nCORS(app, origins=["${ORIGIN}"])`,
	},
	{
		id: "django",
		label: "Django",
		code: `# pip install django-cors-headers; add "corsheaders" to INSTALLED_APPS\n# and "corsheaders.middleware.CorsMiddleware" first in MIDDLEWARE\nCORS_ALLOWED_ORIGINS = ["${ORIGIN}"]\nCORS_ALLOW_HEADERS = ["*"]`,
	},
	{
		id: "rails",
		label: "Rails",
		code: `# Gemfile: gem "rack-cors"\nconfig.middleware.insert_before 0, Rack::Cors do\n  allow { origins "${ORIGIN}"; resource "*", headers: :any, methods: :any }\nend`,
	},
	{
		id: "go",
		label: "Go",
		code: `w.Header().Set("Access-Control-Allow-Origin", "${ORIGIN}")\nw.Header().Set("Access-Control-Allow-Methods", "*")\nw.Header().Set("Access-Control-Allow-Headers", "*")\nif r.Method == http.MethodOptions { w.WriteHeader(204); return }`,
	},
];

function CorsGuide({ message, queuedText }: { message: string | null; queuedText: string }) {
	const [open, setOpen] = useState(true);
	const [tab, setTab] = useState(SNIPPETS[0].id);
	const [copied, setCopied] = useState(false);
	const snippet = SNIPPETS.find((s) => s.id === tab) ?? SNIPPETS[0];

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(snippet.code);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard can be refused; the code stays selectable.
		}
	};

	return (
		<output className="block border-b border-warning/20 bg-warning/10 text-[12px]">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-5 py-2 text-left text-warning font-medium"
			>
				<ShieldAlert size={13} strokeWidth={2} />
				<span className="flex-1">
					{message ?? "Your local server blocks this page from reading its responses (CORS)."}{" "}
					{queuedText}.
				</span>
				<ChevronDown
					size={13}
					strokeWidth={2}
					className={open ? "rotate-180 transition-transform" : "transition-transform"}
				/>
			</button>
			{open && (
				<div className="px-5 pb-3 text-on-surface-variant">
					<p className="mb-2">
						Allow <code className="font-mono text-on-surface">{ORIGIN}</code> on your dev server and
						the queue drains on its own. Or install the extension or CLI, which need no CORS.
					</p>
					<div className="flex flex-wrap gap-1 mb-2" role="tablist">
						{SNIPPETS.map((s) => (
							<button
								key={s.id}
								type="button"
								role="tab"
								aria-selected={s.id === tab}
								onClick={() => setTab(s.id)}
								className={`px-2 py-0.5 rounded border text-[11px] ${
									s.id === tab
										? "border-warning/40 bg-warning/15 text-on-surface"
										: "border-border-subtle text-on-surface-muted hover:text-on-surface"
								}`}
							>
								{s.label}
							</button>
						))}
					</div>
					<div className="relative">
						<pre className="overflow-x-auto rounded bg-surface-muted border border-border-subtle p-3 pr-10 font-mono text-[11px] leading-relaxed text-on-surface">
							{snippet.code}
						</pre>
						<button
							type="button"
							onClick={copy}
							aria-label="Copy snippet"
							className="absolute top-2 right-2 text-on-surface-muted hover:text-on-surface"
						>
							{copied ? <Check size={13} /> : <Copy size={13} />}
						</button>
					</div>
				</div>
			)}
		</output>
	);
}
