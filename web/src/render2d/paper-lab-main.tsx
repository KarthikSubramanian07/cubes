import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PaperLab } from "./PaperLab";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PaperLab />
  </StrictMode>,
);
