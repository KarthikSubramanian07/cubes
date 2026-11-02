import { act, fireEvent, render, screen } from "@testing-library/react";
import { fabricate } from "./lab/fabricate";
import { PaperBoard } from "./PaperBoard";
import { makeLayout, viewBoxOf } from "./geometry";

function setup(extra: Partial<Parameters<typeof PaperBoard>[0]> = {}) {
  const onHover = vi.fn();
  const onSelect = vi.fn();
  const g = fabricate("plane");
  const view = g.view(null);
  const utils = render(<PaperBoard view={view} ghost={null} onHover={onHover} onSelect={onSelect} reducedMotion {...extra} />);
  const root = screen.getByTestId("paper-board");
  const svg = root.querySelector("svg")!;
  // jsdom has no layout: give the svg a rect matching its viewBox 1:1.
  const vb = viewBoxOf(makeLayout(20, 20));
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vb.width, height: vb.height, x: 0, y: 0, right: vb.width, bottom: vb.height, toJSON() {} }) as DOMRect;
  const at = (x: number, y: number) => ({ clientX: -vb.x + (x + 0.5) * 40, clientY: -vb.y + (y + 0.5) * 40 });
  return { ...utils, onHover, onSelect, root, svg, at, view, g };
}

test("renders an accessible board with a summary", () => {
  const { root } = setup();
  expect(root).toHaveAttribute("role", "application");
  expect(root).toHaveAttribute("tabindex", "0");
  const sum = document.getElementById(root.getAttribute("aria-describedby")!)!;
  expect(sum.textContent).toMatch(/20 by 20 board/);
  expect(sum.textContent).toMatch(/Clay \d+ cells/);
});

test("pointer hover maps to a cell once per change, and leave clears it", () => {
  const { svg, at, onHover } = setup();
  fireEvent.pointerMove(svg, { ...at(3, 7), pointerType: "mouse" });
  fireEvent.pointerMove(svg, { ...at(3, 7), pointerType: "mouse" });
  expect(onHover).toHaveBeenCalledTimes(1);
  expect(onHover).toHaveBeenLastCalledWith({ cell: 3 + 20 * 7 });
  fireEvent.pointerMove(svg, { ...at(4, 7), pointerType: "mouse" });
  expect(onHover).toHaveBeenLastCalledWith({ cell: 4 + 20 * 7 });
  fireEvent.pointerLeave(svg, { pointerType: "mouse" });
  expect(onHover).toHaveBeenLastCalledWith(null);
});

test("click selects with button and shift", () => {
  const { svg, at, onSelect } = setup();
  fireEvent.pointerDown(svg, { ...at(5, 5), pointerType: "mouse", pointerId: 1, button: 2 });
  fireEvent.pointerUp(svg, { ...at(5, 5), pointerType: "mouse", pointerId: 1, button: 2, shiftKey: true });
  expect(onSelect).toHaveBeenCalledWith({ cell: 105, button: 2, shift: true });
});

test("drag across cells does not select", () => {
  const { svg, at, onSelect } = setup();
  fireEvent.pointerDown(svg, { ...at(5, 5), pointerType: "mouse", pointerId: 1 });
  fireEvent.pointerUp(svg, { ...at(9, 9), pointerType: "mouse", pointerId: 1 });
  expect(onSelect).not.toHaveBeenCalled();
});

test("touch tap hovers then selects", () => {
  const { svg, at, onHover, onSelect } = setup();
  fireEvent.pointerDown(svg, { ...at(2, 3), pointerType: "touch", pointerId: 7 });
  fireEvent.pointerUp(svg, { ...at(2, 3), pointerType: "touch", pointerId: 7 });
  expect(onHover).toHaveBeenLastCalledWith({ cell: 62 });
  expect(onSelect).toHaveBeenCalledWith({ cell: 62, button: 0, shift: false });
});

test("keyboard moves a cursor, announces it and selects with Enter", () => {
  const { root, onHover, onSelect, g } = setup();
  const core = g.cores[0]!;
  act(() => {
    fireEvent.keyDown(root, { key: "ArrowRight" });
  });
  // First arrow lands on the start cell (board centre for spectators).
  const first = onHover.mock.calls.at(-1)![0].cell as number;
  act(() => {
    fireEvent.keyDown(root, { key: "ArrowRight" });
  });
  expect(onHover).toHaveBeenLastCalledWith({ cell: first + 1 });
  const live = root.querySelector("[aria-live]")!;
  expect(live.textContent).toMatch(/^[A-T]\d+, /);
  act(() => {
    fireEvent.keyDown(root, { key: "Enter", shiftKey: true });
  });
  expect(onSelect).toHaveBeenCalledWith({ cell: first + 1, button: 0, shift: true });
  expect(core).toBeGreaterThan(0);
});

test("draws ghost states and marks", () => {
  const { rerender, view, onHover, onSelect } = setup();
  rerender(<PaperBoard view={view} ghost={{ cells: [0, 1], seat: 0, valid: true }} onHover={onHover} onSelect={onSelect} reducedMotion />);
  expect(document.querySelector("[data-ghost=valid]")).not.toBeNull();
  rerender(
    <PaperBoard
      view={view}
      ghost={{ cells: [0, 1], seat: 0, valid: false }}
      marks={{ attach: [5], targets: [6], misfire: [7], lastPlaced: [8, 9] }}
      onHover={onHover}
      onSelect={onSelect}
      reducedMotion
    />,
  );
  expect(document.querySelector("[data-ghost=invalid]")).not.toBeNull();
  expect(screen.getByText("new!")).toBeInTheDocument();
});

test("new shards bleed in unless motion is reduced", () => {
  const g = fabricate("plane");
  const v1 = g.view(null);
  const props = { ghost: null, onHover: () => {}, onSelect: () => {} };
  const { rerender, container } = render(<PaperBoard view={v1} {...props} />);
  g.step();
  rerender(<PaperBoard view={g.view(null)} {...props} />);
  expect(container.querySelector(".pb-bleed")).not.toBeNull();
  g.step();
  rerender(<PaperBoard view={g.view(null)} {...props} reducedMotion />);
  expect(container.querySelector(".pb-bleed")).toBeNull();
});

test("strokes are stable across re-renders", () => {
  const { container, rerender, view, onHover, onSelect } = setup();
  const before = container.querySelector("svg")!.innerHTML;
  rerender(<PaperBoard view={view} ghost={null} onHover={onHover} onSelect={onSelect} reducedMotion />);
  expect(container.querySelector("svg")!.innerHTML).toBe(before);
});
