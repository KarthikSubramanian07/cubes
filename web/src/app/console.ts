let greeted = false;

/** Easter egg for the curious: a note in the devtools console. */
export function greetConsole(): void {
  if (greeted || typeof console === "undefined" || import.meta.env.MODE === "test") return;
  greeted = true;
  console.log(
    "%c■%c■ %ccubes",
    "color:#c4502f;font-size:18px",
    "color:#1e1c19;font-size:18px;position:relative;top:9px",
    "font:italic 300 22px Newsreader, Georgia, serif",
  );
  console.log(
    "%cHello, person who opens devtools. The rules engine is Rust; the source is at github.com/KarthikSubramanian07/cubes.\nTip: close this and type the word “corner” anywhere on the page.",
    "font:13px ui-monospace,monospace;color:#6f6a61",
  );
}
