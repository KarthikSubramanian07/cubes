import type { ReactNode } from "react";
import { useInView } from "@/app/useInView";
import "./highlight.css";

export interface HighlightProps {
  children: ReactNode;
  /** pollen = highlighter yellow (default), accent = clay wash, seat-N = that seat. */
  tone?: "pollen" | "accent" | "seat-0" | "seat-1" | "seat-2" | "seat-3";
  delay?: number;
  className?: string;
}

/** A highlighter swipe that drags itself across the text when it scrolls into view. */
export function Highlight({ children, tone = "pollen", delay = 0, className }: HighlightProps) {
  const [ref, inView] = useInView<HTMLElement>({ threshold: 0.6 });
  return (
    <mark
      ref={ref}
      className={["hl", `hl--${tone}`, className].filter(Boolean).join(" ")}
      data-inview={inView}
      style={{ ["--delay" as string]: `${delay}ms` }}
    >
      {children}
    </mark>
  );
}
