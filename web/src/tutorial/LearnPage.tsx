/**
 * /learn: "First light", a three-minute guided first game. Eight chapters,
 * each a tiny real position on the real engine. Progress survives reloads.
 */
import { useCallback, useEffect, useState } from "react";
import { useDocumentMeta } from "@/app/meta";
import { SoundProvider } from "@/audio";
import { loadEngine } from "@/engine/engine";
import { HandNote } from "@/ui/HandNote";
import { CHAPTERS } from "./chapters";
import { ChapterView } from "./ChapterView";
import { loadProgress, saveProgress, type Progress } from "./progress";
import "./learn.css";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function Component() {
  useDocumentMeta({
    title: "Learn in three minutes",
    description:
      "First light: a three-minute guided first game of cubes. Eight tiny chapters on a real board: corners, blocking, nodes and surges, shatter, fog, 3D stacking, then a game against Ember.",
    path: "/learn",
  });
  return (
    <SoundProvider>
      <Learn />
    </SoundProvider>
  );
}

function Learn() {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const reduced = useReducedMotion();

  useEffect(() => {
    let alive = true;
    loadEngine()
      .then(() => alive && setReady(true))
      .catch((e) => alive && setFailure(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((fn: (p: Progress) => Progress) => {
    setProgress((p) => {
      const next = fn(p);
      saveProgress(next);
      return next;
    });
  }, []);

  const go = useCallback(
    (i: number) => {
      update((p) => ({ ...p, chapter: Math.max(0, Math.min(CHAPTERS.length - 1, i)) }));
      document.getElementById("learn-top")?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    },
    [update, reduced],
  );

  const index = progress.chapter;
  const chapter = CHAPTERS[index]!;
  const markDone = useCallback(() => update((p) => (p.done.includes(chapter.id) ? p : { ...p, done: [...p.done, chapter.id] })), [update, chapter.id]);

  return (
    <div className="learn" id="learn-top">
      <header className="learn__head wrap">
        <div className="learn__brand">
          <p className="eyebrow">Learn</p>
          <p className="learn__name">
            First <em>light</em>
          </p>
          <HandNote className="learn__note" tilt={-4} size="sm" tone="muted" delay={600}>
            three minutes, give or take
          </HandNote>
        </div>
        <ol className="learn__dots" aria-label="Chapters">
          {CHAPTERS.map((c, i) => {
            const done = progress.done.includes(c.id);
            const current = i === index;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`learn__dot ${done ? "is-done" : ""} ${current ? "is-current" : ""}`}
                  aria-current={current ? "step" : undefined}
                  aria-label={`Chapter ${i + 1}: ${c.short}${done ? " (done)" : ""}`}
                  title={c.short}
                  onClick={() => go(i)}
                >
                  <span className="num">{i + 1}</span>
                </button>
                {current && <span className={`learn__dot-label ${i >= CHAPTERS.length - 2 ? "is-end" : ""}`}>{c.short}</span>}
              </li>
            );
          })}
        </ol>
      </header>

      <div className="learn__rule wrap" aria-hidden="true" />

      <div className="learn__main wrap">
        {failure ? (
          <p className="learn__fail">The engine didn't load ({failure}). A reload usually fixes it.</p>
        ) : !ready ? (
          <p className="learn__loading">sharpening pencils…</p>
        ) : (
          <ChapterView
            key={chapter.id}
            chapter={chapter}
            index={index}
            total={CHAPTERS.length}
            reduced={reduced}
            isLast={index === CHAPTERS.length - 1}
            onComplete={markDone}
            onNext={() => go(index + 1)}
            onBack={() => go(index - 1)}
          />
        )}
      </div>
    </div>
  );
}
