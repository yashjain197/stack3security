"""
Threat-graph routes: user reports, Imran's internal reports, and the neighbourhood read for the website.

Made by Yash Jain with passion.
"""

from fastapi import APIRouter, Depends, status

from app.core.errors import NotFound
from app.core.rate_limit import Limits
from app.modules.graph import service
from app.modules.graph.catalog import VERTEX_TYPES
from app.modules.graph.schemas import InternalReportIn, NeighborhoodOut, ReportIn, ReportOut
from app.modules.identity.dependencies import CurrentPrincipal, DbSession, Limiter, require_internal_service

router = APIRouter(prefix="/v1", tags=["threat-graph"])


@router.post("/report", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def report(body: ReportIn, principal: CurrentPrincipal, db: DbSession, limiter: Limiter) -> ReportOut:
    """A logged-in user reports a wallet, domain, package or repo."""
    await limiter.hit(Limits.GRAPH_REPORT_USER, str(principal.user.id))
    return await service.submit_report(
        db,
        source=principal.client.value,
        reason=body.reason,
        nodes=body.nodes,
        edges=body.edges,
        reporter_user_id=principal.user.id,
        reporter_label=principal.user.email,
    )


@router.post(
    "/internal/report",
    response_model=ReportOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_internal_service)],
)
async def internal_report(body: InternalReportIn, db: DbSession) -> ReportOut:
    """Imran's VS Code backend writes malicious packages, wallets and endpoints here. Header: X-Service-Key."""
    return await service.submit_report(
        db,
        source=body.source,
        reason=body.reason,
        nodes=body.nodes,
        edges=body.edges,
        reporter_label=body.reporter,
    )


@router.get("/graph/{node_type}/{node_id:path}", response_model=NeighborhoodOut)
async def graph_node(
    node_type: str, node_id: str, principal: CurrentPrincipal, db: DbSession, limiter: Limiter
) -> NeighborhoodOut:
    """A node and its direct neighbours, for the website graph page."""
    await limiter.hit(Limits.GRAPH_READ_USER, str(principal.user.id))
    if node_type not in VERTEX_TYPES:
        raise NotFound("Unknown node type", "node_not_found")
    return await service.neighborhood(db, node_type, node_id)
