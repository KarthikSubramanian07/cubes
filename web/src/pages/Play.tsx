import { Link, useLocation, useNavigate } from "react-router";
import { useDocumentMeta } from "@/app/meta";
import { makeRoomCode } from "@/app/roomCode";
import { setupPath, type GameSetup, type SetupKind } from "@/app/setup";
import { HandNote } from "@/ui/HandNote";
import { PlayHub } from "./play/PlayHub";

const NAME_KEY = "cubes:name";

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

/** Router state other pages can pass to preselect a play kind. */
export interface PlayLocationState {
  kind?: SetupKind;
}

export function Component() {
  useDocumentMeta({
    title: "Play",
    description: "Start a game of cubes: make an online room and send the link, play against Ember, Flare or Nova bots, or pass one screen around the table.",
    path: "/play",
  });
  const navigate = useNavigate();
  const location = useLocation();
  const initialKind = (location.state as PlayLocationState | null)?.kind ?? "online";

  function onStart(setup: GameSetup) {
    rememberName(setup.name);
    const s: GameSetup = setup.kind === "online" ? { ...setup, roomCode: makeRoomCode() } : setup;
    navigate(setupPath(s), { state: { setup: s, host: s.kind === "online" } });
  }

  function onJoin(code: string, name: string) {
    if (name.trim()) rememberName(name.trim());
    navigate(`/r/${code}`, { state: { name: name.trim() } });
  }

  return (
    <div className="play wrap">
      <header className="play__head">
        <p className="eyebrow">Play</p>
        <h1>
          Pull up a <em>chair</em>.
        </h1>
        <p className="lede">Three choices and you're in. Everything past step three is optional, and most of it is for people who have already lost a few games.</p>
        <p className="muted">
          New here? <Link to="/learn">Learn in three minutes</Link> first.
        </p>
        <HandNote className="play__head-note annot" tilt={-4} arrow="down-left" delay={300}>
          step three is optional-ish
        </HandNote>
      </header>
      <PlayHub onStart={onStart} onJoin={onJoin} initialKind={initialKind} initialName={storedName()} />
    </div>
  );
}
