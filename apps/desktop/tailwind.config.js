/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {
		extend: {
			fontFamily: {
				// Two-family system, mirroring the website. Manrope handles chrome,
				// labels, and UI; JetBrains Mono is reserved for data (paths,
				// channel ids, status codes, ports, method pills).
				sans: ["Manrope", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
				mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
			},
			fontSize: {
				// Tight, deliberate scale tuned for Manrope at small sizes.
				micro: ["10.5px", { lineHeight: "14px", letterSpacing: "0.04em" }],
				caption: ["12px", { lineHeight: "16px", letterSpacing: "0" }],
				label: ["12px", { lineHeight: "16px", letterSpacing: "0.04em" }],
				body: ["13px", { lineHeight: "18px" }],
				ui: ["14px", { lineHeight: "20px" }],
				heading: ["15px", { lineHeight: "22px", fontWeight: "600", letterSpacing: "-0.005em" }],
				display: ["18px", { lineHeight: "24px", fontWeight: "600", letterSpacing: "-0.02em" }],
			},
			colors: {
				// ── Surface stack ──────────────────────────────────────────────
				// Compressed range: the dashboard relies on borders, not strong
				// background contrast, to establish hierarchy. Five steps so
				// existing components keep their relative depth.
				ink: {
					0: "#020409", // outermost chrome (top header, column header)
					1: "#030712", // app body — Tailwind gray-950
					2: "#0a0f1a", // micro-elevation panels (detect panel, badges)
					3: "#111827", // raised surfaces — Tailwind gray-900
					4: "#1f2937", // hover / selected — Tailwind gray-800
				},
				// ── Borders ────────────────────────────────────────────────────
				edge: {
					DEFAULT: "#111827", // gray-900 — primary divider
					strong: "#1f2937", // gray-800 — modal/raised borders
					accent: "#374151", // gray-700 — focused/important
				},
				// ── Text ───────────────────────────────────────────────────────
				fg: {
					DEFAULT: "#e5e7eb", // gray-200 — primary readable
					muted: "#9ca3af", // gray-400 — secondary
					faint: "#6b7280", // gray-500 — labels, hints
					ghost: "#4b5563", // gray-600 — separators, disabled
				},
				// ── Primary accent (cyan) ──────────────────────────────────────
				// Token kept under the `uranium` name so existing components
				// don't need to be renamed. Two values: a brighter one for
				// text/dot accents, a darker one for primary button bases.
				uranium: {
					DEFAULT: "#22d3ee", // cyan-400 — text accents, dots, active rules
					dim: "#06b6d4", // cyan-500 — primary button base, "deeper" accent
					ink: "#083344", // cyan-950 — dark text on cyan bg
					glow: "rgba(34, 211, 238, 0.14)",
				},
				// ── Brand mark only ────────────────────────────────────────────
				// Orange is reserved for the Logo's "hook" curl. Don't use it
				// for interactive accents — that's cyan's job.
				brand: {
					DEFAULT: "#FF5C26", // primary orange from the website
					hover: "#B33D15",
					subtle: "rgba(255, 92, 38, 0.10)",
				},
				// ── HTTP method pills ──────────────────────────────────────────
				// Match the dashboard's MethodPill exactly.
				method: {
					get: "#60a5fa", // blue-400
					post: "#4ade80", // green-400
					put: "#fbbf24", // amber-400
					patch: "#c084fc", // purple-400
					delete: "#f87171", // red-400
					default: "#9ca3af", // gray-400
				},
				// ── Semantic status ────────────────────────────────────────────
				ok: { DEFAULT: "#4ade80", subtle: "rgba(74, 222, 128, 0.10)" },
				warn: { DEFAULT: "#fbbf24", subtle: "rgba(251, 191, 36, 0.10)" },
				err: { DEFAULT: "#f87171", subtle: "rgba(248, 113, 113, 0.10)" },
				// ── Legacy aliases (preserved so older callsites work) ─────────
				surface: {
					0: "#020409",
					1: "#030712",
					2: "#0a0f1a",
					3: "#111827",
					border: "#111827",
				},
				danger: {
					DEFAULT: "#f87171",
					subtle: "rgba(248, 113, 113, 0.10)",
				},
			},
			borderRadius: {
				// Dashboard-style: rounded-md is the workhorse, pills stay tight.
				DEFAULT: "0.25rem", // 4px — pills, micro buttons
				sm: "0.25rem",
				md: "0.375rem", // 6px — cards, inputs, buttons
				lg: "0.5rem", // 8px — containers
			},
			boxShadow: {
				panel: "0 1px 0 rgba(255,255,255,0.02) inset, 0 0 0 1px rgba(0,0,0,0.4)",
				lift: "0 4px 24px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
				modal:
					"0 24px 64px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06), 0 0 80px -20px rgba(34,211,238,0.08)",
				accent: "0 0 0 1px rgba(34,211,238,0.5), 0 0 16px -4px rgba(34,211,238,0.4)",
				inset: "inset 0 0 0 1px rgba(255,255,255,0.04)",
			},
			animation: {
				"event-flash": "event-flash 700ms ease-out",
				"caret-blink": "caret-blink 1.1s steps(2, jump-none) infinite",
				"scan-line": "scan-line 4s linear infinite",
				"pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
				"slide-up-fade": "slide-up-fade 220ms cubic-bezier(0.16, 1, 0.3, 1) both",
			},
			keyframes: {
				"event-flash": {
					"0%": {
						backgroundColor: "rgba(34, 211, 238, 0.10)",
						boxShadow: "inset 2px 0 0 #22d3ee",
					},
					"100%": {
						backgroundColor: "transparent",
						boxShadow: "inset 2px 0 0 transparent",
					},
				},
				"caret-blink": {
					"0%, 50%": { opacity: "1" },
					"51%, 100%": { opacity: "0" },
				},
				"scan-line": {
					"0%": { transform: "translateY(-100%)" },
					"100%": { transform: "translateY(100%)" },
				},
				"pulse-soft": {
					"0%, 100%": { opacity: "0.55" },
					"50%": { opacity: "1" },
				},
				"slide-up-fade": {
					"0%": { opacity: "0", transform: "translateY(4px)" },
					"100%": { opacity: "1", transform: "translateY(0)" },
				},
			},
		},
	},
	plugins: [],
};
