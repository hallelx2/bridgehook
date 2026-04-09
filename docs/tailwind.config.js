/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				surface: "#0e0e0e",
				background: "#030303",
				primary: "#9093ff",
				"primary-fixed": "#babbff",
				secondary: "#ffb0cd",
				tertiary: "#ddb7ff",
			},
			fontFamily: {
				headline: ["Manrope", "sans-serif"],
				body: ["Plus Jakarta Sans", "sans-serif"],
				label: ["Sora", "sans-serif"],
				mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
			},
		},
	},
	plugins: [],
};
