import { NextResponse } from "next/server";
import { createSessionCookie, hasValidSession, matchesSitePassword } from "../auth";
import { readNewOpportunities } from "../data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
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
    return NextResponse.json({ error: "Enter the site password to view new opportunities." }, { status: 401 });
  }

  try {
    const opportunities = await readNewOpportunities();
    const response = NextResponse.json({ opportunities }, {
      headers: { "Cache-Control": "no-store" },
    });
    if (!hasSession && passwordMatches) response.headers.set("Set-Cookie", createSessionCookie());
    return response;
  } catch {
    return NextResponse.json({ error: "Could not load new opportunities." }, { status: 502 });
  }
}
