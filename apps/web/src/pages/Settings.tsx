/**
 * Settings — minimal v1: account info + plan + retention summary + sign out.
 * Signing-secrets manager and mock-defaults editor (existing modal
 * components from the legacy dashboard) lift here in a later commit.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "../components/DashboardLayout";
import { signOut } from "../lib/auth-client";
import { type MeUser, me } from "../lib/me-api";

export function Settings() {
	return (
		<DashboardLayout>
			<SettingsView />
		</DashboardLayout>
	);
}

function SettingsView() {
	const navigate = useNavigate();
	const [user, setUser] = useState<MeUser | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		me.get()
			.then(setUser)
			.catch((err) => setError(err instanceof Error ? err.message : String(err)));
	}, []);

	async function onSignOut() {
		await signOut();
		navigate("/login", { replace: true });
	}

	if (error) {
		return (
			<div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
				{error}
			</div>
		);
	}
	if (!user)
		return <div className="text-sm text-gray-500 py-12 text-center font-mono">loading…</div>;

	return (
		<div className="space-y-6 max-w-2xl">
			<h1 className="text-xl font-semibold">Settings</h1>

			<Section title="Account">
				<Row label="Name" value={user.user.name} />
				<Row label="Email" value={user.user.email} mono />
				<Row label="User ID" value={user.user.id} mono />
			</Section>

			<Section title="Plan">
				<Row label="Plan" value={user.plan} mono />
				{user.plan === "trialing" && user.trialEndsAt ? (
					<Row label="Trial ends" value={new Date(user.trialEndsAt).toLocaleString()} />
				) : null}
				<Row label="Event retention" value={`${user.retentionDays} days`} />
				<div className="pt-2">
					<button
						type="button"
						onClick={() => navigate("/dashboard/billing")}
						className="text-xs text-cyan-400 hover:underline"
					>
						Manage billing →
					</button>
				</div>
			</Section>

			<Section title="Session">
				<button
					type="button"
					onClick={onSignOut}
					className="rounded-md border border-gray-800 hover:border-red-700 hover:bg-red-950/30 hover:text-red-300 px-3 py-1.5 text-xs text-gray-300"
				>
					Sign out
				</button>
			</Section>
		</div>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="rounded-lg border border-gray-900 bg-gray-950">
			<h2 className="px-4 py-2.5 text-sm font-medium text-gray-200 border-b border-gray-900">
				{title}
			</h2>
			<div className="px-4 py-3 space-y-2">{children}</div>
		</section>
	);
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="flex items-center justify-between gap-4 text-sm">
			<span className="text-gray-500 text-xs uppercase tracking-wider">{label}</span>
			<span className={mono ? "font-mono text-gray-200" : "text-gray-200"}>{value}</span>
		</div>
	);
}
