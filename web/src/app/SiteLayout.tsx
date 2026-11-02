import { useEffect } from "react";
import { isRouteErrorResponse, Link, Outlet, useLocation, useNavigation, useRouteError } from "react-router";
import { Footer } from "@/ui/Footer";
import { HandNote } from "@/ui/HandNote";
import { Nav } from "@/ui/Nav";
import "./layout.css";

/** Scroll to top on navigation, or to the #hash target once it has rendered. */
function useScrollManager(): void {
  const { pathname, hash, key } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
      return;
    }
    let tries = 0;
    let raf = 0;
    const seek = () => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) el.scrollIntoView({ block: "start" });
      else if (tries++ < 30) raf = requestAnimationFrame(seek);
    };
    seek();
    return () => cancelAnimationFrame(raf);
  }, [pathname, hash, key]);
}

function ProgressLine() {
  const nav = useNavigation();
  return <div className="route-progress" data-active={nav.state !== "idle"} aria-hidden="true" />;
}

export function SiteLayout() {
  useScrollManager();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <ProgressLine />
      <Nav />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : "Unknown error";
  return (
    <main className="route-error wrap-narrow">
      <HandNote tilt={-4} size="lg">well, that's not a legal move</HandNote>
      <h1>Something broke.</h1>
      <p className="lede">The page hit an error it didn't plan for. Reloading usually fixes it; if it doesn't, the bug is ours.</p>
      <p className="mono muted route-error__msg">{message}</p>
      <p>
        <Link to="/">Back to the start</Link>
      </p>
    </main>
  );
}
