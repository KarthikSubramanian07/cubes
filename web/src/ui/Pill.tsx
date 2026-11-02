import type { ReactNode } from "react";
import "./controls.css";

export function Pill({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "solid" | "accent" | "live";
  className?: string;
}) {
  return <span className={["pill", tone !== "default" && `pill--${tone}`, tone === "live" && "pill--accent", className].filter(Boolean).join(" ")}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
