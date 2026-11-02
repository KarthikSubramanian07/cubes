import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { canStart, type LobbySeat } from "@/pages/room/RoomLobby";
import { orientations, simulate } from "@/pages/landing/heroSim";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { ShardGlyph } from "@/ui/ShardGlyph";
import { Toggle } from "@/ui/Toggle";
import { SHARDS } from "@/ui/shards";

describe("SegmentedControl", () => {
  function Harness() {
    const [v, setV] = useState("b");
    return (
      <SegmentedControl
        label="Level"
        value={v}
        onChange={setV}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C", disabled: true },
        ]}
      />
    );
  }

  test("is a radiogroup with roving tabindex and arrow-key selection that skips disabled options", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Level" })).toBeInTheDocument();
    const b = screen.getByRole("radio", { name: "B" });
    expect(b).toHaveAttribute("aria-checked", "true");
    expect(b).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("tabindex", "-1");
    act(() => fireEvent.keyDown(b, { key: "ArrowRight" }));
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Toggle", () => {
  test("is a switch that reports its state", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Fog" hint="See less" />);
    const sw = screen.getByRole("switch", { name: /fog/i });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("ShardGlyph", () => {
  test("renders one rect per cell and an accessible name when titled", () => {
    const x = SHARDS.find((s) => s.id === "p5-x")!;
    const { container } = render(<ShardGlyph cells={x.cells} title="X, 5 cells" outline />);
    expect(screen.getByRole("img", { name: "X, 5 cells" })).toBeInTheDocument();
    expect(container.querySelectorAll("rect.glyph__cell")).toHaveLength(5);
    expect(container.querySelector("path.glyph__outline")).not.toBeNull();
  });
});

describe("kit display data", () => {
  test("20 distinct free polyominoes of size 2 to 5", () => {
    expect(SHARDS).toHaveLength(20);
    const sizes = SHARDS.map((s) => s.cells.length);
    expect(sizes.filter((n) => n === 2)).toHaveLength(1);
    expect(sizes.filter((n) => n === 3)).toHaveLength(2);
    expect(sizes.filter((n) => n === 4)).toHaveLength(5);
    expect(sizes.filter((n) => n === 5)).toHaveLength(12);
    // No two shards are the same shape under rotation/reflection.
    const canon = SHARDS.map((s) => orientations(s.cells).map((o) => o.join(";")).sort()[0]);
    expect(new Set(canon).size).toBe(20);
  });
});

describe("hero sim", () => {
  test("every placement obeys the link rule", () => {
    const { size, cores, placements } = simulate({ size: 12, seats: 4, seed: 3 });
    const owner = new Map<string, number>();
    cores.forEach(([x, y], s) => owner.set(`${x},${y}`, s));
    for (const p of placements) {
      let corner = false;
      for (const [x, y] of p.cells) {
        expect(x >= 0 && y >= 0 && x < size && y < size).toBe(true);
        expect(owner.has(`${x},${y}`)).toBe(false);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(owner.get(`${x + dx!},${y + dy!}`)).not.toBe(p.seat);
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) if (owner.get(`${x + dx!},${y + dy!}`) === p.seat) corner = true;
      }
      expect(corner).toBe(true);
      for (const [x, y] of p.cells) owner.set(`${x},${y}`, p.seat);
    }
    expect(placements.length).toBeGreaterThan(10);
  });
});

describe("lobby", () => {
  test("canStart needs two filled seats and everyone ready", () => {
    const host: LobbySeat = { kind: "player", name: "A", ready: false, host: true, you: true };
    expect(canStart([host, { kind: "empty" }])).toBe(false);
    expect(canStart([host, { kind: "bot", level: "ember" }])).toBe(true);
    expect(canStart([host, { kind: "player", name: "B", ready: false }])).toBe(false);
    expect(canStart([host, { kind: "player", name: "B", ready: true }, { kind: "empty" }])).toBe(true);
  });
});
