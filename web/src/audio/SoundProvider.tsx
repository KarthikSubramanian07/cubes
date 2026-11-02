import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createSound, installUnlock, type Sound, type SoundSettings } from "./sound";

const SoundContext = createContext<Sound | null>(null);

export interface SoundProviderProps {
  /** Supply your own instance (tests, sharing with non-React code). Created lazily otherwise. */
  sound?: Sound;
  children?: ReactNode;
}

/**
 * Owns the app's single `Sound`, and unlocks it on the first pointer or key
 * gesture anywhere on the page.
 */
export function SoundProvider({ sound: given, children }: SoundProviderProps) {
  const [sound] = useState<Sound>(() => given ?? createSound());
  useEffect(() => installUnlock(sound), [sound]);
  useEffect(() => {
    if (given) return;
    return () => sound.dispose();
  }, [sound, given]);
  return <SoundContext.Provider value={sound}>{children}</SoundContext.Provider>;
}

/** A silent stand-in so components never need to null-check outside a provider. */
let fallback: Sound | null = null;
function fallbackSound(): Sound {
  fallback ??= createSound({ storage: null, createContext: () => null });
  return fallback;
}

/** The app's `Sound`. Outside a provider, returns an inert instance. */
export function useSound(): Sound {
  return useContext(SoundContext) ?? fallbackSound();
}

/** Reactive volume / mute / music / intensity / context state. */
export function useSoundSettings(): SoundSettings {
  const sound = useSound();
  return useSyncExternalStore(sound.subscribe, sound.getSettings, sound.getSettings);
}
