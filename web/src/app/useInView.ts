import { useEffect, useRef, useState, type RefObject } from "react";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * True once the element has scrolled into view (and stays true).
 * Without IntersectionObserver, or with reduced motion, it is true immediately.
 */
export function useInView<T extends Element>(options: { margin?: string; threshold?: number } = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined" || prefersReducedMotion(),
  );
  const { margin = "0px 0px -12% 0px", threshold = 0.2 } = options;

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: margin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, margin, threshold]);

  return [ref, inView];
}
