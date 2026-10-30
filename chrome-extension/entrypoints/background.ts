// Background worker: owns authentication, caches rules, and runs every API call
// on behalf of the popup and the content script.

import {
  ApiError,
  authStatus,
  checkDomain,
  checkScripts,
  getApiBaseUrl,
  getRulesBundle,
  isBlocklisted,
  pollLinkToken,
  reviewTx,
  scanContract,
  scanPage,
  startLink,
  unlink,
} from "../utils/api";
import type { ExtensionMessage, LinkStart, PageCapture, TabCheckResult, Verdict } from "../utils/types";

type LinkFlow = {
  details: LinkStart;
  email: string | null;
  error: string | null;
  deadline: number;
  lastPollAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const LINK_FLOW_KEY = "pendingLinkFlow";

export default defineBackground(() => {
  const captures = new Map<number, PageCapture>();
  let linkFlow: LinkFlow | null = null;

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

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
    return (async () => {
      try {
        switch (message.type) {
          case "page-capture": {
            const tabId = sender.tab?.id;
            if (tabId !== undefined) {
              captures.set(tabId, message.capture);
              // Offline-first warning via the cached blocklist; the server check stays authoritative.
              try {
                const host = new URL(message.capture.origin).hostname;
                if (await isBlocklisted(host)) {
                  browser.action.setBadgeText({ text: "!", tabId });
                  browser.action.setBadgeBackgroundColor({ color: "#b42318", tabId });
                }
              } catch {
                // Badge is best effort only.
              }
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

  browser.tabs.onRemoved.addListener((tabId) => captures.delete(tabId));

  // Refresh the rules bundle every 6 hours while linked.
  browser.alarms.create("refresh-rules", { periodInMinutes: 360 });
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== "refresh-rules") return;
    const status = await authStatus();
    if (status.linked) getRulesBundle(true).catch(() => {});
  });

  // Warm the caches on startup when already linked.
  authStatus().then((status) => {
    if (status.linked) getRulesBundle().catch(() => {});
  });
});
