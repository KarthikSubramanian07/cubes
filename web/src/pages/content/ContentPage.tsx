import { useEffect, useState } from "react";
import { marked } from "marked";
import { useDocumentMeta } from "@/app/meta";
import { HandNote } from "@/ui/HandNote";
import { CONTENT_PAGES, SITE } from "@/content/routes";
import "./content.css";

// The same Markdown the build pre-renders and agents read (web/content/*.md).
const SOURCES = import.meta.glob("../../../content/*.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

const NOTES: Record<string, string> = {
  about: "the short version: it's a game",
  contact: "we read everything",
  privacy: "the boring, important bit",
};

function toHtml(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  // Keep on-site links on this origin (the Markdown uses absolute URLs for agents).
  return html.replaceAll(`href="${SITE}/`, 'href="/').replaceAll(/href="(https?:\/\/[^"]+)"/g, 'href="$1" rel="noopener"');
}

/** A plain editorial page rendered from web/content/<slug>.md. */
export function ContentPage({ slug }: { slug: "about" | "contact" | "privacy" }) {
  const page = CONTENT_PAGES.find((p) => p.slug === slug)!;
  useDocumentMeta({ title: page.title.replace(/ · cubes$/, ""), description: page.description, path: page.path });
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = SOURCES[`../../../content/${slug}.md`];
    void load?.().then((md) => alive && setHtml(toHtml(md)));
    return () => {
      alive = false;
    };
  }, [slug]);

  return (
    <article className="content wrap-narrow">
      <HandNote tilt={-3} size="md" arrow="down">
        {NOTES[slug]}
      </HandNote>
      {html ? <div className="content__body" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="content__body" aria-busy="true" />}
    </article>
  );
}
