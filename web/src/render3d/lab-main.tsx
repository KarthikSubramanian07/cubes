/** Standalone dev entry for the renderer lab (web/lab.html). */
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/newsreader";
import "@fontsource/caveat";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Lab } from "./Lab";

document.body.style.margin = "0";
document.body.style.background = "#0f0e0c";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
);
