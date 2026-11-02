import { useMemo, useState } from "react";
import { ArrowRight, Button } from "@/ui/Button";
import { HandNote } from "@/ui/HandNote";
import { DAILY_TITLES, dailyNumber, dailyPreset, shareText, todayUTC } from "@/app/daily";
import { dailyStreak, loadStats } from "@/app/stats";

const SQUARE: Record<string, string> = { "🟧": "you", "🟦": "them", "⬛": "dead", "⬜": "empty" };

/** The emoji share grid, drawn as real squares. */
export function DailyGrid({ grid, label }: { grid: string; label: string }) {
  const rows = grid.split("\n").map((r) => [...r]);
  return (
    <div className="daily__grid" role="img" aria-label={label} style={{ "--cols": rows[0]?.length ?? 7 } as React.CSSProperties}>
      {rows.flatMap((r, y) => r.map((c, x) => <i key={`${x}-${y}`} className={`daily__sq daily__sq--${SQUARE[c] ?? "empty"}`} />))}
    </div>
  );
}

/** Today's board on the play page: a nudge to play, or your result and a share button. */
export function DailyCard() {
  const today = useMemo(() => todayUTC(), []);
  const stats = useMemo(() => loadStats(), []);
  const result = stats.daily[today];
  const streak = dailyStreak(stats, today);
  const mode = DAILY_TITLES[dailyPreset(today)] ?? "Duel";
  const n = dailyNumber(today);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    if (!result) return;
    const text = shareText({ day: today, ...result }, window.location.origin);
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      /* dismissed */
    }
  };

  return (
    <section className="card daily" aria-labelledby="daily-title">
      <div className="daily__text">
        <p className="eyebrow eyebrow--plain">
          Daily #{n} · {mode}
        </p>
        {result ? (
          <>
            <h2 id="daily-title" className="daily__title">
              {result.outcome === "win" ? "You beat Flare" : result.outcome === "tie" ? "You tied Flare" : "Flare got you"}{" "}
              <em>
                {result.score}–{result.opponent}
              </em>
            </h2>
            <p className="muted">
              {result.outcome === "win" ? "Nicely done." : result.outcome === "tie" ? "Dead even. Annoying, right?" : "It happens. Tomorrow's board is a fresh start."} A new
              board lands at midnight UTC.
            </p>
            <div className="daily__actions">
              <Button onClick={() => void share()}>{copied ? "Copied" : "Share result"}</Button>
              <Button variant="ghost" to="/daily">
                Practice it again
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 id="daily-title" className="daily__title">
              Today's board, <em>vs Flare</em>
            </h2>
            <p className="muted">Everyone gets the same board today. Your first finished game counts, and there's no undo, so make it a good one.</p>
            <div className="daily__actions">
              <Button iconRight={<ArrowRight />} to="/daily">
                Play today's board
              </Button>
            </div>
          </>
        )}
      </div>
      {result && <DailyGrid grid={result.grid} label={`Your final board for daily ${n}`} />}
      {streak > 1 && (
        <HandNote className="daily__streak annot" tilt={-5} size="sm">
          {streak} days in a row!
        </HandNote>
      )}
    </section>
  );
}
