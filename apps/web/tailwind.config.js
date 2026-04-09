/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				surface: "#0e0e0e",
				"surface-container-low": "#131313",
				"primary-fixed": "#babbff",
				"on-surface": "#fafafa",
				background: "#030303",
				"on-surface-variant": "#a1a1aa",
				primary: "#9093ff",
				secondary: "#ffb0cd",
				tertiary: "#ddb7ff",
				"neon-lime": "#e2ff00",
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
				headline: ["Manrope", "sans-serif"],
				body: ["Plus Jakarta Sans", "sans-serif"],
				label: ["Sora", "sans-serif"],
				display: ["Manrope", "sans-serif"],
				mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
				serif: ["Georgia", "Cambria", "Times New Roman", "Times", "serif"],
			},
			animation: {
				float: "float 6s ease-in-out infinite",
				"pulse-glow": "pulse-glow 4s ease-in-out infinite",
				telescope: "telescope 8s ease-in-out infinite alternate",
				rotate: "rotate 4s linear infinite",
			},
			keyframes: {
				float: {
					"0%, 100%": { transform: "translateY(0)" },
					"50%": { transform: "translateY(-20px)" },
				},
				"pulse-glow": {
					"0%, 100%": { opacity: "0.3", transform: "scale(1)" },
					"50%": { opacity: "0.6", transform: "scale(1.05)" },
				},
				telescope: {
					"0%": { height: "40vh" },
					"100%": { height: "85vh" },
				},
				rotate: {
					from: { transform: "rotate(0deg)" },
					to: { transform: "rotate(360deg)" },
				},
			},
		},
	},
	plugins: [],
};
