// @vitest-environment node
import { CONTENT_PAGES, appRouteSlug, isAppRoute, normalizePath, pageFor, prefersMarkdown } from "@/content/routes";

describe("Accept negotiation", () => {
  it.each([
    ["text/markdown", true],
    ["text/markdown; charset=utf-8", true],
    ["text/markdown, text/html;q=0.9", true],
    ["text/html, text/markdown", true],
    ["text/html;q=0.8, text/markdown;q=0.9", true],
    ["text/html, text/markdown;q=0.5", false],
    ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", false],
    ["*/*", false],
    ["text/markdown;q=0", false],
    ["", false],
  ])("%s -> %s", (accept, md) => {
    expect(prefersMarkdown(accept)).toBe(md);
  });
  it("treats a missing header as HTML", () => {
    expect(prefersMarkdown(null)).toBe(false);
  });
});

describe("routes", () => {
  it("finds content pages with or without a trailing slash", () => {
    expect(pageFor("/")?.slug).toBe("index");
    expect(pageFor("/rules/")?.slug).toBe("rules");
    expect(pageFor("/privacy")?.slug).toBe("privacy");
    expect(pageFor("/nope")).toBeUndefined();
    expect(normalizePath("/about/")).toBe("/about");
  });
  it("knows the client-side routes", () => {
    expect(isAppRoute("/r/K7QXM")).toBe(true);
    expect(isAppRoute("/r/K7QXI")).toBe(false); // I is not in the room alphabet
    expect(isAppRoute("/r/k7qxm")).toBe(false);
    expect(isAppRoute("/game/local")).toBe(true);
    expect(isAppRoute("/game/whatever")).toBe(false);
    expect(appRouteSlug("/r/K7QXM")).toBe("room");
    expect(appRouteSlug("/game/local")).toBe("play");
  });
  it("lists every page once", () => {
    expect(new Set(CONTENT_PAGES.map((p) => p.path)).size).toBe(CONTENT_PAGES.length);
  });
});
