import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ApiError } from "./lib/api";
import { SessionProvider, errorMessage, useSession } from "./lib/session";
import type { ApiClient } from "./lib/api";
import { AppShell } from "./components/AppShell";
import { LandingPage } from "./pages/LandingPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ScannerPage } from "./pages/ScannerPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { ContractsPage } from "./pages/ContractsPage";
import { RepositoriesPage } from "./pages/RepositoriesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { GraphPage } from "./pages/GraphPage";
import { LoginPage } from "./pages/LoginPage";
import { PricingPage } from "./pages/PricingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BillingPage } from "./pages/BillingPage";
import { SessionsPage } from "./pages/SessionsPage";
import { TeamPage } from "./pages/TeamPage";
import { TeamsJoinPage } from "./pages/TeamsJoinPage";
import { LinkDevicePage } from "./pages/LinkDevicePage";
import { BillingReturnPage } from "./pages/BillingReturnPage";
import { PublicShell } from "./components/PublicShell";

const routeTitles: Record<string, string> = {
  "/": "Stack3 Security — Verify what happens underneath",
  "/pricing": "Pricing — Stack3 Security",
  "/how-it-works": "How it works — Stack3 Security",
  "/dashboard": "Security overview — Stack3 Security",
  "/dashboard/scanner": "Website scanner — Stack3 Security",
  "/dashboard/transactions": "Transaction analyzer — Stack3 Security",
  "/dashboard/contracts": "Contract overview — Stack3 Security",
  "/dashboard/repos": "Repository scanner — Stack3 Security",
  "/dashboard/graph": "Threat graph — Stack3 Security",
  "/dashboard/reports": "Scan reports — Stack3 Security",
  "/dashboard/settings": "Settings — Stack3 Security",
  "/login": "Sign in — Stack3 Security",
  "/account/billing": "Billing — Stack3 Security",
  "/account/sessions": "Devices — Stack3 Security",
  "/account/team": "Team — Stack3 Security",
  "/billing/return": "Payment confirmation — Stack3 Security",
  "/link": "Link a device — Stack3 Security",
  "/teams/join": "Join a team — Stack3 Security",
};

function TitleAndScroll() {
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    document.title = routeTitles[path] ?? "Stack3 Security";
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) {
        requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth" }));
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { signedIn } = useSession();
  const location = useLocation();
  if (!signedIn) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

function StartupErrorBanner({ error }: { error: ApiError | null }) {
  const { signedIn } = useSession();
  if (!error || signedIn) return null;
  return (
    <div className="account-message account-message--error" role="alert">
      {errorMessage(error)} Account services are unavailable, so live scans cannot run until the API is reachable.
    </div>
  );
}

function AccountRoute({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <PublicShell mainClassName="account-page">{children}</PublicShell>
    </RequireAuth>
  );
}

function DashboardRoute({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}

export function App({ api, startupError }: { api: ApiClient; startupError: ApiError | null }) {
  return (
    <SessionProvider api={api}>
      <BrowserRouter>
        <TitleAndScroll />
        <StartupErrorBanner error={startupError} />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/login" element={<PublicShell mainClassName="account-page"><LoginPage /></PublicShell>} />
          <Route path="/dashboard" element={<DashboardRoute><DashboardPage /></DashboardRoute>} />
          <Route path="/dashboard/scanner" element={<DashboardRoute><ScannerPage /></DashboardRoute>} />
          <Route path="/dashboard/transactions" element={<DashboardRoute><TransactionsPage /></DashboardRoute>} />
          <Route path="/dashboard/contracts" element={<DashboardRoute><ContractsPage /></DashboardRoute>} />
          <Route path="/dashboard/repos" element={<DashboardRoute><RepositoriesPage /></DashboardRoute>} />
          <Route path="/dashboard/graph" element={<DashboardRoute><GraphPage /></DashboardRoute>} />
          <Route path="/dashboard/reports" element={<DashboardRoute><ReportsPage /></DashboardRoute>} />
          <Route path="/dashboard/settings" element={<DashboardRoute><SettingsPage /></DashboardRoute>} />
          <Route path="/account/billing" element={<DashboardRoute><BillingPage /></DashboardRoute>} />
          <Route path="/account/sessions" element={<DashboardRoute><SessionsPage /></DashboardRoute>} />
          <Route path="/account/team" element={<DashboardRoute><TeamPage /></DashboardRoute>} />
          <Route path="/billing/return" element={<AccountRoute><BillingReturnPage /></AccountRoute>} />
          <Route path="/link" element={<AccountRoute><LinkDevicePage /></AccountRoute>} />
          <Route path="/teams/join" element={<AccountRoute><TeamsJoinPage /></AccountRoute>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
