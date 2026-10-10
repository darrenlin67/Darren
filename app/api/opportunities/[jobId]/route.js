import { NextResponse } from "next/server";
import { agentConfig, agentHeaders, createSessionCookie, hasValidSession, matchesSitePassword } from "../auth";
import { decideOpportunity } from "../data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function relay(request, context, method) {
  if (!hasValidSession(request)) return NextResponse.json({ error: "Your refresh session expired. Enter your site password again." }, { status: 401 });
  const { jobId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  const config = agentConfig();
  if (!config) return NextResponse.json({ error: "The opportunities agent is not configured on the site server." }, { status: 503 });

  try {
    const suffix = method === "POST" ? "/cancel" : "";
    const upstream = await fetch(`${config.base}/jobs/${jobId}${suffix}`, {
      method,
      headers: agentHeaders(config.secret),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const result = await upstream.json().catch(() => ({}));
    return NextResponse.json(result, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read progress from the opportunities agent." }, { status: 502 });
  }
}

export async function GET(request, context) {
  return relay(request, context, "GET");
}

export async function POST(request, context) {
  return relay(request, context, "POST");
}

export async function PATCH(request, context) {
  const hasSession = hasValidSession(request);
  let body = {};
  try {
    const text = await request.text();
    if (text.length > 2048) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const passwordMatches = matchesSitePassword(body?.password);
  if (!hasSession && !passwordMatches) {
    return NextResponse.json({ error: "Enter the site password to decide an opportunity." }, { status: 401 });
  }

  const { jobId: id } = await context.params;
  if (!/^\d{1,20}$/.test(id)) return NextResponse.json({ error: "Invalid opportunity id." }, { status: 400 });
  if (!['approved', 'rejected'].includes(body?.status)) {
    return NextResponse.json({ error: "Choose approved or rejected." }, { status: 400 });
  }

  try {
    const opportunity = await decideOpportunity(id, body.status);
    if (!opportunity) return NextResponse.json({ error: "This new opportunity was not found." }, { status: 404 });
    const response = NextResponse.json({ opportunity }, {
      headers: { "Cache-Control": "no-store" },
    });
    if (!hasSession && passwordMatches) response.headers.set("Set-Cookie", createSessionCookie());
    return response;
  } catch {
    return NextResponse.json({ error: "Could not update this opportunity." }, { status: 502 });
  }
}
