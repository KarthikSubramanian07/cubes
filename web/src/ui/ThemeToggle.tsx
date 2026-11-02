import { useTheme } from "@/app/theme";
import "./nav.css";

/** Flips between paper and night; the choice is stored. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={["theme-toggle", className].filter(Boolean).join(" ")}
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-theme-current={theme}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <g className="theme-toggle__sun">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.3 5.4l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.6l1.6-1.6M17.1 6.9l1.6-1.6" />
        </g>
        <path className="theme-toggle__moon" d="M19.6 14.6 C 18.4 18.2, 14.6 20.6, 10.6 19.8 C 6.4 19, 3.6 15, 4.4 10.8 C 5 7.6, 7.4 5.2, 10.4 4.4 C 8.6 7.4, 9.2 11.4, 12 13.6 C 14.2 15.4, 17.2 15.6, 19.6 14.6 Z" />
      </svg>
    </button>
  );
}
