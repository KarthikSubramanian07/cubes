import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CUE_NAMES, DEFAULT_CUE_PARAMS, fireCue, renderCue } from "./lab";
import { createSound } from "./sound";
import { SoundBoard } from "./SoundBoard";
import { SoundProvider } from "./SoundProvider";

const sound = createSound();
const waveforms = new URLSearchParams(location.search).get("waves") !== "0";

// Hook for the e2e suite and for poking at cues from the console.
Object.assign(globalThis, {
  __soundLab: { sound, CUE_NAMES, DEFAULT_CUE_PARAMS, fireCue, renderCue },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SoundProvider sound={sound}>
      <SoundBoard waveforms={waveforms} />
    </SoundProvider>
  </StrictMode>,
);
