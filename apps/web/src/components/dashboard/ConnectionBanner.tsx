import { AlertCircle, Loader2, WifiOff } from "lucide-react";

interface ConnectionBannerProps {
	status: "idle" | "connecting" | "connected" | "reconnecting" | "error";
	error: string | null;
	pollFailures: number;
}

/**
 * Slim status banner that surfaces connectivity issues. Hidden on the
 * happy-path ("connected" + no failures). Anything else gets a coloured
 * strip across the top of the events panel so the user understands why
 * new requests aren't showing up.
 */
export function ConnectionBanner({ status, error, pollFailures }: ConnectionBannerProps) {
	if (status === "connected" && pollFailures === 0) return null;

	if (status === "error") {
		return (
			<div className="flex items-center gap-2 px-5 py-2 bg-danger/10 border-b border-danger/20 text-[12px] text-danger font-medium">
				<AlertCircle size={13} strokeWidth={2} />
				<span>{error ?? "Connection failed."}</span>
			</div>
		);
	}

	if (status === "reconnecting") {
		return (
			<div className="flex items-center gap-2 px-5 py-2 bg-warning/10 border-b border-warning/20 text-[12px] text-warning font-medium">
				<WifiOff size={13} strokeWidth={2} />
				<span>Reconnecting to relay — attempt {pollFailures}. New events may be delayed.</span>
			</div>
		);
	}

	if (status === "connecting") {
		return (
			<div className="flex items-center gap-2 px-5 py-2 bg-surface-muted border-b border-border-subtle text-[12px] text-on-surface-variant">
				<Loader2 size={13} strokeWidth={2} className="animate-spin" />
				<span>Establishing channel…</span>
			</div>
		);
	}

	return null;
}
