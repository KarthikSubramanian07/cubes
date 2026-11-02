import type { HTMLAttributes, ReactNode } from "react";
import "./controls.css";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "article" | "section" | "li" | "aside";
  variant?: "panel" | "flat" | "dashed";
  children?: ReactNode;
}

export function Card({ as: Tag = "div", variant = "panel", className, children, ...rest }: CardProps) {
  return (
    <Tag className={["card", variant !== "panel" && `card--${variant}`, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </Tag>
  );
}
