/**
 * Small vibrations on phones that support them (Android browsers; iOS Safari
 * has no vibration API). Off when the device asks for reduced motion.
 */
type Pattern = number | number[];

export const PATTERNS = {
  place: 12,
  node: [8, 40, 8],
  invalid: [14, 50, 14],
  shatter: [28, 30, 50],
  win: [20, 70, 20, 70, 60],
} satisfies Record<string, Pattern>;

export type Haptic = keyof typeof PATTERNS;

export function buzz(kind: Haptic, nav: Pick<Navigator, "vibrate"> | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav || typeof nav.vibrate !== "function") return false;
  if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    return nav.vibrate(PATTERNS[kind]);
  } catch {
    return false;
  }
}
