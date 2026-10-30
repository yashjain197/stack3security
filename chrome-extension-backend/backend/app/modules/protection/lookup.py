"""
Read threat-graph nodes in one query. Unknown ids are skipped; a miss just means we have not seen that thing before.

Made by Yash Jain with passion.
"""

from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.graph.catalog import normalize_node
from app.modules.graph.models import GraphNode
from app.modules.protection.verdicts import finding
from app.schemas.verdict import Finding, Layer, Level, Source

_GRAPH_LEVEL = {"caution": Level.CAUTION, "high": Level.HIGH, "critical": Level.CRITICAL}


async def known_nodes(db: AsyncSession, keys: list[tuple[str, str]]) -> dict[tuple[str, str], GraphNode]:
    """Map each valid (type, id) to its graph row. The key uses the canonical id."""
    wanted = []
    for short_type, raw_id in keys:
        try:
            wanted.append(normalize_node(short_type, raw_id))
        except ValueError:
            continue
    if not wanted:
        return {}
    rows = (
        await db.scalars(
            select(GraphNode).where(
                or_(
                    *[
                        and_(GraphNode.vertex_type == node.vertex_type, GraphNode.vertex_id == node.vertex_id)
                        for node in wanted
                    ]
                )
            )
        )
    ).all()
    found = {(row.vertex_type, row.vertex_id): row for row in rows}
    return {
        (node.short_type, node.vertex_id): found[(node.vertex_type, node.vertex_id)]
        for node in wanted
        if (node.vertex_type, node.vertex_id) in found
    }


def graph_finding(node: GraphNode, noun: str, checked_at: datetime) -> Finding | None:
    """A finding when the graph already rates this node as caution or worse. Unknown adds nothing."""
    level = _GRAPH_LEVEL.get(node.risk)
    if level is None:
        return None
    category = node.category or "a reported threat"
    return finding(
        layer=Layer.GRAPH,
        severity=level,
        title=f"This {noun} is in the threat graph as {category}",
        evidence=f"{node.vertex_id} is marked {node.risk} across {node.report_count} reports.",
        source=Source.GRAPH,
        checked_at=checked_at,
    )
