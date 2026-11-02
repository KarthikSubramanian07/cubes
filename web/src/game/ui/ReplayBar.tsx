import { useEffect, useRef, useState } from "react";

export interface ReplayBarProps {
  /** Number of frames, start position included. */
  count: number;
  at: number;
  onSeek(i: number): void;
  /** What happened on the frame being shown, e.g. "Flare placed F". */
  caption: { text: string; color?: string } | null;
  round: number;
  onClose(): void;
  reducedMotion: boolean;
}

const STEP_MS = 620;

/**
 * Scrub through a finished game: drag the slider, step with the arrow keys,
 * or press play and watch it rebuild itself move by move.
 */
export function ReplayBar({ count, at, onSeek, caption, round, onClose, reducedMotion }: ReplayBarProps) {
  const last = count - 1;
  const [playing, setPlaying] = useState(false);
  const atRef = useRef(at);
  atRef.current = at;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      const next = atRef.current + 1;
      if (next > last) {
        setPlaying(false);
        return;
      }
      onSeek(next);
    }, reducedMotion ? STEP_MS * 1.6 : STEP_MS);
    return () => window.clearInterval(t);
  }, [playing, last, onSeek, reducedMotion]);

  const toggle = () => {
    if (!playing && atRef.current >= last) onSeek(0);
    setPlaying((p) => !p);
  };
  const step = (d: number) => {
    setPlaying(false);
    onSeek(Math.max(0, Math.min(last, atRef.current + d)));
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Home") step(-count);
      else if (e.key === "End") step(count);
      else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) toggle();
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return (
    <div className="g-replay" role="group" aria-label="Replay">
      <div className="g-replay-top">
        <span className="g-hand g-replay-tag">replay</span>
        <span className="g-replay-caption" aria-live="polite">
          {at === 0 ? (
            "the empty board"
          ) : caption ? (
            <>
              {caption.color && <i className="g-seat-dot" style={{ background: caption.color }} />}
              {caption.text}
            </>
          ) : (
            "…"
          )}
        </span>
        <span className="g-replay-count">
          move {at} / {last} · round {round}
        </span>
      </div>
      <div className="g-replay-row">
        <button className="g-icon-btn" onClick={() => step(-count)} aria-label="First move" title="Start (Home)">
          ⏮
        </button>
        <button className="g-icon-btn" onClick={() => step(-1)} aria-label="Previous move" title="Back (←)">
          ‹
        </button>
        <button className="g-icon-btn g-replay-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"} title="Play (space)">
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="g-icon-btn" onClick={() => step(1)} aria-label="Next move" title="Forward (→)">
          ›
        </button>
        <button className="g-icon-btn" onClick={() => step(count)} aria-label="Final position" title="End (End)">
          ⏭
        </button>
        <input
          className="g-replay-range"
          type="range"
          min={0}
          max={last}
          value={at}
          aria-label="Move"
          onChange={(e) => {
            setPlaying(false);
            onSeek(Number(e.target.value));
          }}
          style={{ "--p": `${last ? (at / last) * 100 : 100}%` } as React.CSSProperties}
        />
        <button className="g-btn-primary g-replay-close" onClick={onClose}>
          Show the result
        </button>
      </div>
    </div>
  );
}
