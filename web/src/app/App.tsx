import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router";

const LocalGamePage = lazy(() => import("@/game/LocalGamePage"));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/game/local" element={<LocalGamePage />} />
          <Route path="*" element={<main style={{ padding: 48 }}>cubes</main>} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
