import type { CSSProperties, ReactNode } from "react";
import { useInView } from "@/app/useInView";
import "./handnote.css";

export type ArrowDirection =
  | "none"
  | "down"
  | "up"
  | "left"
  | "right"
  | "down-left"
  | "down-right"
  | "up-left"
  | "up-right";

export type NoteTone = "accent" | "ink" | "muted" | "seat-0" | "seat-1" | "seat-2" | "seat-3";

export interface HandNoteProps {
  children: ReactNode;
  arrow?: ArrowDirection;
  /** Degrees. Notes lean left by default, the way a right hand writes in a margin. */
  tilt?: number;
  tone?: NoteTone;
  highlight?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  style?: CSSProperties;
  /** Purely decorative notes are hidden from assistive tech. Set false to have it read. */
  decorative?: boolean;
  /** Draw-in delay, ms. */
  delay?: number;
}

/* One curved arrow (down-right) and one straight-ish arrow (right); the rest are mirrors. */
const CURVE = ["M6 9 C 26 3.5, 52 13, 62 44", "M51.5 37.5 L 63 47.5 L 69.5 33"];
const FLAT = ["M4 17 C 24 9.5, 50 22, 78 13.5", "M67.5 5.5 L 80 13 L 69.5 22.5"];
const DROP = ["M18 4 C 10 22, 27 38, 19 58", "M10 49 L 19 60.5 L 27 48"];

function arrowGeometry(dir: ArrowDirection): { box: string; paths: string[]; sx: number; sy: number } | null {
  switch (dir) {
    case "none":
      return null;
    case "down-right":
      return { box: "0 0 76 56", paths: CURVE, sx: 1, sy: 1 };
    case "down-left":
      return { box: "0 0 76 56", paths: CURVE, sx: -1, sy: 1 };
    case "up-right":
      return { box: "0 0 76 56", paths: CURVE, sx: 1, sy: -1 };
    case "up-left":
      return { box: "0 0 76 56", paths: CURVE, sx: -1, sy: -1 };
    case "right":
      return { box: "0 0 84 28", paths: FLAT, sx: 1, sy: 1 };
    case "left":
      return { box: "0 0 84 28", paths: FLAT, sx: -1, sy: 1 };
    case "down":
      return { box: "0 0 36 64", paths: DROP, sx: 1, sy: 1 };
    case "up":
      return { box: "0 0 36 64", paths: DROP, sx: 1, sy: -1 };
  }
}

/** A Caveat note in the margin, with an optional hand-drawn arrow that draws itself in. */
export function HandNote({
  children,
  arrow = "none",
  tilt = -3,
  tone = "accent",
  highlight = false,
  size = "md",
  className,
  style,
  decorative = true,
  delay = 200,
}: HandNoteProps) {
  const [ref, inView] = useInView<HTMLSpanElement>({ threshold: 0.1 });
  const geo = arrowGeometry(arrow);
  return (
    <span
      ref={ref}
      className={["handnote", `handnote--${size}`, `handnote--${arrow}`, `tone-${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      data-inview={inView}
      aria-hidden={decorative || undefined}
      style={{ ...style, ["--tilt" as string]: `${tilt}deg`, ["--delay" as string]: `${delay}ms` }}
    >
      <span className={highlight ? "handnote__text handnote__text--hl" : "handnote__text"}>{children}</span>
      {geo && (
        <svg
          className="handnote__arrow"
          viewBox={geo.box}
          fill="none"
          aria-hidden="true"
          focusable="false"
          style={{ transform: `scale(${geo.sx}, ${geo.sy})` }}
        >
          {geo.paths.map((d, i) => (
            <path key={i} d={d} pathLength={1} style={{ ["--i" as string]: i }} />
          ))}
        </svg>
      )}
    </span>
  );
}
