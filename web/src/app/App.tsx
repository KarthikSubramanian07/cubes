import { BrowserRouter, Route, Routes } from "react-router";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<main style={{ padding: 48 }}>cubes</main>} />
      </Routes>
    </BrowserRouter>
  );
}
