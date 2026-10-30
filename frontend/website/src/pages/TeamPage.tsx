import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api";
import { externalRedirect, formatDateTime, useApi, useSessionContext } from "../lib/session";
import type { Account, Team } from "../types";
import {
  AccountErrorView,
  AccountHeading,
  AccountLoading,
  AccountMessage,
  Panel,
  useAccountActions,
  useAccountData,
} from "../components/account";

type TeamData = {
  account: Account;
  team: Team | null;
};

export function TeamPage() {
  const api = useApi();
  const { setFlash } = useSessionContext();
  const [teamName, setTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const { state, reload } = useAccountData<TeamData>(async (signal) => {
    const account = await api.request<Account>("/v1/me", { signal });
    let team: Team | null;
    try {
      team = await api.request<Team>("/v1/teams/me", { signal });
    } catch (error) {
      if ((error as ApiError).code !== "team_not_found") throw error;
      team = null;
    }
    return { account, team };
  });
  const { error, busy, run } = useAccountActions();

  if (state.status === "loading") return <AccountLoading />;
  if (state.status === "error") return <AccountErrorView error={state.error} onRetry={reload} />;

  const { account, team } = state.data;

  function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    void run("create-team", async () => {
      const nameValue = teamName.trim();
      if (!nameValue) throw new ApiError("Enter a team name.", { code: "validation_error" });
      await api.request("/v1/teams", { method: "POST", body: { name: nameValue } });
      setFlash("Team created. Choose the Team plan to activate seats.");
      setTeamName("");
      reload();
    });
  }

  if (!team) {
    return (
      <div className="account-content">
        <AccountMessage error={error} />
        <AccountHeading title="Your team" text="Create a team before starting Team checkout." />
        <Panel title="Create a team">
          <form className="account-form" onSubmit={createTeam}>
            <label htmlFor="account-name">Team name</label>
            <input
              id="account-name"
              name="name"
              type="text"
              required
              maxLength={80}
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
            />
            <button className="button button--primary" type="submit" disabled={busy === "create-team"}>
              Create team
            </button>
          </form>
        </Panel>
      </div>
    );
  }

  const manager = ["owner", "admin"].includes(team.myRole);

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity() || !team) return;
    void run("invite", async () => {
      await api.request(`/v1/teams/${encodeURIComponent(team.id)}/invites`, {
        method: "POST",
        body: { email: inviteEmail.trim(), role: inviteRole },
      });
      setFlash("Invitation sent.");
      setInviteEmail("");
      reload();
    });
  }

  return (
    <div className="account-content">
      <AccountMessage error={error} />
      <AccountHeading
        title={team.name}
        text={`${team.myRole} · ${team.seatsUsed} seats used (members and pending invites) / ${team.seats ?? "no active subscription"} · ${team.subscriptionStatus ?? "not subscribed"}`}
      />
      <Panel title="Team plan">
        <div className="account-actions">
          <Link className="button button--secondary" to="/pricing">Start Team checkout</Link>
          {manager ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={busy === "portal"}
              onClick={() => void run("portal", async () => {
                externalRedirect((await api.request<{ url: string }>("/v1/billing/portal", { method: "POST" })).url);
              })}
            >
              Manage seats in billing portal
            </button>
          ) : null}
          <button type="button" className="button button--secondary" onClick={reload}>Refresh team</button>
        </div>
      </Panel>
      <Panel title="Members">
        <ul className="account-list">
          {team.members.map((member) => {
            const self = member.userId === account.user.id;
            const removable = self
              ? member.role !== "owner"
              : manager && member.role !== "owner" && (member.role !== "admin" || team.myRole === "owner");
            return (
              <li className="account-row" key={member.userId}>
                <div>
                  <strong>{member.email}</strong>
                  <p>
                    {member.role}
                    {self ? " · you" : ""} · Joined {formatDateTime(member.joinedAt)}
                  </p>
                </div>
                {removable ? (
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={busy === `remove-${member.userId}`}
                    onClick={() => void run(`remove-${member.userId}`, async () => {
                      if (!window.confirm("Remove this member from the team? This may remove your own team access.")) return;
                      await api.request(
                        `/v1/teams/${encodeURIComponent(team.id)}/members/${encodeURIComponent(member.userId)}`,
                        { method: "DELETE" },
                      );
                      setFlash("Team membership removed.");
                      reload();
                    })}
                  >
                    {self ? "Leave team" : "Remove"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>
      {manager ? (
        <Panel title="Invite a teammate">
          <form className="account-form" onSubmit={invite}>
            <label htmlFor="account-invite-email">Email address</label>
            <input
              id="account-invite-email"
              name="invite-email"
              type="email"
              required
              maxLength={320}
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
            <label htmlFor="invite-role">Role</label>
            <select id="invite-role" name="role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit" className="button button--primary" disabled={busy === "invite"}>
              Send invite
            </button>
            <p className="account-note">An active Team plan and an available seat are required.</p>
          </form>
        </Panel>
      ) : null}
      {manager ? (
        <Panel title="Pending invitations">
          {team.invites.length ? (
            <ul className="account-list">
              {team.invites.map((inviteItem) => (
                <li className="account-row" key={inviteItem.id}>
                  <div>
                    <strong>{inviteItem.email}</strong>
                    <p>{inviteItem.role} · Expires {formatDateTime(inviteItem.expiresAt)}</p>
                  </div>
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={busy === `revoke-invite-${inviteItem.id}`}
                    onClick={() => void run(`revoke-invite-${inviteItem.id}`, async () => {
                      await api.request(
                        `/v1/teams/${encodeURIComponent(team.id)}/invites/${encodeURIComponent(inviteItem.id)}`,
                        { method: "DELETE" },
                      );
                      setFlash("Invitation cancelled.");
                      reload();
                    })}
                  >
                    Cancel invite
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No pending invitations.</p>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
