import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "cn";

interface ResizeHandleProps {
  /** "column" sits between two side-by-side areas, "row" between two stacked ones */
  between: "column" | "row";
  label: string;
  /** Called on every pointer move while dragging */
  onResize: (clientX: number, clientY: number) => void;
  /** Called once when the drag ends, to save the final size */
  onResizeEnd: () => void;
  /** Arrow keys move the handle by this many pixels (negative = left or up) */
  onStep: (pixels: number) => void;
  /** Double-click puts the size back to its default */
  onReset: () => void;
}

const KEYBOARD_STEP = 24;

/** A thin bar that can be dragged with the mouse or moved with the arrow keys. */
export function ResizeHandle({
  between,
  label,
  onResize,
  onResizeEnd,
  onStep,
  onReset,
}: ResizeHandleProps) {
  const draggingRef = useRef(false);
  const isColumn = between === "column";

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Capture keeps the drag going even when the pointer moves over the terminal
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    // No text selection and the same cursor everywhere while dragging
    document.body.style.userSelect = "none";
    document.body.style.cursor = isColumn ? "col-resize" : "row-resize";
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) onResize(event.clientX, event.clientY);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    onResizeEnd();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const backward = isColumn ? "ArrowLeft" : "ArrowUp";
    const forward = isColumn ? "ArrowRight" : "ArrowDown";
    if (event.key === backward || event.key === forward) {
      event.preventDefault();
      onStep(event.key === forward ? KEYBOARD_STEP : -KEYBOARD_STEP);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation={isColumn ? "vertical" : "horizontal"}
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      className={cn(
        // A wide invisible grab area with a thin line in the middle that lights up on hover
        "group/handle relative flex shrink-0 touch-none items-center justify-center outline-none",
        isColumn ? "w-4 cursor-col-resize" : "h-4 cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "rounded-full bg-border transition-colors group-hover/handle:bg-ring group-focus-visible/handle:bg-ring group-active/handle:bg-ring",
          isColumn ? "h-full w-px group-hover/handle:w-0.5" : "h-px w-full group-hover/handle:h-0.5",
        )}
      />
    </div>
  );
}
