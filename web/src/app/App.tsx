import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/hanken-grotesk/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";
import "@/styles/index.css";

import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { ToastProvider } from "@/ui/Toast";
import { CornerParty } from "./CornerParty";
import { RouteError, SiteLayout } from "./SiteLayout";
import { greetConsole } from "./console";
import { labRoute } from "@/render3d/routes";

export const routes = [
  {
    Component: SiteLayout,
    ErrorBoundary: RouteError,
    HydrateFallback: () => null,
    children: [
      { index: true, lazy: () => import("@/pages/Landing") },
      { path: "rules", lazy: () => import("@/pages/Rules") },
      { path: "play", lazy: () => import("@/pages/Play") },
      { path: "learn", lazy: () => import("@/tutorial/LearnPage") },
      { path: "r/:code", lazy: () => import("@/pages/Room") },
      { path: "about", lazy: () => import("@/pages/About") },
      { path: "contact", lazy: () => import("@/pages/Contact") },
      { path: "privacy", lazy: () => import("@/pages/Privacy") },
      { path: "*", lazy: () => import("@/pages/NotFound") },
    ],
  },
  {
    path: "game/local",
    lazy: () => import("@/game/LocalGamePage").then((m) => ({ Component: m.default })),
    HydrateFallback: () => null,
    ErrorBoundary: RouteError,
  },
  {
    path: "daily",
    lazy: () => import("@/game/LocalGamePage").then((m) => ({ Component: m.default })),
    HydrateFallback: () => null,
    ErrorBoundary: RouteError,
  },
  { ...labRoute, HydrateFallback: () => null, ErrorBoundary: RouteError },
  { path: "game/:id", lazy: () => import("@/pages/Game"), HydrateFallback: () => null, ErrorBoundary: RouteError },
];

const router = createBrowserRouter(routes);

greetConsole();

export function App() {
  return (
    <ToastProvider>
      <RouterProvider router={router} />
      <CornerParty />
    </ToastProvider>
  );
}
