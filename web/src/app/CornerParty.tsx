import { useEffect, useState } from "react";
import { useToast } from "@/ui/Toast";
import "./corner-party.css";

const WORD = "corner";

interface Bit {
  id: number;
  corner: 0 | 1 | 2 | 3;
  dx: number;
  dy: number;
  rot: number;
  seat: number;
  size: number;
  delay: number;
}

/**
 * Easter egg: type "corner" anywhere outside a text field. Shards burst in from
 * the four corners of the window, because of course they do.
 */
export function CornerParty() {
  const toast = useToast();
  const [bits, setBits] = useState<Bit[]>([]);

  useEffect(() => {
    let buffer = "";
    let n = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
      buffer = (buffer + e.key.toLowerCase()).slice(-WORD.length);
      if (buffer !== WORD) return;
      buffer = "";
      n++;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) {
        const next: Bit[] = [];
        for (let i = 0; i < 44; i++) {
          const corner = (i % 4) as Bit["corner"];
          const sx = corner === 0 || corner === 3 ? 1 : -1;
          const sy = corner < 2 ? 1 : -1;
          next.push({
            id: n * 1000 + i,
            corner,
            dx: sx * (12 + Math.random() * 34),
            dy: sy * (10 + Math.random() * 30),
            rot: (Math.random() - 0.5) * 540,
            seat: i % 4,
            size: 8 + Math.random() * 12,
            delay: Math.random() * 180,
          });
        }
        setBits(next);
        window.setTimeout(() => setBits([]), 1900);
      }
      const lines = [
        "you found a corner. it's yours now.",
        "another corner. you're a natural.",
        "ok that's enough corners for one day.",
      ];
      toast.show(lines[Math.min(n - 1, lines.length - 1)], { hand: true, tone: "accent" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast]);

  if (!bits.length) return null;
  return (
    <div className="corner-party" aria-hidden="true">
      {bits.map((b) => (
        <span
          key={b.id}
          className={`corner-party__bit corner-party__bit--c${b.corner}`}
          style={{
            ["--dx" as string]: `${b.dx}vw`,
            ["--dy" as string]: `${b.dy}vh`,
            ["--rot" as string]: `${b.rot}deg`,
            ["--s" as string]: `${b.size}px`,
            ["--delay" as string]: `${b.delay}ms`,
            background: `var(--seat-${b.seat})`,
          }}
        />
      ))}
    </div>
  );
}
