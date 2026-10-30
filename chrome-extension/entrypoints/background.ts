// Background worker: owns authentication, caches rules, and runs every API call
// on behalf of the popup and the content script.

import {
  ApiError,
  authStatus,
  checkDomain,
  checkScripts,
  clearLegacyApiBaseUrl,
  getApiBaseUrl,
  getRulesBundle,
  isBlocklisted,
  lookupSourcify,
  pollLinkToken,
  reviewTx,
  scanContract,
  scanPage,
  startLink,
  siteDetailsUrl,
  unlink,
} from "../utils/api";
import { rankOf, subjectContractOf, worstLevel } from "../utils/decode";
import { assessPage, isWeb3Page } from "../utils/phishing";
import type {
  ContractFacts,
  ExtensionMessage,
  LinkStart,
  PageAlert,
  PageCapture,
  TabCheckResult,
  TabMessage,
  TxReview,
  Verdict,
  WalletReviewResult,
} from "../utils/types";

type LinkFlow = {
  details: LinkStart;
  email: string | null;
  error: string | null;
  deadline: number;
  lastPollAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const LINK_FLOW_KEY = "pendingLinkFlow";

// A reviewed wallet prompt stays available to the popup for 10 minutes.
const WALLET_REVIEW_TTL = 10 * 60 * 1000;

type PendingWalletReview = {
  receivedAt: number;
  promise: Promise<WalletReviewResult>;
};

// Server page checks are reused per origin and page-signal set for 30 minutes.
const PAGE_CHECK_TTL = 30 * 60 * 1000;
const DISMISSED_KEY = "dismissedPageAlerts";

export default defineBackground(() => {
  const captures = new Map<number, PageCapture>();
  const walletReviews = new Map<number, PendingWalletReview>();
  let latestWalletTabId: number | null = null;
  let linkFlow: LinkFlow | null = null;
  const pageChecks = new Map<string, { at: number; promise: Promise<Verdict[]> }>();
  const sentAlerts = new Map<number, string>();

  async function persistLinkFlow() {
    if (linkFlow && !linkFlow.email && !linkFlow.error) {
      await browser.storage.session.set({
        [LINK_FLOW_KEY]: { details: linkFlow.details, deadline: linkFlow.deadline },
      });
    } else {
      await browser.storage.session.remove(LINK_FLOW_KEY);
    }
  }

  async function restoreLinkFlow(): Promise<void> {
    if (linkFlow) return;
    const stored = await browser.storage.session.get(LINK_FLOW_KEY);
    const saved = stored[LINK_FLOW_KEY] as { details: LinkStart; deadline: number } | undefined;
    if (saved && Date.now() < saved.deadline) {
      linkFlow = { details: saved.details, email: null, error: null, deadline: saved.deadline, lastPollAt: 0, timer: null };
      scheduleLinkPoll(Math.max(saved.details.interval, 3));
    }
  }

  function stopLinkPolling() {
    if (linkFlow?.timer) clearTimeout(linkFlow.timer);
    if (linkFlow) linkFlow.timer = null;
  }

  async function pollOnce(): Promise<void> {
    if (!linkFlow || linkFlow.email || linkFlow.error) return;
    if (Date.now() > linkFlow.deadline) {
      linkFlow.error = "The link request expired. Start again.";
      stopLinkPolling();
      await persistLinkFlow();
      return;
    }
    const interval = Math.max(linkFlow.details.interval, 3) * 1000;
    if (Date.now() - linkFlow.lastPollAt < interval) return;
    linkFlow.lastPollAt = Date.now();
    try {
      const email = await pollLinkToken(linkFlow.details.deviceCode);
      if (email) {
        linkFlow.email = email;
        stopLinkPolling();
        await persistLinkFlow();
        // Warm the rules caches now that we are authenticated.
        getRulesBundle().catch(() => {});
      }
    } catch (error) {
      linkFlow.error = (error as Error).message;
      stopLinkPolling();
      await persistLinkFlow();
    }
  }

  function scheduleLinkPoll(intervalSeconds: number) {
    if (!linkFlow) return;
    linkFlow.timer = setTimeout(async () => {
      await pollOnce();
      if (linkFlow && !linkFlow.email && !linkFlow.error) scheduleLinkPoll(intervalSeconds);
    }, intervalSeconds * 1000);
  }

  async function handleLinkStart() {
    stopLinkPolling();
    const details = await startLink();
    linkFlow = {
      details,
      email: null,
      error: null,
      deadline: Date.now() + details.expiresIn * 1000,
      lastPollAt: 0,
      timer: null,
    };
    await persistLinkFlow();
    scheduleLinkPoll(Math.max(details.interval, 3));
    return { details, email: null, error: null };
  }

  async function handleCheckTab(tabId: number, url: string): Promise<TabCheckResult> {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      throw new ApiError("This tab has no checkable address.", 0, "invalid_request");
    }
    const capture = captures.get(tabId);
    const errors: string[] = [];
    const settle = async (run: () => Promise<Verdict>): Promise<Verdict | null> => {
      try {
        return await run();
      } catch (error) {
        errors.push((error as Error).message);
        return null;
      }
    };
    const [domain, page, scripts] = await Promise.all([
      settle(() => checkDomain(url)),
      capture ? settle(() => scanPage(capture.origin, capture.signals)) : Promise.resolve(null),
      capture && capture.scripts.length
        ? settle(() => checkScripts(capture.origin, capture.scripts))
        : Promise.resolve(null),
    ]);
    return { host, domain, page, scripts, errors: [...new Set(errors)] };
  }

  /**
   * Runs the transaction review and, when the target is a contract, the contract scan and a
   * Sourcify lookup. Sourcify needs no account, so unlinked users still get contract basics.
   */
  async function runWalletReview(review: TxReview, facts: ContractFacts | null): Promise<WalletReviewResult> {
    const receivedAt = Date.now();
    const { linked } = await authStatus();
    const errors: string[] = [];
    const settle = async (run: () => Promise<Verdict>): Promise<Verdict | null> => {
      try {
        return await run();
      } catch (error) {
        errors.push((error as Error).message);
        return null;
      }
    };
    const contract = subjectContractOf(review);
    // Skip the contract lookups only when the wallet's RPC said the target holds no code.
    const knownWallet = facts?.isContract === false && !!contract && facts.address?.toLowerCase() === contract.toLowerCase();
    const [tx, scan, sourcify] = await Promise.all([
      linked ? settle(() => reviewTx(review)) : Promise.resolve(null),
      linked && contract && !knownWallet ? settle(() => scanContract(review.chainId, contract)) : Promise.resolve(null),
      contract && !knownWallet ? lookupSourcify(review.chainId, contract) : Promise.resolve(null),
    ]);
    return { review, facts, receivedAt, linked, tx, contract: scan, sourcify, errors: [...new Set(errors)] };
  }

  async function handleWalletRequest(
    review: TxReview,
    facts: ContractFacts | null,
    tabId: number | undefined,
  ): Promise<WalletReviewResult> {
    const key = tabId ?? -1;
    const promise = runWalletReview(review, facts);
    walletReviews.set(key, { receivedAt: Date.now(), promise });
    latestWalletTabId = key;
    const result = await promise;
    if (tabId !== undefined && rankOf(worstLevel(result.tx?.level, result.contract?.level)) >= rankOf("high")) {
      browser.action.setBadgeText({ text: "!", tabId }).catch(() => {});
      browser.action.setBadgeBackgroundColor({ color: "#b42318", tabId }).catch(() => {});
    }
    return result;
  }

  async function handleGetWalletReview(tabId: number | null): Promise<WalletReviewResult | null> {
    const key = tabId !== null && walletReviews.has(tabId) ? tabId : latestWalletTabId;
    const entry = key !== null ? walletReviews.get(key) : undefined;
    if (!entry || Date.now() - entry.receivedAt > WALLET_REVIEW_TTL) return null;
    return entry.promise;
  }

  async function dismissedOrigins(): Promise<string[]> {
    const stored = await browser.storage.session.get(DISMISSED_KEY);
    return Array.isArray(stored[DISMISSED_KEY]) ? (stored[DISMISSED_KEY] as string[]) : [];
  }

  /** Server domain + page checks, cached so a busy page does not re-query on every DOM change. */
  function serverPageChecks(capture: PageCapture): Promise<Verdict[]> {
    const key = JSON.stringify([capture.origin, capture.signals]);
    const cached = pageChecks.get(key);
    if (cached && Date.now() - cached.at < PAGE_CHECK_TTL) return cached.promise;
    const promise = Promise.allSettled([checkDomain(capture.origin), scanPage(capture.origin, capture.signals)]).then(
      (outcomes) => outcomes.flatMap((outcome) => (outcome.status === "fulfilled" && outcome.value ? [outcome.value] : [])),
    );
    pageChecks.set(key, { at: Date.now(), promise });
    if (pageChecks.size > 200) pageChecks.delete(pageChecks.keys().next().value!);
    return promise;
  }

  /** Local phishing heuristics on every web page, plus the API checks on web3 pages when linked. */
  async function assessCapture(tabId: number, capture: PageCapture) {
    const host = new URL(capture.origin).hostname;
    const { linked } = await authStatus();
    const blocklisted = linked ? await isBlocklisted(host) : false;
    const local = assessPage(host, capture.signals, { blocklisted });
    let level = local.level;
    const reasons = [...local.reasons];

    if (linked && (isWeb3Page(capture.signals) || rankOf(local.level) > 0)) {
      for (const verdict of await serverPageChecks(capture)) {
        level = worstLevel(level, verdict.level);
        for (const finding of verdict.findings) {
          if (rankOf(finding.severity) >= rankOf("high") && !reasons.includes(finding.title)) reasons.push(finding.title);
        }
      }
    }

    if (rankOf(level) < rankOf("high")) return;
    browser.action.setBadgeText({ text: "!", tabId }).catch(() => {});
    browser.action.setBadgeBackgroundColor({ color: "#b42318", tabId }).catch(() => {});
    if ((await dismissedOrigins()).includes(capture.origin)) return;

    const alert: PageAlert = {
      origin: capture.origin,
      host,
      level,
      reasons: reasons.length ? reasons : ["Stack3 checks rated this page as high risk."],
      detailsUrl: siteDetailsUrl(host),
    };
    const fingerprint = JSON.stringify([alert.origin, alert.level, alert.reasons]);
    if (sentAlerts.get(tabId) === fingerprint) return;
    sentAlerts.set(tabId, fingerprint);
    const message: TabMessage = { type: "page-alert", alert };
    browser.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => sentAlerts.delete(tabId));
  }

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
    return (async () => {
      try {
        switch (message.type) {
          case "page-capture": {
            const tabId = sender.tab?.id;
            if (tabId !== undefined) {
              captures.set(tabId, message.capture);
              // Phishing warnings are best effort; the capture itself is already stored.
              assessCapture(tabId, message.capture).catch(() => {});
            }
            return { ok: true };
          }
          case "get-status": {
            const status = await authStatus();
            return { ok: true, data: { ...status, apiBaseUrl: await getApiBaseUrl() } };
          }
          case "link-start":
            return { ok: true, data: await handleLinkStart() };
          case "link-poll": {
            // Popup polls drive this too, so linking survives service-worker restarts.
            await restoreLinkFlow();
            await pollOnce();
            return {
              ok: true,
              data: linkFlow
                ? { details: linkFlow.details, email: linkFlow.email, error: linkFlow.error }
                : null,
            };
          }
          case "unlink":
            stopLinkPolling();
            linkFlow = null;
            await browser.storage.session.remove(LINK_FLOW_KEY);
            await unlink();
            return { ok: true };
          case "check-tab":
            return { ok: true, data: await handleCheckTab(message.tabId, message.url) };
          case "scan-contract":
            return { ok: true, data: await scanContract(message.chainId, message.address) };
          case "review-tx":
            return { ok: true, data: await reviewTx(message.review) };
          case "wallet-request":
            return { ok: true, data: await handleWalletRequest(message.review, message.facts, sender.tab?.id) };
          case "get-wallet-review":
            return { ok: true, data: await handleGetWalletReview(message.tabId) };
          case "dismiss-page-alert": {
            const origins = await dismissedOrigins();
            if (!origins.includes(message.origin)) {
              await browser.storage.session.set({ [DISMISSED_KEY]: [...origins, message.origin].slice(-200) });
            }
            return { ok: true };
          }
          default:
            return { ok: false, error: "Unknown message." };
        }
      } catch (error) {
        const failure = error as ApiError;
        return {
          ok: false,
          error: failure.message,
          code: failure instanceof ApiError ? failure.code : "error",
          status: failure instanceof ApiError ? failure.status : 0,
        };
      }
    })();
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    captures.delete(tabId);
    walletReviews.delete(tabId);
    sentAlerts.delete(tabId);
    if (latestWalletTabId === tabId) latestWalletTabId = null;
  });

  // Refresh the rules bundle every 6 hours while linked.
  browser.alarms.create("refresh-rules", { periodInMinutes: 360 });
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== "refresh-rules") return;
    const status = await authStatus();
    if (status.linked) getRulesBundle(true).catch(() => {});
  });

  // Drop any stored override of a retired deployment, then warm the caches when already linked.
  clearLegacyApiBaseUrl()
    .then(() => authStatus())
    .then((status) => {
      if (status.linked) getRulesBundle().catch(() => {});
    });
});
