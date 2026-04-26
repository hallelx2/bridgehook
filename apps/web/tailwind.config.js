/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				// Raw background
				background: "#030303",

				// Surface stack — concrete, not opacity-stacked white
				surface: "#0a0a0c", // default card
				"surface-2": "#111113", // elevated card
				"surface-3": "#18181b", // highest elevation / hover
				"surface-muted": "#08080a", // header bars, toolbars

				// Text
				"on-surface": "#fafafa",
				"on-surface-variant": "#a1a1aa",
				"on-surface-muted": "#52525b",
				"on-surface-faint": "#3f3f46",

				// Borders — named, not white/[0.XX]
				border: "#1e1e22",
				"border-strong": "#2a2a2f",
				"border-subtle": "#141418",

				// Single accent — replaces the indigo→purple→pink spectrum
				primary: "#FF5C26",
				"primary-dim": "#B33D15",
				"primary-soft": "#2a1208",
				"primary-glow": "rgba(255, 92, 38, 0.18)",

				// Legacy aliases kept as primary so old class names don't break
				// (we migrate call sites separately)
				secondary: "#FF5C26",
				tertiary: "#FF5C26",
				"primary-fixed": "#FF8A5C",

				// Semantic colors (unchanged — these aren't vibecode tells)
				success: "#4ade80",
				warning: "#fbbf24",
				danger: "#f87171",
			},
			borderRadius: {
				DEFAULT: "0.125rem",
				lg: "0.25rem",
				xl: "0.5rem",
				full: "0.75rem",
				"2xl": "1rem",
				"3xl": "1.5rem",
				"4xl": "2rem",
			},
			fontFamily: {
				// Consolidated to two families. Manrope covers display + body + labels
				// via weight/tracking variation.
				headline: ["Manrope", "sans-serif"],
				display: ["Manrope", "sans-serif"],
				body: ["Manrope", "sans-serif"],
				label: ["Manrope", "sans-serif"],
				sans: ["Manrope", "sans-serif"],
				mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
			},
			animation: {
				float: "float 6s ease-in-out infinite",
				telescope: "telescope 8s ease-in-out infinite alternate",
			},
			keyframes: {
				float: {
					"0%, 100%": { transform: "translateY(0)" },
					"50%": { transform: "translateY(-20px)" },
				},
				telescope: {
					"0%": { height: "40vh" },
					"100%": { height: "85vh" },
				},
			},
		},
	},
	plugins: [],
};
