"""
The shared verdict contract from the Stack3 blueprint; every check on every surface returns this shape.

Imran's VS Code API mirrors these types in TypeScript so the shared screens render both services identically.

Made by Yash Jain with passion.
"""

from datetime import datetime
from enum import StrEnum

from pydantic import Field

from app.schemas.base import ApiModel


class Level(StrEnum):
    """Verdict levels; there is deliberately no 'safe'."""

    CRITICAL = "critical"
    HIGH = "high"
    CAUTION = "caution"
    UNKNOWN = "unknown"
    NO_KNOWN_ISSUES = "no_known_issues"


LEVEL_RANK = {
    Level.NO_KNOWN_ISSUES: 0,
    Level.UNKNOWN: 1,
    Level.CAUTION: 2,
    Level.HIGH: 3,
    Level.CRITICAL: 4,
}


class TargetType(StrEnum):
    """What was checked."""

    REPO = "repo"
    PACKAGE = "package"
    SITE = "site"
    CONTRACT = "contract"
    TX = "tx"


class Layer(StrEnum):
    """Which detection layer produced a finding."""

    REPO_FILE = "repo-file"
    DEPENDENCY = "dependency"
    SECRET = "secret"  # noqa: S105
    SITE = "site"
    CONTRACT = "contract"
    TX = "tx"
    INTENT = "intent"
    GRAPH = "graph"


class Source(StrEnum):
    """Where the evidence came from."""

    RULES = "rules"
    SOCKET = "socket"
    SOURCIFY = "sourcify"
    GRAPH = "graph"


class Target(ApiModel):
    """The checked object, e.g. github.com/x/y@3f9c2a1 or a contract address."""

    type: TargetType
    id: str = Field(max_length=512)


class Location(ApiModel):
    """File and line of a finding, when it has one."""

    file: str | None = Field(default=None, max_length=512)
    line: int | None = Field(default=None, ge=1)


class Finding(ApiModel):
    """One reason behind a verdict."""

    layer: Layer
    severity: Level
    title: str = Field(max_length=200)
    evidence: str = Field(max_length=1000)
    location: Location | None = None
    source: Source
    checked_at: datetime


class Indicators(ApiModel):
    """Attacker wallets and domains that go into the threat graph."""

    addresses: list[str] = Field(default_factory=list, max_length=100)
    domains: list[str] = Field(default_factory=list, max_length=100)


class Verdict(ApiModel):
    """Overall level is always the highest finding severity; one critical is never diluted."""

    level: Level
    target: Target
    findings: list[Finding] = Field(default_factory=list)
    indicators: Indicators = Field(default_factory=Indicators)
    not_checked: list[str] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=list)
    explanation: str | None = None


def aggregate_level(findings: list[Finding], incomplete: bool = False) -> Level:
    """Highest severity wins; with no findings, 'unknown' if checks were incomplete, else 'no_known_issues'."""
    if not findings:
        return Level.UNKNOWN if incomplete else Level.NO_KNOWN_ISSUES
    return max((f.severity for f in findings), key=LEVEL_RANK.__getitem__)
