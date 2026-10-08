import { NextResponse } from "next/server";
import { agentConfig, agentHeaders, hasValidSession } from "../auth";

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
