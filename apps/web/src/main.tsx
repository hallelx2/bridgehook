import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { appHostTarget } from "./lib/app-host";

// A direct visit to an app route on the marketing host leaves before React
// renders anything.
const target = appHostTarget(window.location);
if (target) {
	window.location.replace(target);
} else {
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
