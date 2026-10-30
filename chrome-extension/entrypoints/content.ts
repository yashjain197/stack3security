// Content script: counts facts about the page and reports them to the background worker.
// It never sends the page HTML, anything the user typed, or a recovery phrase.

import type { PageCapture, PageSignals } from "../utils/types";

const SEED_WORDS = /seed|recovery|mnemonic|secret\s*phrase/i;
const PRIVATE_KEY = /private\s*key/i;
const BRANDS = ["MetaMask", "Ledger", "Trezor", "Uniswap", "Coinbase", "Phantom", "Trust Wallet", "Rabby"];

function attributeText(element: Element): string {
  return [
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
    element.getAttribute("autocomplete"),
  ]
    .filter(Boolean)
    .join(" ");
}

function labelText(element: Element): string {
  const id = element.getAttribute("id");
  if (!id) return "";
  try {
    return document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? "";
  } catch {
    return "";
  }
}

function collectSignals(): PageSignals {
  const fields = [...document.querySelectorAll("input, textarea")];
  let seedPhraseField = false;
  let asksForPrivateKey = false;
  let wordInputs = 0;

  for (const field of fields) {
    const text = `${attributeText(field)} ${labelText(field)}`;
    if (SEED_WORDS.test(text)) seedPhraseField = true;
    if (PRIVATE_KEY.test(text)) asksForPrivateKey = true;
    if (/^(word|mnemonic)[\s_-]?\d{1,2}$/i.test(field.getAttribute("name") ?? "")) wordInputs += 1;
  }

  const externalScriptHosts = new Set<string>();
  const ownHost = location.hostname;
  for (const script of document.querySelectorAll("script[src]")) {
    try {
      const host = new URL((script as HTMLScriptElement).src, location.href).hostname;
      if (host && host !== ownHost) externalScriptHosts.add(host);
    } catch {
      // Ignore unparsable script URLs.
    }
    if (externalScriptHosts.size >= 20) break;
  }

  const title = document.title ?? "";
  const brandInTitle = BRANDS.find((brand) =>
    title.toLowerCase().includes(brand.toLowerCase()),
  ) ?? null;

  let hiddenIframe = false;
  for (const iframe of document.querySelectorAll("iframe")) {
    const style = getComputedStyle(iframe);
    const rect = iframe.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || (rect.width <= 1 && rect.height <= 1)) {
      hiddenIframe = true;
      break;
    }
  }

  const walletConnect = [...document.querySelectorAll("button, a")].some((element) =>
    /connect\s*(a\s*)?wallet/i.test(element.textContent ?? ""),
  );

  return {
    seedPhraseField,
    recoveryWordCount: wordInputs >= 12 ? Math.min(wordInputs, 24) : wordInputs > 0 ? wordInputs : null,
    asksForPrivateKey,
    passwordField: document.querySelector('input[type="password"]') !== null,
    walletConnect,
    externalScriptHosts: [...externalScriptHosts],
    brandInTitle,
    hiddenIframe,
    clipboardRead: false,
    fullscreenOverlay: false,
  };
}

function collectScripts(): string[] {
  const urls: string[] = [];
  for (const script of document.querySelectorAll("script[src]")) {
    try {
      const url = new URL((script as HTMLScriptElement).src, location.href);
      if (url.protocol === "https:" || url.protocol === "http:") urls.push(url.href);
    } catch {
      // Ignore unparsable script URLs.
    }
    if (urls.length >= 40) break;
  }
  return urls;
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  main() {
    let lastSent = "";

    const send = () => {
      const capture: PageCapture = {
        origin: location.origin,
        signals: collectSignals(),
        scripts: collectScripts(),
        capturedAt: Date.now(),
      };
      const fingerprint = JSON.stringify([capture.origin, capture.signals, capture.scripts]);
      if (fingerprint === lastSent) return;
      lastSent = fingerprint;
      browser.runtime.sendMessage({ type: "page-capture", capture }).catch(() => {
        // The background worker may be restarting; the next capture retries.
      });
    };

    send();
    // Re-capture when the page changes meaningfully, at most once per 2 seconds.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(send, 2000);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  },
});
