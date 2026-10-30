import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PublicShell } from "../components/PublicShell";

const steps: [string, string, string][] = [
  ["01", "Inspect the signals", "The developer side examines suspicious repository files and dependency risk indicators. The user side examines page behavior, transaction requests, and available contract information."],
  ["02", "Connect the context", "Where evidence supports it, signals such as a suspicious domain, package, contract, or wallet address can provide additional context. A relationship alone is not proof of wrongdoing."],
  ["03", "Explain the finding", "Stack3 presents severity, evidence, source, limitations, and recommended next steps. AI may help translate technical findings, grounded in checks and evidence."],
  ["04", "Let the user decide", "The goal is to help users pause, investigate, reject a request, or proceed with a clearer understanding. Stack3 should not make irreversible wallet decisions on your behalf."],
];

export function HowItWorksPage() {
  return (
    <PublicShell mainClassName="public-subpage">
      <section className="subpage-hero">
        <span className="eyebrow">HOW IT WORKS</span>
        <h1>Security should start before the click, install, or signature.</h1>
        <p>
          Stack3 is designed to inspect risk at two points: when developers evaluate code and when users interact
          with Web3 websites and wallet requests.
        </p>
        <Link className="button button--primary button--large" to="/dashboard">
          Explore the demo<Icon name="arrow" />
        </Link>
      </section>
      <section className="steps-list">
        {steps.map(([number, title, description]) => (
          <article className="step-item" key={number}>
            <span>{number}</span>
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          </article>
        ))}
      </section>
      <section className="not-promises">
        <div className="eyebrow">IMPORTANT LIMITATIONS</div>
        <h2>What Stack3 does not promise</h2>
        <ul>
          <li>It cannot detect every scam or malicious package.</li>
          <li>A verified contract or older deployment is not automatically trustworthy.</li>
          <li>A website with no known reputation signals is not necessarily legitimate.</li>
          <li>A transaction explanation is only as accurate as the decoded data and available context.</li>
          <li>AI explanations can be wrong and should be grounded in inspectable evidence.</li>
        </ul>
      </section>
    </PublicShell>
  );
}
