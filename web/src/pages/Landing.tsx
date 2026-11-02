import { Link } from "react-router";
import { useDocumentMeta } from "@/app/meta";
import { PRESETS, presetConfig } from "@/app/presets";
import { useInView } from "@/app/useInView";
import { ArrowRight, Button } from "@/ui/Button";
import { Doodle } from "@/ui/Doodle";
import { HandNote } from "@/ui/HandNote";
import { Highlight } from "@/ui/Highlight";
import { MiniBoard } from "@/ui/MiniBoard";
import { ModeArt } from "@/ui/ModeArt";
import { SurgeIcon, type SurgeName } from "@/ui/SurgeIcon";
import { HeroScene } from "./landing/HeroScene";
import "./landing/landing.css";

function Reveal({ children, className, delay = 0, as: Tag = "div" }: { children: React.ReactNode; className?: string; delay?: number; as?: "div" | "li" | "article" }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <Tag ref={ref as never} className={["reveal", className].filter(Boolean).join(" ")} data-inview={inView} style={{ ["--delay" as string]: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap hero__grid">
        <div className="hero__copy">
          <HandNote className="hero__note" arrow="down-right" tilt={-4} highlight size="lg" delay={500}>
            the entire game, in one sentence
          </HandNote>
          <h1 id="hero-title" className="hero__title rise">
            Your light only grows by its{" "}
            <span className="doodled">
              <em className="accent-italic">corners</em>
              <Doodle variant="double-underline" delay={1100} strokeWidth={2.6} />
            </span>
            .
          </h1>
          <p className="lede hero__lede rise" style={{ ["--delay" as string]: "120ms" }}>
            <strong>cubes</strong> is a territory game for two to four people. Place glowing shards, link each one to your own light at a corner, never
            along a face, and hold the most of the board when nobody can move. It runs in a browser tab. Send a link; that's the whole setup.
          </p>
          <div className="hero__cta rise" style={{ ["--delay" as string]: "220ms" }}>
            <Button to="/play" size="lg" iconRight={<ArrowRight />}>
              Play now
            </Button>
            <Button to="/play" state={{ kind: "online" }} size="lg" variant="ghost">
              Make a room
            </Button>
            <HandNote className="hero__cta-note annot" arrow="left" tilt={-5} size="sm" tone="muted" delay={1500}>
              no account. we checked.
            </HandNote>
          </div>
          <p className="hero__learn rise" style={{ ["--delay" as string]: "270ms" }}>
            New here? <Link to="/learn">Learn in three minutes</Link>
          </p>
          <dl className="hero__facts rise" style={{ ["--delay" as string]: "320ms" }}>
            <div>
              <dt>Players</dt>
              <dd>2–4</dd>
            </div>
            <div>
              <dt>Modes</dt>
              <dd>9</dd>
            </div>
            <div>
              <dt>Board</dt>
              <dd>2D + 3D</dd>
            </div>
            <div>
              <dt>Costs</dt>
              <dd>Nothing</dd>
            </div>
          </dl>
        </div>
        <div className="hero__visual">
          <HeroScene />
          <HandNote className="hero__visual-note annot" arrow="up-left" tilt={-3} delay={1800}>
            each spark is a corner touch.{"\n"}that's the only way to grow.
          </HandNote>
        </div>
      </div>
    </section>
  );
}

const CLAY = 0;
const TIDE = 1;

function HowItWorks() {
  return (
    <section className="section how" id="how" aria-labelledby="how-title">
      <div className="wrap">
        <header className="section-head">
          <p className="eyebrow">How it works</p>
          <h2 id="how-title">
            The rules, in three <em>corners</em>.
          </h2>
          <p className="lede">You could read the full rules in four minutes. Or read these three panels, play one game, and never need them again.</p>
          <HandNote className="how__margin annot" tilt={-4} arrow="down-left" delay={300}>
            honestly, panel two is the game
          </HandNote>
        </header>
        <ol className="how__grid">
          <Reveal as="li" className="how__step">
            <div className="how__fig">
              <MiniBoard
                cols={6}
                rows={5}
                cell={30}
                label="A Clay core in the top-left corner, with a first shard touching it diagonally."
                cells={[
                  { x: 1, y: 1, seat: CLAY, kind: "core" },
                  { x: 2, y: 2, seat: CLAY, kind: "ghost" },
                  { x: 3, y: 2, seat: CLAY, kind: "ghost" },
                  { x: 3, y: 3, seat: CLAY, kind: "ghost" },
                  { x: 4, y: 4, kind: "node" },
                ]}
                marks={[{ kind: "corner", x: 2, y: 2, ok: true }]}
              />
              <HandNote className="how__fig-note how__fig-note--1 annot" tilt={-6} size="sm" tone="seat-0" delay={900}>
                your Core
              </HandNote>
            </div>
            <span className="how__num num">01</span>
            <h3>Start at your Core.</h3>
            <p>Every seat begins with one glowing Core on the board. Your first shard has to touch it, but only diagonally, corner to corner.</p>
          </Reveal>
          <Reveal as="li" className="how__step" delay={120}>
            <div className="how__fig">
              <MiniBoard
                cols={6}
                rows={5}
                cell={30}
                label="Legal: a new Clay shard touches an existing Clay cell only at a corner. A Tide cell beside it doesn't matter."
                cells={[
                  { x: 0, y: 0, seat: CLAY, kind: "core" },
                  { x: 1, y: 1, seat: CLAY },
                  { x: 1, y: 2, seat: CLAY },
                  { x: 2, y: 1, seat: CLAY },
                  { x: 3, y: 2, seat: CLAY, kind: "ghost" },
                  { x: 3, y: 3, seat: CLAY, kind: "ghost" },
                  { x: 4, y: 3, seat: CLAY, kind: "ghost" },
                  { x: 2, y: 3, seat: TIDE },
                  { x: 2, y: 4, seat: TIDE },
                ]}
                marks={[{ kind: "corner", x: 3, y: 2, ok: true }]}
              />
              <Doodle variant="check" className="how__check" color="var(--seat-1-ink)" delay={900} />
            </div>
            <span className="how__num num">02</span>
            <h3>Link at a corner.</h3>
            <p>
              Each new shard must touch your own light at <Highlight>at least one corner</Highlight>. Touching other players is always fine. Squeeze in
              next to them; it's encouraged.
            </p>
          </Reveal>
          <Reveal as="li" className="how__step" delay={240}>
            <div className="how__fig">
              <MiniBoard
                cols={6}
                rows={5}
                cell={30}
                label="Illegal: the new shard shares a face with an existing Clay cell."
                cells={[
                  { x: 0, y: 0, seat: CLAY, kind: "core" },
                  { x: 1, y: 1, seat: CLAY },
                  { x: 1, y: 2, seat: CLAY },
                  { x: 2, y: 1, seat: CLAY },
                  { x: 3, y: 1, kind: "bad" },
                  { x: 4, y: 1, kind: "bad" },
                  { x: 4, y: 2, kind: "bad" },
                ]}
                marks={[{ kind: "edge", x: 2, y: 1, side: "r" }]}
              />
              <Doodle variant="cross" className="how__cross" delay={900} />
              <HandNote className="how__fig-note how__fig-note--3 annot" tilt={-5} size="sm" delay={1200}>
                nope. that's a face.
              </HandNote>
            </div>
            <span className="how__num num">03</span>
            <h3>Never along a face.</h3>
            <p>A shard may never share an edge with your own cells. So your territory grows as a lattice of diagonals, and gaps appear that someone else will fill.</p>
          </Reveal>
        </ol>
        <p className="how__more">
          <Button to="/rules" variant="quiet" iconRight={<ArrowRight />}>
            Read the full rules
          </Button>
          <span className="muted">Scoring, surges, fog, storm, gravity, the lot.</span>
        </p>
      </div>
    </section>
  );
}

function Modes() {
  return (
    <section className="section modes" id="modes" aria-labelledby="modes-title">
      <div className="wrap">
        <header className="section-head">
          <p className="eyebrow">Modes</p>
          <h2 id="modes-title">
            Nine ways to run out of <em>room</em>.
          </h2>
          <p className="lede">Same rule everywhere. Change the board, take away your sight, set the edges on fire, add a third dimension.</p>
          <HandNote className="modes__margin annot" tilt={-3} arrow="down" delay={300}>
            start with Duel. trust us.
          </HandNote>
        </header>
        <ul className="modes__grid">
          {PRESETS.map((p, i) => {
            const c = presetConfig(p.name);
            const dims = c.dims[2] > 1 ? `${c.dims[0]}×${c.dims[1]}×${c.dims[2]}` : `${c.dims[0]}×${c.dims[1]}`;
            return (
              <Reveal as="li" key={p.name} className="mode" delay={(i % 3) * 90}>
                <div className="mode__art">
                  <ModeArt mode={p.name} />
                </div>
                <div className="mode__body">
                  <div className="mode__top">
                    <h3>
                      {p.name === "duel" ? (
                        <span className="doodled">
                          {p.label}
                          <Doodle variant="circle" className="mode__circle" delay={600} strokeWidth={1.8} />
                        </span>
                      ) : (
                        p.label
                      )}
                    </h3>
                    <span className="mode__meta mono">
                      {p.dimension === "3d" ? "3D · " : ""}
                      {dims}
                    </span>
                  </div>
                  <p>{p.flavor}</p>
                </div>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const SURGES: { name: SurgeName; label: string; cost: number; text: string; foot: string }[] = [
  { name: "spark", label: "Spark", cost: 1, text: "Place a single cell instead of a shard. Small, cheap, and exactly the size of that gap.", foot: "is your placement" },
  { name: "leap", label: "Leap", cost: 2, text: "This placement only needs to be within two cells of your light, no corner needed. Still no faces.", foot: "is your placement" },
  { name: "shatter", label: "Shatter", cost: 3, text: "Destroy one opponent cell. It becomes a scar: dead, unscorable, and very much their problem now.", foot: "then place as usual" },
  { name: "scan", label: "Scan", cost: 1, text: "Fog modes only. See the whole board until the end of your next turn. Bring snacks.", foot: "then place as usual" },
];

function Surges() {
  return (
    <section className="section surges" id="surges" aria-labelledby="surges-title">
      <div className="wrap surges__grid">
        <header className="section-head surges__head">
          <p className="eyebrow">The arena layer</p>
          <h2 id="surges-title">
            Nodes give charge. Charge buys <em>trouble</em>.
          </h2>
          <p className="lede">
            Neutral nodes are scattered with rotational symmetry, so every seat gets the same map. Cover one and you bank a charge, up to nine. Spend it
            on surges. Pure mode switches all of this off, for people who own a pipe.
          </p>
          <div className="surges__charge" aria-label="A charge meter, five of nine">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className={i < 5 ? "pip is-on" : "pip"} />
            ))}
            <span className="mono muted surges__charge-label">5 / 9 charge</span>
          </div>
        </header>
        <ul className="surges__list">
          {SURGES.map((s, i) => (
            <Reveal as="li" key={s.name} className="surge" delay={i * 90}>
              <SurgeIcon surge={s.name} />
              <div>
                <div className="surge__top">
                  <h3>{s.label}</h3>
                  <span className="surge__cost" aria-label={`costs ${s.cost} charge`}>
                    {Array.from({ length: s.cost }, (_, k) => (
                      <span key={k} className="pip is-on" />
                    ))}
                  </span>
                </div>
                <p>{s.text}</p>
                <p className="surge__foot mono">{s.foot}</p>
              </div>
            </Reveal>
          ))}
          <li className="surges__note annot" aria-hidden="true">
            <HandNote tilt={-4} arrow="up" delay={400}>
              Leap + Spark = 3 charge.{"\n"}you'll want that one.
            </HandNote>
          </li>
        </ul>
      </div>
    </section>
  );
}

function Built() {
  return (
    <section className="section built theme-night" id="built" aria-labelledby="built-title">
      <div className="wrap">
        <header className="section-head">
          <p className="eyebrow">How it's built</p>
          <h2 id="built-title">
            One rulebook, compiled <em>twice</em>.
          </h2>
          <p className="lede">The boring, careful parts. You don't need to know any of this to play, but somebody always asks.</p>
        </header>
        <div className="built__diagram" aria-hidden="true">
          <div className="built__box">
            <span className="mono">your browser</span>
            <strong>React + three.js</strong>
          </div>
          <div className="built__wire">
            <span className="mono">postMessage</span>
          </div>
          <div className="built__box built__box--hot">
            <span className="mono">web worker</span>
            <strong>engine.wasm</strong>
          </div>
          <div className="built__wire built__wire--long">
            <span className="mono">wss · same origin</span>
          </div>
          <div className="built__box built__box--hot">
            <span className="mono">durable object</span>
            <strong>room ABCDE</strong>
          </div>
        </div>
        <div className="built__grid">
          <article>
            <p className="built__path mono">crates/engine</p>
            <h3>The rules are Rust.</h3>
            <p>
              Geometry, the kit, move generation, fog, scoring and the bots live in one crate with no platform dependencies. It compiles to WebAssembly and
              runs in a Web Worker, so pass-and-play and bot games never touch a server.
            </p>
          </article>
          <article>
            <p className="built__path mono">crates/rooms</p>
            <h3>Rooms are actors.</h3>
            <p>
              Each online room is one Cloudflare Durable Object, also Rust. It runs the same engine, validates every move, and sends each seat its own
              redacted view, so fog of war is enforced by the server rather than by good manners.
            </p>
          </article>
          <article>
            <p className="built__path mono">web/src/render3d</p>
            <h3>The board is three.js.</h3>
            <p>
              Glassy cubes, emissive cores, selective bloom, fog as drifting haze. This page uses none of it, to stay fast; the renderer loads when you sit
              down to play.
            </p>
          </article>
        </div>
        <HandNote className="built__note annot" tilt={-3} arrow="up-left" tone="accent" delay={300}>
          yes, the bots run the same engine.{"\n"}no, they can't cheat. we asked.
        </HandNote>
      </div>
    </section>
  );
}

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: "Is it free?", a: "Yes. No account, no ads, no premium shards. It's a hobby project with a very small hosting bill." },
  { q: "Do my friends need to install anything?", a: "No. Make a room, send the link, they open it in a browser tab on whatever they're holding. Phones work." },
  { q: "How long is a game?", a: "A Duel is about ten minutes. Four players on the full Plane board, twenty to thirty, depending on how long Pollen spends staring at the tray." },
  {
    q: "What happens when I can't move?",
    a: "You go dark: you're out for the rest of the game, but your cells still count. Surges you can afford count as moves, so check your charge before you sulk.",
  },
  { q: "Can I play alone?", a: "Yes, against bots. Ember is gentle, Flare is tidy, Nova runs a tree search and doesn't do mercy. You can mix levels per seat." },
  {
    q: "What does “corner” mean in 3D?",
    a: "In Stack and Orbit, cubes link when they share an edge or a vertex but not a face. Same idea, more directions to be wrong in.",
  },
  {
    q: "Can people cheat online?",
    a: "Not easily. The room server holds the real game and checks every move with the same engine your browser uses. In fog modes it never even sends you what you can't see.",
  },
];

function Faq() {
  return (
    <section className="section faq" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq__grid">
        <header className="section-head">
          <p className="eyebrow">FAQ</p>
          <h2 id="faq-title">
            Questions, <em>asked</em>.
          </h2>
          <HandNote className="faq__note annot" tilt={-4} delay={300}>
            frequently is a strong word
          </HandNote>
        </header>
        <div className="faq__list">
          {FAQ.map((f) => (
            <details key={f.q} className="faq__item">
              <summary>
                <span>{f.q}</span>
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" className="faq__plus">
                  <path d="M10 3.6 C 10.2 8, 9.8 12, 10 16.4" />
                  <path d="M3.6 10.2 C 8 9.8, 12 10.2, 16.4 9.9" />
                </svg>
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closer() {
  return (
    <section className="closer" aria-labelledby="closer-title">
      <div className="wrap closer__inner">
        <HandNote className="closer__note" tilt={-4} arrow="down-right" delay={200}>
          go on then
        </HandNote>
        <h2 id="closer-title">
          Find a friend. Find a <em className="accent-italic">corner</em>.
        </h2>
        <div className="hero__cta closer__cta">
          <Button to="/play" size="lg" iconRight={<ArrowRight />}>
            Play now
          </Button>
          <Button to="/play" state={{ kind: "bots" }} size="lg" variant="ghost">
            Practise against a bot
          </Button>
        </div>
        <Doodle variant="star" className="closer__star annot" color="var(--seat-2)" delay={700} />
      </div>
    </section>
  );
}

export function Component() {
  useDocumentMeta({
    title: "cubes",
    description:
      "A territory game of light and corners. Place glowing shards, link them corner to corner, and claim the board. 2D, 3D, fog of war and more, with friends over a link or against bots. Free, no signup.",
    path: "/",
  });
  return (
    <>
      <Hero />
      <HowItWorks />
      <Modes />
      <Surges />
      <Built />
      <Faq />
      <Closer />
    </>
  );
}
