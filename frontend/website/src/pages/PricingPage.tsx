import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { externalRedirect, useApi, useSession, useSessionContext } from "../lib/session";
import type { Plan, Team } from "../types";
import {
  AccountErrorView,
  AccountLoading,
  AccountMessage,
  useAccountActions,
  useAccountData,
} from "../components/account";
import { PublicShell } from "../components/PublicShell";

type Interval = "month" | "year";

function PricingCard({ plan, interval, busy, onCheckout, signedIn }: {
  plan: Plan;
  interval: Interval;
  busy: string | null;
  onCheckout: (plan: Plan, seats: number | null) => void;
  signedIn: boolean;
}) {
  const price = plan.prices.find((item) => item.interval === interval);
  const minimum = Math.max(plan.minSeats, price?.includedSeats ?? 1);
  const [seats, setSeats] = useState(minimum);
  const money = price
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(price.amountCents / 100)
    : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    onCheckout(plan, plan.code === "team" ? seats : null);
  }

  return (
    <article className={`pricing-card ${plan.code === "pro" ? "pricing-card--featured" : ""}`}>
      <span className="plan-kicker">{plan.code.toUpperCase()}</span>
      <h2>{plan.name}</h2>
      <div className="plan-price">
        <span className="price-amount">{!plan.isPaid ? "$0" : money ?? "Unavailable"}</span>
        <span className="price-period">{plan.isPaid ? `${price?.perSeat ? "/ seat " : ""}/ ${interval}` : "Free"}</span>
        {plan.isPaid && price?.perSeat ? (
          <span className="price-note">
            {minimum} seats minimum. {price.includedSeats} seats included in the base bundle.
          </span>
        ) : null}
        {plan.trialDays ? (
          <span className="price-note">{plan.trialDays}-day trial for eligible new subscribers</span>
        ) : null}
      </div>
      <ul className="plan-features">
        {plan.features.map((feature) => (
          <li key={feature.description}>
            <span className="check-icon" aria-hidden="true">+</span>
            <span>
              {feature.description}
              {feature.monthlyLimit !== null ? ` (${feature.monthlyLimit} / month)` : ""}
            </span>
          </li>
        ))}
      </ul>
      {!plan.isPaid ? (
        <Link className="button button--secondary" to={signedIn ? "/dashboard/settings" : "/login"}>
          {signedIn ? "Your account" : "Get started"}
        </Link>
      ) : (
        <form className="account-form" onSubmit={submit}>
          {plan.code === "team" ? (
            <>
              <label htmlFor={`seats-${plan.code}`}>Team seats</label>
              <input
                id={`seats-${plan.code}`}
                name="seats"
                type="number"
                required
                min={minimum}
                max={500}
                step={1}
                value={seats}
                onChange={(event) => setSeats(Number(event.target.value))}
              />
            </>
          ) : null}
          <button
            type="submit"
            className="button button--primary button--full"
            disabled={!price?.available || busy === `checkout-${plan.code}`}
          >
            {price?.available ? "Continue to checkout" : "Not available yet"}
          </button>
        </form>
      )}
    </article>
  );
}

export function PricingPage() {
  const api = useApi();
  const { signedIn } = useSession();
  const { setFlash } = useSessionContext();
  const navigate = useNavigate();
  const [interval, setInterval] = useState<Interval>("month");
  const { state, reload } = useAccountData<Plan[]>(async (signal) => {
    const plans = await api.request<Plan[]>("/v1/billing/plans", { authenticated: false, signal });
    if (!plans.length) throw new ApiError("No plans are currently published.", { code: "empty_catalog" });
    return plans;
  });
  const { error, busy, run } = useAccountActions();

  function checkout(plan: Plan, seats: number | null) {
    void run(`checkout-${plan.code}`, async () => {
      if (!api.signedIn) {
        navigate(`/login?next=${encodeURIComponent("/pricing")}`);
        return;
      }
      const body: Record<string, unknown> = { plan: plan.code, interval };
      if (plan.code === "team") {
        let team: Team;
        try {
          team = await api.request<Team>("/v1/teams/me");
        } catch (failure) {
          if ((failure as ApiError).code !== "team_not_found") throw failure;
          setFlash("Create a team first, then return to pricing to choose seats.");
          navigate("/account/team");
          return;
        }
        body.teamId = team.id;
        body.seats = seats;
      }
      externalRedirect((await api.request<{ checkoutUrl: string }>("/v1/billing/checkout", { method: "POST", body })).checkoutUrl);
    });
  }

  let content;
  if (state.status === "loading") {
    content = <AccountLoading />;
  } else if (state.status === "error") {
    content = <AccountErrorView error={state.error} onRetry={reload} />;
  } else {
    content = (
      <div className="account-content">
        <AccountMessage error={error} />
        <section className="subpage-hero pricing-hero">
          <span className="eyebrow">PLANS &amp; ACCESS</span>
          <h1>Protection for every stage.</h1>
          <p>Live plans and availability from Stack3. Trial eligibility is confirmed at checkout.</p>
        </section>
        <section className="pricing-billing" aria-label="Billing interval">
          <span>Billing</span>
          <div className="billing-switch">
            {(["month", "year"] as Interval[]).map((value) => (
              <button
                key={value}
                type="button"
                className="button button--secondary"
                aria-pressed={interval === value}
                onClick={() => setInterval(value)}
              >
                {value === "month" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </section>
        <section className="pricing-grid">
          {state.data.map((plan) => (
            <PricingCard
              key={plan.code}
              plan={plan}
              interval={interval}
              busy={busy}
              signedIn={signedIn}
              onCheckout={checkout}
            />
          ))}
        </section>
      </div>
    );
  }

  return <PublicShell mainClassName="pricing-page">{content}</PublicShell>;
}
