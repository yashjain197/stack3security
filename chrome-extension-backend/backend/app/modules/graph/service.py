"""
Store threat reports in Postgres and sync them to TigerGraph. Reads serve Postgres, and TigerGraph when it is reachable.

Made by Yash Jain with passion.
"""

import uuid
from datetime import UTC

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.core.logging import get_logger
from app.db.base import utcnow
from app.modules.graph import tigergraph
from app.modules.graph.catalog import (
    EDGE_BY_REVERSE,
    EDGE_BY_TG,
    EDGES,
    SHORT_TYPE,
    NormalizedNode,
    check_category,
    normalize_node,
    normalize_tx_hash,
    stronger_risk,
)
from app.modules.graph.models import (
    GraphEdge,
    GraphNode,
    GraphNodeAttribute,
    GraphReport,
    GraphReportEdge,
    GraphReportNode,
)
from app.modules.graph.schemas import (
    EdgeIn,
    GraphEdgeOut,
    GraphNodeOut,
    NeighborhoodOut,
    NodeIn,
    ReportOut,
)
from app.modules.graph.tigergraph import GraphUnavailable

logger = get_logger("graph")

_MAX_SYNC_ATTEMPTS = 10
_INT_ATTRIBUTES = {"chain_id", "report_count"}


def _bad_request(exc: ValueError) -> AppError:
    """Turn a normalisation error into the API's 400 envelope."""
    return AppError("invalid_report", str(exc))


async def submit_report(
    db: AsyncSession,
    *,
    source: str,
    reason: str,
    nodes: list[NodeIn],
    edges: list[EdgeIn],
    reporter_user_id: uuid.UUID | None = None,
    reporter_label: str | None = None,
    report_id: uuid.UUID | None = None,
) -> ReportOut:
    """Save a report, then try once to copy it into TigerGraph. A failure is retried in the background."""
    if report_id is not None:
        existing = await db.get(GraphReport, report_id)
        if existing is not None:
            return ReportOut(id=existing.id, synced=existing.synced_at is not None)
    try:
        report = await _store(db, source, reason, nodes, edges, reporter_user_id, reporter_label, report_id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if report_id is None:
            raise
        return ReportOut(id=report_id, synced=False)
    synced = False
    if get_settings().tigergraph_configured:
        synced = await sync_report(db, report.id)
        await db.commit()
    return ReportOut(id=report.id, synced=synced)


async def sync_pending(db: AsyncSession, limit: int = 20) -> int:
    """Push reports TigerGraph has not accepted yet. Returns how many succeeded."""
    if not get_settings().tigergraph_configured:
        return 0
    pending = await db.scalars(
        select(GraphReport.id)
        .where(GraphReport.synced_at.is_(None), GraphReport.sync_attempts < _MAX_SYNC_ATTEMPTS)
        .order_by(GraphReport.created_at)
        .limit(limit)
    )
    synced = 0
    for report_id in pending.all():
        if await sync_report(db, report_id):
            synced += 1
    return synced


async def sync_report(db: AsyncSession, report_id: uuid.UUID) -> bool:
    """Upsert one report's nodes and edges. On failure the attempt is recorded and the report stays pending."""
    report = await db.get(GraphReport, report_id)
    if report is None or report.synced_at is not None:
        return report is not None
    try:
        vertices, edges = await _tigergraph_payload(db, report_id)
        if vertices or edges:
            await tigergraph.get_tigergraph().upsert(vertices, edges)
    except GraphUnavailable as exc:
        report.sync_attempts += 1
        report.last_sync_error = str(exc)[:500]
        logger.warning("graph_sync_failed", report_id=str(report_id), attempts=report.sync_attempts)
        return False
    report.synced_at = utcnow()
    report.last_sync_error = None
    return True


async def neighborhood(db: AsyncSession, short_type: str, raw_id: str) -> NeighborhoodOut:
    """A node and its direct neighbours. TigerGraph answers when it has the node; otherwise Postgres does."""
    try:
        norm = normalize_node(short_type, raw_id)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    row = await db.scalar(
        select(GraphNode).where(GraphNode.vertex_type == norm.vertex_type, GraphNode.vertex_id == norm.vertex_id)
    )
    if row is None:
        raise NotFound("Nothing is known about this yet", "node_not_found")
    node = await _node_out(db, row)
    if get_settings().tigergraph_configured:
        try:
            live = await _tigergraph_edges(row)
        except GraphUnavailable:
            logger.warning("graph_read_fell_back_to_database", vertex_id=row.vertex_id)
        else:
            if live is not None:
                return NeighborhoodOut(node=node, edges=live, source="tigergraph")
    return NeighborhoodOut(node=node, edges=await _postgres_edges(db, row), source="database")


async def _store(
    db: AsyncSession,
    source: str,
    reason: str,
    nodes: list[NodeIn],
    edges: list[EdgeIn],
    reporter_user_id: uuid.UUID | None,
    reporter_label: str | None,
    report_id: uuid.UUID | None,
) -> GraphReport:
    """Insert the report and upsert every node and edge it mentions."""
    report = GraphReport(
        id=report_id or uuid.uuid4(),
        source=source,
        reporter_user_id=reporter_user_id,
        reporter_label=reporter_label,
        reason=reason.strip(),
    )
    db.add(report)
    stored = await _upsert_nodes(db, report, nodes)
    for edge in edges:
        await _upsert_edge(db, report, edge, stored)
    await db.flush()
    return report


async def _upsert_nodes(db: AsyncSession, report: GraphReport, nodes: list[NodeIn]) -> dict[tuple[str, str], GraphNode]:
    """Create or update each node once per report and return them keyed by (vertex type, vertex id)."""
    stored: dict[tuple[str, str], GraphNode] = {}
    for node in nodes:
        try:
            norm = normalize_node(node.type, node.id)
            category = check_category(node.category)
        except ValueError as exc:
            raise _bad_request(exc) from exc
        row = stored.get((norm.vertex_type, norm.vertex_id))
        if row is None:
            row = await _upsert_node(db, report, norm, node.risk, category)
            stored[(norm.vertex_type, norm.vertex_id)] = row
        elif stronger_risk(row.risk, node.risk) != row.risk:
            row.risk = stronger_risk(row.risk, node.risk)
            if category:
                row.category = category
        await _merge_attributes(db, row, {**norm.attributes, **_caller_attributes(node)})
    return stored


async def _upsert_node(
    db: AsyncSession, report: GraphReport, norm: NormalizedNode, risk: str, category: str | None
) -> GraphNode:
    """Insert a vertex or fold this report into the existing one, counting the report a single time."""
    now = utcnow()
    row = await db.scalar(
        select(GraphNode).where(GraphNode.vertex_type == norm.vertex_type, GraphNode.vertex_id == norm.vertex_id)
    )
    if row is None:
        row = GraphNode(
            vertex_type=norm.vertex_type,
            vertex_id=norm.vertex_id,
            risk=risk,
            category=category,
            report_count=1,
            first_seen=now,
            last_seen=now,
        )
        db.add(row)
        await db.flush()
    else:
        if category and stronger_risk(row.risk, risk) == risk:
            row.category = category
        row.risk = stronger_risk(row.risk, risk)
        row.report_count += 1
        row.last_seen = now
    db.add(GraphReportNode(report_id=report.id, node_id=row.id))
    return row


def _caller_attributes(node: NodeIn) -> dict[str, str]:
    """Optional attributes only the caller knows: a wallet's label and the brand a domain copies."""
    attributes: dict[str, str] = {}
    if node.type == "wallet" and node.label:
        attributes["label"] = node.label
    if node.type == "domain" and node.impersonates:
        attributes["impersonates"] = node.impersonates.lower()
    return attributes


async def _merge_attributes(db: AsyncSession, row: GraphNode, attributes: dict[str, str]) -> None:
    """Write attributes that are new or changed."""
    if not attributes:
        return
    existing = {
        attr.attr_key: attr
        for attr in await db.scalars(select(GraphNodeAttribute).where(GraphNodeAttribute.node_id == row.id))
    }
    for key, value in attributes.items():
        current = existing.get(key)
        if current is None:
            db.add(GraphNodeAttribute(node_id=row.id, attr_key=key, attr_value=value))
        elif current.attr_value != value:
            current.attr_value = value


async def _upsert_edge(
    db: AsyncSession, report: GraphReport, edge: EdgeIn, stored: dict[tuple[str, str], GraphNode]
) -> None:
    """Connect two nodes from this report, reusing the edge when it already exists."""
    spec = EDGES[edge.type]
    try:
        tx_hash = normalize_tx_hash(edge.tx_hash)
        source = stored[_end(spec.from_type, edge.from_id)]
        target = stored[_end(spec.to_type, edge.to_id)]
    except ValueError as exc:
        raise _bad_request(exc) from exc
    except KeyError as exc:
        raise AppError("invalid_report", "An edge refers to a node that is not in this report") from exc
    if tx_hash and spec.api_name != "funded":
        raise AppError("invalid_report", "Only funded edges take a txHash")
    found = await db.scalar(
        select(GraphEdge).where(
            GraphEdge.edge_type == spec.tg_name,
            GraphEdge.from_node_id == source.id,
            GraphEdge.to_node_id == target.id,
            GraphEdge.tx_hash == tx_hash if tx_hash else GraphEdge.tx_hash.is_(None),
        )
    )
    if found is None:
        found = GraphEdge(edge_type=spec.tg_name, from_node_id=source.id, to_node_id=target.id, tx_hash=tx_hash)
        db.add(found)
        await db.flush()
    db.add(GraphReportEdge(report_id=report.id, edge_id=found.id))


def _end(short_type: str, raw_id: str) -> tuple[str, str]:
    """Normalise one end of an edge into the key used by the stored-node map."""
    norm = normalize_node(short_type, raw_id)
    return norm.vertex_type, norm.vertex_id


async def _attributes(db: AsyncSession, node_id: uuid.UUID) -> dict[str, str]:
    """All stored attributes of one node."""
    rows = await db.scalars(select(GraphNodeAttribute).where(GraphNodeAttribute.node_id == node_id))
    return {row.attr_key: row.attr_value for row in rows}


async def _node_out(db: AsyncSession, row: GraphNode) -> GraphNodeOut:
    """Build the API view of a node."""
    return GraphNodeOut(
        type=SHORT_TYPE[row.vertex_type],  # type: ignore[arg-type]
        id=row.vertex_id,
        risk=row.risk,  # type: ignore[arg-type]
        category=row.category,
        attributes=await _attributes(db, row.id),
        report_count=row.report_count,
        first_seen=row.first_seen,
        last_seen=row.last_seen,
    )


async def _postgres_edges(db: AsyncSession, row: GraphNode) -> list[GraphEdgeOut]:
    """Neighbours recorded in Postgres."""
    source, target = aliased(GraphNode), aliased(GraphNode)
    rows = await db.execute(
        select(GraphEdge, source, target)
        .join(source, source.id == GraphEdge.from_node_id)
        .join(target, target.id == GraphEdge.to_node_id)
        .where(or_(GraphEdge.from_node_id == row.id, GraphEdge.to_node_id == row.id))
    )
    edges: list[GraphEdgeOut] = []
    for edge, src, dst in rows:
        outgoing = edge.from_node_id == row.id
        peer = dst if outgoing else src
        edges.append(
            _edge_out(edge.edge_type, "out" if outgoing else "in", peer.vertex_type, peer.vertex_id, edge.tx_hash)
        )
    return edges


async def _tigergraph_edges(row: GraphNode) -> list[GraphEdgeOut] | None:
    """Neighbours from TigerGraph, or None when the vertex has not been synced there yet."""
    client = tigergraph.get_tigergraph()
    if await client.get_vertex(row.vertex_type, row.vertex_id) is None:
        return None
    return [
        mapped
        for raw in await client.get_edges(row.vertex_type, row.vertex_id)
        if (mapped := _map_tigergraph_edge(raw))
    ]


def _map_tigergraph_edge(raw: dict) -> GraphEdgeOut | None:
    """Translate one REST++ edge into the API shape. Unknown edge types are skipped."""
    spec = EDGE_BY_TG.get(raw.get("e_type", "")) or EDGE_BY_REVERSE.get(raw.get("e_type", ""))
    if spec is None or raw.get("to_type") not in SHORT_TYPE:
        return None
    tx_hash = (raw.get("attributes") or {}).get("tx_hash")
    return _edge_out(
        spec.tg_name,
        "out" if raw["e_type"] in EDGE_BY_TG else "in",
        raw["to_type"],
        raw["to_id"],
        tx_hash if isinstance(tx_hash, str) else None,
    )


def _edge_out(tg_name: str, direction: str, peer_type: str, peer_id: str, tx_hash: str | None) -> GraphEdgeOut:
    """One neighbour edge."""
    return GraphEdgeOut(
        type=EDGE_BY_TG[tg_name].api_name,  # type: ignore[arg-type]
        direction=direction,  # type: ignore[arg-type]
        peer_type=SHORT_TYPE[peer_type],  # type: ignore[arg-type]
        peer_id=peer_id,
        tx_hash=tx_hash,
    )


async def _tigergraph_payload(db: AsyncSession, report_id: uuid.UUID) -> tuple[dict, dict]:
    """The upsert body for one report, with absolute counts so a retry overwrites instead of double-counting."""
    nodes = await db.execute(
        select(GraphNode)
        .join(GraphReportNode, GraphReportNode.node_id == GraphNode.id)
        .where(GraphReportNode.report_id == report_id)
    )
    vertices: dict = {}
    for (row,) in nodes:
        attributes = await _vertex_attributes(db, row)
        vertices.setdefault(row.vertex_type, {})[row.vertex_id] = {
            key: {"value": value} for key, value in attributes.items()
        }

    source, target = aliased(GraphNode), aliased(GraphNode)
    edge_rows = await db.execute(
        select(GraphEdge, source, target)
        .join(GraphReportEdge, GraphReportEdge.edge_id == GraphEdge.id)
        .join(source, source.id == GraphEdge.from_node_id)
        .join(target, target.id == GraphEdge.to_node_id)
        .where(GraphReportEdge.report_id == report_id)
    )
    edges: dict = {}
    for edge, src, dst in edge_rows:
        seen = edge.created_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")
        payload: dict = {"first_seen": {"value": seen}}
        if edge.tx_hash:
            payload["tx_hash"] = {"value": edge.tx_hash}
        (
            edges.setdefault(src.vertex_type, {})
            .setdefault(src.vertex_id, {})
            .setdefault(edge.edge_type, {})
            .setdefault(dst.vertex_type, {})
        )[dst.vertex_id] = payload
    return vertices, edges


async def _vertex_attributes(db: AsyncSession, row: GraphNode) -> dict:
    """TigerGraph attributes: strings, plus integers and timestamps in the form the REST API expects."""
    attributes: dict = {
        "risk": row.risk,
        "report_count": row.report_count,
        "first_seen": row.first_seen.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S"),
        "last_seen": row.last_seen.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S"),
    }
    if row.category:
        attributes["category"] = row.category
    for key, value in (await _attributes(db, row.id)).items():
        attributes[key] = int(value) if key in _INT_ATTRIBUTES else value
    return attributes
