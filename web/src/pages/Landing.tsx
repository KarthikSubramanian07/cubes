import { CONTENT_PAGES } from "@/content/routes";
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

const HOME = CONTENT_PAGES[0]!;

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
            <strong>cubes</strong> is a strategy game for two to four players. Take turns placing pieces on a shared board. Each new piece must touch
            one of your own at a corner, never along a side. When nobody can move, whoever covers the most squares wins. It runs in your browser: send
            friends a link, or play against bots.
          </p>
          <div className="hero__cta rise" style={{ ["--delay" as string]: "220ms" }}>
            <Button to="/play" size="lg" iconRight={<ArrowRight />}>
              Play now
            </Button>
            <Button to="/play" state={{ kind: "online" }} size="lg" variant="ghost">
              Make a room
            </Button>
            <HandNote className="hero__cta-note annot" arrow="left" tilt={-5} size="sm" tone="muted" delay={1500}>
              free, no sign-up
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
              <dt>Price</dt>
              <dd>Free</dd>
            </div>
          </dl>
        </div>
        <div className="hero__visual">
          <HeroScene />
          <HandNote className="hero__visual-note annot" arrow="up-left" tilt={-3} delay={1800}>
            each flash is a corner touch:{"\n"}the only way to grow
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
          <p className="eyebrow">How to play</p>
          <h2 id="how-title">
            Three rules. That's <em>it</em>.
          </h2>
          <p className="lede">
            Read these three, or <Link to="/learn">learn by playing</Link> in about three minutes. Everything else (power-ups, fog, 3D) builds on them.
          </p>
        </header>
        <ol className="how__grid">
          <Reveal as="li" className="how__step">
            <div className="how__fig">
              <MiniBoard
                cols={6}
                rows={5}
                cell={30}
                label="A Clay Core in the top-left corner, with a first piece touching it diagonally."
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
            <p>Every player starts with one glowing square on the board, their Core. Your first piece must touch it diagonally, corner to corner.</p>
          </Reveal>
          <Reveal as="li" className="how__step" delay={120}>
            <div className="how__fig">
              <MiniBoard
                cols={6}
                rows={5}
                cell={30}
                label="Allowed: a new Clay piece touches an existing Clay square only at a corner. A Tide square beside it doesn't matter."
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
            <h3>Grow from your corners.</h3>
            <p>
              Each new piece must touch one of your own pieces at <Highlight>at least one corner</Highlight>. Touching other players' pieces is always
              fine, and squeezing in next to them is how you block them.
            </p>
          </Reveal>
          <Reveal as="li" className="how__step" delay={240}>
            <div className="how__fig">
              <MiniBoard
                cols={6}
                rows={5}
                cell={30}
                label="Not allowed: the new piece shares a side with an existing Clay square."
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
                sides touch: not allowed
              </HandNote>
            </div>
            <span className="how__num num">03</span>
            <h3>Never side by side.</h3>
            <p>Your pieces can never touch each other along a side. So your colour spreads in diagonals, leaving gaps that the other players race to fill.</p>
          </Reveal>
        </ol>
        <p className="how__more">
          <Button to="/rules" variant="quiet" iconRight={<ArrowRight />}>
            Read the full rules
          </Button>
          <span className="muted">Scoring, power-ups and every mode.</span>
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
            Nine ways to <em>play</em>.
          </h2>
          <p className="lede">The same three rules everywhere. Modes change the board, hide parts of it, shrink it, or add a third dimension.</p>
          <HandNote className="modes__margin annot" tilt={-3} arrow="down" delay={300}>
            new here? start with Duel
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
                    <span className="mode__meta num">
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
  { name: "spark", label: "Spark", cost: 1, text: "Place a single square instead of a piece. Perfect for filling a one-square gap.", foot: "uses your turn" },
  { name: "leap", label: "Leap", cost: 2, text: "Your piece can go up to two squares away from your colour, without a corner touch. Still never side by side.", foot: "uses your turn" },
  { name: "shatter", label: "Shatter", cost: 3, text: "Destroy one opponent square. It turns into a dead block nobody can use or score.", foot: "then take your turn" },
  { name: "scan", label: "Scan", cost: 1, text: "Fog modes only. See the whole board until the end of your next turn.", foot: "then take your turn" },
];

function Surges() {
  return (
    <section className="section surges" id="surges" aria-labelledby="surges-title">
      <div className="wrap surges__grid">
        <header className="section-head surges__head">
          <p className="eyebrow">Power-ups</p>
          <h2 id="surges-title">
            Grab nodes, earn <em>charge</em>.
          </h2>
          <p className="lede">
            Glowing nodes are scattered evenly around the board, so nobody gets a better map. Cover one with a piece to earn one charge (up to nine),
            then spend charge on these power-ups during your turn. Pure mode turns them off.
          </p>
          <div className="surges__charge" aria-label="A charge meter, five of nine">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className={i < 5 ? "pip is-on" : "pip"} />
            ))}
            <span className="num muted surges__charge-label">5 / 9 charge</span>
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
                <p className="surge__foot">{s.foot}</p>
              </div>
            </Reveal>
          ))}
          <li className="surges__note annot" aria-hidden="true">
            <HandNote tilt={-4} arrow="up" delay={400}>
              Leap and Spark combine:{"\n"}3 charge, one square, anywhere close
            </HandNote>
          </li>
        </ul>
      </div>
    </section>
  );
}

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: "Is it free?", a: "Yes. No account, no ads, nothing to buy. It's an open-source project." },
  { q: "Do my friends need to install anything?", a: "No. Make a room, send the link, they open it in a browser tab on whatever they're holding. Phones work." },
  { q: "How long is a game?", a: "A Duel takes about ten minutes. Four players on the full board take twenty to thirty." },
  {
    q: "What happens when I can't move?",
    a: "You're out for the rest of the game, but everything you placed still counts. If you have charge, a power-up might still give you a move, so the game checks that first.",
  },
  { q: "Can I play alone?", a: "Yes, against bots, at three levels: Ember (easy), Flare (medium) and Nova (hard). You can mix levels in one game." },
  {
    q: "What does “corner” mean in 3D?",
    a: "In the 3D modes, your cubes may touch at an edge or a corner point, but never with a whole face. Same rule, more directions.",
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
            Good <em>questions</em>.
          </h2>
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
          ready when you are
        </HandNote>
        <h2 id="closer-title">
          Find a friend. Find a <em className="accent-italic">corner</em>.
        </h2>
        <div className="hero__cta closer__cta">
          <Button to="/play" size="lg" iconRight={<ArrowRight />}>
            Play now
          </Button>
          <Button to="/play" state={{ kind: "bots" }} size="lg" variant="ghost">
            Play against a bot
          </Button>
        </div>
        <Doodle variant="star" className="closer__star annot" color="var(--seat-2)" delay={700} />
      </div>
    </section>
  );
}

export function Component() {
  useDocumentMeta({
    title: HOME.title,
    description: HOME.description,
    path: "/",
  });
  return (
    <>
      <Hero />
      <HowItWorks />
      <Modes />
      <Surges />
      <Faq />
      <Closer />
    </>
  );
}
