// Placeholder verdict UI. It builds every element with createElement and every piece of text with textContent: nothing
// from the repository, the API or the AI is ever parsed as HTML (I-11). Ivo's React panel replaces this file and must
// keep the same message schema (see src/ui/bridge.ts).
import type { ViewModel } from '../src/ui/view';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const app = document.getElementById('app') as HTMLElement;

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = el('button', primary ? 'btn primary' : 'btn', label) as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function section(title: string): HTMLElement {
  const s = el('section');
  s.append(el('h2', undefined, title));
  return s;
}

function render(scanId: string, view: ViewModel): void {
  const act = (action: string, file?: string) => vscode.postMessage({ type: 'action', scanId, action, ...(file ? { file } : {}) });
  app.replaceChildren();

  const head = el('header', `head level-${view.level}`);
  head.append(el('span', 'badge', view.label), el('h1', undefined, view.headline), el('p', 'target', view.target));
  app.append(head);

  const bar = el('div', 'buttons');
  for (const b of view.buttons) bar.append(button(b.label, b.primary, () => act(b.action)));
  app.append(bar);

  if (view.explanation) {
    const s = section('Explanation (AI, may be wrong)');
    s.append(el('p', 'prose', view.explanation));
    app.append(s);
  }

  const findings = section('Findings');
  if (view.findings.length === 0) findings.append(el('p', 'muted', 'No findings.'));
  const list = el('ul', 'findings');
  for (const f of view.findings) {
    const li = el('li', `finding sev-${f.severity}`);
    li.append(el('span', 'sev', f.severity), el('strong', 'title', f.title));
    if (f.file) li.append(el('div', 'where', f.line ? `${f.file}:${f.line}` : f.file));
    li.append(el('pre', 'evidence', f.evidence));
    if (f.canView && f.file) li.append(button('View file', false, () => act('viewFile', f.file)));
    list.append(li);
  }
  findings.append(list);
  if (view.hiddenFindings > 0) findings.append(el('p', 'muted', `${view.hiddenFindings} more finding${view.hiddenFindings === 1 ? '' : 's'} not shown. Copy the report for the full list.`));
  app.append(findings);

  if (view.notChecked.length > 0) {
    const s = section('Not checked');
    const ul = el('ul');
    for (const n of view.notChecked) ul.append(el('li', undefined, n));
    s.append(ul);
    app.append(s);
  }

  // Report what is actually on screen, so the host can verify that repo text became text and not elements.
  vscode.postMessage({
    type: 'rendered',
    scanId,
    images: document.images.length,
    // VS Code adds its own bootstrap script to every webview, so count only scripts that sit in our content or carry a payload.
    scripts: Array.from(document.scripts).filter((s) => app.contains(s) || (s.textContent ?? '').includes('__stack3_xss')).length,
    anchors: document.querySelectorAll('a[href]').length,
    injected: (window as unknown as Record<string, unknown>).__stack3_xss !== undefined,
    text: document.body.innerText.slice(0, 20000),
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  const m = event.data as { type?: string; scanId?: string; view?: ViewModel } | null;
  if (m && m.type === 'verdict' && typeof m.scanId === 'string' && m.view) render(m.scanId, m.view);
});

vscode.postMessage({ type: 'ready' });
