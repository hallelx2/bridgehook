import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
import { AuthCallback } from "./pages/AuthCallback";
import { Billing } from "./pages/Billing";
import { ChannelsList } from "./pages/ChannelsList";
import { Connect } from "./pages/Connect";
import { DashboardHome } from "./pages/DashboardHome";
import { DevicesList } from "./pages/DevicesList";
import { EventDetail } from "./pages/EventDetail";
import { EventsFeed } from "./pages/EventsFeed";
import { Login } from "./pages/Login";
import { LoginCheckEmail } from "./pages/LoginCheckEmail";
import { Settings } from "./pages/Settings";

function LandingPage() {
	return (
		<>
			<Nav />
			<main className="relative">
				<BridgeHero />
				<DashboardPreview />
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
			<Routes>
				<Route path="/" element={<LandingPage />} />
				<Route path="/login" element={<Login />} />
				<Route path="/login/check-email" element={<LoginCheckEmail />} />
				<Route path="/auth/callback" element={<AuthCallback />} />
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
				<Route
					path="/dashboard/devices"
					element={
						<AuthGate>
							<DevicesList />
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
