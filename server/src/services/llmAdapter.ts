import Anthropic from '@anthropic-ai/sdk';
import { callDeepSeek } from './deepseek.js';
import { execute } from '../db/index.js';

// Unified model-agnostic adapter. Given a model ID string, routes the
// call to the right provider and returns a normalised result shape so
// callers don't have to know which provider they're hitting. This is
// the leaf of the LLM dependency graph: llmRouter.ts and llmCompare.ts
// both sit on top of this module, nothing else does.
//
// Adding a new provider (Gemini, Qwen, local LLM, etc):
//   1. Add a `callXxx(messages, opts)` wrapper in services/xxx.ts
//      mirroring services/deepseek.ts.
//   2. Extend the model-prefix branch in callLlmByModel below to route
//      matching model IDs to that wrapper.
//   3. Add pricing to PRICING_PER_1M in routes/admin.ts AND the client-
//      side PRICING map in pages/LlmCompare.tsx.
//   4. Nothing else: every existing call site picks up the new model
//      automatically via LLM_PRIMARY_MODEL_<OP> or LLM_SHADOW_MODEL
//      env vars. No code changes at claude.ts / reviews.ts needed.

// Shared Anthropic client. Same maxRetries=2 setting as claude.ts's
// getClient() — we duplicate the client here rather than import the
// one in claude.ts so this module stays a leaf (claude.ts imports
// from us, not the other way around).
let _anthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 2 });
  return _anthropic;
}

export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface CallOpts {
  operation: string;
  model: string;
  prompt: string;
  maxTokens: number;
  jsonMode?: boolean;
}

// Single entry point. Picks the provider from the model ID and logs
// usage into claude_usage_log regardless of provider, so the admin
// dashboard + rolling-24h budget gate see every call. Throws on
// provider errors — caller decides whether to retry, fall back, or
// surface the error. JSON-mode is honoured on DeepSeek (OpenAI-style
// response_format) and silently ignored on Anthropic (prompt has to
// handle it there).
export async function callLlmByModel(opts: CallOpts): Promise<LlmResult> {
  const { operation, model, prompt, maxTokens, jsonMode } = opts;

  if (model.startsWith('deepseek-')) {
    const t0 = Date.now();
    const ds = await callDeepSeek(
      [{ role: 'user', content: prompt }],
      { maxTokens, jsonMode, model }
    );
    const latencyMs = Date.now() - t0;
    execute(
      `INSERT INTO claude_usage_log
         (operation, model, input_tokens, output_tokens, web_search_count)
       VALUES (?, ?, ?, ?, 0)`,
      [operation, ds.model, ds.inputTokens, ds.outputTokens]
    );
    return {
      text: ds.content,
      model: ds.model,
      inputTokens: ds.inputTokens,
      outputTokens: ds.outputTokens,
      latencyMs,
    };
  }

  // Anthropic fallthrough — claude-haiku-*, claude-sonnet-*, etc.
  const t0 = Date.now();
  const resp = await anthropicClient().messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const latencyMs = Date.now() - t0;
  const block = resp.content.find((b) => b.type === 'text');
  const text = block && block.type === 'text' ? block.text : '';
  execute(
    `INSERT INTO claude_usage_log
       (operation, model, input_tokens, output_tokens, web_search_count)
     VALUES (?, ?, ?, ?, 0)`,
    [
      operation,
      resp.model || model,
      resp.usage?.input_tokens ?? 0,
      resp.usage?.output_tokens ?? 0,
    ]
  );
  return {
    text,
    model: resp.model || model,
    inputTokens: resp.usage?.input_tokens ?? 0,
    outputTokens: resp.usage?.output_tokens ?? 0,
    latencyMs,
  };
}
