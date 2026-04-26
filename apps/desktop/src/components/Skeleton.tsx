import { cn } from "../lib/cn";

export function Skeleton({ className }: { className?: string }) {
	return (
		<div
			className={cn("animate-pulse-soft bg-ink-3/60 rounded-sm", className)}
			aria-hidden="true"
		/>
	);
}

export function ServiceSkeleton() {
	return (
		<div className="px-3 py-2 border-l-2 border-l-transparent space-y-1.5">
			<div className="flex items-center gap-2">
				<Skeleton className="w-1.5 h-1.5 rounded-full shrink-0" />
				<Skeleton className="h-3 flex-1" />
				<Skeleton className="w-10 h-3" />
			</div>
			<Skeleton className="h-2.5 w-2/3 ml-3.5" />
			<Skeleton className="h-2.5 w-1/2 ml-3.5" />
		</div>
	);
}

export function EventRowSkeleton() {
	return (
		<div className="grid grid-cols-[14px_72px_56px_140px_1fr_64px_64px] gap-2 px-3 h-7 items-center border-b border-edge/40">
			<Skeleton className="w-1 h-1 rounded-full justify-self-center" />
			<Skeleton className="h-2.5 w-12" />
			<Skeleton className="h-3 w-10" />
			<Skeleton className="h-2.5 w-20" />
			<Skeleton className="h-2.5 w-32" />
			<Skeleton className="h-2.5 w-10 justify-self-end" />
			<Skeleton className="h-2.5 w-10 justify-self-end" />
		</div>
	);
}
