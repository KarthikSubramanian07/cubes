# Accessibility

cubes aims for WCAG 2.2 AA on the web app (`web/`).

## What works today

- Document `lang`, page titles, landmarks, and a skip link to `#main`.
- Keyboard play on the paper and night boards (arrow keys, place, rotate, help, pause where the HUD exposes it).
- Visible focus, dialogs that restore focus and close on Escape, and target sizes sized for touch.
- Live regions for turn state, toasts, tutorial status, and the paper board’s match summary.
- Colour is not the only cue: seats also use names, glyphs and text scores; charge uses numeric labels beside the pips.
- `prefers-reduced-motion` freezes autoplaying demos; hero boards also expose an explicit Pause/Play control when motion is allowed.
- Contrast tokens (`--faint` and related) meet 4.5:1 against page and panel backgrounds in light and dark themes.

## Boards and the 3D canvas

The night board is a WebGL canvas. A canvas cannot expose each cell to assistive tech the way a DOM grid can. The board host is labelled as an application, described with a live text summary of dimensions and per-seat cell counts, and the canvas itself is `aria-hidden`. Scores, whose turn it is, clocks, and the match log beside the board carry the same state in text. Spatial layout of every shard is still only fully available visually.

The paper (2D) board keeps an `aria-live` summary of turns and outcomes. Hero SVG demos use an `role="img"` label that describes the scene in words.

## Limits

- Online multiplayer, OAuth, and device vibration were not exercised in the automated pass.
- Screen-reader announcements of every individual cell on the night board are not feasible without a separate non-canvas board view.
- Decorative lab / sound-lab / paper-lab pages are development surfaces; they get basic names and reduced-motion behaviour, not a full game HUD.
