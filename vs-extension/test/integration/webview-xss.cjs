// Runs INSIDE a real VS Code. Opens the real verdict panel with hostile repo text and checks what the webview rendered.
const vscode = require('vscode');
const fs = require('node:fs');

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<img src=x onerror="window.__stack3_xss=1">',
  '<script>window.__stack3_xss=1</script>',
  '<svg onload="window.__stack3_xss=1">',
  '<a href="javascript:window.__stack3_xss=1">click me</a>',
  '"><iframe src="https://evil.example/"></iframe>',
  '<iframe srcdoc="<script>parent.__stack3_xss=1</script>"></iframe>',
  '<style>@import url(https://evil.example/x.css)</style>',
  '<img src="https://evil.example/pixel.png">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
];
const results = [];
const record = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail) });

async function run() {
  try {
    const stats = await vscode.commands.executeCommand('stack3test.showHostile', process.env.STACK3_WEBVIEW_ROOT);
    record('the panel rendered and reported back (not timed out)', stats && !stats.timeout, JSON.stringify(stats).slice(0, 200));
    if (stats && !stats.timeout) {
      record('no <img> element exists in the page', stats.images === 0, `images=${stats.images}`);
      record('no extra <script> element exists in the page', stats.scripts === 0, `scripts=${stats.scripts}`);
      record('no link (<a href>) exists in the page', stats.anchors === 0, `anchors=${stats.anchors}`);
      record('no payload executed (window.__stack3_xss never set)', stats.injected === false);
      for (const p of PAYLOADS) record(`shown as literal text: ${p.slice(0, 48)}`, stats.text.includes(p));
      record('the verdict itself rendered', /critical risk/i.test(stats.text) && /Do not open this folder/.test(stats.text), stats.text.slice(0, 80).replace(/\n/g, ' | '));
      record('buttons for a critical verdict: delete and open-with-auto-run-disabled, no plain Open', /Delete clone/.test(stats.text) && /Open with auto-run disabled/.test(stats.text) && !/Open anyway/.test(stats.text) && !/(^|\n)Open(\n|$)/.test(stats.text));
    }
  } catch (e) {
    record('suite crashed', false, e && e.stack ? e.stack : e);
  }
  fs.writeFileSync(process.env.STACK3_RESULT, JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) throw new Error('webview XSS checks failed; see ' + process.env.STACK3_RESULT);
}
module.exports = { run };
