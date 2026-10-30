// Content script: counts facts about the page and reports them to the background worker.
// It never sends the page HTML, anything the user typed, or a recovery phrase.
// When the background flags the page as phishing, it shows the Stack3 warning here.

import { showPageAlert } from "../utils/overlay";
import { BRAND_NAMES } from "../utils/phishing";
import type { PageCapture, PageSignals, TabMessage } from "../utils/types";

// A field asks for a wallet secret only when its purpose names one: a seed / recovery / secret
// phrase, mnemonic words, or a private key. "Recovery email" or "seed wallet" are not enough.
const SEED_PHRASE = /\b(seed|recovery|secret([\s_-]*recovery)?|backup|mnemonic)[\s_-]*(phrase|words?)\b|\bmnemonic\b/i;
const PRIVATE_KEY = /\bprivate[\s_-]*key\b/i;
// A placeholder counts only when it asks for entry ("Enter your seed phrase"), never when it is an
// example sentence that merely mentions one ("e.g. this page asked for my seed phrase").
const ENTRY_CUE = /\b(enter|type|paste|input|import|restore|provide|your)\b/i;
const EXAMPLE = /^\s*(e\.?\s?g\b|example|for example|i\.?\s?e\b)/i;
// Only free-text boxes can receive a phrase or key.
const TEXT_TYPES = new Set(["", "text", "password", "tel"]);

/** A fixed element covering most of the viewport, as fake wallet pop-ups use. */
function hasFullscreenOverlay(): boolean {
  const area = window.innerWidth * window.innerHeight;
  if (!area) return false;
  // Only elements under the viewport centre can cover it; this avoids styling every node.
  for (const element of document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)) {
    if (element.tagName === "STACK3-SECURITY-UI" || element === document.body || element === document.documentElement) continue;
    const style = getComputedStyle(element);
    if (style.position !== "fixed" || style.display === "none" || style.visibility === "hidden") continue;
    const rect = element.getBoundingClientRect();
    if ((rect.width * rect.height) / area >= 0.9 && Number(style.zIndex) >= 1000) return true;
  }
  return false;
}

/** What the field is for, from its own attributes. The placeholder is judged separately in asksFor(). */
function attributeText(element: Element): string {
  return [
    element.getAttribute("name"),
    element.getAttribute("id"),
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

function isTextEntry(field: Element): boolean {
  if (field.tagName === "INPUT" && !TEXT_TYPES.has((field.getAttribute("type") ?? "").toLowerCase())) return false;
  if ((field as HTMLInputElement).disabled || (field as HTMLInputElement).readOnly) return false;
  // Invisible fields are not asking the user for anything (yet); a later capture sees them once shown.
  return field.getClientRects().length > 0;
}

/** Does this field ask the user to type the secret described by `pattern`? */
function asksFor(field: Element, pattern: RegExp): boolean {
  if (pattern.test(`${attributeText(field)} ${labelText(field)}`)) return true;
  const placeholder = field.getAttribute("placeholder") ?? "";
  return !EXAMPLE.test(placeholder) && ENTRY_CUE.test(placeholder) && pattern.test(placeholder);
}

function collectSignals(): PageSignals {
  const fields = [...document.querySelectorAll("input, textarea")].filter(isTextEntry);
  let seedPhraseField = false;
  let asksForPrivateKey = false;
  let wordInputs = 0;

  for (const field of fields) {
    if (asksFor(field, SEED_PHRASE)) seedPhraseField = true;
    if (asksFor(field, PRIVATE_KEY)) asksForPrivateKey = true;
    if (/^(word|mnemonic|seed)[\s_-]?\d{1,2}$/i.test(field.getAttribute("name") ?? "")) wordInputs += 1;
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
  const brandInTitle = BRAND_NAMES.find((brand) =>
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
    fullscreenOverlay: hasFullscreenOverlay(),
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

    browser.runtime.onMessage.addListener((message: TabMessage) => {
      if (message?.type !== "page-alert" || message.alert.origin !== location.origin) return;
      showPageAlert(message.alert, () => {
        browser.runtime.sendMessage({ type: "dismiss-page-alert", origin: location.origin }).catch(() => {});
      });
    });

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
