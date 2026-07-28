import axios from 'axios';
import { execute } from '../db/index.js';

// DeepSeek V3 wrapper. OpenAI-compatible /chat/completions endpoint.
// We intentionally don't pull in the `openai` package — our usage is
// a single-function request/response with JSON output, and keeping
// this on raw axios means we own the error boundaries explicitly (no
// surprise SDK retries, no hidden buffering) and add zero bundle
// weight. The OpenAI SDK shape would be identical if we ever want to
// migrate.
//
// Used as the primary LLM for the input-heavy scrape-extraction path
// (Jina markdown → review excerpt + score JSON) where DeepSeek's
// ~73% cheaper input pricing translates directly to cost savings.
// Callers are expected to fallback to Haiku on failure — this module
// surfaces errors via thrown exceptions so the caller can branch
// cleanly.

// DeepSeek retired the `deepseek-chat` alias — the API now rejects it
// (400: supported names are deepseek-v4-pro / deepseek-v4-flash), so the
// code default is the explicit flash id. The admin can switch the blanket
// model at runtime via the app_settings 'llm_primary_model' key
// (/admin/api) without a redeploy; this constant is only the last-resort
// fallback when neither that setting nor an env override is present.
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepSeekResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface CallOptions {
  maxTokens?: number;
  jsonMode?: boolean;
  temperature?: number;
  timeoutMs?: number;
  // API model string. Defaults to the deepseek-chat alias (→ v4-flash).
  // Pass an explicit id (e.g. 'deepseek-v4-pro') to route a single op to
  // a pricier tier via the llm router's per-op env override.
  model?: string;
  // Set false when the CALLER already recovers an empty content body by
  // retrying with different params (e.g. extractJsonWithFallback toggles
  // json_object mode off). Retrying the identical jsonMode=true call
  // inside the wrapper almost never recovers a v4-flash empty (it's a
  // systematic mode quirk, not a transient blip) — it just burns a full
  // second call, and stacked under the caller's own retry it tripled the
  // hot scrape path's latency. Default true keeps the recovery for the
  // callers that have no other fallback (summary, similar, editorial pick).
  retryOnEmpty?: boolean;
}

export function isDeepSeekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

// Minimal raw-call helper. Throws on network errors, non-2xx responses,
// and missing-content responses. Returns parsed content + token usage
// so the caller can log it through the shared claude_usage_log (DeepSeek
// rows land there keyed by model='deepseek-chat' — the admin dashboard
// surfaces them as a separate provider line via PRICING_PER_1M).
export async function callDeepSeek(
  messages: DeepSeekMessage[],
  opts: CallOptions = {}
): Promise<DeepSeekResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not set');
  }

  const body: Record<string, unknown> = {
    model: opts.model ?? DEEPSEEK_MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.3,
  };
  // DeepSeek supports OpenAI-style structured output. Keeps the model
  // from wrapping JSON in prose or Markdown code fences.
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  let resp;
  try {
    resp = await axios.post(`${DEEPSEEK_BASE_URL}/chat/completions`, body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: opts.timeoutMs ?? 30000,
    });
  } catch (err) {
    // Surface the real reason instead of the opaque "Request failed with
    // status code 4xx". DeepSeek returns the cause in the JSON body
    // (e.g. 402 Insufficient Balance, 401 auth, 400/404 unknown model) —
    // without it these all look identical downstream ("검색 결과 없음"),
    // which is exactly why an account/key/model problem is hard to spot.
    // The .response is preserved so retry logic can still gate on status.
    const ax = err as {
      response?: { status?: number; data?: { error?: { message?: string } | string; message?: string } };
    };
    if (ax?.response) {
      const status = ax.response.status;
      const body = ax.response.data;
      const apiMsg =
        (typeof body?.error === 'object' ? body?.error?.message : body?.error) ||
        body?.message ||
        '';
      const e = new Error(
        `DeepSeek API ${status}${apiMsg ? `: ${apiMsg}` : ''}`
      ) as Error & { response?: unknown };
      e.response = ax.response;
      throw e;
    }
    throw err; // network error / timeout — no response body to enrich
  }

  const data = resp.data ?? {};
  const choice = data.choices?.[0];
  const content: string | undefined = choice?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    // Keep the "returned no content" substring (the retry gate matches on
    // it) but carry the diagnostics that actually explain WHY: which model
    // answered, the finish_reason (length = truncated / reasoning ate the
    // budget; content_filter = blocked; stop = model chose to say nothing),
    // and whether a reasoning_content block is present (a hint the model
    // is running in a thinking mode that starved the content field).
    const usedModel = data.model || opts.model || DEEPSEEK_MODEL;
    const finish = choice?.finish_reason ?? 'unknown';
    const hasReasoning = !!choice?.message?.reasoning_content;
    throw new Error(
      `DeepSeek (${usedModel}) returned no content [finish_reason=${finish}${hasReasoning ? ', reasoning_content present' : ''}]`
    );
  }
  return {
    content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model || DEEPSEEK_MODEL,
  };
}

// Bounded retry around callDeepSeek for the FAST transient failure modes:
// an empty content body (DeepSeek intermittently answers with
// choices[0].message.content === '' and callDeepSeek throws "no content"),
// a 5xx, or a connection-level network error. All of those fail quickly,
// so one retry costs little.
//
// Timeouts (ECONNABORTED) are deliberately NOT retried: the request
// already burned the full ~30s budget, and retrying would triple the
// latency of an already-slow scrape — enough to push a single add-url
// past the upstream (Cloudflare/Railway) request timeout and turn a slow
// page into a hard failure. That regression is exactly why curation felt
// far slower and dropped reviews after the retry landed. A 4xx is never
// retried either — a bad request / auth / unknown-model error won't fix
// itself on a repeat.
//
// Kept as an explicit opt-in wrapper so callDeepSeek stays the raw single-
// shot call described in the module header. Throws the last error on
// exhaustion, so existing caller try/catch and logging keep working.
const DEEPSEEK_RETRY_ATTEMPTS = 2;

function isTransientDeepSeekError(err: unknown): boolean {
  const e = err as {
    code?: string;
    message?: string;
    response?: { status?: number };
  };
  // Timeout — already cost the full budget; a retry only compounds it.
  if (e?.code === 'ECONNABORTED') return false;
  if (e?.message?.includes('returned no content')) return true;
  if (e?.response?.status != null) return e.response.status >= 500;
  // No response object and not a timeout → connection reset/refused → retry.
  return true;
}

export async function callDeepSeekWithRetry(
  messages: DeepSeekMessage[],
  opts: CallOptions = {}
): Promise<DeepSeekResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < DEEPSEEK_RETRY_ATTEMPTS; attempt++) {
    try {
      return await callDeepSeek(messages, opts);
    } catch (err) {
      lastErr = err;
      const emptyContent = !!(err as Error)?.message?.includes('returned no content');
      const transient =
        isTransientDeepSeekError(err) &&
        !(emptyContent && opts.retryOnEmpty === false);
      console.warn(
        `[deepseek] ${opts.model ?? DEEPSEEK_MODEL} attempt ${attempt + 1}/${DEEPSEEK_RETRY_ATTEMPTS} failed${transient ? '' : ' (non-retryable)'}:`,
        (err as Error).message
      );
      if (!transient || attempt === DEEPSEEK_RETRY_ATTEMPTS - 1) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Mirrors logClaudeUsage shape — same table, different provider. The
// admin dashboard + rolling-24h budget gate both already read from
// claude_usage_log keyed by model, so a deepseek-chat row shows up
// naturally alongside Haiku and Sonnet entries.
export function logDeepSeekUsage(
  operation: string,
  response: DeepSeekResponse
): void {
  try {
    execute(
      `INSERT INTO claude_usage_log
         (operation, model, input_tokens, output_tokens, web_search_count)
       VALUES (?, ?, ?, ?, 0)`,
      [operation, response.model, response.inputTokens, response.outputTokens]
    );
  } catch (err) {
    console.warn(`[deepseek-usage] log failed (${operation}):`, (err as Error).message);
  }
}
