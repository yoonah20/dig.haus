import axios from 'axios';
import { getSetting } from '../utils/settings.js';

// Generic OpenAI-compatible chat provider (POST /chat/completions). Most
// providers speak this exact shape — OpenAI, Groq, OpenRouter, Together,
// Mistral, Fireworks, and local llama.cpp / vLLM servers — so one branch
// covers them all instead of a per-provider wrapper. Point it at a
// provider with:
//   - LLM_COMPAT_BASE_URL   (or the app_settings 'llm_compat_base_url'
//                            admin field) — e.g. https://openrouter.ai/api/v1
//   - LLM_COMPAT_API_KEY    (env ONLY — a secret, never stored in the DB or
//                            shown in the admin UI)
// A model routes here when its id carries the `compat:` prefix (see
// llmAdapter); the real model sent upstream is the id minus that prefix,
// e.g. `compat:google/gemini-2.5-flash` → `google/gemini-2.5-flash`.
//
// Mirrors services/deepseek.ts: raw axios, explicit error boundaries, no
// hidden SDK retries. Errors are enriched (HTTP status + body message, and
// finish_reason on an empty body) so the same admin surfacing that helped
// diagnose DeepSeek works here too.

export const COMPAT_BASE_URL_SETTING_KEY = 'llm_compat_base_url';

export function compatBaseUrl(): string | null {
  const env = (process.env.LLM_COMPAT_BASE_URL || '').trim();
  const raw = env || (getSetting(COMPAT_BASE_URL_SETTING_KEY) || '').trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

interface CompatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CompatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface CallOptions {
  model: string;
  maxTokens?: number;
  jsonMode?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

export async function callOpenAiCompat(
  messages: CompatMessage[],
  opts: CallOptions
): Promise<CompatResponse> {
  const baseUrl = compatBaseUrl();
  const apiKey = process.env.LLM_COMPAT_API_KEY;
  if (!baseUrl) {
    throw new Error(
      'LLM compat base URL not configured (set LLM_COMPAT_BASE_URL or the /admin/api base URL)'
    );
  }
  if (!apiKey) {
    throw new Error('LLM_COMPAT_API_KEY not set');
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  let resp;
  try {
    resp = await axios.post(`${baseUrl}/chat/completions`, body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: opts.timeoutMs ?? 30000,
    });
  } catch (err) {
    const ax = err as {
      response?: { status?: number; data?: { error?: { message?: string } | string; message?: string } };
    };
    if (ax?.response) {
      const status = ax.response.status;
      const b = ax.response.data;
      const apiMsg =
        (typeof b?.error === 'object' ? b?.error?.message : b?.error) ||
        b?.message ||
        '';
      throw new Error(`LLM compat API ${status}${apiMsg ? `: ${apiMsg}` : ''}`);
    }
    throw err; // network error / timeout
  }

  const data = resp.data ?? {};
  const choice = data.choices?.[0];
  const content: string | undefined = choice?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    const finish = choice?.finish_reason ?? 'unknown';
    throw new Error(
      `LLM compat (${data.model || opts.model}) returned no content [finish_reason=${finish}]`
    );
  }
  return {
    content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model || opts.model,
  };
}
