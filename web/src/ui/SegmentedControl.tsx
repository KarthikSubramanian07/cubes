import { useRef, type KeyboardEvent, type ReactNode } from "react";
import "./controls.css";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentOption<T>[];
  label: string;
  block?: boolean;
  className?: string;
}

/** A radiogroup with roving focus: arrow keys move and select, like native radios. */
export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  label,
  block,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const current = enabled.indexOf(options.findIndex((o) => o.value === value));
    let next = current;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % enabled.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + enabled.length) % enabled.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = enabled.length - 1;
    const idx = enabled[next];
    if (idx === undefined) return;
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.value);
    refs.current[idx]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={["seg", block && "seg--block", className].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            className="seg__opt"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
