import { useEffect, useId, useRef, useState } from "react";
import "./controls.css";
import "./overlay.css";

export type CopyStatus = "idle" | "copied" | "manual";

export interface CopyFieldProps {
  value: string;
  label: string;
  /** Visually hide the label (it stays for screen readers). */
  hideLabel?: boolean;
  onCopied?: () => void;
  className?: string;
  buttonLabel?: string;
}

/** Copies text with the async clipboard API, then execCommand, then asks you to press the keys yourself. */
export async function copyText(text: string, input?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or insecure context: fall through */
  }
  try {
    if (input) {
      input.focus();
      input.select();
      input.setSelectionRange(0, text.length);
      if (document.execCommand?.("copy")) return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

export function CopyField({ value, label, hideLabel, onCopied, className, buttonLabel = "Copy link" }: CopyFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onCopy() {
    const ok = await copyText(value, inputRef.current);
    if (ok) {
      setStatus("copied");
      onCopied?.();
    } else {
      inputRef.current?.select();
      setStatus("manual");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), ok ? 2200 : 6000);
  }

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  return (
    <div className={["copyfield", className].filter(Boolean).join(" ")} data-status={status}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "field__label"}>
        {label}
      </label>
      <div className="copyfield__row">
        <input
          ref={inputRef}
          id={id}
          className="input copyfield__input"
          value={value}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn btn--primary btn--md copyfield__btn" onClick={onCopy}>
          <span className="btn__label">{status === "copied" ? "Copied" : buttonLabel}</span>
        </button>
      </div>
      <p className="copyfield__status" role="status" aria-live="polite">
        {status === "copied" && "Copied to your clipboard."}
        {status === "manual" && `Your browser said no. It's selected: press ${isMac ? "⌘" : "Ctrl"}+C.`}
      </p>
    </div>
  );
}
