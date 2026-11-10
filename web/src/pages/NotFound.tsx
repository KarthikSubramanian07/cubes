import { useState } from "react";
import { useDocumentMeta } from "@/app/meta";
import { ArrowRight, Button } from "@/ui/Button";
import { HandNote } from "@/ui/HandNote";
import "./notfound.css";

const N = 7;

/** 404. There is one lost cell. Click a diagonal to move it; it can only go corner to corner, obviously. */
export function Component() {
  useDocumentMeta({ title: "Lost", description: "This page doesn't exist. The cell is lost too.", path: "/404", noindex: true });
  const [pos, setPos] = useState<[number, number]>([3, 3]);
  const [moves, setMoves] = useState(0);
  const options: [number, number][] = [
    [pos[0] - 1, pos[1] - 1],
    [pos[0] + 1, pos[1] - 1],
    [pos[0] - 1, pos[1] + 1],
    [pos[0] + 1, pos[1] + 1],
  ].filter(([x, y]) => x! >= 0 && y! >= 0 && x! < N && y! < N) as [number, number][];

  return (
    <section className="nf wrap">
      <div className="nf__copy">
        <p className="eyebrow">Error 404</p>
        <h1>
          This page has gone <em>dark</em>.
        </h1>
        <p className="lede">
          Either the link is wrong, or the page had no legal moves left and quietly left the game. It happens to the best of us.
        </p>
        <div className="nf__cta">
          <Button to="/" iconRight={<ArrowRight />}>
            Back to the start
          </Button>
          <Button to="/play" variant="ghost">
            Play instead
          </Button>
        </div>
      </div>
      <div className="nf__board">
        <HandNote className="nf__note" tilt={-5} arrow="down-right" size="md">
          {moves === 0 ? "this cell is also lost.\nhelp it. diagonally." : moves < 6 ? `${moves} ${moves === 1 ? "move" : "moves"}. still lost.` : "ok, it lives here now."}
        </HandNote>
        <div className="nf__grid" role="group" aria-label="A lost cell. Move it diagonally.">
          {Array.from({ length: N * N }, (_, i) => {
            const x = i % N;
            const y = Math.floor(i / N);
            const here = x === pos[0] && y === pos[1];
            const can = options.some(([ox, oy]) => ox === x && oy === y);
            return can ? (
              <button
                key={i}
                type="button"
                className="nf__cell nf__cell--can"
                aria-label={`Move to column ${x + 1}, row ${y + 1}`}
                onClick={() => {
                  setPos([x, y]);
                  setMoves((m) => m + 1);
                }}
              />
            ) : here ? (
              <span key={i} className="nf__cell nf__cell--here" role="img" aria-label="the lost cell" />
            ) : (
              <span key={i} className="nf__cell" aria-hidden="true" />
            );
          })}
        </div>
      </div>
    </section>
  );
}
