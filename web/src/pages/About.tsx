import { ContentPage } from "./content/ContentPage";

/** /about: rendered from web/content/about.md, the same source agents read. */
export function Component() {
  return <ContentPage slug="about" />;
}
