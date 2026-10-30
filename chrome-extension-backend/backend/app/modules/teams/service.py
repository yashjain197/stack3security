"""
Team business logic: create, invite (seat-limited), accept (email-bound), remove and leave.

Made by Yash Jain with passion.
"""

import uuid
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, Forbidden, NotFound
from app.core.security import new_opaque_token, sha256_digest
from app.db.base import utcnow
from app.modules.billing.entitlements import ENTITLED_STATUSES
from app.modules.billing.models import Subscription
from app.modules.identity.email import send_team_invite
from app.modules.identity.models import User
from app.modules.teams.models import Team, TeamInvite, TeamMember, TeamRole
from app.modules.teams.schemas import InviteOut, MemberOut, TeamDetailOut

MANAGERS = (TeamRole.OWNER, TeamRole.ADMIN)


async def _membership(db: AsyncSession, user_id: uuid.UUID) -> TeamMember | None:
    """The user's team membership, if any."""
    return (await db.execute(select(TeamMember).where(TeamMember.user_id == user_id))).scalar_one_or_none()


async def _require_role(
    db: AsyncSession, user_id: uuid.UUID, team_id: uuid.UUID, roles: tuple[TeamRole, ...]
) -> TeamMember:
    """Ensure the caller is in this team with one of the given roles; hides teams they are not in."""
    member = await _membership(db, user_id)
    if member is None or member.team_id != team_id:
        raise NotFound("Team not found", "team_not_found")
    if member.role not in roles:
        raise Forbidden("Only a team owner or admin can do this", "team_admin_required")
    return member


async def _active_subscription(db: AsyncSession, team_id: uuid.UUID) -> Subscription | None:
    """The team's entitled subscription, if any."""
    return (
        await db.execute(
            select(Subscription)
            .where(Subscription.team_id == team_id, Subscription.status.in_(ENTITLED_STATUSES))
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _seats_used(db: AsyncSession, team_id: uuid.UUID) -> int:
    """Members plus live pending invites both consume seats."""
    members = await db.scalar(select(func.count()).select_from(TeamMember).where(TeamMember.team_id == team_id))
    invites = await db.scalar(
        select(func.count())
        .select_from(TeamInvite)
        .where(
            TeamInvite.team_id == team_id,
            TeamInvite.accepted_at.is_(None),
            TeamInvite.revoked_at.is_(None),
            TeamInvite.expires_at > utcnow(),
        )
    )
    return int(members or 0) + int(invites or 0)


async def create_team(db: AsyncSession, user: User, name: str) -> Team:
    """Create a team with the caller as owner; one team per user."""
    if await _membership(db, user.id) is not None:
        raise AppError("already_in_team", "Leave your current team before creating a new one", 409)
    team = Team(id=uuid.uuid4(), name=name.strip(), created_by_user_id=user.id)
    db.add(team)
    await db.flush()
    db.add(TeamMember(team_id=team.id, user_id=user.id, role=TeamRole.OWNER))
    await db.commit()
    return team


async def get_my_team(db: AsyncSession, user: User) -> TeamDetailOut:
    """Team details, members and (for managers) pending invites."""
    member = await _membership(db, user.id)
    if member is None:
        raise NotFound("You are not in a team", "team_not_found")
    team = await db.get(Team, member.team_id)
    assert team is not None
    subscription = await _active_subscription(db, team.id)
    members = (
        await db.execute(
            select(TeamMember, User.email)
            .join(User, User.id == TeamMember.user_id)
            .where(TeamMember.team_id == team.id)
            .order_by(TeamMember.joined_at)
        )
    ).all()
    invites = []
    if member.role in MANAGERS:
        invites = (
            (
                await db.execute(
                    select(TeamInvite).where(
                        TeamInvite.team_id == team.id,
                        TeamInvite.accepted_at.is_(None),
                        TeamInvite.revoked_at.is_(None),
                        TeamInvite.expires_at > utcnow(),
                    )
                )
            )
            .scalars()
            .all()
        )
    return TeamDetailOut(
        id=team.id,
        name=team.name,
        my_role=member.role,
        seats=subscription.quantity if subscription else None,
        seats_used=await _seats_used(db, team.id),
        subscription_status=subscription.status if subscription else None,
        members=[MemberOut(user_id=m.user_id, email=email, role=m.role, joined_at=m.joined_at) for m, email in members],
        invites=[InviteOut(id=i.id, email=i.email, role=i.role, expires_at=i.expires_at) for i in invites],
    )


async def invite(db: AsyncSession, inviter: User, team_id: uuid.UUID, email: str, role: TeamRole) -> InviteOut:
    """Invite by email; needs an active team subscription with a free seat."""
    settings = get_settings()
    await _require_role(db, inviter.id, team_id, MANAGERS)
    subscription = await _active_subscription(db, team_id)
    if subscription is None:
        raise AppError("team_subscription_required", "Start the Team plan before inviting members", 402)
    if await _seats_used(db, team_id) >= subscription.quantity:
        raise AppError("no_seats_available", "All seats are used; add seats in the billing portal", 409)

    already_member = await db.scalar(
        select(TeamMember.user_id)
        .join(User, User.id == TeamMember.user_id)
        .where(TeamMember.team_id == team_id, User.email == email)
    )
    if already_member is not None:
        raise AppError("already_member", "This person is already in the team", 409)

    now = utcnow()
    pending = (
        await db.execute(
            select(TeamInvite).where(
                TeamInvite.team_id == team_id,
                TeamInvite.email == email,
                TeamInvite.accepted_at.is_(None),
                TeamInvite.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if pending is not None:
        pending.revoked_at = now
        await db.flush()

    raw = new_opaque_token()
    record = TeamInvite(
        team_id=team_id,
        email=email,
        role=role,
        token_hash=sha256_digest(raw),
        invited_by_user_id=inviter.id,
        expires_at=now + timedelta(days=settings.team_invite_ttl_days),
    )
    db.add(record)
    await db.flush()
    team = await db.get(Team, team_id)
    assert team is not None
    await send_team_invite(
        email, team.name, inviter.email, f"{settings.web_app_url.rstrip('/')}/teams/join?token={raw}"
    )
    await db.commit()
    return InviteOut(id=record.id, email=record.email, role=record.role, expires_at=record.expires_at)


async def accept_invite(db: AsyncSession, user: User, token: str) -> uuid.UUID:
    """Join a team; the invite only works for the email it was sent to."""
    record = (
        await db.execute(select(TeamInvite).where(TeamInvite.token_hash == sha256_digest(token)).with_for_update())
    ).scalar_one_or_none()
    if (
        record is None
        or record.accepted_at is not None
        or record.revoked_at is not None
        or record.expires_at <= utcnow()
    ):
        raise AppError("invalid_invite", "This invite is invalid or has expired", 400)
    if record.email != user.email:
        raise Forbidden("This invite was sent to a different email address", "invite_email_mismatch")
    if await _membership(db, user.id) is not None:
        raise AppError("already_in_team", "Leave your current team before joining another", 409)

    db.add(TeamMember(team_id=record.team_id, user_id=user.id, role=record.role))
    record.accepted_at = utcnow()
    await db.commit()
    return record.team_id


async def revoke_invite(db: AsyncSession, user: User, team_id: uuid.UUID, invite_id: uuid.UUID) -> None:
    """Cancel a pending invite."""
    await _require_role(db, user.id, team_id, MANAGERS)
    record = await db.get(TeamInvite, invite_id)
    if record is None or record.team_id != team_id or record.accepted_at is not None:
        raise NotFound("Invite not found", "invite_not_found")
    record.revoked_at = record.revoked_at or utcnow()
    await db.commit()


async def remove_member(db: AsyncSession, actor: User, team_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Managers remove members; anyone except the owner may remove themselves (leave)."""
    leaving_self = actor.id == user_id
    if leaving_self:
        actor_member = await _require_role(db, actor.id, team_id, (TeamRole.OWNER, TeamRole.ADMIN, TeamRole.MEMBER))
        if actor_member.role == TeamRole.OWNER:
            raise AppError("owner_cannot_leave", "The owner cannot leave the team", 409)
        target = actor_member
    else:
        actor_member = await _require_role(db, actor.id, team_id, MANAGERS)
        target = (
            await db.execute(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id))
        ).scalar_one_or_none()
        if target is None:
            raise NotFound("Member not found", "member_not_found")
        if target.role == TeamRole.OWNER or (target.role == TeamRole.ADMIN and actor_member.role != TeamRole.OWNER):
            raise Forbidden("You cannot remove this member", "cannot_remove_member")
    await db.delete(target)
    await db.commit()
