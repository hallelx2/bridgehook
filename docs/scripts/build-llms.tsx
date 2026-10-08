/**
 * Writes llms.txt, llms-full.txt and one Markdown file per page into dist/,
 * rendered from the same React pages the site shows, so the files an LLM
 * reads can never drift from the docs a person reads.
 *
 *   https://docs.bridgehook.dev/llms.txt        index (llmstxt.org format)
 *   https://docs.bridgehook.dev/llms-full.txt   every page in nav order
 *   https://docs.bridgehook.dev/<id>.md         one page
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { NAV_SECTIONS } from "../src/components/Layout";
import { PAGES } from "../src/registry";

const SITE = "https://docs.bridgehook.dev";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const td = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-",
	emDelimiter: "*",
});
td.use(gfm);

// In-site links (#/page) point at the page's Markdown twin.
td.addRule("docLinks", {
	filter: (node) => node.nodeName === "A" && /^#\//.test(node.getAttribute("href") ?? ""),
	replacement: (content, node) => {
		const id = (node as HTMLElement).getAttribute("href")?.slice(2) ?? "";
		return `[${content}](${SITE}/${id}.md)`;
	},
});

// Diagrams carry a Markdown alternative; their drawn boxes are decoration.
td.addRule("llmsAlt", {
	filter: (node) => node.nodeType === 1 && (node as HTMLElement).hasAttribute("data-llms-md"),
	replacement: (_content, node) => `\n\n${(node as HTMLElement).getAttribute("data-llms-md")}\n\n`,
});

// Step timelines become a numbered list.
td.addRule("steps", {
	filter: (node) =>
		node.nodeType === 1 && (node as HTMLElement).getAttribute("data-llms") === "steps",
	replacement: (_content, node) => {
		const steps = Array.from((node as HTMLElement).querySelectorAll("[data-step-title]"));
		const lines = steps.map((el, i) => {
			const code = el.getAttribute("data-step-code");
			return `${i + 1}. **${el.getAttribute("data-step-title")}.** ${el.getAttribute("data-step-desc")}${code ? ` \`${code}\`` : ""}`;
		});
		return `\n\n${lines.join("\n")}\n\n`;
	},
});

// Callouts become a titled blockquote; the emoji badge is decoration.
td.addRule("callout", {
	filter: (node) => node.nodeName === "DIV" && (node as HTMLElement).hasAttribute("data-callout"),
	replacement: (_content, node) => {
		const el = node as HTMLElement;
		const title = el.getAttribute("data-callout") ?? "";
		const body = el.lastElementChild?.lastElementChild;
		const text = body ? td.turndown(body.innerHTML).trim() : "";
		return `\n\n> **${title}.** ${text.replace(/\n/g, "\n> ")}\n\n`;
	},
});

// Two-column key/value tables without a header row read better as a list.
td.addRule("keyValueTable", {
	filter: (node) => node.nodeName === "TABLE" && !(node as HTMLElement).querySelector("thead, th"),
	replacement: (_content, node) => {
		const rows = Array.from((node as HTMLElement).querySelectorAll("tr"));
		const items = rows.map((tr) => {
			const [k, ...v] = Array.from(tr.children).map((c) => td.turndown(c.innerHTML).trim());
			return `- **${k}:** ${v.join(" ")}`;
		});
		return `\n\n${items.join("\n")}\n\n`;
	},
});

interface Page {
	id: string;
	label: string;
	section: string;
	title: string;
	summary: string;
	markdown: string;
}

function render(id: string, label: string, section: string): Page {
	const Component = PAGES[id];
	if (!Component) throw new Error(`Nav entry "${id}" has no page in registry.tsx`);
	const markdown = td.turndown(renderToStaticMarkup(createElement(Component))).trim();
	const title = markdown.match(/^# (.+)$/m)?.[1] ?? label;
	// The first paragraph's first sentence describes the page in the index.
	const para = markdown.split(/\n{2,}/).find((b) => b && !/^(#|>|-|\||```|\d+\.)/.test(b.trim()));
	const plain = (para ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*`]/g, "");
	const summary = (plain.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? plain).replace(/\s+/g, " ").trim();
	return { id, label, section, title, summary, markdown };
}

const pages: Page[] = NAV_SECTIONS.flatMap((s) =>
	s.items.map((i) => render(i.id, i.label, s.title)),
);

const missing = Object.keys(PAGES).filter((id) => !pages.some((p) => p.id === id));
if (missing.length) throw new Error(`Pages missing from the nav: ${missing.join(", ")}`);

mkdirSync(OUT, { recursive: true });
for (const p of pages) {
	writeFileSync(join(OUT, `${p.id}.md`), `${p.markdown}\n\nSource: ${SITE}/#/${p.id}\n`);
}

const index = [
	"# BridgeHook",
	"",
	"> Webhook testing for apps built with AI, and for the agents building them. Every local port gets a permanent public URL (https://<id>.bridgehook.dev); webhooks reach the server on your machine through the BridgeHook Chrome extension or a dashboard tab, queue while it is off and arrive in order, can return your server's reply to the sender (sync mode), and can be driven by coding agents through a remote MCP server at https://relay.bridgehook.dev/mcp.",
	"",
	`Dashboard: https://app.bridgehook.dev. Source (MIT): https://github.com/hallelx2/bridgehook. Every page below is also in one file: ${SITE}/llms-full.txt`,
	"",
];
for (const section of NAV_SECTIONS) {
	index.push(`## ${section.title}`, "");
	for (const item of section.items) {
		const p = pages.find((x) => x.id === item.id);
		if (!p) continue;
		index.push(`- [${p.title}](${SITE}/${p.id}.md)${p.summary ? `: ${p.summary}` : ""}`);
	}
	index.push("");
}
writeFileSync(join(OUT, "llms.txt"), index.join("\n"));

const full = [
	"# BridgeHook documentation",
	"",
	`Generated from ${SITE} on ${new Date().toISOString().slice(0, 10)}. Index: ${SITE}/llms.txt`,
	"",
	...pages.map((p) => `${p.markdown}\n\nSource: ${SITE}/#/${p.id}\n\n---\n`),
];
writeFileSync(join(OUT, "llms-full.txt"), full.join("\n"));

console.log(`llms.txt: ${pages.length} pages, llms-full.txt: ${full.join("\n").length} chars`);
