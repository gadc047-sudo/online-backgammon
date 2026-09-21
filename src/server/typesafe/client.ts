/**
 * Minimal server-side client for the TypeSafe System One HTTP API.
 *
 * Deliberately `fetch` over the published SDK: the server compiles to
 * CommonJS (`tsconfig.server.json`) and Node 20+ already ships `fetch`, so a
 * hand-rolled client is one less dependency and no ESM/CJS interop risk. The
 * request shape is the documented one — POST /v1/systemone with `model`,
 * `state` and a map of `questions` — so swapping in the SDK later is a change
 * local to this file.
 *
 * The API key never leaves this module: it is read from the environment, put
 * on one Authorization header, and is never logged, snapshotted or sent to a
 * client. Responses come off the network, so every field is validated before
 * it is handed on rather than trusted for its declared type.
 */

export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_MODEL = 'jev-latest';
/** Long enough for a normal call, short enough that a hung API never stalls a turn. */
export const TYPESAFE_TIMEOUT_MS = 12_000;
export const TYPESAFE_API_KEY_ENV = 'TYPESAFE_API_KEY';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ChoiceQuestion {
  readonly type: 'choice';
  readonly instructions: JsonValue;
  /** Option key -> description. At most 255 options per the API. */
  readonly criteria: { readonly [option: string]: JsonValue };
}

export interface NoulQuestion {
  readonly type: 'noul';
  readonly instructions: JsonValue;
  readonly criteria?: { readonly true: JsonValue; readonly false: JsonValue };
}

export type Question = ChoiceQuestion | NoulQuestion;

export interface ChoiceAnswer {
  readonly type: 'choice';
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  /** 0-1, how concentrated the distribution is on the winning option. */
  readonly confidence: number;
}

export interface NoulAnswer {
  readonly type: 'noul';
  /** Probability that the answer is yes. A Noul has no separate confidence. */
  readonly noul: number;
}

export interface SystemOneResponse {
  readonly model: string;
  readonly answers: Readonly<Record<string, ChoiceAnswer | NoulAnswer>>;
}

/** The server has no API key. Distinct from a failed call: it can never succeed. */
export class TypeSafeNotConfiguredError extends Error {
  constructor(
    message = `Jev is not configured on this server. Set ${TYPESAFE_API_KEY_ENV} and restart.`,
  ) {
    super(message);
    this.name = 'TypeSafeNotConfiguredError';
  }
}

/** A call was attempted and failed: transport, timeout, HTTP status or bad shape. */
export class TypeSafeRequestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TypeSafeRequestError';
    this.status = status;
  }
}

export interface TypeSafeClient {
  /** False when no API key is present. Check before offering a Jev-backed feature. */
  readonly configured: boolean;
  ask(state: JsonValue, questions: Readonly<Record<string, Question>>): Promise<SystemOneResponse>;
}

export interface TypeSafeClientOptions {
  /** Defaults to process.env.TYPESAFE_API_KEY. */
  readonly apiKey?: string | undefined;
  readonly endpoint?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  /** Injected in tests so no test ever touches the network. */
  readonly fetchImpl?: typeof fetch;
}

export function createTypeSafeClient(options: TypeSafeClientOptions = {}): TypeSafeClient {
  const apiKey = (options.apiKey ?? process.env[TYPESAFE_API_KEY_ENV] ?? '').trim();
  const endpoint = options.endpoint ?? TYPESAFE_ENDPOINT;
  const model = options.model ?? TYPESAFE_MODEL;
  const timeoutMs = options.timeoutMs ?? TYPESAFE_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  async function ask(
    state: JsonValue,
    questions: Readonly<Record<string, Question>>,
  ): Promise<SystemOneResponse> {
    if (apiKey.length === 0) throw new TypeSafeNotConfiguredError();
    if (typeof doFetch !== 'function') {
      throw new TypeSafeRequestError('No fetch implementation available (Node 20+ required).');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, state, questions }),
        signal: controller.signal,
      });
    } catch (error) {
      // AbortError is the timeout; anything else is a transport failure. The
      // raw error is never re-thrown — it can carry the request headers.
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new TypeSafeRequestError(
        timedOut ? `TypeSafe did not answer within ${timeoutMs}ms.` : 'Could not reach TypeSafe.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new TypeSafeRequestError(`TypeSafe returned HTTP ${response.status}.`, response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TypeSafeRequestError('TypeSafe returned a body that was not JSON.');
    }

    return parseResponse(body);
  }

  return { configured: apiKey.length > 0, ask };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Network data, so shape is checked rather than asserted. An answer that does
 * not parse is dropped instead of poisoning a decision with NaN.
 */
function parseResponse(body: unknown): SystemOneResponse {
  if (!isRecord(body)) throw new TypeSafeRequestError('TypeSafe response was not an object.');
  const rawAnswers = body.answers;
  if (!isRecord(rawAnswers)) throw new TypeSafeRequestError('TypeSafe response had no answers.');

  const answers: Record<string, ChoiceAnswer | NoulAnswer> = {};
  for (const [id, raw] of Object.entries(rawAnswers)) {
    const parsed = parseAnswer(raw);
    if (parsed) answers[id] = parsed;
  }

  return { model: typeof body.model === 'string' ? body.model : TYPESAFE_MODEL, answers };
}

function parseAnswer(raw: unknown): ChoiceAnswer | NoulAnswer | null {
  if (!isRecord(raw)) return null;

  if (raw.type === 'noul') {
    return typeof raw.noul === 'number' && Number.isFinite(raw.noul)
      ? { type: 'noul', noul: clamp01(raw.noul) }
      : null;
  }

  if (raw.type === 'choice') {
    if (typeof raw.choice !== 'string' || raw.choice.length === 0) return null;
    const probabilities: Record<string, number> = {};
    if (isRecord(raw.probabilities)) {
      for (const [option, value] of Object.entries(raw.probabilities)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          probabilities[option] = clamp01(value);
        }
      }
    }
    const confidence =
      typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
        ? clamp01(raw.confidence)
        : (probabilities[raw.choice] ?? 0);
    return { type: 'choice', choice: raw.choice, probabilities, confidence };
  }

  return null;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Narrows an answer to a Choice, failing loudly rather than silently guessing. */
export function requireChoice(response: SystemOneResponse, id: string): ChoiceAnswer {
  const answer = response.answers[id];
  if (!answer) throw new TypeSafeRequestError(`TypeSafe did not answer "${id}".`);
  if (answer.type !== 'choice') {
    throw new TypeSafeRequestError(`TypeSafe answered "${id}" with a ${answer.type}, not a choice.`);
  }
  return answer;
}
