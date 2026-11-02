import { useEffect, useId, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Button } from "./Button";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import "./nav.css";

const LINKS = [
  { to: "/play", label: "Play" },
  { to: "/rules", label: "Rules" },
  { to: "/#modes", label: "Modes" },
  { to: "/#faq", label: "FAQ" },
];

/** Site masthead. On phones the links fold into a small sheet. */
export function Nav() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const location = useLocation();

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [location.pathname, location.hash]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="nav" data-open={open} data-scrolled={scrolled}>
      <div className="nav__inner wrap">
        <Logo />
        <nav aria-label="Main" className="nav__links">
          <ul>
            {LINKS.map((l) => (
              <li key={l.to}>
                {l.to.includes("#") ? (
                  <Link to={l.to} className="nav__link">
                    {l.label}
                  </Link>
                ) : (
                  <NavLink to={l.to} end className="nav__link">
                    {l.label}
                  </NavLink>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="nav__end">
          <ThemeToggle />
          <Button to="/play" size="sm" className="nav__cta">
            Play now
          </Button>
          <button
            type="button"
            className="nav__menu-btn"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="sr-only">Menu</span>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d={open ? "M6 6.4 C 10 10, 14 14, 18 17.6 M17.6 6 C 13.8 10, 10 14, 6.2 18" : "M4 8.2 C 9 7.6, 15 8.4, 20 7.8 M4 15.8 C 10 16.4, 14 15.6, 20 16.2"} />
            </svg>
          </button>
        </div>
      </div>
      <div id={menuId} className="nav__sheet" hidden={!open}>
        <ul className="wrap">
          {LINKS.map((l) => (
            <li key={l.to}>
              {l.to.includes("#") ? (
                <Link to={l.to} className="nav__sheet-link">
                  {l.label}
                </Link>
              ) : (
                <NavLink to={l.to} end className="nav__sheet-link">
                  {l.label}
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
