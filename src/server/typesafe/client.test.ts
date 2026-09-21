/**
 * client.ts — the TypeSafe System One HTTP client.
 *
 * `fetch` is injected in every test here, so nothing in this file touches the
 * network or needs a real API key. The assertions worth having are about the
 * boundary: what goes out on the wire, and what happens to responses that are
 * not the happy path — because everything downstream treats a parse failure as
 * "use the heuristic", and that only works if a parse failure actually throws.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  TYPESAFE_ENDPOINT,
  TYPESAFE_MODEL,
  TypeSafeNotConfiguredError,
  TypeSafeRequestError,
  createTypeSafeClient,
  requireChoice,
  type Question,
} from './client';

const QUESTION: Question = {
  type: 'choice',
  instructions: 'pick one',
  criteria: { a: 'first', b: 'second' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const GOOD_BODY = {
  model: 'jev-1.13.0',
  answers: {
    q: { type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 }, confidence: 0.77 },
  },
};

describe('createTypeSafeClient', () => {
  it('reports itself unconfigured and refuses to call without an API key', async () => {
    const fetchImpl = vi.fn();
    const client = createTypeSafeClient({ apiKey: '', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(client.configured).toBe(false);
    await expect(client.ask('state', { q: QUESTION })).rejects.toBeInstanceOf(
      TypeSafeNotConfiguredError,
    );
    // The point of failing here is that no request is made at all.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only key as absent', () => {
    expect(createTypeSafeClient({ apiKey: '   ' }).configured).toBe(false);
  });

  it('posts the documented request shape with bearer auth', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(GOOD_BODY));
    const client = createTypeSafeClient({
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.ask({ board: 'state' }, { q: QUESTION });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TYPESAFE_ENDPOINT);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe(TYPESAFE_MODEL);
    expect(body.state).toEqual({ board: 'state' });
    expect(body.questions).toEqual({ q: QUESTION });
  });

  it('parses a choice answer including probabilities and confidence', async () => {
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () => jsonResponse(GOOD_BODY)) as unknown as typeof fetch,
    });

    const response = await client.ask('s', { q: QUESTION });
    const answer = requireChoice(response, 'q');
    expect(answer.choice).toBe('b');
    expect(answer.probabilities).toEqual({ a: 0.2, b: 0.8 });
    expect(answer.confidence).toBeCloseTo(0.77);
  });

  it('clamps out-of-range probabilities rather than passing them on', async () => {
    const body = {
      answers: {
        q: { type: 'choice', choice: 'a', probabilities: { a: 1.4, b: -0.2 }, confidence: 2 },
      },
    };
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () => jsonResponse(body)) as unknown as typeof fetch,
    });

    const answer = requireChoice(await client.ask('s', { q: QUESTION }), 'q');
    expect(answer.probabilities).toEqual({ a: 1, b: 0 });
    expect(answer.confidence).toBe(1);
  });

  it('falls back to the winning probability when confidence is missing', async () => {
    const body = { answers: { q: { type: 'choice', choice: 'b', probabilities: { b: 0.6 } } } };
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () => jsonResponse(body)) as unknown as typeof fetch,
    });

    expect(requireChoice(await client.ask('s', { q: QUESTION }), 'q').confidence).toBeCloseTo(0.6);
  });

  it('parses a noul answer', async () => {
    const body = { answers: { q: { type: 'noul', noul: 0.91 } } };
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () => jsonResponse(body)) as unknown as typeof fetch,
    });

    expect((await client.ask('s', { q: QUESTION })).answers.q).toEqual({
      type: 'noul',
      noul: 0.91,
    });
  });

  it('raises a request error on a non-2xx status, carrying the code', async () => {
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () => jsonResponse({ error: 'nope' }, 429)) as unknown as typeof fetch,
    });

    await expect(client.ask('s', { q: QUESTION })).rejects.toMatchObject({
      name: 'TypeSafeRequestError',
      status: 429,
    });
  });

  it('raises a request error when the transport fails', async () => {
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });

    const error = await client.ask('s', { q: QUESTION }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeSafeRequestError);
    // The underlying error is never re-thrown: it can carry the request headers.
    expect((error as Error).message).not.toContain('ECONNREFUSED');
  });

  it('aborts and reports a timeout rather than hanging', async () => {
    const client = createTypeSafeClient({
      apiKey: 'k',
      timeoutMs: 10,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abort = new Error('aborted');
            abort.name = 'AbortError';
            reject(abort);
          });
        })) as unknown as typeof fetch,
    });

    await expect(client.ask('s', { q: QUESTION })).rejects.toThrow(/did not answer within 10ms/);
  });

  it('rejects a body that is not JSON', async () => {
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch,
    });

    await expect(client.ask('s', { q: QUESTION })).rejects.toThrow(/not JSON/);
  });

  it('rejects a body with no answers map', async () => {
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () => jsonResponse({ model: 'x' })) as unknown as typeof fetch,
    });

    await expect(client.ask('s', { q: QUESTION })).rejects.toThrow(/no answers/);
  });

  it('drops a malformed answer instead of surfacing a broken one', async () => {
    const body = {
      answers: {
        good: { type: 'choice', choice: 'a', probabilities: { a: 1 }, confidence: 1 },
        bad: { type: 'choice', probabilities: 'not a map' },
        alsoBad: { type: 'noul', noul: 'high' },
      },
    };
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () => jsonResponse(body)) as unknown as typeof fetch,
    });

    const response = await client.ask('s', { q: QUESTION });
    expect(Object.keys(response.answers)).toEqual(['good']);
    expect(() => requireChoice(response, 'bad')).toThrow(/did not answer/);
  });

  it('refuses to read a noul as a choice', async () => {
    const client = createTypeSafeClient({
      apiKey: 'k',
      fetchImpl: (async () =>
        jsonResponse({ answers: { q: { type: 'noul', noul: 0.5 } } })) as unknown as typeof fetch,
    });

    const response = await client.ask('s', { q: QUESTION });
    expect(() => requireChoice(response, 'q')).toThrow(/not a choice/);
  });
});
