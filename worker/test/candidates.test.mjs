import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateUrls,
  candidateList,
  rankTracks,
  parseTranscriptBody,
  fetchTranscriptFromTrack,
  classifyAttemptsError,
} from '../src/index.js';

describe('Candidate URLs', () => {
  test('returns candidates in exact expected order for full URL', () => {
    const base = 'https://www.youtube.com/api/timedtext?v=test1234567&variant=gemini&exp=xpe';
    const urls = candidateUrls(base);

    assert.deepStrictEqual(urls, [
      'https://www.youtube.com/api/timedtext?v=test1234567&variant=gemini&exp=xpe',
      'https://www.youtube.com/api/timedtext?v=test1234567&variant=gemini&exp=xpe&fmt=json3',
      'https://www.youtube.com/api/timedtext?v=test1234567&exp=xpe',
      'https://www.youtube.com/api/timedtext?v=test1234567&exp=xpe&fmt=json3',
      'https://www.youtube.com/api/timedtext?v=test1234567&variant=gemini',
    ]);
  });

  test('deduplicates candidates when variant or exp is not present', () => {
    // Only exp present (no variant): variant-stripped duplicates verbatim
    const withExpOnly = 'https://www.youtube.com/api/timedtext?v=test1234567&exp=xpe';
    const expUrls = candidateUrls(withExpOnly);

    assert.deepStrictEqual(expUrls, [
      'https://www.youtube.com/api/timedtext?v=test1234567&exp=xpe',
      'https://www.youtube.com/api/timedtext?v=test1234567&exp=xpe&fmt=json3',
      'https://www.youtube.com/api/timedtext?v=test1234567',
    ]);

    // Neither variant nor exp present: only verbatim and json3
    const plain = 'https://www.youtube.com/api/timedtext?v=test1234567';
    const plainUrls = candidateUrls(plain);

    assert.deepStrictEqual(plainUrls, [
      'https://www.youtube.com/api/timedtext?v=test1234567',
      'https://www.youtube.com/api/timedtext?v=test1234567&fmt=json3',
    ]);
  });

  test('normalizes HTML entities in baseUrl', () => {
    const htmlEscaped = 'https://www.youtube.com/api/timedtext?v=test1234567&amp;exp=xpe';
    const urls = candidateUrls(htmlEscaped);
    assert.ok(!urls[0].includes('&amp;'));
    assert.ok(urls[0].includes('&exp=xpe'));
  });

  test('handles empty or missing baseUrl safely', () => {
    assert.deepStrictEqual(candidateUrls(''), []);
    assert.deepStrictEqual(candidateUrls(null), []);
    assert.deepStrictEqual(candidateUrls(undefined), []);
  });
});

describe('classifyAttemptsError', () => {
  test('all-200-empty case yields NO_CAPTIONS (422)', () => {
    const attempts = [
      { url_kind: 'verbatim', status: 200, bytes: 0 },
      { url_kind: 'verbatim+fmt=json3', status: 200, bytes: 0 },
    ];
    const err = classifyAttemptsError(attempts, 'en');
    assert.equal(err.status, 422);
    assert.equal(err.error_code, 'NO_CAPTIONS');
    assert.equal(err.stage, 'timedtext');
    assert.equal(err.lang, 'en');
  });

  test('all-404 case yields UPSTREAM_404 (502) using first status', () => {
    const attempts = [
      { url_kind: 'verbatim', status: 404, bytes: 50 },
      { url_kind: 'verbatim+fmt=json3', status: 404, bytes: 50 },
    ];
    const err = classifyAttemptsError(attempts, 'en');
    assert.equal(err.status, 502);
    assert.equal(err.error_code, 'UPSTREAM_404');
    assert.equal(err.stage, 'timedtext');
    assert.equal(err.lang, 'en');
  });

  test('mixed 200-empty and 404 yields NO_CAPTIONS (422) instead of UPSTREAM_404', () => {
    // Crucial test: candidate 1 returns 200 empty, last candidate returns 404
    const attempts = [
      { url_kind: 'verbatim', status: 200, bytes: 0 },
      { url_kind: 'exp-stripped', status: 404, bytes: 15 },
    ];
    const err = classifyAttemptsError(attempts, 'en');
    assert.equal(err.status, 422);
    assert.equal(err.error_code, 'NO_CAPTIONS');
  });

  test('mixed status-0 and 404 yields UPSTREAM_NETWORK (502)', () => {
    // Transient network failure (status 0) mixed with 404s must be retryable
    const attempts = [
      { url_kind: 'verbatim', status: 0, bytes: 0 },
      { url_kind: 'exp-stripped', status: 404, bytes: 15 },
    ];
    const err = classifyAttemptsError(attempts, 'en');
    assert.equal(err.status, 502);
    assert.equal(err.error_code, 'UPSTREAM_NETWORK');
    assert.equal(err.stage, 'timedtext');
    assert.equal(err.lang, 'en');
  });
});

describe('fetchTranscriptFromTrack', () => {
  test('falls through 200 with empty body or whitespace to next candidate', async () => {
    const track = {
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test1234567&variant=gemini',
      languageCode: 'en',
    };

    const callLog = [];
    const mockFetch = async (url) => {
      callLog.push(url);
      // First attempt (verbatim) returns 200 with empty body (the real-world bug)
      if (callLog.length === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => '',
        };
      }
      // Second attempt (verbatim + json3) returns 200 with whitespace only
      if (callLog.length === 2) {
        return {
          ok: true,
          status: 200,
          text: async () => '   \n  \t ',
        };
      }
      // Third attempt returns valid srv3 XML
      return {
        ok: true,
        status: 200,
        text: async () => '<p><s>Hello</s> <s>world</s></p>',
      };
    };

    const result = await fetchTranscriptFromTrack(track, {
      fetch: mockFetch,
      deadline: Date.now() + 10000,
    });

    assert.equal(result.transcript, 'Hello world');
    assert.equal(result.lang, 'en');
    assert.equal(callLog.length, 3);
    assert.equal(result.attempts.length, 3);
    assert.equal(result.attempts[0].bytes, 0);
    assert.equal(result.attempts[0].status, 200);
    assert.equal(result.attempts[1].bytes, 8);
    assert.equal(result.attempts[1].status, 200);
    assert.ok(result.attempts[2].bytes > 0);
  });

  test('throws structured error 422 NO_CAPTIONS when all candidates return empty body', async () => {
    const track = {
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test1234567',
      languageCode: 'en',
    };

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '',
    });

    await assert.rejects(
      async () => {
        await fetchTranscriptFromTrack(track, {
          fetch: mockFetch,
          deadline: Date.now() + 10000,
        });
      },
      (err) => {
        assert.equal(err.status, 422);
        assert.equal(err.error_code, 'NO_CAPTIONS');
        assert.equal(err.stage, 'timedtext');
        assert.equal(err.lang, 'en');
        assert.ok(Array.isArray(err.attempts));
        assert.ok(err.attempts.length > 0);
        return true;
      }
    );
  });

  test('throws structured error 502 UPSTREAM_404 when all candidates return 404', async () => {
    const track = {
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test1234567',
      languageCode: 'en',
    };

    const mockFetch = async () => ({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await assert.rejects(
      async () => {
        await fetchTranscriptFromTrack(track, {
          fetch: mockFetch,
          deadline: Date.now() + 10000,
        });
      },
      (err) => {
        assert.equal(err.status, 502);
        assert.equal(err.error_code, 'UPSTREAM_404');
        assert.equal(err.stage, 'timedtext');
        return true;
      }
    );
  });
});

describe('rankTracks', () => {
  test('ranks manual en > en-* manual > ASR en > any en* > tracks[0]', () => {
    const tracks = [
      { languageCode: 'bn', kind: 'asr', baseUrl: 'http://bn' },
      { languageCode: 'en-US', kind: 'standard', baseUrl: 'http://en-us-manual' },
      { languageCode: 'en', kind: 'asr', baseUrl: 'http://en-asr' },
      { languageCode: 'en', kind: 'standard', baseUrl: 'http://en-manual' },
      { languageCode: 'en-GB', kind: 'asr', baseUrl: 'http://en-gb-asr' },
    ];

    const ranked = rankTracks(tracks);
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].baseUrl, 'http://en-manual');       // 1. manual en
    assert.equal(ranked[1].baseUrl, 'http://en-us-manual');   // 2. en-* manual
    assert.equal(ranked[2].baseUrl, 'http://en-asr');         // 3. ASR en
  });
});

describe('parseTranscriptBody', () => {
  test('parses json3 format correctly', () => {
    const json3 = JSON.stringify({
      events: [
        { segs: [{ utf8: 'Hello ' }, { utf8: 'everyone' }] },
        { segs: [{ utf8: 'stocks' }] },
      ],
    });
    assert.equal(parseTranscriptBody(json3), 'Hello everyone stocks');
  });

  test('parses srv3 XML format correctly', () => {
    const srv3 = '<timedtext><p><s>Welcome</s> <s>back</s></p></timedtext>';
    assert.equal(parseTranscriptBody(srv3), 'Welcome back');
  });

  test('parses classic text tag XML format correctly', () => {
    const classic = '<transcript><text>Line 1</text><text>Line 2</text></transcript>';
    assert.equal(parseTranscriptBody(classic), 'Line 1 Line 2');
  });

  test('returns null for empty or invalid transcript', () => {
    assert.equal(parseTranscriptBody(''), null);
    assert.equal(parseTranscriptBody('   \n  '), null);
    assert.equal(parseTranscriptBody('<timedtext></timedtext>'), null);
  });
});
