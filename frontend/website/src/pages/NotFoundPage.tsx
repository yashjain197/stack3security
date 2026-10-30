import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";

export function NotFoundPage() {
  return (
    <PublicShell mainClassName="not-found">
      <span className="eyebrow">NOT FOUND</span>
      <h1>This page isn't in the demo.</h1>
      <p>Choose an available section to continue exploring Stack3 Security.</p>
      <Link className="button button--primary" to="/dashboard">Go to dashboard</Link>
    </PublicShell>
  );
}
