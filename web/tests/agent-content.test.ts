// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONTENT_PAGES, SITE } from "@/content/routes";
import { headingLevels, injectPage, markdownToHtml, outputFile, textOf } from "../scripts/prerender-lib";

const web = resolve(process.cwd());
const read = (p: string) => readFileSync(resolve(web, p), "utf8");
const shell = read("index.html");

describe("pre-rendered pages", () => {
  for (const page of CONTENT_PAGES) {
    describe(page.path, () => {
      const html = markdownToHtml(read(`content/${page.slug}.md`));

      it("has a single H1 and heading levels that never skip", () => {
        const levels = headingLevels(html);
        expect(levels[0]).toBe(1);
        expect(levels.filter((l) => l === 1)).toHaveLength(1);
        for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
      });

      it("has at least 500 characters of real text", () => {
        expect(textOf(html).length).toBeGreaterThanOrEqual(500);
      });

      it("is injected into the shell with its own metadata", () => {
        const out = injectPage(shell, page, html);
        const url = page.path === "/" ? `${SITE}/` : `${SITE}${page.path}`;
        expect(out).toContain(`<title>${page.title}</title>`);
        expect(out).toContain(`<link rel="canonical" href="${url}" />`);
        expect(out).toContain(`<meta property="og:url" content="${url}" />`);
        expect(out).toContain(`href="/md/${page.slug}.md"`);
        expect(out).toMatch(/<div id="root"><main class="prerender">[\s\S]*<h1/);
        // Without JavaScript, the body carries the page's text.
        const body = out.slice(out.indexOf("<body"));
        expect(textOf(body).length).toBeGreaterThanOrEqual(500);
      });
    });
  }

  it("keeps on-site links on this origin", () => {
    const html = markdownToHtml("[Rules](https://playcubes.pages.dev/rules) [Home](https://playcubes.pages.dev)");
    expect(html).toContain('href="/rules"');
    expect(html).toContain('href="/"');
  });

  it("writes flat files so pages are served without redirects", () => {
    expect(CONTENT_PAGES.map(outputFile)).toEqual(["index.html", "play.html", "rules.html", "learn.html", "about.html", "contact.html", "privacy.html"]);
  });
});

describe("machine-readable files", () => {
  it("llms.txt follows the llms.txt format and says when to use cubes", () => {
    const txt = read("public/llms.txt");
    const lines = txt.split("\n");
    expect(lines[0]).toMatch(/^# \S/);
    expect(lines.filter((l) => /^# /.test(l))).toHaveLength(1);
    expect(txt).toMatch(/\n> .+/);
    expect(txt).toContain("\n## When to use\n");
    // Every H2 section is a list of [name](url) entries, and every link is absolute.
    const sections = txt.split(/\n## /).slice(1);
    for (const s of sections) {
      const items = s.split("\n").slice(1).filter((l) => l.trim());
      expect(items.length).toBeGreaterThan(0);
      for (const item of items.filter((l) => l.startsWith("- "))) expect(item).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)]+\)/);
    }
    for (const page of CONTENT_PAGES) expect(txt).toContain(`${SITE}/md/${page.slug}.md`);
  });

  it("sitemap lists every content page", () => {
    const xml = read("public/sitemap.xml");
    for (const page of CONTENT_PAGES) expect(xml).toContain(`<loc>${page.path === "/" ? `${SITE}/` : `${SITE}${page.path}`}</loc>`);
  });

  it("robots.txt points to the sitemap and llms.txt", () => {
    const robots = read("public/robots.txt");
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).toContain(`${SITE}/llms.txt`);
  });

  it("JSON-LD describes the game and a complete author", () => {
    const json = shell.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
    const ld = JSON.parse(json);
    expect(ld["@type"]).toBe("VideoGame");
    expect(ld.keywords).toMatch(/strategy game/);
    expect(ld.author).toMatchObject({ "@type": "Person", name: "Karthik Subramanian" });
    expect(ld.author.description.length).toBeGreaterThan(20);
    expect(ld.author.url).toMatch(/^https:\/\//);
    expect(ld.author.sameAs.length).toBeGreaterThan(0);
  });

  it("the home page's keywords appear in its own text", () => {
    const text = textOf(markdownToHtml(read("content/index.md"))).toLowerCase();
    for (const term of ["online", "strategy game", "territory", "board"]) expect(text).toContain(term);
  });
});
