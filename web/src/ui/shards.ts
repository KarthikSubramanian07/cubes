/**
 * Display shapes for the 2D kit: every free polyomino of size 2 to 5 (20 shards).
 * This is presentation data for diagrams and the tray skeleton; the engine's kit
 * (crates/engine) is the authority on orientation and indexing.
 */
export type Cell2 = readonly [x: number, y: number];

export interface ShardShape {
  id: string;
  name: string;
  cells: readonly Cell2[];
}

export const SHARDS: readonly ShardShape[] = [
  { id: "p2", name: "Domino", cells: [[0, 0], [1, 0]] },
  { id: "p3-i", name: "I3", cells: [[0, 0], [1, 0], [2, 0]] },
  { id: "p3-v", name: "V3", cells: [[0, 0], [0, 1], [1, 1]] },
  { id: "p4-i", name: "I4", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: "p4-o", name: "O", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { id: "p4-t", name: "T4", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { id: "p4-s", name: "S", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { id: "p4-l", name: "L4", cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { id: "p5-f", name: "F", cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]] },
  { id: "p5-i", name: "I5", cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  { id: "p5-l", name: "L5", cells: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]] },
  { id: "p5-n", name: "N", cells: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]] },
  { id: "p5-p", name: "P", cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] },
  { id: "p5-t", name: "T5", cells: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]] },
  { id: "p5-u", name: "U", cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { id: "p5-v", name: "V5", cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] },
  { id: "p5-w", name: "W", cells: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]] },
  { id: "p5-x", name: "X", cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: "p5-y", name: "Y", cells: [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]] },
  { id: "p5-z", name: "Z", cells: [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]] },
];

export const SHARD_BY_ID: Record<string, ShardShape> = Object.fromEntries(SHARDS.map((s) => [s.id, s]));
