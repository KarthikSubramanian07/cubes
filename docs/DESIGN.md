# cubes: design spec

> The contract every part of the codebase works from. If code and this file
> disagree, one of them is a bug.

**cubes** is an original territory game about light that spreads by its corners.
Players take turns placing shards (polyominoes in 2D, polycubes in 3D) on a
shared lattice. Your light can only grow by touching itself at a corner, never
along a face. Whoever holds the most of the board when nobody can move wins.

Play it at **playcubes.pages.dev**.

---

## 1. Core rules (every mode)

1. **Seats.** 2 to 4 players. Seat colours, in order: **Clay**, **Tide**,
   **Pollen**, **Iris**.
2. **Cores.** Every seat starts with one glowing **Core** cell already on the
   board, inset from the edge. A Core counts as your own cell for linking but
   scores nothing and can never be destroyed (except by the Storm).
3. **Turn.** On your turn you place exactly one shard. Before placing you may
   trigger surges (Arena mode). If you have no legal placement you go **dark**
   (out for the rest of the game).
4. **The link rule.** A new shard must:
   - fit on empty, playable cells;
   - touch at least one of your own cells (or your Core) at a **corner**
     (2D: diagonal; 3D: shares an edge or vertex but not a face);
   - never share a **face** (2D: an edge) with any of your own cells.
   Touching opponents is always allowed.
5. **Kit.** 2D: 20 shards, sizes 2–5 (every free polyomino of that size, 88
   cells; there is no single cell in the kit). Shards may be rotated and
   flipped. 3D: 17 shards (1 domino, 2 tricubes, all 8 one-sided tetracubes
   including both chiral screws, and 6 planar pentacubes: L P T V Y N), 70
   cubes; rotations only, chiral pairs are separate shards.
6. **End.** When every seat is dark or has placed its whole kit.
7. **Score.** One point per cell you own on the board (Cores excluded),
   **+5** for placing every shard in your kit (a *clean sweep*). In gravity
   modes, **+1 per column you crown** (the top cube of the column is yours).
   Teams add their seats together. Ties are shared.

## 2. Arena layer (on by default, off in Pure)

- **Nodes.** Neutral glowing cells scattered with rotational symmetry so every
  seat gets an identical map. Covering a node gives **+1 charge** (max 9).
- **Second-seat charge.** In two-seat 2D arena games the second seat starts
  with **2 charge** (1 on a torus) to offset moving second; 3D boards need
  none. Measured in `docs/BALANCE.md`.
- **Surges** (spend charge on your turn):
  | Surge | Cost | Effect | Ends turn? |
  |---|---|---|---|
  | **Spark** | 1 | Place a single cell this turn instead of a kit shard. | it *is* your placement |
  | **Leap** | 2 | This placement only needs a cell within 2 (Chebyshev) of your light instead of a corner touch. Still no face contact with your own cells. Combines with Spark (cost 3). | it *is* your placement |
  | **Shatter** | 3 | Destroy one opponent cell (not a Core, not an ally, nothing stacked on it). It becomes a **scar**: dead, unscorable, unplaceable, but solid (supports cubes above). Once per turn. | no |
  | **Scan** | 1 | Fog modes only: see the whole board until the end of your next turn. | no |
- A seat only goes dark when it has no legal placement *including* the
  surges its charge can pay for.

## 3. Variants (composable flags in `GameConfig`)

| Preset | Lattice | Flags |
|---|---|---|
| **Plane** | 20×20, 4 seats (14×14 for 2) | arena |
| **Duel** | 14×14, 2 seats | arena |
| **Pure** | 20×20 | no arena |
| **Fog** | 18×18 | arena, fog radius 2 |
| **Storm** | 20×20 | arena, storm from round 6 every 3 rounds |
| **Torus** | 18×18 wraps on both axes | arena |
| **Teams** | 20×20, 4 seats, seats 0+2 vs 1+3 | arena, shared light |
| **Stack** (3D) | 8×8×8 (8×8×6 for 2) | gravity, crowns, arena |
| **Orbit** (3D) | 7×7×7 (6×6×6 for 2) | no gravity, arena |

Board shapes for 2D: `square`, `octagon` (cut corners), `cross`, `diamond`.

### Fog of war
- You see every cell within Chebyshev distance *R* of your own cells and
  Core (allies share sight). Everything else shows your **last-seen memory**
  of it, marked stale. Storm ash and the board outline are always public.
- Opponents' scores, charge and remaining kit are hidden until the end.
- If you place onto something you couldn't see (an unseen occupied cell, or
  an unseen support missing), it's a **misfire**: the shard stays in your
  kit, the conflicting cells are revealed to you, and your turn ends.
- Spectators in fog games see only the public map until the game ends.

### Storm
Starting at round `start`, every `every` rounds the outermost living ring of
the board (all heights) collapses into **ash**: cells there are destroyed and
stop scoring. It stops when the living area would drop below `minSpan`.

### Teams and shared light
Seats 0+2 vs 1+3. With shared light, an ally's cells count for your corner
link, and you may touch an ally along a face.

### Gravity (Stack)
Every cube needs support directly below it: the floor, any occupied cube or
scar, or another cube of the same shard. Because you may never share a face
with yourself, you cannot stack directly on your own cubes. You climb on
your opponents. Crowning columns rewards it.

## 4. Architecture

```
crates/engine   Rust. Rules, geometry, kits, move generation, fog, scoring,
                replay codec, AI (heuristic + MCTS). No platform deps.
crates/wasm     wasm-bindgen wrapper for the browser (Web Worker).
crates/rooms    workers-rs Durable Object: one actor per room, hibernating
                WebSockets, authoritative engine, bots, turn clocks.
crates/sim      Self-play CLI for balance tuning.
web/            Vite + React + TypeScript UI, three.js renderer, Bun tooling.
web/functions   Pages Function: /api/room/:code -> Durable Object (same origin).
```

- **Authority.** The room Durable Object owns the truth. Clients send
  intents; the server validates with the same Rust engine and broadcasts a
  per-seat **View** (redacted under fog).
- **Local play** (hot-seat, vs bots, tutorial) runs entirely in the browser
  on the WASM engine. No server.
- **Deploy.** Cloudflare Pages project `playcubes` (static site + one Pages
  Function), Worker `playcubes-rooms` (Rust Durable Object). Same origin, so
  no CORS or CSP exceptions.

### Engine data contract (JSON, camelCase)

- `GameConfig`: `{ dims:[w,h,d], shape, topology:"flat"|"torus", gravity,
  seats, teams, sharedLight, arena, nodes, fog: null|radius, storm:
  null|{start,every,minSpan}, crowns, turnSeconds: null|n, kit:"shards"|"cubes" }`
- `Action` (tagged by `type`):
  `place {piece, orient, at:[x,y,z], leap}` (piece index into kit, or the
  kit length for a Spark), `shatter {cell}`, `scan`, `resign`.
- `View`: config, seat, cell owners, per-cell flags (node, core, stale,
  visible), per-seat public info, turn, round, phase, events, scores.
- Cell owner codes: `0` empty, `1..4` seat+1, `250` void (off-board),
  `251` scar, `252` ash.

## 5. Aesthetic

Two registers, one personality.

- **Paper** (site shell: landing, rules, lobby). Warm paper, ink, one clay
  accent, a light editorial serif with italic accents, a hand-written
  annotation layer (Caveat + hand-drawn SVG Bézier arrows, circles,
  underlines that draw themselves), dashed sketchbook rules, mono eyebrows.
  Never bold serif headlines, never gradients-on-everything, never generic
  component-library chrome.
- **Night** (in-game). The board is a luminous object on warm near-black:
  glassy cubes with emissive cores, selective bloom, a holographic grid,
  particles on placement, the fog as drifting volumetric haze. The same
  hand-written annotations appear in the HUD ("your move", arrows to the
  tray, "nice corner").

Copy is dry, specific and human. Never mention other games by name.
