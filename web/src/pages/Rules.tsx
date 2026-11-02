import { useEffect, useState, type ReactNode } from "react";
import { useDocumentMeta } from "@/app/meta";
import { ArrowRight, Button } from "@/ui/Button";
import { Doodle } from "@/ui/Doodle";
import { HandNote } from "@/ui/HandNote";
import { Highlight } from "@/ui/Highlight";
import { MiniBoard } from "@/ui/MiniBoard";
import { Pill } from "@/ui/Pill";
import { SeatChip } from "@/ui/SeatChip";
import { ShardGlyph } from "@/ui/ShardGlyph";
import { SHARDS } from "@/ui/shards";
import "./rules.css";

const SECTIONS = [
  { id: "goal", label: "The goal" },
  { id: "seats", label: "Seats and Cores" },
  { id: "link", label: "The link rule" },
  { id: "kit", label: "Your kit" },
  { id: "turns", label: "Turns, and going dark" },
  { id: "scoring", label: "Scoring" },
  { id: "arena", label: "Nodes and surges" },
  { id: "fog", label: "Fog of war" },
  { id: "storm", label: "Storm" },
  { id: "torus", label: "Torus and shapes" },
  { id: "teams", label: "Teams" },
  { id: "gravity", label: "3D and gravity" },
  { id: "reference", label: "Quick reference" },
] as const;

function useActiveSection(): string {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return active;
}

function Section({ id, n, title, children, aside }: { id: string; n: number; title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="rules__section" aria-labelledby={`${id}-h`}>
      <div className="rules__body prose">
        <p className="rules__n num">§{String(n).padStart(2, "0")}</p>
        <h2 id={`${id}-h`}>{title}</h2>
        {children}
      </div>
      {aside && <aside className="rules__aside annot" aria-hidden="true">{aside}</aside>}
    </section>
  );
}

function Figure({ children, caption }: { children: ReactNode; caption: ReactNode }) {
  return (
    <figure className="rules__fig">
      <div className="rules__fig-row">{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function Component() {
  useDocumentMeta({
    title: "Rules",
    description:
      "The complete rules of cubes: seats and Cores, the corner link rule, the 20-shard kit, scoring, nodes and surges, fog of war, storm, torus, teams and 3D gravity.",
    path: "/rules",
  });
  const active = useActiveSection();

  return (
    <div className="rules">
      <header className="rules__hero wrap">
        <HandNote className="rules__hero-note annot" tilt={-4} arrow="down-left" delay={400}>
          four minutes. we timed it. twice.
        </HandNote>
        <p className="eyebrow">The rules</p>
        <h1>
          How light <em>spreads</em>.
        </h1>
        <p className="lede">
          Everything you need to play every mode. The first six sections are the whole game; the rest are the dials you can turn once you've played
          it.
        </p>
      </header>

      <div className="rules__layout wrap">
        <nav className="rules__toc" aria-label="Contents">
          <p className="rules__toc-title">Contents</p>
          <ol>
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} aria-current={active === s.id ? "location" : undefined}>
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="rules__article">
          <Section
            id="goal"
            n={1}
            title={
              <>
                Hold the most <em>board</em>.
              </>
            }
            aside={
              <HandNote tilt={-3} size="sm">
                that's it. the rest is{"\n"}how you get there.
              </HandNote>
            }
          >
            <p>
              Two to four players take turns placing <strong>shards</strong>, small shapes made of cells, on a shared grid. When nobody can place
              anything else, whoever owns the most cells wins.
            </p>
            <p>
              The catch is how your territory is allowed to grow. Each new shard has to connect to your own light by a <em>corner</em>, and may never
              sit flat against it along a face. Your colour spreads in diagonals, leaving gaps. Other people live in your gaps.
            </p>
          </Section>

          <Section
            id="seats"
            n={2}
            title={
              <>
                Seats and <em>Cores</em>.
              </>
            }
            aside={
              <HandNote tilt={-4} size="sm" tone="seat-2">
                Pollen goes third.{"\n"}Pollen has opinions about this.
              </HandNote>
            }
          >
            <p>Seats always play in the same order, and each has a colour:</p>
            <p className="rules__seats">
              <SeatChip seat={0} label="first" />
              <SeatChip seat={1} label="second" />
              <SeatChip seat={2} label="third" />
              <SeatChip seat={3} label="fourth" />
            </p>
            <p>
              Every seat starts with one glowing <strong>Core</strong> already on the board, inset from the edge. A Core counts as your own cell for
              linking, but it scores nothing, and nothing can destroy it except the Storm.
            </p>
            <Figure caption="Four Cores on a fresh board. Each is one cell in from its corner.">
              <MiniBoard
                cols={10}
                rows={10}
                cell={22}
                label="An empty ten by ten board with a Core in each corner, inset by one cell."
                cells={[
                  { x: 1, y: 1, seat: 0, kind: "core" },
                  { x: 8, y: 8, seat: 1, kind: "core" },
                  { x: 8, y: 1, seat: 2, kind: "core" },
                  { x: 1, y: 8, seat: 3, kind: "core" },
                  { x: 4, y: 3, kind: "node" },
                  { x: 5, y: 6, kind: "node" },
                  { x: 3, y: 5, kind: "node" },
                  { x: 6, y: 4, kind: "node" },
                ]}
              />
            </Figure>
          </Section>

          <Section
            id="link"
            n={3}
            title={
              <>
                The link <em>rule</em>.
              </>
            }
            aside={
              <>
                <HandNote tilt={-4} size="sm">
                  read this one twice
                </HandNote>
                <Doodle variant="bracket" className="rules__bracket" />
              </>
            }
          >
            <p>A new shard is legal only if all three are true:</p>
            <ol>
              <li>It fits on empty, playable cells.</li>
              <li>
                It touches at least one of your own cells, or your Core, <Highlight>at a corner</Highlight>.
              </li>
              <li>
                It never shares a <strong>face</strong> (in 2D, an edge) with any of your own cells.
              </li>
            </ol>
            <p>
              Touching opponents is always allowed, along faces, corners, whatever you like. The rule only constrains you against yourself.
            </p>
            <Figure caption="Left: legal, the new shard meets Clay at one corner. Right: illegal, it lies along a Clay face.">
              <div className="rules__pair">
                <MiniBoard
                  cols={6}
                  rows={5}
                  cell={26}
                  label="Legal placement: corner contact only."
                  cells={[
                    { x: 0, y: 0, seat: 0, kind: "core" },
                    { x: 1, y: 1, seat: 0 },
                    { x: 2, y: 1, seat: 0 },
                    { x: 1, y: 2, seat: 0 },
                    { x: 3, y: 2, seat: 0, kind: "ghost" },
                    { x: 4, y: 2, seat: 0, kind: "ghost" },
                    { x: 4, y: 3, seat: 0, kind: "ghost" },
                    { x: 2, y: 3, seat: 1 },
                    { x: 3, y: 3, seat: 1 },
                  ]}
                  marks={[{ kind: "corner", x: 3, y: 2, ok: true }]}
                />
                <span className="rules__verdict rules__verdict--ok hand">yes</span>
              </div>
              <div className="rules__pair">
                <MiniBoard
                  cols={6}
                  rows={5}
                  cell={26}
                  label="Illegal placement: shares an edge with Clay."
                  cells={[
                    { x: 0, y: 0, seat: 0, kind: "core" },
                    { x: 1, y: 1, seat: 0 },
                    { x: 2, y: 1, seat: 0 },
                    { x: 1, y: 2, seat: 0 },
                    { x: 2, y: 2, kind: "bad" },
                    { x: 3, y: 2, kind: "bad" },
                    { x: 3, y: 3, kind: "bad" },
                  ]}
                  marks={[
                    { kind: "edge", x: 2, y: 1, side: "b" },
                    { kind: "edge", x: 1, y: 2, side: "r" },
                  ]}
                />
                <span className="rules__verdict hand">no</span>
              </div>
            </Figure>
          </Section>

          <Section
            id="kit"
            n={4}
            title={
              <>
                Your <em>kit</em>.
              </>
            }
            aside={
              <HandNote tilt={-3} size="sm">
                the X is a trap.{"\n"}a beautiful trap.
              </HandNote>
            }
          >
            <p>
              In 2D everyone gets the same <strong>20 shards</strong>: every free shape of two to five cells, one of each. There is no single cell in
              the kit (that's what the Spark surge is for). Shards can be rotated and flipped.
            </p>
            <div className="rules__kit" role="list" aria-label="The 20 shards">
              {SHARDS.map((s) => (
                <span key={s.id} role="listitem" className="rules__kit-item">
                  <ShardGlyph cells={s.cells} size={11} color="var(--seat-0)" title={`${s.name}, ${s.cells.length} cells`} />
                  <span className="mono">{s.name}</span>
                </span>
              ))}
            </div>
            <p>
              In 3D the kit is <strong>17 polycubes</strong>: a domino, two tricubes, all eight one-sided tetracubes (both screw-shaped ones included)
              and six flat pentacubes. You can rotate them but not mirror them, so the chiral pairs count as separate pieces.
            </p>
          </Section>

          <Section
            id="turns"
            n={5}
            title={
              <>
                Turns, and going <em>dark</em>.
              </>
            }
            aside={
              <HandNote tilt={-4} size="sm" tone="muted">
                going dark is not losing.{"\n"}it just feels like it.
              </HandNote>
            }
          >
            <p>
              On your turn you place exactly one shard. In arena modes you may trigger surges first. If you have no legal placement, counting any surge
              your charge could pay for, you go <strong>dark</strong>: you're out for the rest of the game, and your cells stay on the board and keep
              counting.
            </p>
            <p>The game ends when every seat is dark or has placed its entire kit.</p>
          </Section>

          <Section
            id="scoring"
            n={6}
            title={
              <>
                <em>Scoring</em>.
              </>
            }
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">For</th>
                  <th scope="col">Points</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Each cell you own on the board (Cores excluded)</td>
                  <td className="num">+1</td>
                </tr>
                <tr>
                  <td>
                    Placing every shard in your kit, a <em>clean sweep</em>
                  </td>
                  <td className="num">+5</td>
                </tr>
                <tr>
                  <td>Gravity modes: each column whose top cube is yours (a crown)</td>
                  <td className="num">+1</td>
                </tr>
              </tbody>
            </table>
            <p>Teams add their seats together. Ties are shared; nobody has to arm-wrestle.</p>
          </Section>

          <Section
            id="arena"
            n={7}
            title={
              <>
                Nodes and <em>surges</em>.
              </>
            }
            aside={
              <HandNote tilt={-3} size="sm">
                Pure mode turns all of{"\n"}this off. purists rejoice.
              </HandNote>
            }
          >
            <p>
              The arena layer is on by default. Neutral <strong>nodes</strong> are scattered with rotational symmetry, so every seat sees the same map
              from its corner. Cover a node with a shard and you gain <strong>+1 charge</strong>, up to 9. Spend charge on surges during your turn:
            </p>
            <p>
              Going second in a two-player 2D game is a real handicap, because your opponent reaches the nodes first. So the second player starts with{" "}
              <strong>2 charge</strong> in hand (1 on a torus). We measured it; it evens things out.
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">Surge</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Effect</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Spark</strong></td>
                  <td className="num">1</td>
                  <td>Place a single cell this turn instead of a kit shard. This is your placement.</td>
                </tr>
                <tr>
                  <td><strong>Leap</strong></td>
                  <td className="num">2</td>
                  <td>
                    This placement only needs a cell within 2 (counting diagonals) of your light, not a corner touch. Still no face contact with your own
                    cells. Combine with Spark for 3.
                  </td>
                </tr>
                <tr>
                  <td><strong>Shatter</strong></td>
                  <td className="num">3</td>
                  <td>
                    Destroy one opponent cell (not a Core, not an ally, nothing stacked on it). It becomes a <em>scar</em>: dead, unscorable, unplaceable,
                    but solid. Once per turn; you still place afterwards.
                  </td>
                </tr>
                <tr>
                  <td><strong>Scan</strong></td>
                  <td className="num">1</td>
                  <td>Fog modes only. See the whole board until the end of your next turn. You still place afterwards.</td>
                </tr>
              </tbody>
            </table>
            <Figure caption="A Leap: the new cell is two away from Clay's light, with no corner touch. A Shatter has scarred one Tide cell.">
              <MiniBoard
                cols={7}
                rows={5}
                cell={26}
                label="Leap and Shatter example."
                cells={[
                  { x: 0, y: 0, seat: 0, kind: "core" },
                  { x: 1, y: 1, seat: 0 },
                  { x: 1, y: 2, seat: 0 },
                  { x: 3, y: 2, seat: 0, kind: "ghost" },
                  { x: 4, y: 1, seat: 1 },
                  { x: 5, y: 1, seat: 1 },
                  { x: 5, y: 2, kind: "scar" },
                  { x: 5, y: 3, seat: 1 },
                  { x: 3, y: 4, kind: "node" },
                ]}
                marks={[{ kind: "ring", x: 5, y: 2 }]}
              />
            </Figure>
          </Section>

          <Section
            id="fog"
            n={8}
            title={
              <>
                Fog of <em>war</em>.
              </>
            }
            aside={
              <HandNote tilt={-4} size="sm">
                misfires are funny when{"\n"}they happen to other people
              </HandNote>
            }
          >
            <p>
              You see every cell within distance <em>R</em> (counting diagonals) of your own cells and Core; allies share sight. Everywhere else shows your
              last-seen memory of it, marked stale. The board outline and Storm ash are always public.
            </p>
            <p>
              Opponents' scores, charge and remaining kit are hidden until the end. If you place onto something you couldn't see, an occupied cell or a
              missing support, it's a <strong>misfire</strong>: the shard stays in your kit, the conflicting cells are revealed to you, and your turn
              ends. Spectators see only the public map until the game is over.
            </p>
            <Figure caption="Fog radius 2 around Tide's light. Grey cells are memory, not sight.">
              <MiniBoard
                cols={9}
                rows={7}
                cell={22}
                label="Fog of war example."
                cells={[
                  { x: 4, y: 3, seat: 1 },
                  { x: 5, y: 4, seat: 1 },
                  { x: 3, y: 2, seat: 1 },
                  ...[...Array(63).keys()]
                    .map((i) => ({ x: i % 9, y: Math.floor(i / 9) }))
                    .filter(({ x, y }) => {
                      const near = [[4, 3], [5, 4], [3, 2]].some(([a, b]) => Math.max(Math.abs(x - a!), Math.abs(y - b!)) <= 2);
                      return !near;
                    })
                    .map(({ x, y }) => ({ x, y, kind: "fog" as const })),
                  { x: 0, y: 6, seat: 0 },
                  { x: 8, y: 0, seat: 2 },
                ]}
              />
            </Figure>
          </Section>

          <Section
            id="storm"
            n={9}
            title={
              <>
                <em>Storm</em>.
              </>
            }
          >
            <p>
              Starting at a set round, and every few rounds after, the outermost living ring of the board collapses into <strong>ash</strong>: cells
              there are destroyed and stop scoring, at every height. It stops when the living area would drop below a minimum span. In the Storm preset
              the first collapse is on round 6 and then every 3 rounds.
            </p>
          </Section>

          <Section
            id="torus"
            n={10}
            title={
              <>
                Torus and board <em>shapes</em>.
              </>
            }
            aside={
              <HandNote tilt={-3} size="sm">
                on a torus, every corner{"\n"}is a corner. even that one.
              </HandNote>
            }
          >
            <p>
              On a <strong>torus</strong> the board wraps on both axes: a shard can leave the right edge and come back on the left, and corners link across
              the seam. 2D boards also come in four shapes: <code>square</code>, <code>octagon</code> (cut corners), <code>cross</code> and{" "}
              <code>diamond</code>.
            </p>
          </Section>

          <Section
            id="teams"
            n={11}
            title={
              <>
                <em>Teams</em> and shared light.
              </>
            }
          >
            <p>
              Seats one and three play against two and four. With <strong>shared light</strong> on, an ally's cells count for your corner link, and
              you may touch an ally along a face. You still can't sit flat against yourself.
            </p>
            <p className="rules__seats">
              <SeatChip seat={0} /> <span className="muted">+</span> <SeatChip seat={2} /> <span className="muted rules__vs">vs</span>{" "}
              <SeatChip seat={1} /> <span className="muted">+</span> <SeatChip seat={3} />
            </p>
          </Section>

          <Section
            id="gravity"
            n={12}
            title={
              <>
                3D, and <em>gravity</em>.
              </>
            }
            aside={
              <HandNote tilt={-4} size="sm">
                you climb on other people.{"\n"}it's in the rules.
              </HandNote>
            }
          >
            <p>
              In 3D modes a corner means sharing an edge or a vertex but not a face. <strong>Orbit</strong> is a floating 7×7×7 cube (6×6×6 for two) with no gravity.
            </p>
            <p>
              In <strong>Stack</strong>, every cube needs support directly below it: the floor, any occupied cube or scar, or another cube of the same
              shard. Since you can never share a face with yourself, you can't stack straight onto your own cubes, so you climb on your opponents. Each
              column whose top cube is yours is a <strong>crown</strong>, worth a point.
            </p>
          </Section>

          <Section
            id="reference"
            n={13}
            title={
              <>
                Quick <em>reference</em>.
              </>
            }
          >
            <dl className="rules__ref">
              <div>
                <dt>Link</dt>
                <dd>Corner yes. Face no. Opponents anything.</dd>
              </div>
              <div>
                <dt>Turn</dt>
                <dd>Surges (optional), then one placement.</dd>
              </div>
              <div>
                <dt>Dark</dt>
                <dd>No legal placement, even with surges. You're out; your cells stay.</dd>
              </div>
              <div>
                <dt>Score</dt>
                <dd>+1 per cell, +5 clean sweep, +1 per crown.</dd>
              </div>
              <div>
                <dt>Charge</dt>
                <dd>+1 per node covered, max 9. The second player in a two-player 2D game starts with 2 (1 on a torus).</dd>
              </div>
              <div>
                <dt>Surges</dt>
                <dd>
                  <Pill>Spark 1</Pill> <Pill>Leap 2</Pill> <Pill>Shatter 3</Pill> <Pill>Scan 1</Pill>
                </dd>
              </div>
            </dl>
            <div className="rules__cta">
              <Button to="/play" size="lg" iconRight={<ArrowRight />}>
                Try it
              </Button>
              <HandNote tilt={-4} arrow="left" size="sm" className="annot">
                the best tutorial is losing once
              </HandNote>
            </div>
          </Section>
        </article>
      </div>
    </div>
  );
}
