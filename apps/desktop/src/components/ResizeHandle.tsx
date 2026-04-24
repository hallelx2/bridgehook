import { useCallback, useEffect, useRef } from "react";

interface ResizeHandleProps {
	direction: "horizontal" | "vertical";
	onResize: (delta: number) => void;
}

export function ResizeHandle({ direction, onResize }: ResizeHandleProps) {
	const dragging = useRef(false);
	const lastPos = useRef(0);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			dragging.current = true;
			lastPos.current = direction === "horizontal" ? e.clientX : e.clientY;
			document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
			document.body.style.userSelect = "none";
		},
		[direction],
	);

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!dragging.current) return;
			const pos = direction === "horizontal" ? e.clientX : e.clientY;
			const delta = pos - lastPos.current;
			lastPos.current = pos;
			onResize(delta);
		};

		const handleMouseUp = () => {
			dragging.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);
		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		};
	}, [direction, onResize]);

	const isHorizontal = direction === "horizontal";

	return (
		<div
			onMouseDown={handleMouseDown}
			className={`${
				isHorizontal
					? "w-1 cursor-col-resize hover:w-1 hover:bg-cyan-500/30"
					: "h-1 cursor-row-resize hover:h-1 hover:bg-cyan-500/30"
			} bg-gray-800 transition-colors duration-150 shrink-0 relative group`}
		>
			{/* Wider hit area */}
			<div
				className={`absolute ${
					isHorizontal ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1"
				}`}
			/>
		</div>
	);
}
