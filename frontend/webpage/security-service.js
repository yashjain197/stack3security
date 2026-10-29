import {
  contractExample,
  reports,
  transactionExample,
  websiteScan,
} from "./mock-data.js";

const DEMO_DOMAIN = "demo-recovery-site.test";

export function getDashboardData() {
  return {
    reports,
    scansReviewed: reports.length,
    criticalFindings: reports.filter((report) => report.verdict === "critical").length,
    needsReview: reports.filter((report) => ["high", "caution"].includes(report.verdict)).length,
    noKnownIssues: reports.filter((report) => report.verdict === "no_known_issues").length,
  };
}

export function scanWebsite(input) {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    throw new Error("Enter the sample domain to run the illustrative demo scan.");
  }

  let hostname;
  try {
    hostname = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedInput) ? trimmedInput : `https://${trimmedInput}`,
    ).hostname;
  } catch {
    throw new Error("Enter a valid website URL or domain.");
  }

  if (hostname !== DEMO_DOMAIN) {
    throw new Error(
      `This local demo only analyzes ${DEMO_DOMAIN}. No live domain assessment was performed.`,
    );
  }

  return { ...websiteScan, target: { ...websiteScan.target, id: hostname } };
}

export function analyzeSampleTransaction() {
  return transactionExample;
}

export function reviewSampleContract(input) {
  if (input.trim().toLowerCase() !== contractExample.target) {
    throw new Error(
      'Live contract lookups are not connected. Enter "sample-contract" to view the illustrative fixture.',
    );
  }
  return contractExample;
}

export function getReport(target) {
  return reports.find((report) => report.target === target) ?? null;
}
