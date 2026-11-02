/**
 * The site's public pages and how they're served to people and to agents.
 * Shared by the build step (scripts/prerender.ts), the Pages middleware
 * (functions/_middleware.ts) and the React app, so they can't drift.
 * Platform-free: no DOM, no Workers types.
 */

export const SITE = "https://playcubes.pages.dev";

export interface ContentPage {
  /** URL path, without a trailing slash ("/" for the home page). */
  path: string;
  /** Name of the Markdown source in web/content/ and of /md/<slug>.md. */
  slug: string;
  title: string;
  description: string;
}

export const CONTENT_PAGES: readonly ContentPage[] = [
  {
    path: "/",
    slug: "index",
    title: "cubes: a free online territory strategy game of light and corners",
    description:
      "Place glowing shards, link them corner to corner, and claim the board. A free online strategy game for 2 to 4 players in 2D and 3D, with friends over a link or against bots. No signup.",
  },
  {
    path: "/play",
    slug: "play",
    title: "Play cubes online, free · cubes",
    description: "Start a game of cubes: make a room and send the link, play against three levels of bots, or pass and play on one screen.",
  },
  {
    path: "/rules",
    slug: "rules",
    title: "The rules of cubes · cubes",
    description: "Every rule of cubes: Cores, the corner link rule, kits, scoring, nodes and surges, fog, storm, torus, teams and the 3D modes.",
  },
  {
    path: "/learn",
    slug: "learn",
    title: "Learn cubes in three minutes · cubes",
    description: "First light: an interactive tutorial on real boards that teaches cubes by doing, in eight short chapters.",
  },
  {
    path: "/about",
    slug: "about",
    title: "About cubes · cubes",
    description: "Who made cubes, why it exists, what makes it different, and how it is built: Rust, WebAssembly and Cloudflare.",
  },
  {
    path: "/contact",
    slug: "contact",
    title: "Contact · cubes",
    description: "How to report a bug, suggest an idea, or privately report a security problem in cubes.",
  },
  {
    path: "/privacy",
    slug: "privacy",
    title: "Privacy · cubes",
    description: "cubes has no accounts, ads, analytics or cookies. Exactly what it stores on your device and in online rooms, and for how long.",
  },
];

/** Markdown served for app routes and errors (not standalone pages). */
export const ROOM_SLUG = "room";
export const NOT_FOUND_SLUG = "not-found";

const ROOM = /^\/r\/[A-HJ-NP-Z2-9]{5}$/;
const APP_ROUTES: readonly RegExp[] = [ROOM, /^\/game\/local$/, /^\/lab$/];

/** Standalone static pages from the build (developer labs), served as they are. */
const STATIC_PAGES: readonly RegExp[] = [/^\/(sound-lab|paper-lab)$/];

export function isStaticPage(path: string): boolean {
  return STATIC_PAGES.some((r) => r.test(normalizePath(path)));
}

/** Strip a trailing slash (but keep "/"). */
export function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function pageFor(path: string): ContentPage | undefined {
  const p = normalizePath(path);
  return CONTENT_PAGES.find((c) => c.path === p);
}

/** Client-side routes that exist but have no static page (rooms, the game). */
export function isAppRoute(path: string): boolean {
  const p = normalizePath(path);
  return APP_ROUTES.some((r) => r.test(p));
}

/** Markdown to answer an app route with, when an agent asks for Markdown. */
export function appRouteSlug(path: string): string {
  return ROOM.test(normalizePath(path)) ? ROOM_SLUG : "play";
}

interface MediaRange {
  type: string;
  q: number;
}

function parseAccept(accept: string): MediaRange[] {
  return accept
    .split(",")
    .map((part) => {
      const [type = "", ...params] = part.trim().toLowerCase().split(";");
      let q = 1;
      for (const p of params) {
        const [k, v] = p.trim().split("=");
        if (k === "q" && v !== undefined) {
          const n = Number(v);
          q = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
        }
      }
      return { type: type.trim(), q };
    })
    .filter((r) => r.type.length > 0);
}

/**
 * True when the client prefers Markdown over HTML: it lists text/markdown
 * with q > 0, and doesn't rank text/html (or a wildcard covering it) above it.
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const ranges = parseAccept(accept);
  const md = Math.max(0, ...ranges.filter((r) => r.type === "text/markdown").map((r) => r.q));
  if (md <= 0) return false;
  const html = Math.max(0, ...ranges.filter((r) => r.type === "text/html" || r.type === "application/xhtml+xml").map((r) => r.q));
  return md >= html;
}
