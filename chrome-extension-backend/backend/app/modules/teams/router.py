"""
HTTP routes for teams: create, view, invite, accept, revoke invite, remove member or leave.

Made by Yash Jain with passion.
"""

import uuid

from fastapi import APIRouter, Response, status

from app.core.rate_limit import Limits
from app.modules.identity.dependencies import DbSession, Limiter, WebPrincipal
from app.modules.teams import service
from app.modules.teams.schemas import InviteAcceptIn, InviteCreateIn, InviteOut, TeamCreateIn, TeamDetailOut

router = APIRouter(prefix="/v1/teams", tags=["teams"])


@router.post("", response_model=TeamDetailOut, status_code=status.HTTP_201_CREATED)
async def create_team(body: TeamCreateIn, principal: WebPrincipal, db: DbSession) -> TeamDetailOut:
    """Create a team owned by the caller."""
    await service.create_team(db, principal.user, body.name)
    return await service.get_my_team(db, principal.user)


@router.get("/me", response_model=TeamDetailOut)
async def my_team(principal: WebPrincipal, db: DbSession) -> TeamDetailOut:
    """The caller's team."""
    return await service.get_my_team(db, principal.user)


@router.post("/{team_id}/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
async def create_invite(
    team_id: uuid.UUID, body: InviteCreateIn, principal: WebPrincipal, db: DbSession, limiter: Limiter
) -> InviteOut:
    """Invite someone by email."""
    await limiter.hit(Limits.TEAM_INVITE_USER, str(principal.user.id))
    return await service.invite(db, principal.user, team_id, body.email, body.role)


@router.post("/invites/accept", response_model=TeamDetailOut)
async def accept_invite(body: InviteAcceptIn, principal: WebPrincipal, db: DbSession) -> TeamDetailOut:
    """Join a team from an invite link."""
    await service.accept_invite(db, principal.user, body.token)
    return await service.get_my_team(db, principal.user)


@router.delete("/{team_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(team_id: uuid.UUID, invite_id: uuid.UUID, principal: WebPrincipal, db: DbSession) -> Response:
    """Cancel a pending invite."""
    await service.revoke_invite(db, principal.user, team_id, invite_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(team_id: uuid.UUID, user_id: uuid.UUID, principal: WebPrincipal, db: DbSession) -> Response:
    """Remove a member, or leave the team when user_id is yourself."""
    await service.remove_member(db, principal.user, team_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
