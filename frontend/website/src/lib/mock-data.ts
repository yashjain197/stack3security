import type { ContractResult, Report, ScanResult, TransactionResult } from "../types";

export const demoNotice =
  "You're viewing illustrative scan data. Live scanning is not connected. Account, billing and team features use the API.";

export const websiteScan: ScanResult = {
  level: "critical",
  target: { type: "Website", id: "demo-recovery-site.test" },
  findings: [
    {
      layer: "website",
      severity: "critical",
      title: "Recovery phrase requested in a suspicious context",
      evidence:
        "The sample page requests a wallet recovery phrase and its form submits to an unrelated destination in the simulated fixture.",
      source: "Simulated page content and form destination",
      recommendation:
        "Do not enter or submit a recovery phrase. Navigate to the official service using a trusted bookmark or independently verified domain.",
    },
  ],
  explanation:
    "The simulated page asks for a recovery phrase and sends the form to an unrelated destination. A recovery phrase can grant control over a wallet.",
  notChecked: [
    "Live domain reputation",
    "Real page scripts or network requests",
    "Certificate and hosting history",
  ],
};

export const transactionExample: TransactionResult = {
  level: "high",
  websiteAction: "Claim your reward.",
  network: "Ethereum (illustrative)",
  method: "approve(address,uint256)",
  targetAddress: "0x71C7...8A42",
  tokenAddress: "0x3D91...12F0",
  spenderAddress: "0xA804...C215",
  allowance: "Unlimited (illustrative)",
  findings: [
    {
      layer: "transaction",
      severity: "high",
      title: "Website intent and wallet request do not match",
      evidence:
        'The website says "Claim your reward," while the decoded request is an ERC-20 token approval.',
      source: "Illustrative decoded wallet request",
      recommendation:
        "Review the spender and permission scope carefully. Reject the request if you did not intend to grant token spending permission.",
    },
  ],
  notChecked: [
    "Contract bytecode or runtime behavior",
    "Whether the displayed addresses identify known entities",
    "Any submitted transaction or on-chain result",
  ],
};

export const contractExample: ContractResult = {
  target: "sample-contract",
  network: "Not specified in demo",
  sourceVerification: "Not checked in demo",
  proxyStatus: "Unknown",
  ownerPermissions: "Not checked",
  deploymentAge: "Unavailable",
  verdict: "caution",
  explanation:
    "There is not enough evidence in this demo to make a meaningful security assessment. Unknown fields are not negative findings.",
  notChecked: [
    "Source code verification",
    "Deployment date and age",
    "Proxy and upgradeability status",
    "Owner or administrator permissions",
    "External audit references",
  ],
};

export const reports: Report[] = [
  {
    target: "demo-recovery-site.test",
    type: "Website scan",
    verdict: "critical",
    findings: 1,
    date: "Oct 28, 2026",
    detail: "Recovery phrase requested in a suspicious context.",
    findingDetails: [
      {
        layer: "website",
        severity: "critical",
        title: "Recovery phrase requested in a suspicious context",
        evidence:
          "The simulated page requests a wallet recovery phrase and submits the form to an unrelated destination.",
        source: "Simulated page content and form destination",
        recommendation:
          "Do not enter a recovery phrase. Navigate to the official service using an independently verified domain.",
      },
    ],
    notChecked: ["Live domain reputation", "Real page scripts or network requests"],
  },
  {
    target: "sample-token-package",
    type: "Package review",
    verdict: "high",
    findings: 2,
    date: "Oct 27, 2026",
    detail: "Illustrative package review with sample risk indicators.",
    findingDetails: [
      {
        layer: "package",
        severity: "high",
        title: "Install behavior requires review",
        evidence: "This local example includes an illustrative package install-script risk indicator.",
        source: "Simulated package metadata",
        recommendation: "Inspect lifecycle scripts and verify the package source before installing.",
      },
      {
        layer: "package",
        severity: "caution",
        title: "Dependency context is incomplete",
        evidence: "The demo fixture does not include a verified dependency or publisher history.",
        source: "Simulated package metadata",
        recommendation: "Check package provenance and dependency changes using trusted sources.",
      },
    ],
    notChecked: ["Live registry data", "Package contents or publisher identity"],
  },
  {
    target: "demo-claim-dapp.test",
    type: "Transaction review",
    verdict: "high",
    findings: 1,
    date: "Oct 26, 2026",
    detail: "Illustrative approval does not match the stated claim action.",
    findingDetails: [
      {
        layer: "transaction",
        severity: "high",
        title: "Website intent and wallet request do not match",
        evidence:
          'The website says "Claim your reward," while the sample request is an ERC-20 token approval.',
        source: "Illustrative decoded wallet request",
        recommendation: "Review the spender and permission scope before deciding whether to approve.",
      },
    ],
    notChecked: ["Contract behavior", "Any submitted transaction or on-chain result"],
  },
  {
    target: "sample-contract",
    type: "Contract review",
    verdict: "caution",
    findings: 0,
    date: "Oct 25, 2026",
    detail: "Illustrative contract information is mostly unknown or unchecked.",
    findingDetails: [],
    notChecked: [
      "Source code verification",
      "Deployment date and age",
      "Proxy and upgradeability status",
      "Owner or administrator permissions",
      "External audit references",
    ],
  },
];
