import { act, render, screen } from "@testing-library/react";
import { SoundProvider, useSound, useSoundSettings } from "./SoundProvider";
import { createSound } from "./sound";
import { memoryStorage } from "./testing/mockAudioContext";

function Probe() {
  const sound = useSound();
  const settings = useSoundSettings();
  return (
    <button type="button" onClick={() => sound.setVolume(0.2)}>
      vol {settings.volume.toFixed(2)} {settings.state}
    </button>
  );
}

test("useSound outside a provider is inert, not a crash", () => {
  render(<Probe />);
  expect(screen.getByRole("button").textContent).toMatch(/^vol/);
  act(() => screen.getByRole("button").click());
});

test("provider shares one instance and re-renders on settings changes", () => {
  const sound = createSound({ storage: memoryStorage(), prefs: { volume: 0.7 } });
  render(
    <SoundProvider sound={sound}>
      <Probe />
    </SoundProvider>,
  );
  expect(screen.getByRole("button").textContent).toBe("vol 0.70 locked");
  act(() => screen.getByRole("button").click());
  expect(screen.getByRole("button").textContent).toBe("vol 0.20 locked");
  expect(sound.getSettings().volume).toBe(0.2);
});

test("provider tries to unlock on the first gesture", async () => {
  const sound = createSound({ storage: memoryStorage(), createContext: () => null });
  const spy = vi.spyOn(sound, "unlock");
  render(
    <SoundProvider sound={sound}>
      <Probe />
    </SoundProvider>,
  );
  await act(async () => {
    window.dispatchEvent(new Event("pointerdown"));
  });
  expect(spy).toHaveBeenCalled();
});
