import { Agent, Runner, tool, webSearchTool } from '@openai/agents';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { lookup } from 'node:dns/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_SEARCHES = 10;
const MAX_PAGE_READS = 15;
const MAX_RUNTIME_MS = 4 * 60 * 1000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_PAGE_CHARS = 18_000;
const JOB_RETENTION_MS = 60 * 60 * 1000;

const HttpUrlSchema = z.string().regex(/^https?:\/\/[^\s]+$/i);

const EvidenceSchema = z.object({
  url: HttpUrlSchema,
  quote: z.string().min(8).max(320),
});

const ReportSchema = z.object({
  summary: z.string().max(600),
  opportunities: z.array(z.object({
    title: z.string().min(1).max(180),
    kind: z.string().min(1).max(80),
    description: z.string().min(1).max(500),
    ageEligible: z.boolean(),
    locationAccessible: z.boolean(),
    applicationsOpen: z.boolean(),
    deadline: z.string().max(160).nullable(),
    ageEvidence: EvidenceSchema,
    locationEvidence: EvidenceSchema,
    availabilityEvidence: EvidenceSchema,
  })).max(5),
  ruledOut: z.array(z.object({
    title: z.string().min(1).max(180),
    reason: z.string().min(1).max(400),
    sourceUrl: HttpUrlSchema.nullable(),
    excerpt: z.string().max(320).nullable(),
  })).max(20),
});

const runner = new Runner({
  modelSettings: {
    maxTokens: 6000,
    parallelToolCalls: false,
  },
});

const jobs = new Map();

function logToolCall(job, toolName, args) {
  console.log(JSON.stringify({
    event: 'tool_call',
    jobId: job.id,
    tool: toolName,
    arguments: args ?? null,
  }));
}

function normalizeText(value) {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function pageForEvidence(job, url) {
  const wanted = normalizeUrl(url);
  return job.pages.find(page =>
    normalizeUrl(page.requestedUrl) === wanted || normalizeUrl(page.finalUrl) === wanted
  );
}

function addActivity(job, type, label, details = {}) {
  const entry = { type, label, elapsedMs: elapsedMs(job), ...details };
  job.activity.push(entry);
  if (job.activity.length > 80) job.activity.shift();
  return entry;
}

function verifiedQuote(job, evidence) {
  const page = pageForEvidence(job, evidence.url);
  return Boolean(page && normalizeText(page.text).includes(normalizeText(evidence.quote)));
}

function validateReport(job, value) {
  const parsed = ReportSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('The agent returned results in an unexpected format.');
  }

  const accepted = [];
  const ruledOut = [...parsed.data.ruledOut];

  for (const item of parsed.data.opportunities) {
    const evidenceVerified = [
      item.ageEvidence,
      item.locationEvidence,
      item.availabilityEvidence,
    ].every(evidence => verifiedQuote(job, evidence));

    if (!item.ageEligible || !item.locationAccessible || !item.applicationsOpen) {
      const reasons = [];
      if (!item.ageEligible) reasons.push('age eligibility did not pass');
      if (!item.locationAccessible) reasons.push('location did not pass');
      if (!item.applicationsOpen) reasons.push('applications were not confirmed open');
      ruledOut.push({
        title: item.title,
        reason: reasons.join('; '),
        sourceUrl: item.availabilityEvidence.url,
        excerpt: item.availabilityEvidence.quote,
      });
      continue;
    }

    if (!evidenceVerified) {
      ruledOut.push({
        title: item.title,
        reason: 'Excluded because one or more source excerpts could not be matched to a page read by open_page.',
        sourceUrl: null,
        excerpt: null,
      });
      continue;
    }

    accepted.push(item);
  }

  return {
    summary: parsed.data.summary,
    opportunities: accepted.slice(0, 5),
    ruledOut: ruledOut.slice(0, 20),
  };
}

function htmlToText(html) {
  const preferred = html.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i);
  let content = preferred ? preferred[2] : html;
  content = content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr|\/main)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, digits) => decodeCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => decodeCodePoint(Number.parseInt(digits, 16)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return content.slice(0, MAX_PAGE_CHARS);
}

function decodeCodePoint(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : ' ';
}

function awaitWithSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error('Job was stopped.'));
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new Error('Job was stopped.'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => {
    signal.removeEventListener('abort', onAbort);
  });
}

async function assertPublicUrl(rawUrl, signal) {
  const url = new URL(rawUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only public HTTP or HTTPS pages can be opened.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Local network addresses cannot be opened.');
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await awaitWithSignal(lookup(hostname, { all: true, verbatim: true }), signal);
  if (!addresses.length || addresses.some(({ address }) => {
    try {
      return ipaddr.process(address).range() !== 'unicast';
    } catch {
      return true;
    }
  })) {
    throw new Error('The page address is not a public Internet host.');
  }
  return url;
}

async function fetchPage(job, rawUrl) {
  let current = rawUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const url = await assertPublicUrl(current, job.controller.signal);
    if (job.controller.signal.aborted) throw new Error('Job was stopped.');

    const pageController = new AbortController();
    const timeout = setTimeout(() => pageController.abort(), 12_000);
    const abortFromJob = () => pageController.abort();
    job.controller.signal.addEventListener('abort', abortFromJob, { once: true });

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: pageController.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'user-agent': 'OpportunitiesAgent/1.0 (+official-source verification)',
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) throw new Error('The page redirected too many times.');
        current = new URL(location, url).toString();
        continue;
      }

      if (!response.ok) throw new Error('Page returned HTTP ' + response.status + '.');
      const contentType = response.headers.get('content-type') || '';
      if (!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
        throw new Error('The page did not return readable HTML or text.');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('The page had no readable body.');
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = MAX_RESPONSE_BYTES - total;
        if (value.byteLength > remaining) {
          chunks.push(value.slice(0, Math.max(0, remaining)));
          total = MAX_RESPONSE_BYTES;
          await reader.cancel();
          break;
        }
        chunks.push(value);
        total += value.byteLength;
      }

      const source = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
      const text = /text\/plain/i.test(contentType) ? source.slice(0, MAX_PAGE_CHARS) : htmlToText(source);
      if (!text) throw new Error('The page contained no readable text.');

      const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200) || url.hostname;

      const page = {
        requestedUrl: rawUrl,
        finalUrl: url.toString(),
        title,
        text,
      };
      job.pages.push(page);
      return page;
    } finally {
      clearTimeout(timeout);
      job.controller.signal.removeEventListener('abort', abortFromJob);
    }
  }
  throw new Error('Could not follow the page URL.');
}

function openPageTool(job) {
  return tool({
    name: 'open_page',
    description: 'Read one public web page and return its title, final URL, and readable text. Use official organizer pages to verify eligibility and current availability.',
    parameters: z.object({
      url: HttpUrlSchema.max(2000),
    }),
    execute: async ({ url }) => {
      if (job.searches === 0) {
        return 'Search the web before opening source pages.';
      }
      if (job.pagesRead >= MAX_PAGE_READS) {
        return 'Page read limit reached; do not accept an item without verifying it.';
      }
      job.pagesRead += 1;
      const activity = addActivity(job, 'reading', 'Reading source page', { url, status: 'reading' });
      try {
        const page = await fetchPage(job, url);
        activity.label = 'Read source: ' + page.title;
        activity.url = page.finalUrl;
        activity.status = 'read';
        return JSON.stringify({
          title: page.title,
          url: page.finalUrl,
          text: page.text,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Page could not be read.';
        activity.status = 'failed';
        activity.label = 'Could not read source';
        activity.error = message;
        return 'Could not read this page: ' + message + ' Try another official source before excluding the item.';
      }
    },
  });
}

function callName(event) {
  const item = event.item;
  return item?.toolName || item?.rawItem?.name || item?.name || 'unknown_tool';
}

function callArguments(event) {
  const item = event.item;
  const raw = item?.rawItem || item;
  const value = raw?.arguments ?? raw?.input ?? null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractSearchQueries(value, depth = 0, found = []) {
  if (depth > 8 || value == null) return found;
  if (Array.isArray(value)) {
    for (const item of value) extractSearchQueries(item, depth + 1, found);
  } else if (typeof value === 'object') {
    if (value.type === 'web_search_call' && value.action) {
      const action = value.action;
      if (typeof action.query === 'string') found.push(action.query);
      if (Array.isArray(action.queries)) found.push(...action.queries.filter(query => typeof query === 'string'));
    }
    for (const key of ['item', 'action', 'response', 'output', 'queries']) {
      if (key in value) extractSearchQueries(value[key], depth + 1, found);
    }
  }
  return [...new Set(found)].slice(0, 10);
}

function elapsedMs(job) {
  return Math.max(0, Date.now() - job.startedAt);
}

function jobView(job) {
  const view = {
    jobId: job.id,
    status: job.status,
    progress: {
      searches: job.searches,
      pageReads: job.pagesRead,
      elapsedMs: elapsedMs(job),
      stage: job.stage,
    },
    activity: job.activity,
  };
  if (job.status === 'completed') view.results = job.result;
  if (job.status === 'failed' || job.status === 'cancelled') view.error = job.error;
  return view;
}

async function runJob(job) {
  if (job.status === 'cancelled' || job.controller.signal.aborted) return;
  job.status = 'running';
  job.startedAt = Date.now();
  job.stage = 'Searching the web';
  job.deadlineTimer = setTimeout(() => {
    job.timedOut = true;
    job.controller.abort(new Error('Four-minute job limit reached.'));
  }, MAX_RUNTIME_MS);

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set. Add it to agent/.env and restart the server.');
    }
    if (!process.env.AGENT_SECRET) {
      throw new Error('AGENT_SECRET is not set. Add it to agent/.env and restart the server.');
    }

    const interestsText = await readFile(path.join(PACKAGE_DIR, 'interests.txt'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const age = process.env.PROFILE_AGE?.trim() || interestsText.match(/^\s*age\s*:\s*(.+)$/im)?.[1]?.trim();
    const city = process.env.PROFILE_CITY?.trim() || interestsText.match(/^\s*city\s*:\s*(.+)$/im)?.[1]?.trim();
    const interests = (process.env.PROFILE_INTERESTS || interestsText.match(/^\s*interests\s*:\s*(.+)$/im)?.[1])
      ?.split(',')
      .map(value => value.trim())
      .filter(Boolean);
    if (!age || !city || !interests?.length) {
      throw new Error('interests.txt must contain Age, City, and Interests entries.');
    }

    const today = new Intl.DateTimeFormat('en-NZ', {
      dateStyle: 'long',
      timeZone: 'Pacific/Auckland',
    }).format(new Date());

    const search = webSearchTool({ searchContextSize: 'low' });
    const agent = new Agent({
      name: 'Youth Opportunities Researcher',
      model: 'gpt-6-luna',
      outputType: ReportSchema,
      tools: [search, openPageTool(job)],
      instructions: [
        'Find up to five current competitions, programs, or events that fit the profile below. The current date in Auckland is ' + today + '.',
        'Read the supplied interests and search the web first. Use no more than 10 web_search calls total and no more than 15 open_page calls total. Do not make parallel tool calls.',
        'Search with broad terms and avoid including an exact age or personal name in search queries. The city and interests may be used to find local opportunities.',
        'After searching, use open_page to read an official organizer, government, or event source for every item you might shortlist.',
        'Before accepting an item, verify from pages you actually read: the person is eligible at the supplied age, the opportunity is accessible from the supplied city, and applications or registration are open as of the current date.',
        'Every accepted item must have separate short, verbatim excerpts for age eligibility, location/access, and open availability. Each excerpt must cite the exact URL returned by open_page. Do not infer missing facts.',
        'Do not assume the person attends a particular school or has experience, awards, equipment, or other qualifications.',
        'If an official page cannot be read, try another official source. Exclude the item if you still cannot verify it, and explain why in ruledOut.',
        'Return fewer than five if that is all you can verify. Never invent titles, quotes, deadlines, eligibility, or open status.',
        'Keep descriptions concise and do not request contact details or other personal information.',
        'User profile from agent/interests.txt:',
        'Age: ' + age,
        'City: ' + city,
        'Interests: ' + interests.join(', '),
      ].join('\n'),
    });

    const resultStream = await runner.run(agent, 'Find current opportunities for me.', {
      stream: true,
      maxTurns: 40,
      signal: job.controller.signal,
    });

    for await (const event of resultStream) {
      if (event.type === 'raw_model_stream_event') {
        const queries = extractSearchQueries(event.data);
        if (queries.length) {
          const searchActivity = [...job.activity].reverse().find(item => item.type === 'search');
          if (searchActivity) searchActivity.queries = queries;
        }
      }
      if (event.type === 'run_item_stream_event' && event.name === 'tool_called') {
        const name = callName(event);
        const args = callArguments(event);
        logToolCall(job, name, args);
        if (/web_search/i.test(name)) {
          if (job.searches >= MAX_SEARCHES) {
            job.searchLimitExceeded = true;
            job.controller.abort(new Error('Search limit reached.'));
            break;
          }
          job.searches += 1;
          let query = null;
          if (args && typeof args === 'object') {
            query = args.query || args.search_query || args.q || null;
          }
          addActivity(job, 'search', 'Web search ' + job.searches, query ? { query: String(query).slice(0, 300) } : {});
          job.stage = 'Searching the web';
        } else if (name === 'open_page') {
          job.stage = 'Reading sources';
        }
      }
      if (event.type === 'run_item_stream_event' && event.name === 'message_output_created') {
        job.stage = 'Checking matches';
        addActivity(job, 'checking', 'Checking candidate matches against the sources');
        }
    }
    await resultStream.completed;

    if (job.timedOut) throw new Error('The search exceeded the four-minute limit.');
    if (job.searchLimitExceeded) throw new Error('Stopped because the search tried to exceed the ten-search limit.');
    if (job.controller.signal.aborted) throw new Error('The job was stopped before results were complete.');

    job.result = validateReport(job, resultStream.finalOutput);
    job.status = 'completed';
    job.stage = 'Finished';
    addActivity(job, 'complete', 'Search finished');
  } catch (error) {
    if (job.status === 'cancelled') return;
    if (job.timedOut) {
      job.status = 'failed';
      job.error = 'The search exceeded the four-minute limit. No unverified results were returned.';
    } else if (job.searchLimitExceeded) {
      job.status = 'failed';
      job.error = 'Stopped because the search tried to exceed the ten-search limit. No unverified results were returned.';
    } else if (job.controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = 'The job was cancelled.';
    } else {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'The search failed unexpectedly.';
    }
  } finally {
    clearTimeout(job.deadlineTimer);
  }
}

function secretsEqual(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorizedAgentRequest(request) {
  const provided = request.headers.agent_secret;
  const headerValue = Array.isArray(provided) ? provided[0] : provided;
  return secretsEqual(headerValue, process.env.AGENT_SECRET);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function purgeOldJobs() {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff && !['queued', 'running'].includes(job.status)) jobs.delete(id);
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('agent is running');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/jobs') {
    request.resume();
    if (!process.env.AGENT_SECRET) {
      sendJson(response, 503, { error: 'AGENT_SECRET is not configured.' });
      return;
    }
    const provided = request.headers.agent_secret;
    const headerValue = Array.isArray(provided) ? provided[0] : provided;
    if (!secretsEqual(headerValue, process.env.AGENT_SECRET)) {
      sendJson(response, 401, { error: 'Invalid or missing AGENT_SECRET header.' });
      return;
    }

    purgeOldJobs();
    if (jobs.size >= 100) {
      sendJson(response, 503, { error: 'Too many retained jobs. Try again later.' });
      return;
    }

    const id = randomUUID();
    const job = {
      id,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: Date.now(),
      searches: 0,
      pagesRead: 0,
      pages: [],
      activity: [],
      stage: 'Queued',
      result: null,
      error: null,
      controller: new AbortController(),
    };
    jobs.set(id, job);
    setImmediate(() => void runJob(job));
    sendJson(response, 202, { jobId: id, status: 'queued' });
    return;
  }

  const jobMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]+)$/i);
  if (request.method === 'GET' && jobMatch) {
    if (!process.env.AGENT_SECRET) {
      sendJson(response, 503, { error: 'AGENT_SECRET is not configured.' });
      return;
    }
    if (!authorizedAgentRequest(request)) {
      sendJson(response, 401, { error: 'Invalid or missing AGENT_SECRET header.' });
      return;
    }
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: 'Job not found.' });
      return;
    }
    sendJson(response, 200, jobView(job));
    return;
  }

  const cancelMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]+)\/cancel$/i);
  if (request.method === 'POST' && cancelMatch) {
    request.resume();
    if (!process.env.AGENT_SECRET) {
      sendJson(response, 503, { error: 'AGENT_SECRET is not configured.' });
      return;
    }
    if (!authorizedAgentRequest(request)) {
      sendJson(response, 401, { error: 'Invalid or missing AGENT_SECRET header.' });
      return;
    }
    const job = jobs.get(cancelMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: 'Job not found.' });
      return;
    }
    if (!['queued', 'running'].includes(job.status)) {
      sendJson(response, 409, { error: 'Job is already ' + job.status + '.' });
      return;
    }
    job.status = 'cancelled';
    job.error = 'The job was cancelled.';
    job.controller.abort(new Error('Cancelled by request.'));
    sendJson(response, 200, jobView(job));
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
});

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Agent server listening on port ' + PORT + '.');
});

server.on('close', () => {
  for (const job of jobs.values()) {
    if (job.status === 'queued' || job.status === 'running') job.controller.abort();
  }
});
