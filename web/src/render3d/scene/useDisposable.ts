import { useEffect, useMemo, type DependencyList } from "react";

/** useMemo for GPU resources: disposes the previous value when deps change and on unmount. */
export function useDisposable<T extends { dispose(): void }>(factory: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(factory, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}
