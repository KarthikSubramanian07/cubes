import { Link } from "react-router";
import { HandNote } from "./HandNote";
import { Logo } from "./Logo";
import "./nav.css";

export function Footer() {
  return (
    <footer className="footer">
      <HandNote className="footer__note annot" tilt={-4} size="sm">
        thanks for scrolling all the way down
      </HandNote>
      <div className="wrap">
        <div className="footer__grid">
          <div className="footer__brand">
            <Logo />
            <p>A territory game of light and corners. Free, in the browser, no account, no ads, no idea why you'd need either.</p>
          </div>
          <div className="footer__col">
            <h2>Play</h2>
            <ul>
              <li><Link to="/play">Start a game</Link></li>
              <li><Link to="/play" state={{ kind: "online" }}>Make a room</Link></li>
              <li><Link to="/play" state={{ kind: "bots" }}>Versus bots</Link></li>
            </ul>
          </div>
          <div className="footer__col">
            <h2>Learn</h2>
            <ul>
              <li><Link to="/rules">Rules</Link></li>
              <li><Link to="/#modes">Modes</Link></li>
              <li><Link to="/#faq">FAQ</Link></li>
            </ul>
          </div>
          <div className="footer__col">
            <h2>Project</h2>
            <ul>
              <li><a href="https://github.com/KarthikSubramanian07/cubes" rel="noopener">Source</a></li>
              <li><Link to="/about">How it's built</Link></li>
              <li><a href="https://github.com/KarthikSubramanian07/cubes/issues" rel="noopener">Report a bug</a></li>
              <li><Link to="/about">About</Link></li>
              <li><Link to="/contact">Contact</Link></li>
              <li><Link to="/privacy">Privacy</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer__base">
          <span>© {new Date().getFullYear()} cubes · MIT licensed</span>
          <span>Made with an unreasonable number of diagonals.</span>
        </div>
      </div>
    </footer>
  );
}
