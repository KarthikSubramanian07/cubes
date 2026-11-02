import { useEffect } from "react";

export const SITE_URL = "https://playcubes.pages.dev";
export const SITE_NAME = "cubes";
const DEFAULT_IMAGE = `${SITE_URL}/og.png`;

export interface DocumentMeta {
  title: string;
  description: string;
  /** Path for the canonical URL, e.g. "/rules". */
  path: string;
  image?: string;
  noindex?: boolean;
}

function setMeta(attr: "name" | "property", key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

/** Per-route title, description, canonical, OpenGraph and Twitter tags. */
export function useDocumentMeta({ title, description, path, image = DEFAULT_IMAGE, noindex }: DocumentMeta): void {
  useEffect(() => {
    const full = title === SITE_NAME ? title : `${title} · ${SITE_NAME}`;
    const url = `${SITE_URL}${path}`;
    document.title = full;
    setMeta("name", "description", description);
    setMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow");
    setMeta("property", "og:title", full);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", url);
    setMeta("property", "og:image", image);
    setMeta("name", "twitter:title", full);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", image);
    setCanonical(url);
  }, [title, description, path, image, noindex]);
}
