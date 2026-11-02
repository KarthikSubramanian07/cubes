/**
 * Runs after `vite build`. For every content page, writes HTML with the
 * page's text already inside #root (so it's readable without JavaScript),
 * publishes the Markdown sources at /md/<slug>.md for content negotiation,
 * keeps a pristine copy of the app shell for client-side routes, and builds
 * llms-full.txt. Usage: bun scripts/prerender.ts
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONTENT_PAGES, SITE } from "../src/content/routes";
import { injectPage, markdownToHtml, outputFile, textOf } from "./prerender-lib";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "dist");
const content = join(root, "content");

const shell = readFileSync(join(dist, "index.html"), "utf8");
if (shell.includes('class="prerender"')) throw new Error("dist/index.html is already pre-rendered; run vite build first");

// The untouched shell, for /r/:code, /game/local and real 404s.
writeFileSync(join(dist, "shell.html"), shell);

mkdirSync(join(dist, "md"), { recursive: true });
for (const f of readdirSync(content).filter((f) => f.endsWith(".md"))) copyFileSync(join(content, f), join(dist, "md", f));

for (const page of CONTENT_PAGES) {
  const md = readFileSync(join(content, `${page.slug}.md`), "utf8");
  const html = injectPage(shell, page, markdownToHtml(md));
  writeFileSync(join(dist, outputFile(page)), html);
  console.log(`prerender ${page.path.padEnd(9)} -> ${outputFile(page).padEnd(13)} ${textOf(markdownToHtml(md)).length} chars of text`);
}

// Everything in one file for agents that want the whole site at once.
const full = [
  `# cubes: everything on ${SITE}`,
  "",
  "> Every page of the cubes site as Markdown, in one file. The short map is at /llms.txt.",
  "",
  ...CONTENT_PAGES.map((p) => `<!-- ${SITE}${p.path} -->\n\n${readFileSync(join(content, `${p.slug}.md`), "utf8").trim()}\n`),
].join("\n");
writeFileSync(join(dist, "llms-full.txt"), full);
console.log("prerender wrote shell.html, md/*.md, llms-full.txt");
