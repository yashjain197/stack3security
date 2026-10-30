"""
Threat-graph tables (3NF). Postgres is the source of truth; TigerGraph is the synced copy used for traversal.

A report mentions nodes and edges. Node attributes that differ per vertex type live in their own table,
so the node row stays the same shape for wallets, domains, packages, repos and endpoints.

Made by Yash Jain with passion.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin

_RISK = "risk IN ('unknown', 'caution', 'high', 'critical')"
_VERTEX = "vertex_type IN ('Wallet', 'Domain', 'SoftwarePackage', 'Repo', 'Endpoint')"
_EDGE = (
    "edge_type IN ('PACKAGE_DRAINS_TO', 'DOMAIN_DRAINS_TO', 'PACKAGE_SENDS_TO', "
    "'DOMAIN_SENDS_TO', 'LOADS_SCRIPT', 'DEPENDS_ON', 'FUNDED')"
)
_SOURCE = "source IN ('web', 'chrome', 'vscode', 'cli', 'seed')"


class GraphNode(CreatedAtMixin, Base):
    """One vertex. report_count and the timestamps are absolute, so syncing to TigerGraph can be repeated safely."""

    __tablename__ = "graph_nodes"
    __table_args__ = (
        CheckConstraint(_RISK, name="risk_known"),
        CheckConstraint(_VERTEX, name="vertex_type_known"),
        CheckConstraint("report_count >= 0", name="report_count_nonnegative"),
        Index("uq_graph_nodes_vertex", "vertex_type", "vertex_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    vertex_type: Mapped[str] = mapped_column(String(32), nullable=False)
    vertex_id: Mapped[str] = mapped_column(String(512), nullable=False)
    risk: Mapped[str] = mapped_column(String(16), nullable=False)
    category: Mapped[str | None] = mapped_column(String(40))
    report_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class GraphNodeAttribute(Base):
    """One attribute of a vertex, such as chain_id, pkg_name or the brand a domain impersonates."""

    __tablename__ = "graph_node_attributes"

    node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_nodes.id", ondelete="CASCADE"), primary_key=True)
    attr_key: Mapped[str] = mapped_column(String(40), primary_key=True)
    attr_value: Mapped[str] = mapped_column(String(300), nullable=False)


class GraphEdge(CreatedAtMixin, Base):
    """One directed connection. At most one FUNDED edge per transaction hash; other edges are unique per pair."""

    __tablename__ = "graph_edges"
    __table_args__ = (
        CheckConstraint(_EDGE, name="edge_type_known"),
        Index(
            "uq_graph_edges_pair",
            "edge_type",
            "from_node_id",
            "to_node_id",
            unique=True,
            postgresql_where=text("tx_hash IS NULL"),
        ),
        Index(
            "uq_graph_edges_transfer",
            "edge_type",
            "from_node_id",
            "to_node_id",
            "tx_hash",
            unique=True,
            postgresql_where=text("tx_hash IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    edge_type: Mapped[str] = mapped_column(String(40), nullable=False)
    from_node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False)
    to_node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False)
    tx_hash: Mapped[str | None] = mapped_column(String(66))


class GraphReport(CreatedAtMixin, Base):
    """One submission. synced_at stays null until TigerGraph has accepted its nodes and edges."""

    __tablename__ = "graph_reports"
    __table_args__ = (
        CheckConstraint(_SOURCE, name="source_known"),
        CheckConstraint("length(trim(reason)) > 0", name="reason_not_blank"),
        CheckConstraint("sync_attempts >= 0", name="sync_attempts_nonnegative"),
        Index("ix_graph_reports_unsynced", "created_at", postgresql_where=text("synced_at IS NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    reporter_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reporter_label: Mapped[str | None] = mapped_column(String(80))
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    last_sync_error: Mapped[str | None] = mapped_column(String(500))


class GraphReportNode(Base):
    """Which report mentioned which node. Counting these rows gives report_count."""

    __tablename__ = "graph_report_nodes"

    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_reports.id", ondelete="CASCADE"), primary_key=True)
    node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_nodes.id", ondelete="CASCADE"), primary_key=True)


class GraphReportEdge(Base):
    """Which report mentioned which edge."""

    __tablename__ = "graph_report_edges"

    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_reports.id", ondelete="CASCADE"), primary_key=True)
    edge_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("graph_edges.id", ondelete="CASCADE"), primary_key=True)
