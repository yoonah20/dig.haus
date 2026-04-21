import { callLlmByModel, type LlmResult } from './llmAdapter.js';
import { fireShadowComparison } from './llmCompare.js';

// The single entry point that claude.ts / reviews.ts / routes call
// when they want an LLM response. Two responsibilities:
//   1. Resolve which primary model to use based on env overrides
//      (defaults to the caller's suggested model).
//   2. Automatically fire a shadow comparison (fire-and-forget) if
//      shadow is configured.
//
// Env model selection knobs:
//   LLM_PRIMARY_MODEL                  # blanket default for ALL ops
//   LLM_PRIMARY_MODEL_<OP>=<model|default>
//                                       # per-op override. 'default'
//                                       # sentinel falls back to the
//                                       # default even if the blanket
//                                       # override is set.
//   LLM_SHADOW_MODEL                   # blanket shadow for ALL ops
//   LLM_SHADOW_MODEL_<OP>=<model|off>
//                                       # per-op override. 'off' disables
//                                       # shadow for that op even if the
//                                       # blanket shadow is set.
//   LLM_COMPARE=1                       # backward-compat alias for
//                                       # LLM_SHADOW_MODEL=deepseek-chat
//
// <OP> is the operation string uppercased (pronunciation →
// PRONUNCIATION). Dots/dashes in op names are not supported — keep
// operation IDs alphanumeric + underscore.

function opEnvKey(kind: 'PRIMARY' | 'SHADOW', op: string): string {
  return `LLM_${kind}_MODEL_${op.toUpperCase()}`;
}

export function resolvePrimaryModel(
  operation: string,
  defaultModel: string
): string {
  const perOp = process.env[opEnvKey('PRIMARY', operation)];
  if (perOp && perOp !== 'default') return perOp;
  if (perOp === 'default') return defaultModel;
  const global = process.env.LLM_PRIMARY_MODEL;
  if (global) return global;
  return defaultModel;
}

export interface InvokeLlmOpts {
  operation: string;
  prompt: string;
  maxTokens: number;
  defaultModel: string;
  jsonMode?: boolean;
  albumMbid?: string | null;
  albumTitle?: string | null;
}

// One-call-does-it-all wrapper. Use this instead of hand-rolling an
// Anthropic SDK call at the site — it gives you env-driven model
// flipping + shadow comparison + automatic fallback for free, and
// the return shape is provider-agnostic so caller code doesn't need
// to know whether it just talked to Claude or DeepSeek.
//
// Fallback behaviour: when an env override pushes primary to a
// non-default model (e.g. LLM_PRIMARY_MODEL=deepseek-chat) and the
// primary call fails (network error, 429, timeout), we retry ONCE
// with the caller's built-in defaultModel. This means the code-level
// defaults act as a safety net — admin can flip everything to
// DeepSeek via env and know that a DeepSeek outage gracefully
// degrades to Haiku/Sonnet rather than surfacing errors to users.
// Set LLM_FALLBACK=off to disable the retry (for debugging which
// provider is actually failing).
export async function invokeLlm(opts: InvokeLlmOpts): Promise<LlmResult> {
  const primaryModel = resolvePrimaryModel(opts.operation, opts.defaultModel);
  let result: LlmResult;
  try {
    result = await callLlmByModel({
      operation: opts.operation,
      model: primaryModel,
      prompt: opts.prompt,
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
    });
  } catch (err) {
    const fallbackDisabled = process.env.LLM_FALLBACK === 'off';
    const canFallback =
      !fallbackDisabled && primaryModel !== opts.defaultModel;
    if (!canFallback) throw err;
    console.warn(
      `[llm-router] primary ${primaryModel} failed for ${opts.operation}, retrying with default ${opts.defaultModel}: ${(err as Error).message}`
    );
    result = await callLlmByModel({
      operation: `${opts.operation}__fallback`,
      model: opts.defaultModel,
      prompt: opts.prompt,
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
    });
  }

  // Detached shadow — doesn't block the caller. Internally resolves
  // LLM_SHADOW_MODEL / LLM_SHADOW_MODEL_<OP> / LLM_COMPARE; if nothing
  // is set, this is a no-op.
  fireShadowComparison({
    operation: opts.operation,
    prompt: opts.prompt,
    maxTokens: opts.maxTokens,
    jsonMode: opts.jsonMode,
    albumMbid: opts.albumMbid,
    albumTitle: opts.albumTitle,
    primaryModel: result.model,
    primaryOutput: result.text,
    primaryInputTokens: result.inputTokens,
    primaryOutputTokens: result.outputTokens,
    primaryLatencyMs: result.latencyMs,
  });

  return result;
}

// Introspection for /admin/compare and anywhere else that needs to
// display the currently-active routing without reading env directly.
// Operations passed in are the known call-site IDs; the function
// reports primary (resolved), shadow (or null), and whether the
// shadow is a no-op because it equals primary.
export interface OperationRoute {
  operation: string;
  defaultModel: string;
  primaryModel: string;
  shadowModel: string | null;
  shadowIsNoop: boolean;
}

export function describeOperationRoutes(
  ops: Array<{ operation: string; defaultModel: string }>
): OperationRoute[] {
  return ops.map(({ operation, defaultModel }) => {
    const primary = resolvePrimaryModel(operation, defaultModel);
    const shadow = resolveShadowModel(operation);
    return {
      operation,
      defaultModel,
      primaryModel: primary,
      shadowModel: shadow,
      shadowIsNoop: shadow !== null && shadow === primary,
    };
  });
}

// Re-exported from llmCompare via this module so admin routes / client
// never need to import llmCompare directly.
import { resolveShadowModel } from './llmCompare.js';
export { resolveShadowModel };
