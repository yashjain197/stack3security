import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Badge } from "../components/ui";
import { PublicShell } from "../components/PublicShell";

export function LandingPage() {
  return (
    <PublicShell>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line"></span> SECURITY BEFORE YOU TRUST</div>
          <h1>Don't trust the interface.<br /><span>Verify what happens underneath.</span></h1>
          <p className="hero-description">
            A website can look legitimate while asking your wallet to do something very different. A code
            repository can look ordinary while hiding a malicious install script.
          </p>
          <p className="hero-description hero-description--second">
            Stack3 Security helps developers inspect suspicious code and helps Web3 users understand websites,
            contracts, and wallet requests before they act.
          </p>
          <div className="hero-actions">
            <Link className="button button--primary button--large" to="/dashboard">
              Explore the dashboard<Icon name="arrow" />
            </Link>
            <Link className="button button--secondary button--large" to="/how-it-works">
              See how it works
            </Link>
          </div>
          <div className="hero-note">
            <Icon name="lock" />
            <span>Demo experience — checks shown in the dashboard are illustrative until live scanning is connected.</span>
          </div>
        </div>
        <div className="hero-visual" aria-label="Illustration of a website request and its security findings">
          <div className="visual-glow"></div>
          <div className="visual-top">
            <span className="visual-dot"></span>
            <span className="visual-dot"></span>
            <span className="visual-dot"></span>
            <span className="visual-url">app.example.test</span>
            <span className="visual-lock"><Icon name="lock" /></span>
          </div>
          <div className="visual-body">
            <div className="visual-sidebar">
              <span className="mini-mark"><Icon name="shield" /></span>
              <i></i>
              <i></i>
              <i></i>
            </div>
            <div className="visual-content">
              <div className="visual-caption">WALLET REQUEST REVIEW</div>
              <div className="visual-title">Transaction intent</div>
              <div className="visual-claim">
                <span className="claim-icon"><Icon name="spark" /></span>
                <div>
                  <span className="mini-label">WEBSITE SAYS</span>
                  <strong>Claim your reward</strong>
                </div>
                <span className="claim-check">✓</span>
              </div>
              <div className="visual-divider"><span>but the wallet request is</span></div>
              <div className="visual-approval">
                <span className="approval-icon"><Icon name="arrows" /></span>
                <div>
                  <span className="mini-label">DECODED REQUEST</span>
                  <strong>Approve token spending</strong>
                </div>
              </div>
              <div className="visual-warning">
                <span className="warning-symbol">!</span>
                <div>
                  <strong>Intent mismatch</strong>
                  <span>Review the requested permission before signing.</span>
                </div>
              </div>
              <div className="visual-foot">
                <Badge verdict="high" />
                <span>Illustrative example</span>
              </div>
            </div>
          </div>
          <div className="floating-note">
            <Icon name="shield" />
            <span>Evidence over assumptions</span>
          </div>
        </div>
      </section>
      <section className="proof-strip" aria-label="Product capabilities">
        <span>Developer-side code inspection</span>
        <span>Website and phishing signals</span>
        <span>Transaction intent review</span>
        <span>Smart-contract risk context</span>
      </section>
      <section className="section section--layers" id="product">
        <div className="section-heading">
          <span className="eyebrow">ONE SECURITY MINDSET</span>
          <h2>Two layers. One clearer picture.</h2>
          <p>Understand risk at the code you run and the Web3 interactions you review.</p>
        </div>
        <div className="feature-grid">
          <article className="feature-card">
            <div className="feature-icon feature-icon--blue"><Icon name="blocks" /></div>
            <span className="feature-kicker">FOR DEVELOPERS</span>
            <h3>Developer Guard</h3>
            <h4>Catch suspicious code before you run it.</h4>
            <p>
              Inspect project files and npm dependencies for suspicious install scripts, risky configuration,
              exposed secrets, and known package risk indicators.
            </p>
            <Link to="/how-it-works" className="text-link">Explore developer protection <Icon name="arrow" /></Link>
          </article>
          <article className="feature-card">
            <div className="feature-icon feature-icon--navy"><Icon name="shield" /></div>
            <span className="feature-kicker">FOR WEB3 USERS</span>
            <h3>Web3 Guard</h3>
            <h4>Understand what a website asks you to approve.</h4>
            <p>
              Review suspicious page behavior, recovery-phrase phishing signals, transaction requests, and
              available smart-contract risk indicators.
            </p>
            <Link to="/dashboard/scanner" className="text-link">Try the sample scanner <Icon name="arrow" /></Link>
          </article>
        </div>
      </section>
      <section className="intent-section">
        <div className="intent-copy">
          <span className="eyebrow">LOOK BENEATH THE BUTTON</span>
          <h2>The interface says one thing.<br /><span>The transaction may say another.</span></h2>
          <p>
            A “Claim reward” button might trigger a token approval or an unexpected transfer request. Stack3
            aims to make the difference understandable before you approve.
          </p>
          <p className="intent-disclaimer">
            An approval is not automatically malicious. The spender, scope, contract behavior, and context matter.
          </p>
          <Link className="text-link" to="/dashboard/transactions">Review the example</Link>
        </div>
        <div className="intent-card">
          <div className="intent-card-header">
            <span>ILLUSTRATIVE EXAMPLE</span>
            <Badge verdict="high" />
          </div>
          <div className="intent-row">
            <span className="intent-marker intent-marker--neutral">01</span>
            <div>
              <small>WEBSITE PROMISE</small>
              <strong>“Claim your reward.”</strong>
            </div>
          </div>
          <div className="intent-arrow-down"><Icon name="arrow" /></div>
          <div className="intent-row">
            <span className="intent-marker intent-marker--amber">02</span>
            <div>
              <small>WALLET REQUEST</small>
              <strong>Approve token spending</strong>
              <span>Permission within the approval's scope</span>
            </div>
          </div>
          <div className="intent-card-footer">
            <Icon name="shield" />
            <span>Review what the request encodes before deciding.</span>
          </div>
        </div>
      </section>
      <section className="evidence-section">
        <div className="section-heading">
          <span className="eyebrow">EXPLAIN THE EVIDENCE</span>
          <h2>Not just a score. A reason to decide.</h2>
          <p>A useful warning should help answer the important questions.</p>
        </div>
        <div className="evidence-grid">
          <article>
            <span className="evidence-number">01</span>
            <h3>What was detected?</h3>
            <p>See the finding and its severity in plain language.</p>
          </article>
          <article>
            <span className="evidence-number">02</span>
            <h3>What supports it?</h3>
            <p>Review evidence and source when available.</p>
          </article>
          <article>
            <span className="evidence-number">03</span>
            <h3>What was not checked?</h3>
            <p>Understand limitations instead of filling gaps with assumptions.</p>
          </article>
          <article>
            <span className="evidence-number">04</span>
            <h3>What can I do next?</h3>
            <p>Get practical recommendations to guide your review.</p>
          </article>
        </div>
      </section>
      <section className="decisions-section">
        <div className="section-heading">
          <span className="eyebrow">DESIGNED FOR REAL DECISIONS</span>
          <h2>A little more context, before you act.</h2>
        </div>
        <div className="decision-grid">
          <article>
            <span className="decision-icon"><Icon name="blocks" /></span>
            <h3>Before you run</h3>
            <p>Review suspicious project configuration and dependency signals before running unfamiliar code.</p>
          </article>
          <article>
            <span className="decision-icon"><Icon name="scan" /></span>
            <h3>Before you enter</h3>
            <p>Identify pages that appear to request recovery phrases in suspicious contexts.</p>
          </article>
          <article>
            <span className="decision-icon"><Icon name="arrows" /></span>
            <h3>Before you sign</h3>
            <p>Review decoded methods, permissions, and intent mismatches before approving.</p>
          </article>
          <article>
            <span className="decision-icon"><Icon name="shield" /></span>
            <h3>Before you trust</h3>
            <p>Review available information about verification, proxy behavior, and permissions.</p>
          </article>
        </div>
        <p className="section-footnote">
          These checks depend on available data and supported networks. They cannot guarantee the absence of
          malicious behavior.
        </p>
      </section>
      <section className="closing-cta">
        <div className="closing-icon"><Icon name="shield" /></div>
        <span className="eyebrow">MAKE YOUR NEXT DECISION WITH BETTER INFORMATION</span>
        <h2>See what's underneath.</h2>
        <p>
          Explore the Stack3 demo and see how code, website, and transaction risks can be explained in one clear
          experience.
        </p>
        <Link className="button button--light button--large" to="/dashboard">
          Open the dashboard<Icon name="arrow" />
        </Link>
      </section>
    </PublicShell>
  );
}
