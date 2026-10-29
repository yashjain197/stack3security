"""
Request and response models for threat-graph reports and the neighbourhood view.

Made by Yash Jain with passion.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import ApiModel

NodeTypeName = Literal["wallet", "domain", "package", "repo", "endpoint"]
EdgeTypeName = Literal[
    "package_drains_to",
    "domain_drains_to",
    "package_sends_to",
    "domain_sends_to",
    "loads_script",
    "depends_on",
    "funded",
]
RiskName = Literal["unknown", "caution", "high", "critical"]


class NodeIn(ApiModel):
    """One vertex in a report. `id` is normalised; see graph/README.md for the format of each type."""

    type: NodeTypeName
    id: str = Field(min_length=1, max_length=512)
    risk: RiskName = "unknown"
    category: str | None = Field(default=None, max_length=40)
    label: str | None = Field(default=None, max_length=120)
    impersonates: str | None = Field(default=None, max_length=80)


class EdgeIn(ApiModel):
    """One connection. fromId and toId are the same ids used in `nodes`, before or after normalisation."""

    type: EdgeTypeName
    from_id: str = Field(min_length=1, max_length=512)
    to_id: str = Field(min_length=1, max_length=512)
    tx_hash: str | None = Field(default=None, max_length=66)


class ReportIn(ApiModel):
    """A logged-in user's report: at least one node, and edges only between those nodes."""

    reason: str = Field(min_length=1, max_length=500)
    nodes: list[NodeIn] = Field(min_length=1, max_length=40)
    edges: list[EdgeIn] = Field(default_factory=list, max_length=80)


class InternalReportIn(ReportIn):
    """Imran's backend reporting through the service key. `reporter` is a label such as scan-repo."""

    source: Literal["vscode", "cli"] = "vscode"
    reporter: str = Field(min_length=1, max_length=80)


class ReportOut(ApiModel):
    """Accepted report. `synced` is false when TigerGraph has not stored it yet; it retries in the background."""

    id: uuid.UUID
    synced: bool


class GraphNodeOut(ApiModel):
    """A vertex with its attributes and how many reports mention it."""

    type: NodeTypeName
    id: str
    risk: RiskName
    category: str | None
    attributes: dict[str, str]
    report_count: int
    first_seen: datetime
    last_seen: datetime


class GraphEdgeOut(ApiModel):
    """A neighbour of the requested node. `direction` is out when the node points at the peer."""

    type: EdgeTypeName
    direction: Literal["out", "in"]
    peer_type: NodeTypeName
    peer_id: str
    tx_hash: str | None = None


class NeighborhoodOut(ApiModel):
    """A node and its direct neighbours. `source` says whether the edges came from TigerGraph or Postgres."""

    node: GraphNodeOut
    edges: list[GraphEdgeOut]
    source: Literal["tigergraph", "database"]
