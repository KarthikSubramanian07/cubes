import type { Vec3 } from "@/engine/types";

/**
 * A crisp little drawing of a shard. 2D shards are flat squares; 3D shards
 * are drawn as isometric cubes so chiral screws read as different.
 */
export function ShardIcon({
  cells,
  color,
  size = 44,
  dim = false,
  iso = false,
}: {
  cells: Vec3[];
  color: string;
  size?: number;
  dim?: boolean;
  iso?: boolean;
}) {
  if (iso) return <IsoIcon cells={cells} color={color} size={size} dim={dim} />;
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  const span = Math.max(w, h, 3);
  const u = 10;
  const ox = ((span - w) * u) / 2;
  const oy = ((span - h) * u) / 2;
  return (
    <svg viewBox={`-2 -2 ${span * u + 4} ${span * u + 4}`} width={size} height={size} aria-hidden="true" className="shard-icon">
      {cells.map(([x, y], i) => (
        <rect
          key={i}
          x={ox + x * u + 0.6}
          y={oy + y * u + 0.6}
          width={u - 1.2}
          height={u - 1.2}
          rx={2}
          fill={color}
          fillOpacity={dim ? 0.18 : 0.92}
          stroke={color}
          strokeOpacity={dim ? 0.35 : 1}
          strokeWidth={0.8}
        />
      ))}
    </svg>
  );
}

function IsoIcon({ cells, color, size, dim }: { cells: Vec3[]; color: string; size: number; dim: boolean }) {
  // Painter's order: far to near.
  const sorted = [...cells].sort((a, b) => a[2] - b[2] || a[1] + a[0] - (b[1] + b[0]));
  const s = 7;
  const proj = ([x, y, z]: Vec3): [number, number] => [(x - y) * s * 0.87, (x + y) * s * 0.5 - z * s];
  const pts = cells.flatMap((c) => [proj(c), proj([c[0] + 1, c[1] + 1, c[2] + 1])]);
  const minX = Math.min(...pts.map((p) => p[0])) - s;
  const maxX = Math.max(...pts.map((p) => p[0])) + s;
  const minY = Math.min(...pts.map((p) => p[1])) - s;
  const maxY = Math.max(...pts.map((p) => p[1])) + s;
  const span = Math.max(maxX - minX, maxY - minY);
  const op = dim ? 0.25 : 1;
  return (
    <svg viewBox={`${minX} ${minY} ${span} ${span}`} width={size} height={size} aria-hidden="true" className="shard-icon">
      {sorted.map((c, i) => {
        const [x, y, z] = c;
        const top = [proj([x, y, z + 1]), proj([x + 1, y, z + 1]), proj([x + 1, y + 1, z + 1]), proj([x, y + 1, z + 1])];
        const left = [proj([x, y + 1, z + 1]), proj([x + 1, y + 1, z + 1]), proj([x + 1, y + 1, z]), proj([x, y + 1, z])];
        const right = [proj([x + 1, y, z + 1]), proj([x + 1, y + 1, z + 1]), proj([x + 1, y + 1, z]), proj([x + 1, y, z])];
        const d = (p: [number, number][]) => p.map((q) => q.join(",")).join(" ");
        return (
          <g key={i} opacity={op} stroke="rgba(0,0,0,.35)" strokeWidth={0.5} strokeLinejoin="round">
            <polygon points={d(left)} fill={color} style={{ filter: "brightness(.7)" }} />
            <polygon points={d(right)} fill={color} style={{ filter: "brightness(.85)" }} />
            <polygon points={d(top)} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}
