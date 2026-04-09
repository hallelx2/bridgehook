import { useEffect, useState } from "react";
import { Benefits } from "./components/Benefits";
import { BentoGrid } from "./components/BentoGrid";
import { BridgeHero } from "./components/BridgeHero";
import { ComparisonTable } from "./components/ComparisonTable";
import { DashboardPreview } from "./components/DashboardPreview";
import { FinalCTA } from "./components/FinalCTA";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import { ScrollFlow } from "./components/ScrollFlow";
import { Dashboard } from "./pages/Dashboard";

function LandingPage() {
	return (
		<>
			<Nav />
			<main className="relative">
				<BridgeHero />
				<DashboardPreview />
				<BentoGrid />
				<ScrollFlow />
				<Benefits />
				<ComparisonTable />
				<FinalCTA />
			</main>
			<Footer />
		</>
	);
}

/** Simple hash-based router — no dependency needed */
export function App() {
	const [route, setRoute] = useState(window.location.hash);

	useEffect(() => {
		const onHashChange = () => setRoute(window.location.hash);
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, []);

	if (route === "#/dashboard") {
		return <Dashboard />;
	}

	return <LandingPage />;
}
