import type { AiLevel } from "@/engine/types";
import type { Outcome } from "@/app/stats";
import type { MatchSnapshot } from "./LocalMatch";

const STRENGTH: AiLevel[] = ["ember", "flare", "nova"];

/** One human against bots: how did the human do, and against which bot? */
export function soloResult(snap: Pick<MatchSnapshot, "seats" | "view">): { level: AiLevel; outcome: Outcome; score: number } | null {
  const humans = snap.seats.flatMap((s, i) => (s.kind === "human" ? [i] : []));
  if (humans.length !== 1) return null;
  const me = humans[0]!;
  const level = snap.seats.reduce<AiLevel | null>(
    (best, s) => (s.level && (!best || STRENGTH.indexOf(s.level) > STRENGTH.indexOf(best)) ? s.level : best),
    null,
  );
  if (!level) return null;
  const winners = snap.view.winners ?? [];
  const outcome: Outcome = !winners.includes(me) ? "loss" : winners.length > 1 ? "tie" : "win";
  const score = snap.view.scores?.[me] ?? snap.view.seats[me]?.score ?? 0;
  return { level, outcome, score };
}
