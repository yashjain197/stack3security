import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";
import { useSession } from "../lib/session";

export function Brand() {
  return (
    <Link className="brand" to="/">
      <span className="brand-mark"><Icon name="shield" /></span>
      <span>stack3<span className="brand-light"> security</span></span>
    </Link>
  );
}

export function PublicHeader() {
  const { signedIn } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <Brand />
      <nav className={`public-nav${open ? " public-nav--open" : ""}`} aria-label="Main navigation">
        <Link to="/#product">Product</Link>
        <Link to="/how-it-works">How it works</Link>
        <Link to="/pricing">Pricing</Link>
      </nav>
      <div className="public-actions">
        <Link className="sign-in" to={signedIn ? "/dashboard/settings" : "/login"}>
          {signedIn ? "Account" : "Sign in"}
        </Link>
        <Link className="button button--primary button--small" to="/dashboard">Open dashboard</Link>
      </div>
      <button
        className="menu-toggle"
        aria-label="Open navigation menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="grid" />
      </button>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="footer-main">
        <Brand />
        <p>Web3 security for developers and users.</p>
      </div>
      <div className="footer-links">
        <Link to="/#product">Product</Link>
        <Link to="/how-it-works">How it works</Link>
        <Link to="/pricing">Pricing</Link>
        <Link to="/dashboard/settings">Privacy</Link>
        <a href="mailto:hello@stack3security.example">Contact</a>
      </div>
      <p className="footer-disclaimer">
        Stack3 Security provides risk indicators and security information, not a guarantee that software,
        websites, transactions, or smart contracts are safe. Always review wallet requests carefully.
      </p>
      <span className="footer-copy">© Stack3 Security · Demo experience</span>
    </footer>
  );
}

export function PublicShell({ children, mainClassName }: { children: ReactNode; mainClassName?: string }) {
  return (
    <div className="public-shell">
      <PublicHeader />
      <main className={mainClassName}>{children}</main>
      <PublicFooter />
    </div>
  );
}
