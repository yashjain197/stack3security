# Stack3 Security — Website Content

This document contains the source copy for the Stack3 Security website and frontend demo.

Until the backend is connected, clearly label sample results as demo or illustrative data.

---

# Brand

**Product:** Stack3 Security

**Descriptor:** Web3 security for developers and users.

**Tagline:** Don't trust the interface. Verify what happens underneath.

**Core message:** Catch malicious code before you run it. Understand suspicious websites before you trust them. Know what your wallet is being asked to sign.

**One-sentence pitch:** Stack3 Security connects developer-side code risk with website, smart-contract, and transaction analysis to help people spot suspicious behavior before it causes harm.

Never promise that a website, package, transaction, or contract is completely safe.

Use evidence-based wording such as:

- Risk indicators found.
- Requires review.
- No known issues found.
- Insufficient evidence.
- Checks not performed.

---

# 1. Landing page — `/`

## Navigation

- Product
- How it works
- Pricing
- Sign in
- Open dashboard

## Hero

**Eyebrow:** SECURITY BEFORE YOU TRUST

# Don't trust the interface. Verify what happens underneath.

A website can look legitimate while asking your wallet to do something very different. A code repository can look ordinary while hiding a malicious install script.

Stack3 Security helps developers inspect suspicious code and helps Web3 users understand websites, contracts, and wallet requests before they act.

**Primary CTA:** Explore the dashboard

**Secondary CTA:** See how it works

**Trust note:** Demo experience — security checks shown in the dashboard are illustrative until live scanning is connected.

## Proof strip

- Developer-side code inspection
- Website and phishing signals
- Transaction intent review
- Smart-contract risk context

Do not display customer counts, detection percentages, audit badges, or partner logos unless verified and approved.

## Section: Two layers. One security mindset.

### Developer Guard

**Catch suspicious code before you run it.**

Inspect project files and npm dependencies for suspicious install scripts, risky configuration, exposed secrets, and known package risk indicators.

Understand what was flagged and where to investigate.

**CTA:** Explore developer protection

### Web3 Guard

**Understand what a website is asking you to approve.**

Review suspicious page behavior, seed-phrase phishing signals, transaction requests, and available smart-contract risk indicators.

Compare the website's promise with the decoded wallet request.

**CTA:** Explore user protection

## Section: The interface says one thing. The transaction may say another.

A "Claim reward" button might trigger a token approval or an unexpected transfer request.

Stack3 aims to make the difference understandable before you approve.

**Illustrative example**

Website promise:
"Claim your reward."

Wallet request:
"Approve token spending."

Why it matters:
The request grants a spender permission within the approval's scope. The user should understand that permission before deciding.

Stack3 finding:
Website intent and transaction request may not match.

An approval is not automatically malicious. The spender, scope, contract behavior, and context matter.

## Section: Explain the evidence, not just the score.

A useful warning should answer:

- What was detected?
- What evidence supports the finding?
- Why could it matter?
- What was not checked?
- What should I do next?

Stack3 is designed to pair technical findings with clear explanations and practical next steps.

AI-generated explanations should summarize available evidence, not replace the underlying checks.

## Section: Designed for real decisions

### Before you run

Review suspicious project configuration and dependency signals before running unfamiliar code.

### Before you enter

Identify pages that appear to request recovery phrases or private keys in suspicious contexts.

### Before you sign

Review decoded transaction methods, recipients or spenders, permissions, and intent mismatches.

### Before you trust a contract

Review available information about verification, deployment age, proxy behavior, owner permissions, and suspicious capabilities.

These checks depend on available data and supported networks. They cannot guarantee the absence of malicious behavior.

## Section: Built for clarity

**Headline:** Security findings should help you decide what to do next.

Every finding should include:

- A clear severity level.
- Evidence and source, when available.
- A concise explanation.
- Recommended next steps.
- Any important checks that were not performed.

## Final CTA

# Make the next decision with better information.

Explore the Stack3 demo and see how code, website, and transaction risks can be explained in one clear experience.

**CTA:** Open the dashboard

## Footer

Stack3 Security

Web3 security for developers and users.

Links:
Product · How it works · Pricing · Privacy · Contact

**Disclaimer:** Stack3 provides risk indicators and security information, not a guarantee that software, websites, transactions, or smart contracts are safe. Always review wallet requests carefully.

---

# 2. How it works — `/how-it-works`

## Hero

# Security should start before the click, install, or signature.

Stack3 is designed to inspect risk at two points: when developers evaluate code and when users interact with Web3 websites and wallet requests.

## Step 1: Inspect the signals

The developer side examines suspicious repository files and dependency risk indicators.

The user side examines page behavior, transaction requests, and available contract information.

## Step 2: Connect the context

Where evidence supports it, signals such as a suspicious domain, package, contract, or wallet address can provide additional context.

A relationship should not be treated as proof of wrongdoing without supporting evidence.

## Step 3: Explain the finding

Stack3 presents severity, evidence, source, limitations, and recommended next steps.

AI may help translate technical findings into plain language, while verdicts should remain grounded in actual checks and evidence.

## Step 4: Let the user decide

The goal is to help users pause, investigate, reject a request, or proceed with a clearer understanding.

Stack3 should not make irreversible wallet decisions on a user's behalf.

## What Stack3 does not promise

- It cannot detect every scam or malicious package.
- A verified contract or older deployment is not automatically trustworthy.
- A website with no known reputation signals is not necessarily legitimate.
- A transaction explanation is only as accurate as the decoded data and available context.
- AI explanations can be wrong and should be grounded in inspectable evidence.

---

# 3. Dashboard — `/dashboard`

## Page title

# Security overview

**Subtitle:** Review recent findings across code, websites, transactions, and contracts.

**Demo banner:** You're viewing illustrative demo data. Live scanning and account features will appear when the backend is connected.

## Summary cards

### Scans reviewed

Number of sample scan records in this demo.

### Critical findings

Sample findings classified as critical.

### Needs review

Sample high-risk and caution findings.

### No known issues

Sample checks that returned no known issues. This is not a safety guarantee.

Numbers must match the local demo dataset. Do not imply that these are live customer or production statistics.

## Recent activity

Columns:

- Target
- Scan type
- Verdict
- Date
- Action

Example demo records:

- `demo-recovery-site.test` — Website scan — Critical
- `sample-token-package` — Package review — High
- `demo-claim-dapp.test` — Transaction review — High
- `sample-contract` — Contract review — Caution

These are invented local demo fixtures. Do not use real brands or real domains to falsely label a site as malicious.

## Quick actions

- Scan a website
- Review a transaction
- Explore contract details
- View recent reports

---

# 4. Website scanner — `/dashboard/scanner`

## Page title

# Website risk scanner

**Subtitle:** Inspect a domain for suspicious identity, page behavior, and recovery-phrase requests.

**Input label:** Website URL

**Placeholder:** `https://example.com`

**Button:** Scan website

**Privacy note:** Never enter a seed phrase or private key. The scanner should inspect the page and relevant signals, not collect wallet secrets.

## What the scanner may inspect

- Lookalike or suspicious domain patterns.
- Recovery-phrase or private-key prompts.
- Suspicious form destinations.
- Wallet-brand impersonation signals.
- Relevant page-script indicators, when supported.

## Demo result example

**Target:** `demo-recovery-site.test`

**Verdict:** Critical

**Status:** Illustrative demo result — not a live domain assessment.

### Finding: Recovery phrase requested in a suspicious context

Evidence:

- The sample page includes language requesting a wallet recovery phrase.
- A form appears to submit data to an unrelated destination in the simulated fixture.

Why it matters:
A recovery phrase can grant control over a wallet. Legitimate support or claim pages should not require users to disclose it.

Recommended action:

- Do not enter or submit a recovery phrase.
- Close the page and navigate to the official service using a trusted bookmark or independently verified domain.
- If you already shared a phrase, treat the wallet as potentially compromised and seek trusted wallet-security guidance.

**Limitations:** This is demo data. A real scan must show the checks actually performed and the evidence collected.

## Empty state

Enter a website URL to begin a demo scan.

## Error state

We couldn't complete this scan. Check the URL and try again.

No conclusion about the website's safety can be drawn from a failed scan.

---

# 5. Transaction analyzer — `/dashboard/transactions`

## Page title

# Transaction intent analyzer

**Subtitle:** Understand the wallet request, what it authorizes, and whether it matches the website's stated action.

**Mode label:** Demonstration mode

## Fields

- Network
- Transaction data or sample request
- Contract address, if available
- Website's stated action, optional

Never ask for a seed phrase or private key.

## Example analysis

**Website says:** Claim your reward.

**Decoded request:** ERC-20 token approval.

**Verdict:** High — illustrative example.

### What this request means

The transaction requests permission for a spender to access a token within the allowance's scope.

Depending on the token, spender, and amount, this may create meaningful financial risk.

### Why Stack3 flags it

The website's wording suggests a claim, while the decoded request is an approval. That mismatch deserves review.

### Details to display when available

- Network.
- Method or function name.
- Target contract address.
- Token address.
- Spender address.
- Allowance or amount.
- Whether the allowance is unlimited.
- Decode source and confidence.
- Contract findings.
- Relevant known risk indicators.
- Checks not performed.

### Important limitation

A decoded method does not prove what every contract will do in all circumstances.

Explain what the request encodes and what additional information remains unknown.

**Actions:**

- Reject request — only in a connected extension flow.
- View technical details.
- Copy contract address.

On the website demo, these controls must not trigger a real wallet transaction.

---

# 6. Contract explorer — `/dashboard/contracts`

## Page title

# Smart-contract overview

**Subtitle:** Review available contract information and risk indicators before interacting.

## Search field

**Label:** Contract address

**Placeholder:** Paste a public contract address

**Button:** Review contract

Do not imply live verification until connected to a real data source.

## Contract details

Display fields only when available:

- Network.
- Contract address.
- Source verification status.
- Deployment date and calculated age.
- Proxy or upgradeability information.
- Owner/admin address.
- Privileged functions.
- Mint, pause, blacklist, fee-change, or withdrawal permissions.
- External audit references, only if verified.
- Findings and evidence.
- Not checked or unavailable fields.

## Example result

**Sample contract**

**Verdict:** Caution — illustrative demo data.

- Source verification: Not checked in demo.
- Proxy status: Unknown.
- Owner permissions: Not checked.
- Deployment age: Unavailable.

**Explanation:** There is not enough evidence in this demo to make a meaningful security assessment.

Unknown fields must not be presented as negative findings.

---

# 7. Reports — `/dashboard/reports`

## Page title

# Scan reports

**Subtitle:** Review what was checked, what was found, and what remains unknown.

## Reports table

Columns:

- Target
- Scan type
- Verdict
- Findings
- Date
- View report

## Report details

- Overall verdict.
- Target and network/domain.
- Findings and evidence.
- Sources.
- Recommendations.
- Checks not performed.
- Demo/live indicator.

## Empty state

No reports yet. Run a demo scan to see a sample report.

---

# 8. Pricing — `/pricing`

## Hero

# Security that fits your workflow.

Protect the code you evaluate and the Web3 interactions you review.

**Pricing notice:** Plan details below are provided by the Stack3 team. Account setup and subscription checkout are not connected in this demo.

## Plan: Free

**$0 — Everyone**

- Full Chrome protection: page scan, transaction review, phishing checks, and GitHub banner.
- Unlimited VS Code local repository-file rules.
- 20 "Clone and scan safely" runs each month.

**CTA:** Explore the demo

## Plan: Pro

**$9/month or $90/year — Solo Web3 developers**

Includes a 30-day free trial with either billing option.

- Unlimited clone-and-scan.
- Socket package scanning.
- Secret scanning.
- AI explanations.
- Warnings while working.
- CLI for private repositories.
- Report history.

**CTA:** Start 30-day free trial (checkout not connected)

## Plan: Team

**$29/seat/month, three-seat minimum — Web3 teams and audit shops**

Includes a 30-day free trial. The minimum subscription is $87/month after the trial.

Team plan inclusions have not yet been provided and must not be invented.

Do not wire these buttons to a fake checkout. Do not promise plan access until account and subscription integrations are available.

---

# 9. Settings — `/dashboard/settings`

## Page title

# Settings

**Subtitle:** Account and product preferences.

## Account

Authentication integration pending.

## Subscription

Dodo Payments integration pending.

## Security and privacy

Explain what data each real scan sends once implementation is confirmed.

## Connected wallet

Do not request a wallet connection unless the feature actually needs it.

## Theme

Only include this if implemented.

**Banner:** Account and subscription settings are not connected in this demo.

---

# 10. Shared interface copy

## Verdict labels

### Critical

Strong evidence of a severe threat.

### High risk

Significant risk indicators require attention.

### Caution

Review the available evidence before proceeding.

### Unknown

There is not enough evidence to assess this target.

### No known issues found

The checks performed did not identify known issues. This is not a guarantee of safety.

## Common labels

- Evidence
- Why this matters
- Recommended action
- Source
- Confidence
- Checks performed
- Not checked
- Demo data
- Scan incomplete
- Try again
- View technical details
- Copy address

## Generic AI explanation

**Explanation generated from available findings**

This explanation summarizes the evidence shown in this report. It does not independently prove that a target is safe or malicious.

Review the cited evidence and any checks that were not performed.

## Footer disclaimer

Stack3 Security provides risk indicators and security information, not a guarantee that software, websites, transactions, or smart contracts are safe.

Always review wallet requests carefully and never share a seed phrase or private key.
