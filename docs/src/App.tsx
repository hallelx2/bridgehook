import { useState } from "react";
import { Layout } from "./components/Layout";
import { Architecture } from "./pages/Architecture";
import { BrowserBridge } from "./pages/BrowserBridge";
import { ChannelSecrets } from "./pages/ChannelSecrets";
import { Tradeoffs, VsCloudflareTunnel, VsLocaltunnel, VsNgrok } from "./pages/Comparison";
import { HowItWorks } from "./pages/HowItWorks";
import { Introduction } from "./pages/Introduction";
import { PathAllowlist } from "./pages/PathAllowlist";
import { Quickstart } from "./pages/Quickstart";
import { RelayAPI } from "./pages/RelayAPI";
import { SSEEvents } from "./pages/SSEEvents";
import { SSETechnology } from "./pages/SSETechnology";
import { SecurityModel } from "./pages/SecurityModel";
import { SelfHosting } from "./pages/SelfHosting";

const PAGES: Record<string, () => React.JSX.Element> = {
	introduction: Introduction,
	quickstart: Quickstart,
	"how-it-works": HowItWorks,
	"sse-technology": SSETechnology,
	"browser-bridge": BrowserBridge,
	"security-model": SecurityModel,
	"channel-secrets": ChannelSecrets,
	"path-allowlist": PathAllowlist,
	"vs-ngrok": VsNgrok,
	"vs-cloudflare-tunnel": VsCloudflareTunnel,
	"vs-localtunnel": VsLocaltunnel,
	tradeoffs: Tradeoffs,
	"relay-api": RelayAPI,
	"sse-events": SSEEvents,
	"self-hosting": SelfHosting,
	architecture: Architecture,
};

export function App() {
	const [page, setPage] = useState("introduction");
	const PageComponent = PAGES[page] || Introduction;

	return (
		<Layout currentPage={page} onNavigate={setPage}>
			<PageComponent />
		</Layout>
	);
}
