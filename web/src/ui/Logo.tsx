import { Link } from "react-router";
import "./logo.css";

/**
 * The mark is the rule: two cells that touch only at a corner.
 * Easter egg: hover it and the two cells hinge on that corner, which throws a spark.
 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo__mark" viewBox="0 0 28 28" width={size} height={size} aria-hidden="true" focusable="false">
      <g className="logo__a">
        <rect x="2.5" y="2.5" width="11.5" height="11.5" rx="2.2" />
      </g>
      <g className="logo__b">
        <rect x="14" y="14" width="11.5" height="11.5" rx="2.2" />
      </g>
      <g className="logo__spark">
        <path d="M14 8.6 L15 13 L19.4 14 L15 15 L14 19.4 L13 15 L8.6 14 L13 13 Z" />
      </g>
    </svg>
  );
}

export function Logo({ to = "/", label = "cubes, home" }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="logo" aria-label={label}>
      <LogoMark />
      <span className="logo__word" aria-hidden="true">
        cubes
      </span>
    </Link>
  );
}
