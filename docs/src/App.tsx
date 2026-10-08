import { useCallback, useEffect, useState } from "react";
import { ALL_PAGES, Layout } from "./components/Layout";
import { Introduction } from "./pages/Introduction";
import { PAGES } from "./registry";

/** Pages are addressed as `#/<id>` so every page has a URL to link to. */
function pageFromHash(): string {
	const id = window.location.hash.replace(/^#\/?/, "").split(/[?#]/)[0];
	return Object.hasOwn(PAGES, id) ? id : "introduction";
}

export function App() {
	const [page, setPage] = useState(pageFromHash);
	const PageComponent = PAGES[page] || Introduction;

	useEffect(() => {
		const onHash = () => setPage(pageFromHash());
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	useEffect(() => {
		const label = ALL_PAGES.find((p) => p.id === page)?.label;
		document.title = label ? `${label} · BridgeHook docs` : "BridgeHook docs";
		window.scrollTo(0, 0);
	}, [page]);

	const navigate = useCallback((id: string) => {
		window.location.hash = `/${id}`;
	}, []);

	return (
		<Layout currentPage={page} onNavigate={navigate}>
			<PageComponent />
		</Layout>
	);
}
