import { AgentInstructions } from "./pages/AgentInstructions";
import { AiAgents } from "./pages/AiAgents";
import { Architecture } from "./pages/Architecture";
import { Auth } from "./pages/Auth";
import { Billing } from "./pages/Billing";
import { BrowserBridge } from "./pages/BrowserBridge";
import { ChannelSecrets } from "./pages/ChannelSecrets";
import { Tradeoffs, VsCloudflareTunnel, VsLocaltunnel, VsNgrok } from "./pages/Comparison";
import { DevicePairing } from "./pages/DevicePairing";
import { HowItWorks } from "./pages/HowItWorks";
import { Introduction } from "./pages/Introduction";
import { PathAllowlist } from "./pages/PathAllowlist";
import {
	ElevenLabsGuide,
	GitHubGuide,
	OpenAIGuide,
	StripeGuide,
	VapiGuide,
} from "./pages/Providers";
import { Quickstart } from "./pages/Quickstart";
import { RelayAPI } from "./pages/RelayAPI";
import { Replay } from "./pages/Replay";
import { SSEEvents } from "./pages/SSEEvents";
import { SSETechnology } from "./pages/SSETechnology";
import { SecurityModel } from "./pages/SecurityModel";
import { SelfHosting } from "./pages/SelfHosting";
import { SyncResponses } from "./pages/SyncResponses";

/** Every docs page by id. The id is the page's URL (`#/<id>`) and its
 * llms.txt entry, so ids are permanent once published. */
export const PAGES: Record<string, () => React.JSX.Element> = {
	introduction: Introduction,
	quickstart: Quickstart,
	"how-it-works": HowItWorks,
	"sse-technology": SSETechnology,
	"browser-bridge": BrowserBridge,
	"security-model": SecurityModel,
	"channel-secrets": ChannelSecrets,
	"path-allowlist": PathAllowlist,
	auth: Auth,
	"device-pairing": DevicePairing,
	billing: Billing,
	replay: Replay,
	"vs-ngrok": VsNgrok,
	"vs-cloudflare-tunnel": VsCloudflareTunnel,
	"vs-localtunnel": VsLocaltunnel,
	tradeoffs: Tradeoffs,
	"ai-agents": AiAgents,
	"agent-instructions": AgentInstructions,
	"sync-responses": SyncResponses,
	openai: OpenAIGuide,
	elevenlabs: ElevenLabsGuide,
	vapi: VapiGuide,
	stripe: StripeGuide,
	github: GitHubGuide,
	"relay-api": RelayAPI,
	"sse-events": SSEEvents,
	"self-hosting": SelfHosting,
	architecture: Architecture,
};
