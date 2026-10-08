import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AgentsSection } from "./components/AgentsSection";
import { Architecture } from "./components/Architecture";
import { AuthGate } from "./components/AuthGate";
import { Benefits } from "./components/Benefits";
import { BentoGrid } from "./components/BentoGrid";
import { BridgeHero } from "./components/BridgeHero";
import { ComparisonTable } from "./components/ComparisonTable";
import { DashboardPreview } from "./components/DashboardPreview";
import { FinalCTA } from "./components/FinalCTA";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import { ScrollFlow } from "./components/ScrollFlow";
import { AiAgents } from "./pages/AiAgents";
import { AuthCallback } from "./pages/AuthCallback";
import { Billing } from "./pages/Billing";
import { ChannelsList } from "./pages/ChannelsList";
import { Connect } from "./pages/Connect";
import { Dashboard as BrowserBridge } from "./pages/Dashboard";
import { DashboardHome } from "./pages/DashboardHome";
import { DevicesList } from "./pages/DevicesList";
import { EventDetail } from "./pages/EventDetail";
import { EventsFeed } from "./pages/EventsFeed";
import { Login } from "./pages/Login";
import { LoginCheckEmail } from "./pages/LoginCheckEmail";
import { Privacy } from "./pages/Privacy";
import { Settings } from "./pages/Settings";

function LandingPage() {
	return (
		<>
			<Nav />
			<main className="relative">
				<BridgeHero />
				<DashboardPreview />
				<AgentsSection />
				<BentoGrid />
				<ScrollFlow />
				<Architecture />
				<Benefits />
				<ComparisonTable />
				<FinalCTA />
			</main>
			<Footer />
		</>
	);
}

/** Routes the marketing host serves itself; everything else belongs to the app. */
const MARKETING_PATHS = new Set(["/", "/privacy"]);

/**
 * The apex (bridgehook.dev) serves the landing page. Signing in and the
 * dashboard live on VITE_APP_URL, the origin the relay trusts with the
 * session cookie, so any other route is moved there, path and all.
 */
function AppHostRedirect() {
	const location = useLocation();
	useEffect(() => {
		const appUrl = import.meta.env.VITE_APP_URL;
		if (!appUrl) return;
		const app = new URL(appUrl);
		if (window.location.origin === app.origin) return;
		if (MARKETING_PATHS.has(location.pathname)) return;
		window.location.replace(`${app.origin}${location.pathname}${location.search}${location.hash}`);
	}, [location]);
	return null;
}

/**
 * One-shot shim: people with `#/dashboard` bookmarks land at `/` with a hash;
 * convert to a real path navigation so the new BrowserRouter takes over.
 * Runs once on mount; harmless on subsequent renders.
 */
function HashCompatRedirect() {
	const navigate = useNavigate();
	const location = useLocation();

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot on mount
	useEffect(() => {
		const hash = window.location.hash;
		if (hash.startsWith("#/") && location.pathname === "/") {
			const target = hash.slice(1) || "/";
			navigate(target, { replace: true });
		}
	}, []);

	return null;
}

export function App() {
	return (
		<BrowserRouter>
			<HashCompatRedirect />
			<AppHostRedirect />
			<Routes>
				<Route path="/" element={<LandingPage />} />
				<Route path="/login" element={<Login />} />
				<Route path="/login/check-email" element={<LoginCheckEmail />} />
				<Route path="/auth/callback" element={<AuthCallback />} />
				<Route path="/privacy" element={<Privacy />} />
				<Route
					path="/connect"
					element={
						<AuthGate>
							<Connect />
						</AuthGate>
					}
				/>
				<Route
					path="/dashboard"
					element={
						<AuthGate>
							<DashboardHome />
						</AuthGate>
					}
				/>
				<Route
					path="/dashboard/events"
					element={
						<AuthGate>
							<EventsFeed />
						</AuthGate>
					}
				/>
				<Route
					path="/dashboard/events/:id"
					element={
						<AuthGate>
							<EventDetail />
						</AuthGate>
					}
				/>
				<Route
					path="/dashboard/channels"
					element={
						<AuthGate>
							<ChannelsList />
						</AuthGate>
					}
				/>
				{/* No-install mode: this tab forwards webhooks to localhost. */}
				<Route
					path="/dashboard/bridge"
					element={
						<AuthGate>
							<BrowserBridge />
						</AuthGate>
					}
				/>
				<Route
					path="/dashboard/devices"
					element={
						<AuthGate>
							<DevicesList />
						</AuthGate>
					}
				/>
				<Route
					path="/dashboard/agents"
					element={
						<AuthGate>
							<AiAgents />
						</AuthGate>
					}
				/>
				<Route
					path="/dashboard/settings"
					element={
						<AuthGate>
							<Settings />
						</AuthGate>
					}
				/>
				<Route
					path="/dashboard/billing"
					element={
						<AuthGate>
							<Billing />
						</AuthGate>
					}
				/>
				{/* Channel detail (/dashboard/channels/:id) lands in a later commit. */}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</BrowserRouter>
	);
}
