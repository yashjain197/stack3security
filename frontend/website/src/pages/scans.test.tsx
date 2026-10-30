import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../lib/api";
import { makeApi, renderPage, type FakeRequest } from "../test/helpers";
import { ContractsPage } from "./ContractsPage";
import { DashboardPage } from "./DashboardPage";
import { ReportsPage } from "./ReportsPage";
import { RepositoriesPage } from "./RepositoriesPage";
import { ScannerPage } from "./ScannerPage";
import { TransactionsPage } from "./TransactionsPage";

const verdict = (level: string, id: string, extra: Record<string, unknown> = {}) => ({
  level,
  target: { type: "site", id },
  findings: [
    {
      layer: "site",
      severity: level,
      title: "Listed on a phishing blocklist",
      evidence: "metamask-verify.io appears in the Stack3 blocklist.",
      source: "rules",
      checkedAt: "2026-10-30T10:00:00Z",
    },
  ],
  indicators: { addresses: [], domains: [id] },
  notChecked: ["Page content"],
  actions: ["Do not connect your wallet."],
  explanation: "This site is a known wallet drainer.",
  ...extra,
});

beforeEach(() => localStorage.clear());

test("website scanner sends the hostname to check-domain and shows the live verdict", async () => {
  const request = vi.fn<FakeRequest>(async () => verdict("critical", "metamask-verify.io"));
  renderPage("/dashboard/scanner", <ScannerPage />, makeApi(request), "/dashboard/scanner");

  await userEvent.type(screen.getByLabelText("Website URL"), "https://metamask-verify.io/login?x=1");
  await userEvent.click(screen.getByRole("button", { name: /scan website/i }));

  expect(await screen.findByText("This site is a known wallet drainer.")).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith("/v1/check-domain", expect.objectContaining({
    method: "POST", body: { domain: "metamask-verify.io" },
  }));
  expect(screen.getByText("Listed on a phishing blocklist")).toBeInTheDocument();
  expect(screen.getAllByText("Critical")).toHaveLength(2);
  expect(document.body.textContent).not.toMatch(/demo|illustrative|sample/i);
  expect(JSON.parse(localStorage.getItem("stack3.scanHistory.user-1") ?? "[]")).toHaveLength(1);
});

test("website scanner explains a missing plan feature with a link to pricing", async () => {
  const request = vi.fn<FakeRequest>(async () => {
    throw new ApiError("Chrome protection is not enabled for this account", { status: 403, code: "feature_required" });
  });
  renderPage("/dashboard/scanner", <ScannerPage />, makeApi(request), "/dashboard/scanner?domain=example.com");

  expect(await screen.findByRole("alert")).toHaveTextContent("Chrome protection is not enabled");
  expect(screen.getByRole("link", { name: "View plans" })).toHaveAttribute("href", "/pricing");
});

test("contract deep link scans the given chain and address straight away", async () => {
  const address = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const request = vi.fn<FakeRequest>(async () => verdict("caution", address, {
    target: { type: "contract", id: address },
    explanation: "Upgradeable proxy controlled by one wallet.",
  }));
  renderPage("/dashboard/contracts", <ContractsPage />, makeApi(request), `/dashboard/contracts?chain=8453&address=${address}`);

  expect(await screen.findByText("Upgradeable proxy controlled by one wallet.")).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(`/v1/scan-contract/8453/${address}`, expect.anything());
  expect(screen.getByRole("link", { name: /block explorer/i })).toHaveAttribute("href", `https://basescan.org/address/${address}`);
});

test("contract form rejects an invalid address without calling the API", async () => {
  const request = vi.fn<FakeRequest>();
  renderPage("/dashboard/contracts", <ContractsPage />, makeApi(request), "/dashboard/contracts");

  await userEvent.type(screen.getByLabelText("Contract address"), "0x123");
  await userEvent.click(screen.getByRole("button", { name: /review contract/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("40 hex characters");
  expect(request).not.toHaveBeenCalled();
});

test("transaction analyzer builds a review-tx request with the value in wei", async () => {
  const request = vi.fn<FakeRequest>(async () => verdict("high", "tx", { target: { type: "tx", id: "tx" }, explanation: "Unlimited approval to an unverified spender." }));
  renderPage("/dashboard/transactions", <TransactionsPage />, makeApi(request), "/dashboard/transactions");

  fireEvent.change(screen.getByLabelText("Website asking (optional)"), { target: { value: "claim-rewards.io" } });
  fireEvent.change(screen.getByLabelText("To (contract or recipient)"), { target: { value: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" } });
  fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: "0.5" } });
  fireEvent.change(screen.getByLabelText("Call data (hex, optional)"), { target: { value: "0x095ea7b3" } });
  await userEvent.click(screen.getByRole("button", { name: /analyze request/i }));

  expect(await screen.findByText("Unlimited approval to an unverified spender.")).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith("/v1/review-tx", expect.objectContaining({
    method: "POST",
    body: {
      chainId: 1,
      method: "eth_sendTransaction",
      origin: "https://claim-rewards.io",
      to: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      data: "0x095ea7b3",
      value: "0x6f05b59d3b20000",
    },
  }));
});

test("typed-data mode requires valid JSON", async () => {
  const request = vi.fn<FakeRequest>();
  renderPage("/dashboard/transactions", <TransactionsPage />, makeApi(request), "/dashboard/transactions");

  await userEvent.click(screen.getByRole("tab", { name: "Typed data" }));
  fireEvent.change(screen.getByLabelText("Typed data (JSON)"), { target: { value: "{not json" } });
  await userEvent.click(screen.getByRole("button", { name: /analyze request/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("valid JSON");
  expect(request).not.toHaveBeenCalled();
});

test("dashboard and reports show the saved live scans", async () => {
  const request = vi.fn<FakeRequest>(async () => verdict("critical", "metamask-verify.io"));
  const api = makeApi(request);
  const scanner = renderPage("/dashboard/scanner", <ScannerPage />, api, "/dashboard/scanner?domain=metamask-verify.io");
  await screen.findByText("This site is a known wallet drainer.");
  scanner.unmount();

  const dashboard = renderPage("/dashboard", <DashboardPage />, api, "/dashboard");
  expect(screen.getByText("metamask-verify.io")).toBeInTheDocument();
  expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  dashboard.unmount();

  renderPage("/dashboard/reports", <ReportsPage />, api, "/dashboard/reports");
  await userEvent.click(screen.getByRole("link", { name: /view report for metamask-verify.io/i }));
  await waitFor(() => expect(screen.getByText("Listed on a phishing blocklist")).toBeInTheDocument());
});

test("reports show an empty state before any scan", () => {
  renderPage("/dashboard/reports", <ReportsPage />, makeApi(vi.fn<FakeRequest>()), "/dashboard/reports");
  expect(screen.getByText("No scans yet")).toBeInTheDocument();
});

test("repository scanner normalizes the repo, allows a long scan and shows file locations", async () => {
  const request = vi.fn<FakeRequest>(async () => ({
    level: "critical",
    target: { type: "repo", id: "github.com/acme/widget" },
    findings: [
      { layer: "repo-file", severity: "critical", title: "Install script downloads and runs code", evidence: "postinstall pipes curl into sh.", location: { file: "package.json", line: 12 }, source: "rules", checkedAt: "2026-10-30T10:00:00Z" },
      { layer: "secret", severity: "high", title: "Private key committed", evidence: "A PEM private key is in the repository.", location: { file: "deploy/key.pem" }, source: "rules", checkedAt: "2026-10-30T10:00:00Z" },
    ],
    indicators: { addresses: [], domains: [] },
    notChecked: [],
    actions: ["Do not install this package."],
    explanation: null,
  }));
  renderPage("/dashboard/repos", <RepositoriesPage />, makeApi(request), "/dashboard/repos");

  await userEvent.type(screen.getByLabelText("GitHub repository"), "https://github.com/acme/widget.git");
  await userEvent.click(screen.getByRole("button", { name: /scan repository/i }));

  expect(await screen.findByText("Install script downloads and runs code")).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith("/v1/scan-repo", expect.objectContaining({
    method: "POST", body: { repoUrl: "https://github.com/acme/widget" }, timeoutMs: 120_000,
  }));
  expect(screen.getByText("package.json:12")).toBeInTheDocument();
  expect(screen.getByText("deploy/key.pem")).toBeInTheDocument();
  expect(screen.getByText("Private key committed")).toBeInTheDocument();
  expect(document.querySelector(".severity-summary")?.textContent).toBe("1 critical1 high risk");
});

test("repository scanner rejects something that is not a GitHub repo", async () => {
  const request = vi.fn<FakeRequest>();
  renderPage("/dashboard/repos", <RepositoriesPage />, makeApi(request), "/dashboard/repos");
  await userEvent.type(screen.getByLabelText("GitHub repository"), "https://gitlab.com/a/b/c");
  await userEvent.click(screen.getByRole("button", { name: /scan repository/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("public GitHub repository");
  expect(request).not.toHaveBeenCalled();
});

test("dashboard shows the live scan-service counters", async () => {
  const request = vi.fn<FakeRequest>(async (path) => {
    if (path === "/v1/stats") return { reposScanned: 1234, threatsFound: 56, byLevel: {}, since: "2026-10-01T00:00:00Z" };
    throw new Error(`unexpected ${path}`);
  });
  renderPage("/dashboard", <DashboardPage />, makeApi(request), "/dashboard");
  expect(await screen.findByText("1,234")).toBeInTheDocument();
  expect(screen.getByText("56")).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith("/v1/stats", expect.objectContaining({ authenticated: false }));
});

test("long reports show the first findings and expand on request", async () => {
  const findings = Array.from({ length: 30 }, (_, index) => ({
    layer: "dependency", severity: "caution", title: `Finding ${index + 1}`, evidence: "e", source: "rules", checkedAt: "2026-10-30T10:00:00Z",
  }));
  const request = vi.fn<FakeRequest>(async () => ({ level: "caution", target: { type: "repo", id: "github.com/a/b" }, findings, indicators: { addresses: [], domains: [] }, notChecked: [], actions: [], explanation: null }));
  renderPage("/dashboard/repos", <RepositoriesPage />, makeApi(request), "/dashboard/repos?repo=a/b");

  expect(await screen.findByText("Finding 25")).toBeInTheDocument();
  expect(screen.queryByText("Finding 26")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show all 30 findings" }));
  expect(screen.getByText("Finding 30")).toBeInTheDocument();
});
