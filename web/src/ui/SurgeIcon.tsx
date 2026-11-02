import "./mode-art.css";

export type SurgeName = "spark" | "leap" | "shatter" | "scan";

/** Small pencil icons for the four surges. */
export function SurgeIcon({ surge, className }: { surge: SurgeName; className?: string }) {
  return (
    <svg className={["surge-icon", className].filter(Boolean).join(" ")} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {surge === "spark" && (
        <>
          <rect className="si-fill" x="17" y="17" width="14" height="14" rx="2.5" />
          <path className="si-line" d="M24 4.5v6M24 37.5v6M4.5 24h6M37.5 24h6M10 10.2l4 4M34 34l4 4M10 37.8l4-4M34 14l4-4" />
        </>
      )}
      {surge === "leap" && (
        <>
          <rect className="si-fill" x="4" y="30" width="11" height="11" rx="2" />
          <rect className="si-ghost" x="33" y="8" width="11" height="11" rx="2" />
          <path className="si-line si-dash" d="M12 28 C 14 12, 24 8, 31 13" />
          <path className="si-line" d="M26 9.5 L 31.5 13.5 L 26.5 17.8" />
        </>
      )}
      {surge === "shatter" && (
        <>
          <rect className="si-fill si-fill--muted" x="10" y="10" width="28" height="28" rx="3" />
          <path className="si-crack" d="M24 10 L 21 19 L 27 23 L 20 31 L 23 38 M27 23 L 37 25 M21 19 L 11 17" />
        </>
      )}
      {surge === "scan" && (
        <>
          <circle className="si-fill" cx="24" cy="24" r="3.6" />
          <path className="si-line" d="M14 24 C 14 18, 18.6 14, 24 14 M34 24 C 34 30, 29.4 34, 24 34" />
          <path className="si-line" d="M6.5 24 C 6.5 14, 14 6.5, 24 6.5 M41.5 24 C 41.5 34, 34 41.5, 24 41.5" />
        </>
      )}
    </svg>
  );
}
