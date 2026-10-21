/**
 * Cloudflare Worker: YouTube Transcript Proxy
 *
 * Uses YouTube's innertube player API with ANDROID client to get transcript URLs
 * that don't require PO tokens, then fetches the actual transcript XML/JSON.
 *
 * GET /transcript?v=VIDEO_ID
 * GET /debug?v=VIDEO_ID
 */

const ALLOWED_ORIGINS = [
  'https://aura.bynoor.io',
  'http://localhost:3000',
  'http://localhost:8000',
];

export function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// Innertube context for ANDROID client (no PO token needed)
const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
  },
};

// Public innertube API key
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

/**
 * Strips a query parameter cleanly from a URL string.
 */
function stripParam(urlStr, param) {
  return urlStr
    .replace(new RegExp(`([?&])${param}=[^&]*(&|$)`, 'g'), (m, p1, p2) => (p2 === '&' ? p1 : ''))
    .replace(/[?&]$/, '');
}

/**
 * Appends &fmt=json3 to a URL string if not already present.
 */
function addFmtJson3(urlStr) {
  if (urlStr.includes('fmt=json3')) return urlStr;
  return urlStr + (urlStr.includes('?') ? '&' : '?') + 'fmt=json3';
}

/**
 * Returns candidate list with kinds and URLs.
 */
export function candidateList(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return [];
  const normalized = baseUrl.replace(/&amp;/g, '&');

  const verbatim = normalized;
  const verbatimJson3 = addFmtJson3(verbatim);
  const variantStripped = stripParam(verbatim, 'variant');
  const variantStrippedJson3 = addFmtJson3(variantStripped);
  const expStripped = stripParam(verbatim, 'exp');

  const raw = [
    { url_kind: 'verbatim', url: verbatim },
    { url_kind: 'verbatim+fmt=json3', url: verbatimJson3 },
    { url_kind: 'variant-stripped', url: variantStripped },
    { url_kind: 'variant-stripped+fmt=json3', url: variantStrippedJson3 },
    { url_kind: 'exp-stripped', url: expStripped },
  ];

  const seen = new Set();
  const deduped = [];
  for (const item of raw) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      deduped.push(item);
    }
  }
  return deduped;
}

/**
 * Candidate URLs ladder: verbatim, verbatim + &fmt=json3, variant-stripped,
 * variant-stripped + &fmt=json3, exp-stripped (last resort only).
 * Deduped and returned in order.
 */
export function candidateUrls(baseUrl) {
  return candidateList(baseUrl).map(c => c.url);
}

/**
 * Ranks caption tracks:
 * 1. manual en
 * 2. en-* manual
 * 3. ASR en
 * 4. any en*
 * 5. tracks[0]
 * Up to 3 ranked tracks are returned.
 */
export function rankTracks(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  const manualEn = [];
  const manualEnPrefix = [];
  const asrEn = [];
  const anyEn = [];

  for (const t of tracks) {
    const lang = t.languageCode || '';
    const isAsr = t.kind === 'asr';
    if (lang === 'en' && !isAsr) {
      manualEn.push(t);
    } else if (lang.startsWith('en') && lang !== 'en' && !isAsr) {
      manualEnPrefix.push(t);
    } else if (lang === 'en' && isAsr) {
      asrEn.push(t);
    } else if (lang.startsWith('en')) {
      anyEn.push(t);
    }
  }

  const ranked = [];
  const seen = new Set();
  const add = (t) => {
    if (t && !seen.has(t)) {
      seen.add(t);
      ranked.push(t);
    }
  };

  manualEn.forEach(add);
  manualEnPrefix.forEach(add);
  asrEn.forEach(add);
  anyEn.forEach(add);
  if (tracks.length > 0) {
    add(tracks[0]);
  }

  return ranked.slice(0, 3);
}

/**
 * Parses transcript text from raw XML or JSON string.
 */
export function parseTranscriptBody(body) {
  if (!body || typeof body !== 'string' || !body.trim()) {
    return null;
  }
  const trimmed = body.trim();

  // json3 format
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      const segments = [];
      for (const event of data.events || []) {
        for (const seg of event.segs || []) {
          const t = (seg.utf8 || '').replace(/\n/g, ' ').trim();
          if (t) segments.push(t);
        }
      }
      if (segments.length > 0) return segments.join(' ');
    } catch (_) {
      // not valid json3, continue to XML regexes
    }
  }

  // Format 3 (srv3): uses <p> with <s> children
  const segments = [];
  const srv3Regex = /<s[^>]*>([^<]*)<\/s>/g;
  let match;
  while ((match = srv3Regex.exec(trimmed)) !== null) {
    const t = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();
    if (t) segments.push(t);
  }

  // Fallback: classic format uses <text> tags
  if (segments.length === 0) {
    const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
    while ((match = textRegex.exec(trimmed)) !== null) {
      const t = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n/g, ' ')
        .trim();
      if (t) segments.push(t);
    }
  }

  if (segments.length > 0) {
    return segments.join(' ');
  }

  return null;
}

/**
 * Classifies playabilityStatus from Innertube player response:
 * - LOGIN_REQUIRED with bot detection reason -> UPSTREAM_BOTWALL (502, retryable)
 * - LOGIN_REQUIRED with age-restricted reason -> NO_CAPTIONS_AGE (422, terminal)
 * - Any other LOGIN_REQUIRED status (unknown login wall) -> UPSTREAM_BOTWALL (502, retryable)
 * - Any other non-OK status (e.g. unavailable, removed) -> NO_CAPTIONS (422, terminal)
 */
export function classifyPlayability(playability) {
  if (!playability || playability.status === 'OK') return null;

  const status = (playability.status || '').toUpperCase();
  const reasonText = [
    playability.reason,
    playability.subreason,
    ...(Array.isArray(playability.messages) ? playability.messages : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // (1) Bot detection on egress: evaluated BEFORE age restriction
  const isBotReason =
    reasonText.includes('confirm you are not a bot') ||
    reasonText.includes('bot') ||
    (reasonText.includes('sign in to confirm') && !reasonText.includes('confirm your age'));
  if (status === 'LOGIN_REQUIRED' && isBotReason) {
    const err = new Error(`Video not playable: ${playability.reason || playability.status}`);
    err.error_code = 'UPSTREAM_BOTWALL';
    err.status = 502;
    err.stage = 'player';
    err.lang = null;
    err.attempts = [];
    return err;
  }

  // (2) Age restriction with word-boundary regex or 'confirm your age', NOT bare 'age' substring
  const isAgeReason =
    /\bage[- ]?restrict/i.test(reasonText) ||
    reasonText.includes('confirm your age') ||
    reasonText.includes('viewer discretion') ||
    Boolean(playability.desktopLegacyAgeGateReason);
  if (status === 'LOGIN_REQUIRED' && isAgeReason) {
    const err = new Error(`Video not playable: ${playability.reason || playability.status}`);
    err.error_code = 'NO_CAPTIONS_AGE';
    err.status = 422;
    err.stage = 'player';
    err.lang = null;
    err.attempts = [];
    return err;
  }

  // (3) Any other LOGIN_REQUIRED (unknown login wall) maps to UPSTREAM_BOTWALL (502, retryable)
  if (status === 'LOGIN_REQUIRED') {
    const err = new Error(`Video not playable: ${playability.reason || playability.status}`);
    err.error_code = 'UPSTREAM_BOTWALL';
    err.status = 502;
    err.stage = 'player';
    err.lang = null;
    err.attempts = [];
    return err;
  }

  // (4) All other unplayable reasons ('Video unavailable', removed, etc.): terminal NO_CAPTIONS
  const err = new Error(`Video not playable: ${playability.reason || playability.status}`);
  err.error_code = 'NO_CAPTIONS';
  err.status = 422;
  err.stage = 'player';
  err.lang = null;
  err.attempts = [];
  return err;
}

/**
 * Classifies final attempts error:
 * - If caption tracks did not exist -> NO_CAPTIONS (422, terminal)
 * - Else if any attempt has status 0 (network failure) -> UPSTREAM_NETWORK (502, retryable)
 * - Else if any attempt has status 200 (empty/unparseable body) -> UPSTREAM_EMPTY (502, retryable)
 * - Else if every attempt has status > 0 and non-200 -> UPSTREAM_<status> (502, retryable) using FIRST attempt's status
 * - Else UPSTREAM_NETWORK (502, retryable)
 */
export function classifyAttemptsError(attempts, lang, tracksExist = true) {
  if (!tracksExist) {
    const err = new Error(
      lang ? `No caption tracks available for ${lang}` : 'No caption tracks available'
    );
    err.error_code = 'NO_CAPTIONS';
    err.status = 422;
    err.stage = 'timedtext';
    err.lang = lang;
    err.attempts = attempts || [];
    return err;
  }

  const hasStatus0 = (attempts || []).some(a => !a.status || a.status === 0);
  if (hasStatus0) {
    const err = new Error(`All candidate URLs failed for track ${lang || ''}`.trim());
    err.error_code = 'UPSTREAM_NETWORK';
    err.status = 502;
    err.stage = 'timedtext';
    err.lang = lang;
    err.attempts = attempts || [];
    return err;
  }

  const has200 = (attempts || []).some(a => a.status === 200);
  if (has200) {
    const err = new Error(`All candidate URLs returned empty or unparseable captions for track ${lang || ''}`.trim());
    err.error_code = 'UPSTREAM_EMPTY';
    err.status = 502;
    err.stage = 'timedtext';
    err.lang = lang;
    err.attempts = attempts || [];
    return err;
  }

  const allNon200Positive = (attempts || []).length > 0 && attempts.every(
    a => typeof a.status === 'number' && a.status > 0 && a.status !== 200
  );
  if (allNon200Positive) {
    const firstStatus = attempts[0].status;
    const err = new Error(`Timedtext failed with upstream status ${firstStatus}`);
    err.error_code = `UPSTREAM_${firstStatus}`;
    err.status = 502;
    err.stage = 'timedtext';
    err.lang = lang;
    err.attempts = attempts || [];
    return err;
  }

  const err = new Error(`All candidate URLs failed for track ${lang || ''}`.trim());
  err.error_code = 'UPSTREAM_NETWORK';
  err.status = 502;
  err.stage = 'timedtext';
  err.lang = lang;
  err.attempts = attempts || [];
  return err;
}

/**
 * Step 1: Call innertube player API to get caption tracks (ANDROID client, no PO token needed).
 * Fast-fails on UPSTREAM_BOTWALL (502) immediately with no internal retries so caller can retry on fresh egress.
 */
export async function getCaptionTracks(videoId, apiKey, deadline = (Date.now() + 10000), fetchFn = fetch) {
  const remainingBudget = deadline - Date.now();
  if (remainingBudget <= 0) {
    const err = new Error('Budget exhausted before player API call');
    err.error_code = 'DEADLINE';
    err.status = 504;
    err.stage = 'player';
    err.lang = null;
    err.attempts = [];
    throw err;
  }

  const timeoutMs = Math.min(8000, remainingBudget);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Player API call timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  let data;
  try {
    const resp = await fetchFn(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 13; en_US)',
      },
      body: JSON.stringify({
        context: INNERTUBE_CONTEXT,
        videoId: videoId,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const err = new Error(`Player API returned ${resp.status}: ${text.substring(0, 200)}`);
      err.error_code = `UPSTREAM_${resp.status}`;
      err.status = 502;
      err.stage = 'player';
      err.lang = null;
      err.attempts = [];
      throw err;
    }

    data = await resp.json();
  } catch (err) {
    if (err.status) throw err;
    const isTimeout = err.name === 'AbortError' || Date.now() >= deadline;
    const error = new Error(isTimeout ? 'Player API call timed out' : `Player fetch failed: ${err.message}`);
    error.error_code = isTimeout ? 'DEADLINE' : 'UPSTREAM_NETWORK';
    error.status = isTimeout ? 504 : 502;
    error.stage = 'player';
    error.lang = null;
    error.attempts = [];
    throw error;
  } finally {
    clearTimeout(timer);
  }

  // Check playability - fast-fails immediately if bot wall or unplayable
  const playabilityErr = classifyPlayability(data.playabilityStatus);
  if (playabilityErr) {
    throw playabilityErr;
  }

  const captions = data.captions;
  if (!captions) {
    const err = new Error('No captions data in player response (video may not have subtitles)');
    err.error_code = 'NO_CAPTIONS';
    err.status = 422;
    err.stage = 'player';
    err.lang = null;
    err.attempts = [];
    throw err;
  }

  const tracks = captions.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    const err = new Error('No caption tracks available');
    err.error_code = 'NO_CAPTIONS';
    err.status = 422;
    err.stage = 'player';
    err.lang = null;
    err.attempts = [];
    throw err;
  }

  return { tracks, data };
}

/**
 * Step 2: Fetch transcript from a single track using candidate ladder.
 */
export async function fetchTranscriptFromTrack(track, options = {}) {
  const fetchFn = options.fetch || fetch;
  const deadline = options.deadline || (Date.now() + 10000);
  const attempts = options.attempts || [];

  const candidates = candidateList(track.baseUrl);
  const lang = track.languageCode || null;

  for (const candidate of candidates) {
    const remainingBudget = deadline - Date.now();
    if (remainingBudget <= 0) {
      const err = new Error('Request budget exhausted');
      err.error_code = 'DEADLINE';
      err.status = 504;
      err.stage = 'timedtext';
      err.lang = lang;
      err.attempts = attempts;
      throw err;
    }

    const timeoutMs = Math.min(10000, remainingBudget);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Timedtext candidate timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    let status = 0;
    let byteCount = 0;

    try {
      const resp = await fetchFn(candidate.url, {
        headers: {
          'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 13; en_US)',
        },
        signal: controller.signal,
      });

      status = resp.status;
      const body = await resp.text();
      byteCount = (body || '').length;

      attempts.push({
        url_kind: candidate.url_kind,
        status,
        bytes: byteCount,
      });

      if (resp.ok) {
        // Treat HTTP 200 with empty or whitespace-only body as failure of that candidate
        if (!body || !body.trim()) {
          continue;
        }

        const transcript = parseTranscriptBody(body);
        if (transcript && transcript.length > 0) {
          return {
            transcript,
            length: transcript.length,
            lang,
            attempts,
          };
        }
      }
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || Date.now() >= deadline;
      attempts.push({
        url_kind: candidate.url_kind,
        status: status || 0,
        bytes: byteCount,
      });

      if (isTimeout) {
        const deadlineErr = new Error('Request budget exhausted');
        deadlineErr.error_code = 'DEADLINE';
        deadlineErr.status = 504;
        deadlineErr.stage = 'timedtext';
        deadlineErr.lang = lang;
        deadlineErr.attempts = attempts;
        throw deadlineErr;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw classifyAttemptsError(attempts, lang, true);
}

/**
 * Step 3: Fetch transcript across ranked tracks.
 * Retries the whole flow once if candidate ladder returns entirely empty (UPSTREAM_EMPTY).
 */
export async function getTranscript(videoId, options = {}) {
  const fetchFn = options.fetch || fetch;
  const deadline = options.deadline || (Date.now() + 10000);
  const attempts = options.attempts || [];

  const maxRetries = 1; // at most one retry on all-empty case

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (Date.now() >= deadline) {
      const err = new Error('Request budget exhausted');
      err.error_code = 'DEADLINE';
      err.status = 504;
      err.stage = attempt > 0 ? 'retry' : 'timedtext';
      err.lang = null;
      err.attempts = attempts;
      throw err;
    }

    const { tracks } = await getCaptionTracks(videoId, INNERTUBE_API_KEY, deadline, fetchFn);
    const ranked = rankTracks(tracks);

    if (ranked.length === 0) {
      const err = new Error('No usable caption tracks');
      err.error_code = 'NO_CAPTIONS';
      err.status = 422;
      err.stage = 'player';
      err.lang = null;
      err.attempts = attempts;
      throw err;
    }

    let lastTrackError = null;

    for (const track of ranked) {
      if (Date.now() >= deadline) {
        const err = new Error('Request budget exhausted');
        err.error_code = 'DEADLINE';
        err.status = 504;
        err.stage = 'timedtext';
        err.lang = track.languageCode || null;
        err.attempts = attempts;
        throw err;
      }

      try {
        const result = await fetchTranscriptFromTrack(track, {
          fetch: fetchFn,
          deadline,
          attempts,
        });
        return result;
      } catch (e) {
        lastTrackError = e;
        if (e.error_code === 'DEADLINE') {
          throw e;
        }
      }
    }

    // Only retry the whole flow when candidate ladder came back entirely empty (UPSTREAM_EMPTY)
    const isAllEmpty = lastTrackError?.error_code === 'UPSTREAM_EMPTY';
    if (isAllEmpty && attempt < maxRetries && Date.now() < deadline) {
      continue;
    }

    if (lastTrackError) {
      throw lastTrackError;
    }

    throw classifyAttemptsError(attempts, ranked[0]?.languageCode || null, tracks.length > 0);
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    // Debug endpoint
    if (url.pathname === '/debug') {
      const videoId = url.searchParams.get('v');
      if (!videoId) {
        return new Response(JSON.stringify({ error: 'Need ?v=VIDEO_ID' }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }

      const deadline = Date.now() + 10000;
      try {
        const { tracks } = await getCaptionTracks(videoId, INNERTUBE_API_KEY, deadline, fetch);
        const ranked = rankTracks(tracks);
        const track = ranked[0] || tracks[0];
        const candidates = candidateList(track.baseUrl);

        // Test fetch the verbatim candidate
        const testCandidate = candidates[0];
        const testResp = await fetch(testCandidate.url, {
          headers: { 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 13; en_US)' },
        });
        const testText = await testResp.text().catch(() => '');

        return new Response(JSON.stringify({
          tracksCount: tracks.length,
          rankedTracksCount: ranked.length,
          track: {
            lang: track.languageCode,
            kind: track.kind,
            baseUrlLength: track.baseUrl ? track.baseUrl.length : 0,
          },
          hasExpXpe: (track.baseUrl || '').includes('exp=xpe'),
          hasVariant: (track.baseUrl || '').includes('variant='),
          candidatesCount: candidates.length,
          testFetch: {
            url_kind: testCandidate.url_kind,
            status: testResp.status,
            bytes: testText.length,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      } catch (e) {
        const status = e.status || 500;
        return new Response(JSON.stringify({
          error: e.message,
          error_code: e.error_code || 'UNKNOWN',
          stage: e.stage || 'debug',
          lang: e.lang || null,
          attempts: e.attempts || [],
        }), {
          status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      }
    }

    // Main transcript endpoint
    if (url.pathname !== '/transcript') {
      return new Response(JSON.stringify({ error: 'Use /transcript?v=VIDEO_ID' }), {
        status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }

    const videoId = url.searchParams.get('v');
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return new Response(JSON.stringify({ error: 'Invalid or missing video ID' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }

    const deadline = Date.now() + 10000;

    try {
      const result = await getTranscript(videoId, { deadline, fetch });
      return new Response(JSON.stringify({
        transcript: result.transcript,
        length: result.length,
        lang: result.lang,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    } catch (e) {
      const status = e.status || 422;
      return new Response(JSON.stringify({
        error: e.message || 'Unknown error',
        error_code: e.error_code || (status === 504 ? 'DEADLINE' : (status === 502 ? 'UPSTREAM_ERROR' : 'NO_CAPTIONS')),
        stage: e.stage || 'transcript',
        lang: e.lang || null,
        attempts: e.attempts || [],
      }), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
  },
};
