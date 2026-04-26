import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";
import type { ReplayResult, WebhookEventPayload } from "../hooks/useEvents";
import type { Service } from "../hooks/useServices";
import { cn } from "../lib/cn";
import { JsonViewer } from "./JsonViewer";

interface EventDetailProps {
	event: WebhookEventPayload;
	service: Service | null;
	onClose: () => void;
	onReplay?: (result: ReplayResult) => void;
}

function methodClass(method: string): string {
	switch (method.toUpperCase()) {
		case "GET":
			return "method-get";
		case "POST":
			return "method-post";
		case "PUT":
			return "method-put";
		case "PATCH":
			return "method-patch";
		case "DELETE":
			return "method-delete";
		default:
			return "method-default";
	}
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
	const entries = Object.entries(headers);
	if (entries.length === 0)
		return <span className="text-fg-ghost text-caption italic">— empty —</span>;
	const longestKey = entries.reduce((acc, [k]) => Math.max(acc, k.length), 0);
	return (
		<div className="text-caption space-y-px tabular">
			{entries.map(([key, value]) => (
				<div key={key} className="flex gap-3 py-px hover:bg-ink-3/40 -mx-2 px-2 rounded-sm">
					<span
						className="text-uranium/70 shrink-0"
						style={{ minWidth: `${Math.min(longestKey, 22)}ch` }}
					>
						{key}
					</span>
					<span className="text-fg-muted truncate" title={value}>
						{value}
					</span>
				</div>
			))}
		</div>
	);
}

function SignatureBadge({ headers }: { headers: Record<string, string> }) {
	const status = Object.entries(headers).find(
		([k]) => k.toLowerCase() === "x-bridgehook-signature",
	)?.[1];
	if (!status) return null;
	const tone =
		status === "valid"
			? "border-ok/30 text-ok bg-ok/5"
			: status === "missing"
				? "border-warn/30 text-warn bg-warn/5"
				: "border-err/30 text-err bg-err/5";
	const glyph = status === "valid" ? "✓" : status === "invalid" ? "✕" : "?";
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 text-micro uppercase tracking-wider px-1.5 py-px rounded-sm border tabular",
				tone,
			)}
			title={`Signature: ${status}`}
		>
			<span>{glyph}</span>
			sig·{status}
		</span>
	);
}

function statusTone(status: number) {
	if (status < 300) return "text-ok border-ok/30 bg-ok/5";
	if (status < 400) return "text-warn border-warn/30 bg-warn/5";
	return "text-err border-err/30 bg-err/5";
}

function statusText(status: number): string {
	if (status === 200) return "ok";
	if (status === 201) return "created";
	if (status === 204) return "no content";
	if (status === 301 || status === 302) return "redirect";
	if (status === 400) return "bad request";
	if (status === 401) return "unauthorized";
	if (status === 403) return "forbidden";
	if (status === 404) return "not found";
	if (status === 422) return "unprocessable";
	if (status === 429) return "too many";
	if (status === 500) return "server error";
	if (status === 502) return "bad gateway";
	if (status === 503) return "unavailable";
	if (status === 504) return "gateway timeout";
	return "";
}

export function EventDetail({ event, service, onClose, onReplay }: EventDetailProps) {
	const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
	const [replaying, setReplaying] = useState(false);
	const [copyMenuOpen, setCopyMenuOpen] = useState(false);
	const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
	const [editMode, setEditMode] = useState(false);
	const [editHeaders, setEditHeaders] = useState<string>(() =>
		typeof event.request_headers === "string"
			? event.request_headers
			: JSON.stringify(event.request_headers ?? {}, null, 2),
	);
	const [editBody, setEditBody] = useState<string>(event.request_body ?? "");
	const [editError, setEditError] = useState<string | null>(null);

	const targetHost = service ? `http://localhost:${service.port}` : "http://localhost:PORT";
	const fullUrl = `${targetHost}${event.path}`;

	const requestHeaders =
		typeof event.request_headers === "string"
			? JSON.parse(event.request_headers || "{}")
			: event.request_headers;

	const responseHeaders: Record<string, string> = {};

	const handleReplay = async () => {
		setReplaying(true);
		setEditError(null);
		try {
			let result: ReplayResult;
			if (editMode) {
				let headersObj: Record<string, string> = {};
				try {
					headersObj = editHeaders.trim() ? JSON.parse(editHeaders) : {};
					if (typeof headersObj !== "object" || Array.isArray(headersObj)) {
						throw new Error("Headers must be a JSON object");
					}
				} catch (e) {
					setEditError(`Invalid headers JSON: ${String(e)}`);
					setReplaying(false);
					return;
				}
				result = await invoke<ReplayResult>("replay_event_with_edits", {
					eventId: event.id,
					headers: headersObj,
					body: editBody,
				});
			} else {
				result = await invoke<ReplayResult>("replay_event", {
					eventId: event.id,
				});
			}
			setReplayResult(result);
			onReplay?.(result);
		} catch (err) {
			setEditError(String(err));
		} finally {
			setReplaying(false);
		}
	};

	const markCopied = async (label: string, text: string) => {
		try {
			await writeText(text);
		} catch {
			try {
				await navigator.clipboard.writeText(text);
			} catch {
				/* ignore */
			}
		}
		setCopiedLabel(label);
		setTimeout(() => setCopiedLabel(null), 1500);
		setCopyMenuOpen(false);
	};

	const buildCurl = () => {
		const headerFlags = Object.entries(requestHeaders)
			.map(([k, v]) => `  -H '${k}: ${v}'`)
			.join(" \\\n");
		const bodyFlag = event.request_body
			? ` \\\n  --data-raw '${event.request_body.replace(/'/g, "'\\''")}'`
			: "";
		return `curl -X ${event.method} '${fullUrl}'${headerFlags ? ` \\\n${headerFlags}` : ""}${bodyFlag}`;
	};

	const buildFetch = () => {
		const init: Record<string, unknown> = { method: event.method };
		if (Object.keys(requestHeaders).length) init.headers = requestHeaders;
		if (event.request_body) init.body = event.request_body;
		return `fetch(${JSON.stringify(fullUrl)}, ${JSON.stringify(init, null, 2)})`;
	};

	const buildHttpie = () => {
		const headerParts = Object.entries(requestHeaders)
			.map(([k, v]) => `'${k}:${v}'`)
			.join(" ");
		const body = event.request_body ? ` <<< '${event.request_body.replace(/'/g, "'\\''")}'` : "";
		return `http ${event.method} '${fullUrl}' ${headerParts}${body}`.trim();
	};

	const buildPython = () => {
		const lines = [
			"import requests",
			"",
			`url = ${JSON.stringify(fullUrl)}`,
			`headers = ${JSON.stringify(requestHeaders, null, 4)}`,
		];
		if (event.request_body) {
			lines.push(`data = ${JSON.stringify(event.request_body)}`);
			lines.push(
				`resp = requests.request(${JSON.stringify(event.method)}, url, headers=headers, data=data)`,
			);
		} else {
			lines.push(`resp = requests.request(${JSON.stringify(event.method)}, url, headers=headers)`);
		}
		lines.push("print(resp.status_code, resp.text)");
		return lines.join("\n");
	};

	const buildHar = () => {
		const har = {
			log: {
				version: "1.2",
				creator: { name: "BridgeHook", version: "0.1" },
				entries: [
					{
						startedDateTime: event.received_at,
						time: event.latency_ms ?? 0,
						request: {
							method: event.method,
							url: fullUrl,
							httpVersion: "HTTP/1.1",
							headers: Object.entries(requestHeaders).map(([name, value]) => ({
								name,
								value,
							})),
							queryString: [],
							postData: event.request_body
								? {
										mimeType: requestHeaders["content-type"] ?? "application/json",
										text: event.request_body,
									}
								: undefined,
							headersSize: -1,
							bodySize: event.request_body?.length ?? 0,
						},
						response: {
							status: event.response_status ?? 0,
							statusText: "",
							httpVersion: "HTTP/1.1",
							headers: [],
							content: {
								size: event.response_body?.length ?? 0,
								mimeType: "application/json",
								text: event.response_body ?? "",
							},
							redirectURL: "",
							headersSize: -1,
							bodySize: event.response_body?.length ?? 0,
						},
						cache: {},
						timings: { send: 0, wait: event.latency_ms ?? 0, receive: 0 },
					},
				],
			},
		};
		return JSON.stringify(har, null, 2);
	};

	const copyFormats: { label: string; build: () => string }[] = [
		{ label: "cURL", build: buildCurl },
		{ label: "fetch()", build: buildFetch },
		{ label: "HTTPie", build: buildHttpie },
		{ label: "Python", build: buildPython },
		{ label: "HAR", build: buildHar },
	];

	return (
		<div className="h-full flex flex-col bg-ink-1 font-sans">
			{/* ── Header: HTTP status line ───────────────────────────────── */}
			<div className="bg-ink-0 border-b border-edge px-3 pt-2.5 pb-2 shrink-0">
				<div className="flex items-start gap-2 min-w-0">
					<span
						className={cn(
							"px-1.5 py-px rounded-sm text-micro font-bold uppercase tracking-wider tabular shrink-0",
							methodClass(event.method),
						)}
					>
						{event.method}
					</span>
					<span
						className="text-ui text-fg truncate flex-1 tabular tracking-tight"
						title={event.path}
					>
						{event.path}
					</span>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close inspector"
						className="w-6 h-6 flex items-center justify-center text-fg-faint hover:text-fg hover:bg-ink-3 rounded text-base leading-none shrink-0"
					>
						×
					</button>
				</div>

				{/* Status / metadata strip */}
				<div className="flex items-center gap-1.5 mt-2 text-caption tabular flex-wrap">
					{event.response_status != null ? (
						<span
							className={cn(
								"inline-flex items-center gap-1 px-1.5 py-px rounded-sm border tabular",
								statusTone(event.response_status),
							)}
						>
							<span className="font-bold">{event.response_status}</span>
							<span className="text-current/70 normal-case">
								{statusText(event.response_status)}
							</span>
						</span>
					) : (
						<span className="inline-flex items-center gap-1 px-1.5 py-px rounded-sm border border-edge text-fg-faint">
							<span className="w-1 h-1 rounded-full bg-fg-faint animate-pulse-soft" />
							pending
						</span>
					)}
					{event.latency_ms !== null && (
						<span className="text-fg-muted">
							{event.latency_ms}
							<span className="text-fg-ghost ml-0.5">ms</span>
						</span>
					)}
					{service && (
						<span className="text-fg-faint">
							→ <span className="text-fg-muted">{targetHost}</span>
						</span>
					)}
					<SignatureBadge headers={requestHeaders} />
					<span className="ml-auto text-fg-ghost text-micro tabular">
						{new Date(event.received_at).toLocaleString()}
					</span>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-1 mt-2.5">
					<button
						type="button"
						onClick={handleReplay}
						disabled={replaying}
						className={cn(
							"flex items-center gap-1.5 px-2.5 h-7 text-caption uppercase tracking-wider rounded-sm font-semibold transition-colors disabled:opacity-30",
							"bg-uranium text-uranium-ink hover:bg-uranium-dim",
						)}
					>
						<svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
							<path d="M3 6 L9 2 L9 10 Z" fill="currentColor" />
						</svg>
						{replaying ? "replaying…" : editMode ? "replay+edits" : "replay"}
					</button>
					<button
						type="button"
						onClick={() => setEditMode((v) => !v)}
						className={cn(
							"px-2.5 h-7 text-caption uppercase tracking-wider rounded-sm border transition-colors",
							editMode
								? "border-uranium/40 text-uranium bg-uranium/10"
								: "border-edge text-fg-muted hover:text-fg hover:border-edge-strong hover:bg-ink-3",
						)}
					>
						{editMode ? "editing" : "edit"}
					</button>
					<div className="relative">
						<button
							type="button"
							onClick={() => setCopyMenuOpen((v) => !v)}
							className="flex items-center gap-1 px-2.5 h-7 text-caption uppercase tracking-wider rounded-sm border border-edge text-fg-muted hover:text-fg hover:bg-ink-3"
						>
							{copiedLabel ? `copied·${copiedLabel}` : "copy as"}
							<span className="text-fg-ghost">▾</span>
						</button>
						{copyMenuOpen && (
							<>
								<button
									type="button"
									aria-label="Close menu"
									className="fixed inset-0 z-10 cursor-default bg-transparent"
									onClick={() => setCopyMenuOpen(false)}
								/>
								<div className="absolute right-0 top-full mt-1 z-20 glass border border-edge-strong rounded-sm shadow-modal py-1 min-w-[140px] animate-slide-up-fade">
									{copyFormats.map((f) => (
										<button
											key={f.label}
											type="button"
											onClick={() => markCopied(f.label, f.build())}
											className="w-full text-left px-3 h-7 text-caption text-fg-muted hover:bg-uranium/10 hover:text-uranium tracking-tight"
										>
											{f.label}
										</button>
									))}
								</div>
							</>
						)}
					</div>
				</div>
			</div>

			{/* ── Error banner ─────────────────────────────────────────── */}
			{event.error && (
				<div className="mx-3 mt-3 flex items-start gap-2 bg-err/5 border border-err/20 rounded-sm px-3 py-2">
					<span className="text-err shrink-0 font-bold tabular">!</span>
					<span className="text-err text-caption tabular flex-1">{event.error}</span>
				</div>
			)}

			{/* ── Edit panel ─────────────────────────────────────────── */}
			{editMode && (
				<div className="mx-3 mt-3 p-3 bg-ink-2 border border-edge-strong rounded-sm space-y-2.5 animate-slide-up-fade">
					<SectionLabel>headers · json</SectionLabel>
					<textarea
						value={editHeaders}
						onChange={(e) => setEditHeaders(e.target.value)}
						className="w-full bg-ink-0 border border-edge rounded-sm p-2 text-caption text-fg focus:outline-none focus:border-uranium/50"
						rows={4}
						spellCheck={false}
					/>
					<SectionLabel>body</SectionLabel>
					<textarea
						value={editBody}
						onChange={(e) => setEditBody(e.target.value)}
						className="w-full bg-ink-0 border border-edge rounded-sm p-2 text-caption text-fg focus:outline-none focus:border-uranium/50"
						rows={4}
						spellCheck={false}
					/>
					{editError && (
						<p className="text-err text-caption">
							<span className="font-bold mr-1">!</span>
							{editError}
						</p>
					)}
				</div>
			)}

			{/* ── Content panes ────────────────────────────────────────── */}
			<div className="flex-1 overflow-auto">
				<div className="p-3 space-y-4">
					<Section title="request" tone="primary">
						<div>
							<SectionLabel>headers</SectionLabel>
							<div className="bg-ink-0 border border-edge rounded-sm p-2.5 mt-1">
								<HeadersTable headers={requestHeaders} />
							</div>
						</div>
						<div>
							<SectionLabel>body</SectionLabel>
							<div className="mt-1">
								<JsonViewer value={event.request_body} />
							</div>
						</div>
					</Section>

					<Section title="response" tone="ok">
						<div>
							<SectionLabel>headers</SectionLabel>
							<div className="bg-ink-0 border border-edge rounded-sm p-2.5 mt-1">
								<HeadersTable headers={responseHeaders} />
							</div>
						</div>
						<div>
							<SectionLabel>body</SectionLabel>
							<div className="mt-1">
								<JsonViewer value={event.response_body} />
							</div>
						</div>
					</Section>

					{replayResult && (
						<Section title="replay result" tone="warn">
							<div className="flex items-center gap-2 text-caption tabular">
								<span
									className={cn(
										"inline-flex items-center gap-1 px-1.5 py-px rounded-sm border",
										statusTone(replayResult.status),
									)}
								>
									<span className="font-bold">{replayResult.status}</span>
									<span className="text-current/70">{statusText(replayResult.status)}</span>
								</span>
								<span className="text-fg-muted">
									{replayResult.latency_ms}
									<span className="text-fg-ghost ml-0.5">ms</span>
								</span>
							</div>
							<JsonViewer value={replayResult.body} maxHeight={160} />
						</Section>
					)}
				</div>
			</div>
		</div>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="text-micro text-fg-faint uppercase tracking-[0.18em]">
			<span className="text-fg-ghost mr-1">/</span>
			{children}
		</p>
	);
}

function Section({
	title,
	tone,
	children,
}: {
	title: string;
	tone: "primary" | "ok" | "warn";
	children: React.ReactNode;
}) {
	const ruleColor = tone === "primary" ? "bg-uranium" : tone === "ok" ? "bg-ok" : "bg-warn";
	return (
		<section>
			<div className="flex items-center gap-2 mb-2">
				<span className={cn("h-3 w-0.5", ruleColor)} />
				<h4 className="text-micro font-semibold text-fg uppercase tracking-[0.18em]">{title}</h4>
				<span className="flex-1 border-t border-dashed border-edge ml-1" />
			</div>
			<div className="space-y-3">{children}</div>
		</section>
	);
}
