import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon";
import { Brand } from "./PublicShell";
import { useApi, useSession } from "../lib/session";

const navItems: { path: string; label: string; icon: IconName }[] = [
  { path: "/dashboard", label: "Overview", icon: "grid" },
  { path: "/dashboard/scanner", label: "Website scanner", icon: "scan" },
  { path: "/dashboard/transactions", label: "Transactions", icon: "arrows" },
  { path: "/dashboard/contracts", label: "Contracts", icon: "blocks" },
  { path: "/dashboard/repos", label: "Repositories", icon: "code" },
  { path: "/dashboard/graph", label: "Threat graph", icon: "graph" },
  { path: "/dashboard/reports", label: "Reports", icon: "file" },
  { path: "/dashboard/settings", label: "Settings", icon: "settings" },
  { path: "/account/billing", label: "Billing", icon: "file" },
  { path: "/account/team", label: "Team", icon: "grid" },
  { path: "/account/sessions", label: "Devices", icon: "lock" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const api = useApi();
  const { user } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activePath = pathname.replace(/\/+$/, "") || "/";
  const email = user?.email;
  const initial = email?.charAt(0).toUpperCase() ?? "S";
  const mode = activePath.startsWith("/dashboard") && activePath !== "/dashboard/settings" ? "LIVE DATA" : "LIVE ACCOUNT";

  async function signOut() {
    try {
      await api.logout();
    } catch (error) {
      console.error("Sign out failed:", error);
    }
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar${sidebarOpen ? " sidebar--open" : ""}`}>
        <Brand />
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Dashboard navigation">
          {navItems.map((item) => (
            <Link
              key={item.path}
              className={`side-link ${activePath === item.path ? "is-active" : ""}`}
              to={item.path}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <span className="help-icon"><Icon name="spark" /></span>
            <strong>Security, with context.</strong>
            <p>Review evidence before you decide.</p>
            <Link to="/how-it-works">How it works <Icon name="arrow" /></Link>
          </div>
          <button
            className="user-profile"
            type="button"
            aria-label="Account settings"
            onClick={() => navigate("/dashboard/settings")}
          >
            <span className="avatar">{initial}</span>
            <span className="user-info">
              <strong>{email ?? "Your workspace"}</strong>
              <small>{email ? "Signed in" : "Not signed in"}</small>
            </span>
            <span className="profile-more">···</span>
          </button>
          <button className="sidebar-signout" type="button" onClick={() => void signOut()}>
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <button
            className="mobile-menu"
            aria-label="Toggle menu"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((value) => !value)}
          >
            <Icon name="grid" />
          </button>
          <div className="breadcrumbs">
            <Link to="/dashboard">Workspace</Link>
            <span>/</span>
            <strong>{navItems.find((item) => item.path === activePath)?.label ?? "Account"}</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-mode"><Icon name="shield" /> {mode}</span>
            <span className="topbar-avatar">{initial}</span>
          </div>
        </header>
        <main className="dashboard-content">{children}</main>
        <footer className="app-footer">
          <span>Stack3 Security · Live scans from the Stack3 API</span>
          <span>Risk indicators, not a guarantee of safety.</span>
        </footer>
      </div>
    </div>
  );
}
