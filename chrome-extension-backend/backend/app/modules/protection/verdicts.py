"""
Build the shared verdict from findings. The highest severity wins, and a skipped check is said out loud.

Made by Yash Jain with passion.
"""

from datetime import datetime

from app.db.base import utcnow
from app.schemas.verdict import Finding, Indicators, Layer, Level, Source, Target, Verdict, aggregate_level

_ACTIONS = {
    Level.CRITICAL: ["Reject this request"],
    Level.HIGH: ["Do not continue unless you opened this site yourself and trust it"],
    Level.CAUTION: ["Read the details before continuing"],
    Level.UNKNOWN: ["Some checks did not finish, so this is not a clear result"],
    Level.NO_KNOWN_ISSUES: [],
}


def finding(
    *,
    layer: Layer,
    severity: Level,
    title: str,
    evidence: str,
    source: Source,
    checked_at: datetime | None = None,
) -> Finding:
    """One reason, with the clock set once for a whole check."""
    return Finding(
        layer=layer,
        severity=severity,
        title=title[:200],
        evidence=evidence[:1000],
        source=source,
        checked_at=checked_at or utcnow(),
    )


def finish(
    target: Target,
    findings: list[Finding],
    *,
    not_checked: list[str] | None = None,
    indicators: Indicators | None = None,
    incomplete: bool = False,
    explanation: str | None = None,
) -> Verdict:
    """Collapse findings into one verdict. Incomplete with nothing found stays unknown, never a clean bill."""
    skipped = list(dict.fromkeys(not_checked or []))
    seen: set[tuple[str, str, str]] = set()
    unique: list[Finding] = []
    for item in findings:
        key = (item.layer, item.title, item.evidence)
        if key not in seen:
            seen.add(key)
            unique.append(item)
    findings = unique
    level = aggregate_level(findings, incomplete=False)
    if not findings and incomplete:
        level = Level.UNKNOWN
    elif findings:
        level = aggregate_level(findings, incomplete=False)
    text = explanation or _explain(level, findings, skipped)
    return Verdict(
        level=level,
        target=target,
        findings=findings,
        indicators=indicators or Indicators(),
        not_checked=skipped,
        actions=_ACTIONS[level],
        explanation=text,
    )


def _explain(level: Level, findings: list[Finding], skipped: list[str]) -> str:
    """One sentence a person can read on the warning screen."""
    if findings:
        lead = max(findings, key=lambda item: (item.severity, item.title)).title
        extra = f" Also not checked: {', '.join(skipped)}." if skipped else ""
        return f"{lead}.{extra}" if not lead.endswith(".") else f"{lead}{extra}"
    if skipped:
        return f"No threat was found in the checks that finished. Not checked: {', '.join(skipped)}."
    if level == Level.NO_KNOWN_ISSUES:
        return "Nothing in these checks matches a known threat."
    return "These checks did not produce a result."
