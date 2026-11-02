import { useMemo } from "react";
import type { AiLevel } from "@/engine/types";
import { loadStats, totals } from "@/app/stats";

const BOTS: { level: AiLevel; name: string; note: string }[] = [
  { level: "ember", name: "Ember", note: "gentle" },
  { level: "flare", name: "Flare", note: "sharp" },
  { level: "nova", name: "Nova", note: "ruthless" },
];

/** Your record against the bots, from this browser. Hidden until you've played one. */
export function RecordCard() {
  const s = useMemo(() => loadStats(), []);
  if (s.played === 0) return null;
  const t = totals(s);
  return (
    <section className="card record" aria-labelledby="record-title">
      <p className="eyebrow eyebrow--plain" id="record-title">
        Your record
      </p>
      <p className="record__big">
        <strong>{t.win}</strong>
        <span>–</span>
        <strong>{t.loss}</strong>
        {t.tie > 0 && (
          <>
            <span>–</span>
            <strong>{t.tie}</strong>
          </>
        )}
        <small>{t.tie > 0 ? "won, lost, tied" : "won, lost"}</small>
      </p>
      <table className="record__table">
        <tbody>
          {BOTS.map((b) => {
            const r = s.byLevel[b.level];
            const n = r.win + r.loss + r.tie;
            return (
              <tr key={b.level}>
                <th scope="row">
                  {b.name} <span className="muted">{b.note}</span>
                </th>
                <td>{n ? `${r.win}–${r.loss}${r.tie ? `–${r.tie}` : ""}` : "not yet"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="record__foot muted">
        Best score {s.best} · longest win streak {s.bestStreak}
        {s.streak > 1 ? ` · on a ${s.streak}-game streak` : ""}
      </p>
    </section>
  );
}
