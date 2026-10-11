"use client";

import { useCallback, useEffect, useState } from "react";

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

function newestFirst(left, right) {
  return Date.parse(right.found_at || "") - Date.parse(left.found_at || "");
}

function foundDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeZone: "Pacific/Auckland" }).format(new Date(value));
}

export default function OpportunitiesClient() {
  const [password, setPassword] = useState("");
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [approved, setApproved] = useState([]);
  const [pending, setPending] = useState([]);
  const [canModerate, setCanModerate] = useState(false);
  const [moderatingId, setModeratingId] = useState("");
  const [listError, setListError] = useState("");

  const loadSaved = useCallback(async () => {
    const data = await readResponse(await fetch("/api/opportunities", { cache: "no-store" }));
    setApproved(data.approved || []);
    setCanModerate(Boolean(data.canModerate));
    if (data.canModerate) {
      const review = await readResponse(await fetch("/api/opportunities/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
      }));
      setPending(review.opportunities || []);
    } else {
      setPending([]);
    }
    setListError("");
  }, []);

  useEffect(() => {
    loadSaved().catch(cause => setListError(cause.message || "Could not load saved opportunities."));
  }, [loadSaved]);

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
        if (next.status === "completed") {
          try {
            await loadSaved();
          } catch (cause) {
            setListError(cause.message || "Could not refresh saved opportunities.");
          }
        }
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
  }, [jobId, job?.status, loadSaved]);

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
      try {
        await loadSaved();
      } catch (cause) {
        setListError(cause.message || "Could not load saved opportunities.");
      }
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

  async function decide(item, status) {
    const itemId = String(item.id);
    const decidedAt = new Date().toISOString();
    setModeratingId(itemId);
    setError("");
    setPending(current => current.filter(row => String(row.id) !== itemId));
    if (status === "approved") {
      const optimistic = { ...item, status, decided_at: decidedAt };
      setApproved(current => [...current.filter(row => String(row.id) !== itemId), optimistic].sort(newestFirst));
    }

    try {
      const response = await readResponse(await fetch(`/api/opportunities/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }));
      if (status === "approved") {
        setApproved(current => [...current.filter(row => String(row.id) !== itemId), response.opportunity].sort(newestFirst));
      }
    } catch (cause) {
      setPending(current => [...current.filter(row => String(row.id) !== itemId), item].sort(newestFirst));
      if (status === "approved") setApproved(current => current.filter(row => String(row.id) !== itemId));
      setError(cause.message || "Could not update this opportunity.");
    } finally {
      setModeratingId("");
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

        <section className="saved-opportunities" aria-labelledby="saved-heading" aria-live="polite">
          <div className="saved-section-heading">
            <p className="section-label"><span>02</span> SAVED OPPORTUNITIES</p>
            <h2 id="saved-heading">Worth a closer look.</h2>
          </div>
          {listError && <p className="opportunity-error" role="alert">{listError}</p>}

          {canModerate && <section className="review-queue" aria-labelledby="review-heading">
            <div className="review-heading"><div><p className="section-label"><span>03</span> PRIVATE REVIEW</p><h3 id="review-heading">New opportunities</h3></div><span>{pending.length} waiting</span></div>
            {pending.length ? <div className="opportunity-grid">
              {pending.map(item => <article className="opportunity-card saved-opportunity-card" key={item.id}>
                <div className="card-top"><span>NEW</span><span>{foundDate(item.found_at) || "JUST FOUND"}</span></div>
                <h3>{item.title}</h3>
                {item.why_it_fits && <p className="opportunity-description">{item.why_it_fits}</p>}
                {item.source_excerpt && <p className="saved-source-excerpt">{item.source_excerpt}</p>}
                <a className="saved-source-link" href={item.url} target="_blank" rel="noreferrer">Open source ↗</a>
                <div className="decision-actions">
                  <button className="button" type="button" onClick={() => decide(item, "approved")} disabled={Boolean(moderatingId)}>{moderatingId === String(item.id) ? "Saving…" : "Approve"}</button>
                  <button className="button decision-reject" type="button" onClick={() => decide(item, "rejected")} disabled={Boolean(moderatingId)}>{moderatingId === String(item.id) ? "Saving…" : "Reject"}</button>
                </div>
              </article>)}
            </div> : <p className="saved-empty">No new opportunities are waiting for review.</p>}
          </section>}

          <div className="approved-list">
            <div className="review-heading"><div><p className="section-label"><span>04</span> APPROVED</p><h3>Ready to explore</h3></div><span>{approved.length} saved</span></div>
            {approved.length ? <div className="opportunity-grid">
              {approved.map(item => <article className="opportunity-card saved-opportunity-card" key={item.id}>
                <div className="card-top"><span>APPROVED</span><span>{foundDate(item.found_at)}</span></div>
                <h3>{item.title}</h3>
                {item.why_it_fits && <p className="opportunity-description">{item.why_it_fits}</p>}
                {item.source_excerpt && <p className="saved-source-excerpt">{item.source_excerpt}</p>}
                <a className="saved-source-link" href={item.url} target="_blank" rel="noreferrer">Open source ↗</a>
              </article>)}
            </div> : <p className="saved-empty">No approved opportunities yet.</p>}
          </div>
        </section>

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
          {job.warning && <p className="result-note" role="status">{job.warning}</p>}
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
