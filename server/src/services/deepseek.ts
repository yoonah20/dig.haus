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

export const DEEPSEEK_MODEL = 'deepseek-chat';
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
    model: DEEPSEEK_MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.3,
  };
  // DeepSeek supports OpenAI-style structured output. Keeps the model
  // from wrapping JSON in prose or Markdown code fences.
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const resp = await axios.post(`${DEEPSEEK_BASE_URL}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: opts.timeoutMs ?? 30000,
  });

  const data = resp.data ?? {};
  const content: string | undefined = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('DeepSeek returned no content');
  }
  return {
    content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model || DEEPSEEK_MODEL,
  };
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
