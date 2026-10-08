import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "opportunities_session";
const SESSION_SECONDS = 15 * 60;

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function matchesSitePassword(provided) {
  const expected = process.env.SITE_PASSWORD;
  return Boolean(expected) && constantTimeEqual(provided, expected);
}

function signature(payload) {
  return createHmac("sha256", process.env.SITE_PASSWORD).update(payload).digest("base64url");
}

export function createSessionCookie() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${expires}.${randomBytes(16).toString("base64url")}`;
  const value = `${payload}.${signature(payload)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api/opportunities; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function hasValidSession(request) {
  const raw = request.headers.get("cookie") || "";
  const value = raw.split(";").map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!value || !process.env.SITE_PASSWORD) return false;
  const [expiresText, nonce, suppliedSignature, ...extra] = value.split(".");
  if (extra.length || !/^\d+$/.test(expiresText || "") || !nonce || !suppliedSignature) return false;
  if (Number(expiresText) <= Math.floor(Date.now() / 1000)) return false;
  return constantTimeEqual(suppliedSignature, signature(`${expiresText}.${nonce}`));
}

export function agentConfig() {
  const base = process.env.AGENT_URL?.trim();
  const secret = process.env.AGENT_SECRET;
  if (!base || !secret) return null;
  try {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return { base: url.toString().replace(/\/$/, ""), secret };
  } catch {
    return null;
  }
}

export function agentHeaders(secret) {
  return { agent_secret: secret, accept: "application/json" };
}
