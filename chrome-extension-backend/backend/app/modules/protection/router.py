"""
Chrome extension routes. Every check requires a logged-in token that includes chrome_protection.

Made by Yash Jain with passion.
"""

from fastapi import APIRouter, Request, Response, status

from app.core.errors import Forbidden
from app.core.rate_limit import Limits
from app.modules.identity.dependencies import CurrentPrincipal, DbSession, Limiter
from app.modules.protection import bundle, page
from app.modules.protection.chain import scan_contract
from app.modules.protection.domain import check_domain
from app.modules.protection.review import review_tx
from app.modules.protection.schemas import DomainCheckIn, PageScanIn, ScriptCheckIn, TxReviewIn
from app.modules.protection.scripts import check_scripts
from app.schemas.verdict import Verdict

router = APIRouter(prefix="/v1", tags=["chrome"])


async def _guard(principal: CurrentPrincipal, limiter: Limiter) -> None:
    """One budget for every Chrome check, and the feature that every plan includes."""
    await limiter.hit(Limits.PROTECTION_USER, str(principal.user.id))
    if "chrome_protection" not in (principal.claims.get("ent") or []):
        raise Forbidden("Chrome protection is not enabled for this account", "feature_required")


@router.get("/rules/bundle", response_model=bundle.RulesBundleOut)
async def get_rules_bundle(principal: CurrentPrincipal, limiter: Limiter) -> bundle.RulesBundleOut:
    """Brands, lookalike letters and transaction selectors. The domain list is a separate download."""
    await _guard(principal, limiter)
    return await bundle.rules_bundle()


@router.get("/rules/blocklist")
async def get_blocklist(request: Request, principal: CurrentPrincipal, limiter: Limiter) -> Response:
    """Blocked hosts. Send the previous ETag in If-None-Match to skip a list you already have."""
    await _guard(principal, limiter)
    body = await bundle.blocklist_body()
    headers = {"ETag": body.version, "Cache-Control": "private, max-age=21600"}
    if request.headers.get("if-none-match") == body.version:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=body.model_dump_json(by_alias=True), media_type="application/json", headers=headers)


@router.post("/check-domain", response_model=Verdict)
async def post_check_domain(
    payload: DomainCheckIn, principal: CurrentPrincipal, db: DbSession, limiter: Limiter
) -> Verdict:
    """Blocklists, the threat graph, and wallet lookalike names."""
    await _guard(principal, limiter)
    return await check_domain(db, payload.domain)


@router.post("/review-tx", response_model=Verdict)
async def post_review_tx(payload: TxReviewIn, principal: CurrentPrincipal, db: DbSession, limiter: Limiter) -> Verdict:
    """Decode a wallet request and score the origin, the spender and the threat graph."""
    await _guard(principal, limiter)
    return await review_tx(db, payload)


@router.post("/scan-page", response_model=Verdict)
async def post_scan_page(payload: PageScanIn, principal: CurrentPrincipal, db: DbSession, limiter: Limiter) -> Verdict:
    """Score page signals. The extension must not send page text or a recovery phrase."""
    await _guard(principal, limiter)
    return await page.scan_page(db, payload)


@router.get("/scan-contract/{chain_id}/{address}", response_model=Verdict)
async def get_scan_contract(
    chain_id: int, address: str, principal: CurrentPrincipal, db: DbSession, limiter: Limiter
) -> Verdict:
    """Verified source, proxy, owner and age, plus the threat graph."""
    await _guard(principal, limiter)
    return await scan_contract(db, chain_id, address)


@router.post("/check-scripts", response_model=Verdict)
async def post_check_scripts(
    payload: ScriptCheckIn, principal: CurrentPrincipal, db: DbSession, limiter: Limiter
) -> Verdict:
    """Map script URLs to packages and check the threat graph. Socket runs when its key is set."""
    await _guard(principal, limiter)
    return await check_scripts(db, payload)
