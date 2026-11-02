/**
 * Pages middleware: makes every URL honest for people and agents.
 *
 * - Content pages (/, /play, /rules, /learn, /about, /contact, /privacy)
 *   are pre-rendered HTML. Ask with `Accept: text/markdown` and you get the
 *   same page as Markdown instead. Both carry `Vary: Accept`.
 * - App routes that only exist client-side (/r/:code, /game/local, /lab)
 *   get the clean app shell (or a short Markdown explainer).
 * - Anything else is a real 404, as the app's 404 page or as Markdown.
 * - /api/* (room WebSockets) passes straight through.
 */
import {
  NOT_FOUND_SLUG,
  appRouteSlug,
  isAppRoute,
  isStaticPage,
  normalizePath,
  pageFor,
  prefersMarkdown,
} from "../src/content/routes";

export interface MiddlewareEnv {
  ASSETS: { fetch(input: Request | string | URL): Promise<Response> };
}

/** The pristine SPA shell, written by scripts/prerender.ts. */
export const SHELL_PATH = "/shell";

function withVary(res: Response): Response {
  const out = new Response(res.body, res);
  const vary = out.headers.get("Vary");
  // Compare whole tokens: "Accept-Encoding" is not "Accept".
  const has = (vary ?? "").split(",").some((t) => t.trim().toLowerCase() === "accept" || t.trim() === "*");
  if (!has) out.headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
  return out;
}

async function markdown(env: MiddlewareEnv, url: URL, slug: string, status: number): Promise<Response> {
  const src = await env.ASSETS.fetch(new URL(`/md/${slug}.md`, url));
  const body = src.ok ? await src.text() : "# cubes\n\nThis page has no Markdown version. See https://playcubes.pages.dev/llms.txt\n";
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Vary": "Accept",
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function shell(env: MiddlewareEnv, url: URL, status: number): Promise<Response> {
  const src = await env.ASSETS.fetch(new URL(SHELL_PATH, url));
  const headers = new Headers(src.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Vary", "Accept");
  if (status !== 200) headers.set("Cache-Control", "no-store");
  return new Response(src.body, { status, headers });
}

export async function handle(request: Request, env: MiddlewareEnv, next: () => Promise<Response>): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  if (path.startsWith("/api/")) return next();

  const md = prefersMarkdown(request.headers.get("Accept"));

  const page = pageFor(path);
  if (page) return md ? markdown(env, url, page.slug, 200) : withVary(await next());

  if (isAppRoute(path)) return md ? markdown(env, url, appRouteSlug(path), 200) : shell(env, url, 200);

  if (isStaticPage(path)) return next();

  // Files (icons, manifest, llms.txt...) are served as they are. If one is
  // missing, the host falls back to the HTML shell; turn that into a 404.
  if (/\.[a-z0-9]+$/i.test(path)) {
    const res = await next();
    const html = (res.headers.get("Content-Type") ?? "").includes("text/html");
    if (res.ok && html && !path.endsWith(".html")) return md ? markdown(env, url, NOT_FOUND_SLUG, 404) : shell(env, url, 404);
    return res;
  }

  return md ? markdown(env, url, NOT_FOUND_SLUG, 404) : shell(env, url, 404);
}

export const onRequest = (context: { request: Request; env: MiddlewareEnv; next: () => Promise<Response> }) =>
  handle(context.request, context.env, context.next);
