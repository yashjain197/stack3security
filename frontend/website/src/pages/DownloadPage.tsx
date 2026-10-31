import { Icon } from "../components/Icon";
import { PublicShell } from "../components/PublicShell";

const marketplaceUrl = "https://marketplace.visualstudio.com/items?itemName=Stack3Security.stack3-vscode";
const chromeReleaseUrl = "https://github.com/yashjain197/stack3security/releases/tag/chrome-v0.1.0";
const chromeZipUrl =
  "https://github.com/yashjain197/stack3security/releases/download/chrome-v0.1.0/stack3-security-chrome-0.1.0.zip";

function Command({ children }: { children: string }) {
  return <pre className="download-command"><code>{children}</code></pre>;
}

export function DownloadPage() {
  return (
    <PublicShell mainClassName="public-subpage">
      <section className="subpage-hero">
        <span className="eyebrow">DOWNLOAD</span>
        <h1>Install Stack3 where you work.</h1>
        <p>
          The VS Code extension checks repositories and dependencies before you run them. The Chrome extension
          checks websites and wallet requests before you sign.
        </p>
      </section>

      <div className="download-grid">
        <section className="download-card" id="vscode">
          <div className="download-card-head">
            <Icon name="code" />
            <h2>VS Code extension</h2>
          </div>
          <p>Available on the Visual Studio Marketplace.</p>
          <a className="button button--primary" href={marketplaceUrl} target="_blank" rel="noreferrer">
            Get it on the Marketplace<Icon name="external" />
          </a>

          <h3>VS Code</h3>
          <Command>code --install-extension Stack3Security.stack3-vscode</Command>
          <p>
            Or, with no terminal: open the Extensions panel (<kbd>Ctrl+Shift+X</kbd>), search for <strong>Stack3
            Security</strong> and click Install. You can also press <kbd>Ctrl+P</kbd> and paste:
          </p>
          <Command>ext install Stack3Security.stack3-vscode</Command>

          <h3>Cursor and other editors</h3>
          <p>
            Cursor installs from Open VSX, which doesn't list Stack3 yet. Download the <code>.vsix</code> from
            the <a href={marketplaceUrl} target="_blank" rel="noreferrer">Marketplace page</a> (“Download
            Extension”) and install it:
          </p>
          <Command>cursor --install-extension stack3-vscode-0.1.2.vsix</Command>
          <p>
            Or run <strong>Extensions: Install from VSIX…</strong> from the command palette. The same works in
            VS Code with <code>code --install-extension</code>.
          </p>
        </section>

        <section className="download-card" id="chrome">
          <div className="download-card-head">
            <Icon name="shield" />
            <h2>Chrome extension</h2>
          </div>
          <p>
            The Chrome Web Store listing is under review. Until it's approved, install it from GitHub. Works in
            Chrome, Edge, Brave and other Chromium browsers.
          </p>
          <a className="button button--primary" href={chromeZipUrl}>
            Download v0.1.0 (.zip)<Icon name="arrow" />
          </a>

          <h3>Set it up</h3>
          <ol className="download-steps">
            <li>Extract the zip to a folder you'll keep. Chrome loads the extension from that folder, so don't delete it.</li>
            <li>Open <code>chrome://extensions</code> in the address bar.</li>
            <li>Turn on <strong>Developer mode</strong> (top right).</li>
            <li>Click <strong>Load unpacked</strong> and select the extracted folder (the one containing <code>manifest.json</code>).</li>
            <li>Pin Stack3 Security from the puzzle-piece menu in the toolbar.</li>
          </ol>
          <p>
            To update, download the new zip from the{" "}
            <a href={chromeReleaseUrl} target="_blank" rel="noreferrer">GitHub release</a>, replace the folder
            contents and click the reload icon on the extension card. Chrome may warn about developer-mode
            extensions on startup; that's expected for unpacked installs.
          </p>
        </section>
      </div>
    </PublicShell>
  );
}
