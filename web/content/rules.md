# The rules of cubes

cubes is a territory game for two to four players. Players take turns placing shards on a shared board. Your light only grows by its corners.

## Seats and Cores

There are two to four seats, coloured Clay, Tide, Pollen and Iris. Every seat starts with one glowing **Core** cell already on the board, set in from the edge. The Core counts as your own light for linking, but it scores nothing.

## Your turn

On your turn you place exactly one shard. Before placing you may trigger surges. If you have no legal placement, including any surge your charge could pay for, you **go dark**: you are out for the rest of the game, and your cells stay on the board and keep scoring.

## The link rule

A new shard must:

- fit on empty cells of the board;
- touch at least one of your own cells (or your Core) at a **corner**: diagonally in 2D, or by an edge or a vertex in 3D;
- never share a **side** with any of your own cells (a face, in 3D).

Touching other players is always allowed.

## Your kit

In 2D you have 20 shards: every free polyomino of two to five cells, 88 cells in all. Shards may be rotated and flipped. In 3D you have 17 cube shards, including both mirror-image screw shapes; they can be rotated but not mirrored.

## Scoring and the end

The game ends when every seat is dark or has placed its whole kit. You score one point per cell you hold (Cores excluded), plus five for placing every shard. In 3D gravity games you also score one point per column you crown, meaning the top cube is yours. Teams add their seats together, and ties are shared.

## Nodes and surges

Neutral **nodes** are scattered symmetrically, so every seat sees the same map. Covering a node gives one **charge**, up to nine. Going second in a two-player 2D game is a real handicap, so the second player starts with two charge (one on a torus).

| Surge | Cost | What it does |
|---|---|---|
| Spark | 1 | Place a single cell instead of a kit shard. |
| Leap | 2 | Link from up to two cells away instead of touching a corner. |
| Shatter | 3 | Destroy one opponent cell (not a Core); it becomes dead scar. Once per turn. |
| Scan | 1 | Fog games only: see the whole board until the end of your next turn. |

## Variants

- **Fog:** you see two cells past your own light; the rest is memory. Placing onto something you could not see is a misfire: the shard stays in your kit and your turn ends.
- **Storm:** every few rounds the outermost ring collapses into ash, destroying what is there.
- **Torus:** the board wraps on both axes.
- **Teams:** seats one and three play seats two and four; with shared light you may link off your ally.
- **Stack (3D):** every cube needs support underneath. You cannot stack on your own colour, so you climb on everyone else's.
- **Orbit (3D):** a floating cube with no gravity.

[Learn by playing](https://playcubes.pages.dev/learn) · [Play](https://playcubes.pages.dev/play)
