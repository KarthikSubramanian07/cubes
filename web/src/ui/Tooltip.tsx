import { cloneElement, useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import "./overlay.css";

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: "top" | "bottom";
  hand?: boolean;
}

/** Hover or focus shows it; Escape or leaving hides it. The trigger is described by the tip. */
export function Tooltip({ content, children, side = "top", hand }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const trigger = cloneElement(children, {
    "aria-describedby": id,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  });

  return (
    <span className="tip-anchor">
      {trigger}
      <span id={id} role="tooltip" className={["tip", `tip--${side}`, hand && "tip--hand"].filter(Boolean).join(" ")} data-open={open}>
        {content}
      </span>
    </span>
  );
}
