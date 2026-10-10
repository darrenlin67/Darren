import { NextResponse } from "next/server";
import { agentConfig, agentHeaders, createSessionCookie, hasValidSession, matchesSitePassword } from "./auth";
import { readApprovedOpportunities } from "./data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const approved = await readApprovedOpportunities();
    return NextResponse.json({ approved, canModerate: hasValidSession(request) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not load approved opportunities." }, { status: 502 });
  }
}

export async function POST(request) {
  if (!process.env.SITE_PASSWORD) {
    return NextResponse.json({ error: "SITE_PASSWORD is not configured on the site server." }, { status: 503 });
  }

  let body;
  try {
    const text = await request.text();
    if (text.length > 2048) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Enter your site password to refresh opportunities." }, { status: 400 });
  }

  if (!matchesSitePassword(body?.password)) {
    return NextResponse.json({ error: "That site password didn’t match. Try again." }, { status: 401 });
  }

  const config = agentConfig();
  if (!config) return NextResponse.json({ error: "The opportunities agent is not configured. Check AGENT_URL and AGENT_SECRET on the site server." }, { status: 503 });

  try {
    const upstream = await fetch(`${config.base}/jobs`, {
      method: "POST",
      headers: agentHeaders(config.secret),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !result.jobId) {
      return NextResponse.json({ error: result.error || "The agent could not start a job." }, { status: upstream.status || 502 });
    }

    const response = NextResponse.json({ jobId: result.jobId, status: result.status || "queued" }, { status: 202 });
    response.headers.set("Set-Cookie", createSessionCookie());
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "Could not reach the opportunities agent. Check AGENT_URL and that the agent is running." }, { status: 502 });
  }
}
