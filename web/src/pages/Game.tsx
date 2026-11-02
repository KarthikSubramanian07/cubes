import { useMemo, useState } from "react";
import { useLocation, useParams } from "react-router";
import { useDocumentMeta } from "@/app/meta";
import { useForceNight } from "@/app/theme";
import { AI_LABELS, buildSetup, type GameSetup } from "@/app/setup";
import { HandNote } from "@/ui/HandNote";
import { SHARDS } from "@/ui/shards";
import type { SurgeName } from "@/ui/SurgeIcon";
import { HeroBoard } from "./landing/HeroBoard";
import { simulate } from "./landing/heroSim";
import { GameShell } from "./game/GameShell";
import { SurgeBar, TopBar, Tray, type HudSeat } from "./game/HudParts";

const MOCK_NAMES = ["", "Rin", "Oskar", "Mae"];

/**
 * /game/:id. A layout placeholder with mock data until the engine worker and
 * renderers are wired in. The canvas slot shows a frozen sim board.
 */
export function Component() {
  useForceNight();
  const { id = "local" } = useParams();
  const location = useLocation();
  const setup: GameSetup = (location.state as { setup?: GameSetup } | null)?.setup ?? buildSetup({ kind: "bots", preset: "plane", bots: [null, "ember", "flare", "nova"] });
  useDocumentMeta({ title: id === "local" ? "Local game" : `Game ${id}`, description: "A game of cubes in progress.", path: `/game/${id}`, noindex: true });

  // Freeze on a ply where it's seat 0's turn, so the HUD shows "your move".
  const STILL_AT = Math.floor(22 / setup.config.seats) * setup.config.seats;
  const sim = useMemo(() => simulate({ size: 14, seats: setup.config.seats, seed: 23 }), [setup.config.seats]);
  const shown = sim.placements.slice(0, STILL_AT);
  const turn = (sim.placements[STILL_AT]?.seat ?? 0) as number;
  const used = useMemo(() => new Set(shown.filter((p) => p.seat === 0).map((p) => p.shard)), [shown]);
  const [selected, setSelected] = useState<string | null>("p5-w");
  const [armed, setArmed] = useState<SurgeName | null>(null);

  const seats: HudSeat[] = Array.from({ length: setup.config.seats }, (_, i) => ({
    seat: i,
    name: i === 0 ? setup.name : setup.bots[i] ? AI_LABELS[setup.bots[i]!].label : (MOCK_NAMES[i] ?? `Seat ${i + 1}`),
    score: shown.filter((p) => p.seat === i).reduce((n, p) => n + p.cells.length, 0),
    charge: [3, 1, 4, 0][i] ?? 0,
    piecesLeft: SHARDS.length - shown.filter((p) => p.seat === i).length,
    you: i === 0,
    bot: setup.bots[i] ? "bot" : null,
  }));

  return (
    <GameShell
      topBar={<TopBar code={id === "local" ? "LOCAL" : id} seats={seats} turn={turn} round={Math.floor(STILL_AT / setup.config.seats) + 1} clock={setup.config.turnSeconds ? `0:${String(setup.config.turnSeconds).padStart(2, "0")}` : null} />}
      canvas={
        <div className="gs-placeholder">
          <HeroBoard size={14} seats={setup.config.seats} seed={23} stillAt={STILL_AT} showScores={false} />
          <p className="gs-placeholder__label mono">canvas slot · render2d / render3d mounts here</p>
        </div>
      }
      tray={<Tray shards={SHARDS} used={used} selected={selected} seat={0} onSelect={setSelected} />}
      surges={<SurgeBar charge={seats[0]?.charge ?? 0} fog={setup.config.fog !== null} armed={armed} onArm={setArmed} />}
      overlay={
        <>
          {turn === 0 && (
            <HandNote className="gs-note gs-note--move" tilt={-4} arrow="right" tone="accent" size="lg">
              your move
            </HandNote>
          )}
          <HandNote className="gs-note gs-note--corner annot" tilt={-6} arrow="down-left" tone="seat-2" size="md">
            nice corner
          </HandNote>
        </>
      }
    />
  );
}
