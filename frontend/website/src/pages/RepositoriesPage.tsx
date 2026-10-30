import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageHeading, ScanError, Spinner, ResultSkeleton } from "../components/ui";
import { VerdictPanel } from "../components/results";
import { useApi, useSession } from "../lib/session";
import { normalizeRepoUrl, saveScan, scanRepository } from "../lib/scans";
import type { ScanRecord } from "../types";

export function RepositoriesPage() {
  const api = useApi();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const linked = params.get("repo");
  const [value, setValue] = useState(linked ?? "");
  const [error, setError] = useState<Error | null>(null);
  const [record, setRecord] = useState<ScanRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (input: string) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setError(null);
    setRecord(null);
    let repoUrl: string;
    try {
      repoUrl = normalizeRepoUrl(input);
    } catch (caught) {
      setError(caught as Error);
      return;
    }
    setBusy(true);
    try {
      const verdict = await scanRepository(api, repoUrl, current.signal);
      if (!current.signal.aborted) {
        setRecord(saveScan(user?.id ?? "anonymous", "repo", verdict.target.id || repoUrl.replace(/^https:\/\//, ""), verdict));
      }
    } catch (caught) {
      if (!current.signal.aborted) setError(caught as Error);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }, [api, user?.id]);

  // /dashboard/repos?repo=owner/name scans straight away.
  useEffect(() => {
    if (!linked) return;
    setValue(linked);
    void run(linked);
    return () => controller.current?.abort();
  }, [linked, run]);

  // A clone and full scan can take over a minute; show that the request is still alive.
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (linked) setParams({}, { replace: true });
    void run(value);
  }

  return (
    <>
      <PageHeading
        eyebrow="DEVELOPER GUARD"
        title="Repository scanner"
        subtitle="Clone a public GitHub repository into quarantine and check it before you install or run it."
      />
      <section className="panel contract-search-panel">
        <div className="panel-header">
          <div>
            <h2>Scan a repository</h2>
            <p>Install scripts, malicious code patterns, leaked secrets, hidden text tricks and npm dependency risk.</p>
          </div>
        </div>
        <form id="repo-form" className="form-stack" noValidate onSubmit={submit}>
          <label htmlFor="repo-url">GitHub repository</label>
          <div className="input-with-icon">
            <Icon name="code" />
            <input
              id="repo-url"
              name="repo"
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="github.com/owner/name"
              aria-describedby="repo-status"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <button className="button button--primary" type="submit" disabled={busy}>
              {busy ? <>
                <Spinner />Scanning…
              </> : <>
                Scan repository <Icon name="arrow" />
              </>}
            </button>
          </div>
          <div id="repo-status" aria-live="polite">
            {busy ? (
              <p className="input-helper">
                Cloning and scanning · {elapsed}s. Large repositories can take up to a minute and a half.
              </p>
            ) : null}
            <ScanError error={error} />
          </div>
        </form>
        <div className="privacy-note">
          <Icon name="lock" />
          <span>Only public repositories. The code is never executed; it is cloned to an isolated folder, read, and deleted.</span>
        </div>
      </section>
      <section id="repo-result" className="result-region" aria-live="polite">
        {busy ? <ResultSkeleton label="Scanning repository…" /> : null}
        {record ? (
          <VerdictPanel
            verdict={record.verdict}
            label={`LIVE SCAN · ${new Date(record.createdAt).toLocaleString()}`}
            title={record.target}
          >
            <div className="result-links">
              <a className="text-link" href={`https://${record.target}`} target="_blank" rel="noopener noreferrer">
                Open on GitHub <Icon name="external" />
              </a>
            </div>
          </VerdictPanel>
        ) : null}
      </section>
    </>
  );
}
