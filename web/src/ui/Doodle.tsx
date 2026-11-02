import type { CSSProperties } from "react";
import { useInView } from "@/app/useInView";
import "./doodle.css";

export type DoodleVariant =
  | "underline"
  | "double-underline"
  | "circle"
  | "arrow"
  | "star"
  | "scribble"
  | "bracket"
  | "cross"
  | "check";

interface Shape {
  viewBox: string;
  paths: string[];
  /** Stretch to the box (underlines, circles, brackets) vs keep proportions. */
  stretch?: boolean;
}

/*
 * Hand-authored Béziers. Nothing closes exactly, nothing is symmetric, the second stroke of a
 * double underline is shorter than the first, the way a pen actually moves.
 */
const SHAPES: Record<DoodleVariant, Shape> = {
  underline: {
    viewBox: "0 0 200 16",
    paths: ["M3 10.5 C 38 6.5, 92 4.8, 140 6.4 S 186 8.2, 197 6.2"],
    stretch: true,
  },
  "double-underline": {
    viewBox: "0 0 200 20",
    paths: ["M3 7.5 C 44 4, 112 3.6, 197 6.4", "M14 15 C 62 11.6, 128 11.4, 184 13.6"],
    stretch: true,
  },
  circle: {
    viewBox: "0 0 220 100",
    paths: [
      "M124 8.5 C 74 2.5, 16 14, 8.5 47 C 2 79, 66 97, 126 93 C 180 89.5, 214 72, 211 45 C 208 19, 160 5.5, 96 9.5 C 82 10.5, 70 13, 61 16",
    ],
    stretch: true,
  },
  arrow: {
    viewBox: "0 0 80 60",
    paths: ["M6 9 C 26 3.5, 52 13, 62 44", "M51.5 37.5 L 63 47.5 L 69.5 33"],
  },
  star: {
    viewBox: "0 0 48 48",
    paths: ["M24 4.5 L 29.5 18.5 L 44 19.5 L 32.5 29 L 36.5 43.5 L 24 35 L 11 43 L 15.5 29 L 4 19.8 L 18.6 18.2 Z"],
  },
  scribble: {
    viewBox: "0 0 120 40",
    paths: ["M4 30 C 14 8, 20 8, 24 26 C 28 40, 36 6, 44 22 C 50 34, 56 6, 66 22 C 72 32, 80 6, 88 22 C 94 32, 102 8, 116 14"],
    stretch: true,
  },
  bracket: {
    viewBox: "0 0 24 200",
    paths: ["M18 3 C 8 4, 9.5 30, 9.5 60 C 9.5 86, 8 96, 2.5 100 C 8 104, 9.5 116, 9.6 142 C 9.8 172, 8 196, 19 197"],
    stretch: true,
  },
  cross: {
    viewBox: "0 0 48 48",
    paths: ["M8 9 C 20 20, 30 30, 41 40.5", "M40 7.5 C 29 19, 19 30, 7.5 41"],
  },
  check: {
    viewBox: "0 0 48 40",
    paths: ["M5 22 C 10 25, 14 30, 17.5 35.5 C 24 22, 32 12, 44 4.5"],
  },
};

export interface DoodleProps {
  variant: DoodleVariant;
  className?: string;
  style?: CSSProperties;
  /** Any CSS colour. Defaults to the red pencil (--accent). */
  color?: string;
  strokeWidth?: number;
  /** Delay before drawing, ms. */
  delay?: number;
  /** Draw itself in when scrolled into view. */
  animate?: boolean;
  /** Mirror horizontally or vertically (arrows mostly). */
  flipX?: boolean;
  flipY?: boolean;
  rotate?: number;
}

export function Doodle({
  variant,
  className,
  style,
  color,
  strokeWidth = 2.2,
  delay = 0,
  animate = true,
  flipX,
  flipY,
  rotate = 0,
}: DoodleProps) {
  const [ref, inView] = useInView<SVGSVGElement>({ threshold: 0.1 });
  const shape = SHAPES[variant];
  const transform =
    flipX || flipY || rotate ? `rotate(${rotate}deg) scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : undefined;
  return (
    <svg
      ref={ref}
      className={["doodle", `doodle--${variant}`, className].filter(Boolean).join(" ")}
      viewBox={shape.viewBox}
      preserveAspectRatio={shape.stretch ? "none" : "xMidYMid meet"}
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-animate={animate}
      data-inview={inView}
      style={{ ...style, color, transform, ["--delay" as string]: `${delay}ms` }}
    >
      {shape.paths.map((d, i) => (
        <path
          key={i}
          d={d}
          pathLength={1}
          className="doodle__stroke"
          strokeWidth={strokeWidth}
          style={{ ["--i" as string]: i }}
        />
      ))}
    </svg>
  );
}
