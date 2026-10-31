import type { ReactNode } from "react";
import { PublicShell } from "../components/PublicShell";

const contactEmail = "ivopereiraix3@gmail.com";
const websiteUrl = "https://stack3security.stack3security.workers.dev/";

const sections: [string, ReactNode][] = [
  ["1. Introduction", (
    <>
      <p>Welcome to <strong>Stack3 Security</strong>.</p>
      <p>
        Stack3 Security is a browser extension designed to help users identify potential security threats while
        browsing websites and interacting with Web3 applications, blockchain transactions, and smart contracts.
      </p>
      <p>
        Your privacy and security are important to us. This Privacy Policy explains what information Stack3 Security
        processes, how it is used, when it may be shared, and the choices available to users.
      </p>
      <p>By installing or using Stack3 Security, you acknowledge the practices described in this Privacy Policy.</p>
    </>
  )],
  ["2. Information We Collect and Process", (
    <>
      <p>To provide its security functionality, Stack3 Security may process the following categories of information:</p>
      <h3>A. Website and Browsing Information</h3>
      <ul>
        <li>Website URLs and domain names.</li>
        <li>Website characteristics and relevant page elements.</li>
        <li>Information about suspicious forms, iframes, overlays, and external scripts.</li>
        <li>Indicators used to identify phishing attempts and potentially malicious websites.</li>
      </ul>
      <h3>B. Web3 and Blockchain Information</h3>
      <p>When users interact with supported decentralized applications, the extension may process:</p>
      <ul>
        <li>Public wallet addresses.</li>
        <li>Blockchain network and chain identifiers.</li>
        <li>Transaction destination addresses.</li>
        <li>Transaction values and calldata.</li>
        <li>Smart contract addresses.</li>
        <li>Message-signing and typed-data request information.</li>
      </ul>
      <p>This information is used to analyze potentially risky blockchain interactions and provide security insights.</p>
      <p><strong>Stack3 Security does not request or intentionally collect wallet seed phrases or private keys.</strong></p>
      <h3>C. Account and Authentication Information</h3>
      <p>If account linking or authentication features are used, Stack3 Security may process:</p>
      <ul>
        <li>Email addresses.</li>
        <li>Authentication tokens.</li>
        <li>Device-linking information.</li>
        <li>Session-related information.</li>
      </ul>
      <p>Authentication information is used to maintain account access and provide authorized extension functionality.</p>
      <h3>D. Extension Storage Information</h3>
      <p>The extension may store:</p>
      <ul>
        <li>User preferences and configuration settings.</li>
        <li>Cached security rules.</li>
        <li>Phishing and threat blocklists.</li>
        <li>Authentication and session state.</li>
        <li>Temporary security-analysis results.</li>
      </ul>
    </>
  )],
  ["3. How We Use Information", (
    <>
      <p>
        Information processed by Stack3 Security is used exclusively for providing and maintaining its security-related
        functionality, including:
      </p>
      <ul>
        <li>Detecting potentially malicious and phishing websites.</li>
        <li>Identifying suspicious website characteristics and scripts.</li>
        <li>Analyzing Web3 wallet interactions.</li>
        <li>Evaluating potentially risky blockchain transactions.</li>
        <li>Providing smart contract security and verification insights.</li>
        <li>Retrieving threat intelligence and security information.</li>
        <li>Maintaining authentication and extension functionality.</li>
        <li>Improving the reliability and performance of security analysis.</li>
      </ul>
      <p>We do not use collected information for unrelated advertising or behavioral profiling.</p>
    </>
  )],
  ["4. Third-Party Services", (
    <>
      <p>Stack3 Security communicates with external services to provide its functionality.</p>
      <p>These services may include:</p>
      <h3>Stack3 Security Backend</h3>
      <p>
        Our backend infrastructure processes security-analysis requests and returns relevant security findings, threat
        indicators, and analysis results.
      </p>
      <h3>Sourcify</h3>
      <p>Sourcify may be accessed to retrieve smart contract source-code verification information.</p>
      <p>Information transmitted to these services is limited to what is required for the relevant functionality.</p>
      <p>Third-party services may operate under their own privacy policies and data-handling practices.</p>
    </>
  )],
  ["5. Data Sharing and Disclosure", (
    <>
      <p>We do not sell users' personal information.</p>
      <p>
        Information may be transmitted to the Stack3 Security backend and relevant third-party services when necessary
        to perform security analysis or provide requested functionality.
      </p>
      <p>
        We may also disclose information when required by applicable law or when necessary to protect the security and
        integrity of our services.
      </p>
      <p>We do not intentionally share personal information with advertisers for targeted advertising.</p>
    </>
  )],
  ["6. Data Storage and Retention", (
    <>
      <p>
        Stack3 Security uses browser storage to maintain extension settings, authentication state, cached security
        information, and temporary session data.
      </p>
      <p>Information submitted to our backend may be processed or retained according to the operational requirements of the service.</p>
      <p>
        We aim to retain information only for as long as necessary to provide the requested functionality and meet
        applicable legal or operational requirements.
      </p>
      <p>For questions about retention or deletion of information, users may contact us using the details provided below.</p>
    </>
  )],
  ["7. Data Security", (
    <>
      <p>We implement reasonable technical and organizational safeguards designed to protect information processed through Stack3 Security.</p>
      <p>However, no internet-based service or electronic transmission can be guaranteed to be completely secure.</p>
      <p>
        Users should never disclose their wallet seed phrases, private keys, passwords, or other sensitive credentials to
        websites or browser extensions.
      </p>
    </>
  )],
  ["8. User Rights and Choices", (
    <>
      <p>Users can control their use of Stack3 Security by:</p>
      <ul>
        <li>Disabling or uninstalling the browser extension.</li>
        <li>Managing available extension permissions through Chrome.</li>
        <li>Contacting us to request information about their personal data.</li>
        <li>Requesting deletion of applicable personal information, subject to legal and operational requirements.</li>
      </ul>
      <p>We will review privacy-related requests and respond in accordance with applicable data protection laws.</p>
    </>
  )],
  ["9. Children's Privacy", (
    <>
      <p>Stack3 Security is not specifically designed to collect personal information from children.</p>
      <p>We do not knowingly collect personal information from children in violation of applicable privacy laws.</p>
    </>
  )],
  ["10. Changes to This Privacy Policy", (
    <>
      <p>
        We may periodically update this Privacy Policy to reflect changes in our extension, backend infrastructure,
        security functionality, or applicable legal requirements.
      </p>
      <p>Any updates will be published on this page with a revised Last Updated date.</p>
      <p>Users are encouraged to review this page periodically.</p>
    </>
  )],
  ["11. Contact Information", (
    <>
      <p>For privacy-related questions, concerns, or data requests, please contact:</p>
      <p><strong>Stack3 Security</strong></p>
      <p>Privacy Contact: <a href={`mailto:${contactEmail}`}>{contactEmail}</a></p>
      <p>Website: <a href={websiteUrl}>{websiteUrl}</a></p>
    </>
  )],
];

export function PrivacyPolicyPage() {
  return (
    <PublicShell mainClassName="public-subpage">
      <section className="subpage-hero">
        <span className="eyebrow">LEGAL</span>
        <h1>Privacy Policy</h1>
        <p>Last Updated: October 31, 2026</p>
      </section>
      <div className="legal-body">
        {sections.map(([title, body]) => (
          <section key={title}>
            <h2>{title}</h2>
            {body}
          </section>
        ))}
        <p className="legal-signoff">
          <strong>Stack3 Security</strong>
          <br />
          <em>Verify What Happens Underneath.</em>
        </p>
      </div>
    </PublicShell>
  );
}
