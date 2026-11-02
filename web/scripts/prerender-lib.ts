/**
 * Pure helpers for scripts/prerender.ts: turn the built SPA shell into a
 * per-page HTML file whose meaningful text is present without JavaScript.
 */
import { marked } from "marked";
import { SITE, type ContentPage } from "../src/content/routes";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Markdown to HTML, with absolute site links made relative so they stay on this origin. */
export function markdownToHtml(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  return html.replaceAll(`href="${SITE}/`, 'href="/').replaceAll(`href="${SITE}"`, 'href="/"');
}

/** Insert a page's content and metadata into the SPA shell. */
export function injectPage(shell: string, page: ContentPage, contentHtml: string): string {
  const url = page.path === "/" ? `${SITE}/` : `${SITE}${page.path}`;
  let out = shell;
  const swap = (re: RegExp, value: string) => {
    if (!re.test(out)) throw new Error(`prerender: shell is missing ${re}`);
    out = out.replace(re, value);
  };
  swap(/<title>[\s\S]*?<\/title>/, `<title>${escapeText(page.title)}</title>`);
  swap(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeAttr(page.description)}" />`);
  swap(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`);
  swap(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`);
  swap(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeAttr(page.title)}" />`);
  swap(/<link rel="alternate" type="text\/markdown" href="[^"]*"/, `<link rel="alternate" type="text/markdown" href="/md/${page.slug}.md"`);
  swap(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeAttr(page.description)}" />`);
  // The app replaces #root's children when it mounts; until then (or without
  // JavaScript) this is the page.
  swap(/<div id="root"><\/div>/, `<div id="root"><main class="prerender">\n${contentHtml}</main></div>`);
  return out;
}

/** Where a page's HTML goes in dist/: index.html for "/", else a flat <name>.html (served without redirects). */
export function outputFile(page: ContentPage): string {
  return page.path === "/" ? "index.html" : `${page.path.slice(1)}.html`;
}

/** Plain text of some HTML, for size checks. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Heading levels in document order, e.g. [1, 2, 2, 3, 2]. */
export function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
}
