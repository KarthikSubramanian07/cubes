// @vitest-environment node
import { handle, type MiddlewareEnv } from "../functions/_middleware";

const SHELL = "<!doctype html><html><body><div id=\"root\"></div></body></html>";
const FILES: Record<string, { body: string; type: string }> = {
  "/shell": { body: SHELL, type: "text/html; charset=utf-8" },
  "/md/index.md": { body: "# cubes: a free online territory strategy game\n\nHello.", type: "text/markdown" },
  "/md/rules.md": { body: "# The rules of cubes\n", type: "text/markdown" },
  "/md/play.md": { body: "# Play cubes\n", type: "text/markdown" },
  "/md/room.md": { body: "# A cubes room\n", type: "text/markdown" },
  "/md/not-found.md": { body: "# Not found\n\nThere is no page here. See https://playcubes.pages.dev/llms.txt\n", type: "text/markdown" },
};

const env: MiddlewareEnv = {
  ASSETS: {
    async fetch(input) {
      const path = new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
      const f = FILES[path];
      return f ? new Response(f.body, { headers: { "Content-Type": f.type } }) : new Response("missing", { status: 404 });
    },
  },
};

/** What the static host would answer: real files, or the SPA fallback (HTML, 200). */
function host(path: string) {
  return async () => {
    if (path === "/favicon.svg") return new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } });
    if (path === "/llms.txt") return new Response("# cubes\n", { headers: { "Content-Type": "text/plain" } });
    return new Response("<!doctype html><title>page</title>", { headers: { "Content-Type": "text/html; charset=utf-8", "Vary": "Accept-Encoding" } });
  };
}

function req(path: string, accept?: string, method = "GET") {
  return new Request(`https://playcubes.pages.dev${path}`, { method, headers: accept ? { Accept: accept } : {} });
}

async function call(path: string, accept?: string, method = "GET") {
  return handle(req(path, accept, method), env, host(path));
}

describe("markdown negotiation", () => {
  it("serves the home page as Markdown with Vary: Accept", async () => {
    const res = await call("/", "text/markdown");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("Vary")).toBe("Accept");
    expect(await res.text()).toMatch(/^# cubes/);
  });
  it("keeps HTML for browsers, and adds Accept to Vary", async () => {
    const res = await call("/", "text/html,application/xhtml+xml,*/*;q=0.8");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Vary")).toBe("Accept-Encoding, Accept");
  });
  it("works for inner pages, with or without a trailing slash", async () => {
    expect(await (await call("/rules", "text/markdown")).text()).toMatch(/^# The rules/);
    expect(await (await call("/rules/", "text/markdown")).text()).toMatch(/^# The rules/);
  });
});

describe("404s", () => {
  it("returns a real 404 with the app shell for unknown paths", async () => {
    const res = await call("/some-path-that-does-not-exist", "text/html");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Vary")).toBe("Accept");
    expect(await res.text()).toContain('<div id="root">');
  });
  it("returns a Markdown 404 that points agents somewhere useful", async () => {
    const res = await call("/some-path-that-does-not-exist", "text/markdown");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    const body = await res.text();
    expect(body.length).toBeGreaterThan(20);
    expect(body).toContain("llms.txt");
  });
  it("turns a missing file (host fell back to HTML) into a 404", async () => {
    expect((await call("/nope.png")).status).toBe(404);
    expect((await call("/old-page.md", "text/markdown")).status).toBe(404);
  });
  it("leaves real files alone", async () => {
    const res = await call("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect((await call("/llms.txt")).status).toBe(200);
  });
  it("404s room links with impossible codes", async () => {
    expect((await call("/r/HELLO1")).status).toBe(404);
  });
});

describe("app routes", () => {
  it("serves the shell for a room link", async () => {
    const res = await call("/r/K7QXM");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SHELL);
  });
  it("explains a room link in Markdown", async () => {
    const res = await call("/r/K7QXM", "text/markdown");
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^# A cubes room/);
  });
  it("passes the developer labs through", async () => {
    expect((await call("/sound-lab")).status).toBe(200);
  });
  it("serves the shell for local games", async () => {
    expect((await call("/game/local")).status).toBe(200);
  });
});

describe("passthrough", () => {
  it("never touches the room WebSocket API", async () => {
    let hit = false;
    const res = await handle(req("/api/room/K7QXM", "text/markdown"), env, async () => {
      hit = true;
      return new Response(null, { status: 426 });
    });
    expect(hit).toBe(true);
    expect(res.status).toBe(426);
  });
  it("ignores non-GET methods", async () => {
    let hit = false;
    await handle(req("/", "text/markdown", "POST"), env, async () => {
      hit = true;
      return new Response("ok");
    });
    expect(hit).toBe(true);
  });
  it("answers HEAD like GET", async () => {
    const res = await call("/nope", "text/markdown", "HEAD");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
  });
});
