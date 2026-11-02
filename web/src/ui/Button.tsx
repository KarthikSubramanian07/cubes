import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import "./controls.css";

export type ButtonVariant = "primary" | "accent" | "ghost" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

interface BaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
  className?: string;
  block?: boolean;
}

type AsButton = BaseProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { to?: undefined; href?: undefined };
type AsLink = BaseProps & { to: string; state?: unknown; href?: undefined; onClick?: () => void; "aria-label"?: string };
type AsAnchor = BaseProps & { href: string; to?: undefined; target?: string; rel?: string; "aria-label"?: string };

export type ButtonProps = AsButton | AsLink | AsAnchor;

function classes({ variant = "primary", size = "md", className, block }: BaseProps): string {
  return ["btn", `btn--${variant}`, `btn--${size}`, block && "btn--block", className].filter(Boolean).join(" ");
}

function Inner({ icon, iconRight, children }: BaseProps) {
  return (
    <>
      {icon && <span className="btn__icon" aria-hidden="true">{icon}</span>}
      {children !== undefined && <span className="btn__label">{children}</span>}
      {iconRight && <span className="btn__icon btn__icon--right" aria-hidden="true">{iconRight}</span>}
    </>
  );
}

/** Primary (ink), accent (clay), ghost (outlined) and quiet (text) buttons; renders a Link for `to`, an anchor for `href`. */
export function Button(props: ButtonProps) {
  const { variant, size, icon, iconRight, children, className, block, ...rest } = props;
  const cls = classes({ variant, size, className, block });
  const inner = <Inner icon={icon} iconRight={iconRight}>{children}</Inner>;
  if ("to" in rest && rest.to !== undefined) {
    const { to, state, onClick, ...aria } = rest as AsLink;
    return (
      <Link to={to} state={state} onClick={onClick} className={cls} {...aria}>
        {inner}
      </Link>
    );
  }
  if ("href" in rest && rest.href !== undefined) {
    const a = rest as AsAnchor;
    return (
      <a className={cls} {...a}>
        {inner}
      </a>
    );
  }
  const b = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type="button" className={cls} {...b}>
      {inner}
    </button>
  );
}

/** A small hand-feeling arrow used on CTAs. */
export function ArrowRight() {
  return (
    <svg viewBox="0 0 20 14" width="18" height="12" fill="none" aria-hidden="true">
      <path d="M1.5 7.4 C 6 6.6, 11 7.2, 17.6 6.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12.6 2.2 L 18 6.9 L 12.4 11.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
