import { useId, type ReactNode } from "react";
import "./controls.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** An accessible switch: a real button with role="switch". */
export function Toggle({ checked, onChange, label, hint, disabled, className }: ToggleProps) {
  const hintId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={hint ? hintId : undefined}
      disabled={disabled}
      className={["toggle", className].filter(Boolean).join(" ")}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span>
        {label}
        {hint && (
          <span id={hintId} className="toggle__hint">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}
