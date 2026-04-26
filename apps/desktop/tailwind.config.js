/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {
		extend: {
			fontFamily: {
				// Mono-only typography. Variable weight does the heavy lifting.
				sans: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
				mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
			},
			fontSize: {
				// Tight, deliberate scale. 12px tabular base.
				micro: ["10px", { lineHeight: "13px", letterSpacing: "0.04em" }],
				caption: ["11px", { lineHeight: "15px", letterSpacing: "0.02em" }],
				label: ["11.5px", { lineHeight: "16px", letterSpacing: "0.06em" }],
				body: ["12px", { lineHeight: "17px" }],
				ui: ["13px", { lineHeight: "18px" }],
				heading: ["14px", { lineHeight: "20px", fontWeight: "600", letterSpacing: "-0.005em" }],
				display: ["18px", { lineHeight: "22px", fontWeight: "500", letterSpacing: "-0.02em" }],
			},
			colors: {
				// Surface — warm-tinted near-black scale
				ink: {
					0: "#08090c", // outermost (chrome)
					1: "#0c0d11", // app background
					2: "#111218", // panel
					3: "#161821", // raised surface
					4: "#1d2030", // hover / selected
				},
				// Borders — subtle to strong
				edge: {
					DEFAULT: "#1a1c25",
					strong: "#272a37",
					accent: "#3a3f52",
				},
				// Text scale
				fg: {
					DEFAULT: "#e8e9ed",
					muted: "#9b9eaa",
					faint: "#6a6d79",
					ghost: "#43464f",
				},
				// THE accent — uranium chartreuse
				uranium: {
					DEFAULT: "#ccff00",
					dim: "#a3cc00",
					ink: "#3a4d00",
					glow: "rgba(204, 255, 0, 0.14)",
				},
				// Method badges (HTTP verbs) — desaturated, distinct
				method: {
					get: "#84cdff",
					post: "#a8e6a3",
					put: "#ffc78a",
					patch: "#e8b6ff",
					delete: "#ff9a8a",
					default: "#9b9eaa",
				},
				// Status semantics — restrained, never compete with accent
				ok: { DEFAULT: "#5dd39e", subtle: "rgba(93, 211, 158, 0.12)" },
				warn: { DEFAULT: "#f4c361", subtle: "rgba(244, 195, 97, 0.12)" },
				err: { DEFAULT: "#ff7a7a", subtle: "rgba(255, 122, 122, 0.12)" },
				// Aliases used by older components — pointed at new tokens for compatibility
				surface: {
					0: "#0c0d11",
					1: "#111218",
					2: "#161821",
					3: "#1d2030",
					border: "#1a1c25",
				},
				brand: {
					DEFAULT: "#ccff00",
					hover: "#a3cc00",
					subtle: "rgba(204, 255, 0, 0.10)",
				},
				danger: {
					DEFAULT: "#ff7a7a",
					subtle: "rgba(255, 122, 122, 0.12)",
				},
			},
			boxShadow: {
				panel: "0 1px 0 rgba(255,255,255,0.02) inset, 0 0 0 1px rgba(0,0,0,0.4)",
				lift: "0 4px 24px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
				modal:
					"0 24px 64px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06), 0 0 80px -20px rgba(204,255,0,0.08)",
				accent: "0 0 0 1px rgba(204,255,0,0.5), 0 0 16px -4px rgba(204,255,0,0.4)",
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
						backgroundColor: "rgba(204, 255, 0, 0.10)",
						boxShadow: "inset 2px 0 0 #ccff00",
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
