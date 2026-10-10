import "server-only";

const TABLE = "opportunities";

function supabaseRequestUrl(query = {}) {
  const base = process.env.SUPABASE_URL?.trim();
  if (!base || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error("Supabase is not configured on the site server.");
  }

  const url = new URL(`/rest/v1/${TABLE}`, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

function supabaseHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: "application/json",
    ...extra,
  };
}

async function readRows(statuses) {
  const response = await fetch(supabaseRequestUrl({
    select: "id,title,url,source_excerpt,why_it_fits,status,found_at,decided_at",
    status: `in.(${statuses.join(",")})`,
    order: "found_at.desc,id.desc",
  }), {
    headers: supabaseHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error("Supabase could not return opportunities.");
  return response.json();
}

export function readApprovedOpportunities() {
  return readRows(["approved"]);
}

export function readNewOpportunities() {
  return readRows(["new"]);
}

export async function decideOpportunity(id, status) {
  const url = supabaseRequestUrl({ id: `eq.${id}`, status: "eq.new" });
  const response = await fetch(url, {
    method: "PATCH",
    headers: supabaseHeaders({
      "content-type": "application/json",
      prefer: "return=representation",
    }),
    body: JSON.stringify({ status, decided_at: new Date().toISOString() }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error("Supabase could not update this opportunity.");
  const rows = await response.json();
  return rows[0] || null;
}
