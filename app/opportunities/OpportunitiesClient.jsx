"use client";

import { useEffect, useState } from "react";

function elapsedLabel(milliseconds = 0) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request failed. Please try again.");
  return body;
}

function Evidence({ label, evidence }) {
  if (!evidence?.url || !evidence?.quote) return null;
  return (
    <p className="opportunity-evidence">
      <span>{label}</span> “{evidence.quote}” <a href={evidence.url} target="_blank" rel="noreferrer">Source ↗</a>
    </p>
  );
}

export default function OpportunitiesClient() {
  const [password, setPassword] = useState("");
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!jobId || !["queued", "running"].includes(job?.status)) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        const next = await readResponse(await fetch(`/api/opportunities/${jobId}`, { cache: "no-store" }));
        if (stopped) return;
        setJob(next);
        setError("");
        if (["queued", "running"].includes(next.status)) timer = setTimeout(poll, 1200);
      } catch (cause) {
        if (!stopped) setError(cause.message || "Could not load job progress.");
      }
    };
    timer = setTimeout(poll, 700);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, job?.status]);

  async function startJob(event) {
    event.preventDefault();
    setError("");
    setStarting(true);
    setJob(null);
    setJobId("");
    try {
      const started = await readResponse(await fetch("/api/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      }));
      setPassword("");
      setJobId(started.jobId);
      setJob({ status: started.status || "queued", progress: { searches: 0, pageReads: 0, elapsedMs: 0, stage: "Queued" }, activity: [] });
    } catch (cause) {
      setError(cause.message || "Could not start the search.");
    } finally {
      setStarting(false);
    }
  }

  async function cancelJob() {
    if (!jobId) return;
    setCancelling(true);
    setError("");
    try {
      setJob(await readResponse(await fetch(`/api/opportunities/${jobId}`, { method: "POST" })));
    } catch (cause) {
      setError(cause.message || "Could not cancel the search.");
    } finally {
      setCancelling(false);
    }
  }

  const running = ["queued", "running"].includes(job?.status);

  return (
    <>
      <section className="opportunities-intro">
        <p className="kicker"><span className="status-dot" /> LIVE RESEARCH</p>
        <h1 id="page-title">Find your<br /><span>next thing.</span></h1>
        <p className="hero-text">Current competitions, programs, and events checked against their official sources.</p>
      </section>

      <section className="opportunities-panel" aria-labelledby="refresh-heading">
        <div className="opportunities-panel-head">
          <div><p className="section-label"><span>01</span> OPPORTUNITY FINDER</p><h2 id="refresh-heading">Fresh from the web.</h2></div>
          <span className="live-mark"><i /> NOT SAVED</span>
        </div>
        <form className="refresh-form" onSubmit={startJob}>
          <label htmlFor="site-password">Site password</label>
          <div className="refresh-controls">
            <input id="site-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your site password" required disabled={running || starting} />
            <button className="button refresh-button" type="submit" disabled={running || starting || !password}>{starting ? "Starting…" : "Refresh opportunities"}<span aria-hidden="true">↗</span></button>
          </div>
          <p className="form-note">Your password is checked by the site server. Agent credentials stay on the server.</p>
        </form>

        {error && <p className="opportunity-error" role="alert">{error}</p>}

        {job && <section className="job-status" aria-live="polite" aria-label="Search progress">
          <div className="job-status-top">
            <div><p className="section-label"><span>02</span> {job.status === "completed" ? "SEARCH COMPLETE" : job.status === "failed" ? "SEARCH FAILED" : job.status === "cancelled" ? "SEARCH CANCELLED" : "IN PROGRESS"}</p><h3>{job.progress?.stage || job.status}</h3></div>
            <div className="job-time"><span>{elapsedLabel(job.progress?.elapsedMs)}</span><small>ELAPSED</small></div>
          </div>
          <div className="progress-track" aria-hidden="true"><span className={running ? "progress-fill is-running" : "progress-fill"} /></div>
          <div className="job-metrics"><span>{job.progress?.searches ?? 0} searches</span><span>{job.progress?.pageReads ?? 0} source reads</span>{running && <button className="cancel-button" type="button" onClick={cancelJob} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel search"}</button>}</div>
          <details className="activity-details">
            <summary>Activity and source links <span>{job.activity?.length || 0} updates</span></summary>
            <ol className="activity-list">
              {(job.activity || []).map((item, index) => <li key={`${item.elapsedMs}-${index}`}>
                <span className={`activity-dot activity-${item.type || "info"}`} />
                <div><strong>{item.label}</strong>{item.query && <p>Search: {item.query}</p>}{item.queries?.map(query => <p key={query}>Search: {query}</p>)}{item.url && <p><a href={item.url} target="_blank" rel="noreferrer">{item.url} ↗</a></p>}{item.error && <p className="activity-error">{item.error}</p>}</div>
                <time>{elapsedLabel(item.elapsedMs)}</time>
              </li>)}
              {!job.activity?.length && <li className="activity-empty">Waiting for the agent to begin.</li>}
            </ol>
          </details>
          {job.status === "failed" && <p className="opportunity-error" role="alert">{job.error || "The search failed. Please try again."}</p>}
          {job.status === "cancelled" && <p className="result-note">Search cancelled. No results were saved.</p>}
        </section>}

        {job?.status === "completed" && <section className="opportunity-results" aria-labelledby="results-heading">
          <div className="results-title"><p className="section-label"><span>03</span> VERIFIED RESULTS</p><h2 id="results-heading">{job.results?.opportunities?.length ? `${job.results.opportunities.length} ${job.results.opportunities.length === 1 ? "good fit" : "good fits"}.` : "Nothing verified this time."}</h2><p>{job.results?.summary}</p></div>
          <div className="opportunity-grid">
            {(job.results?.opportunities || []).map((item, index) => <article className="opportunity-card" key={`${item.title}-${index}`}>
              <div className="card-top"><span>{item.kind}</span><span>{String(index + 1).padStart(2, "0")}</span></div>
              <h3>{item.title}</h3><p className="opportunity-description">{item.description}</p>
              {item.deadline && <p className="deadline"><span>DEADLINE</span> {item.deadline}</p>}
              <div className="evidence-list">
                <Evidence label="Age" evidence={item.ageEvidence} />
                <Evidence label="Location" evidence={item.locationEvidence} />
                <Evidence label="Open" evidence={item.availabilityEvidence} />
              </div>
            </article>)}
          </div>
          {!!job.results?.ruledOut?.length && <section className="ruled-out" aria-labelledby="ruled-out-heading">
            <p className="section-label"><span>04</span> CHECKED, NOT INCLUDED</p><h3 id="ruled-out-heading">What I ruled out</h3>
            <ul>{job.results.ruledOut.map((item, index) => <li key={`${item.title}-${index}`}><div><strong>{item.title}</strong><p>{item.reason}</p>{item.excerpt && <blockquote>“{item.excerpt}”</blockquote>}</div>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a>}</li>)}</ul>
          </section>}
          <p className="result-note">These results live only for this page session. Refresh to run a new search.</p>
        </section>}
      </section>
    </>
  );
}
