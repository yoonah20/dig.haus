import { execute } from '../db/index.js';
import { callLlmByModel } from './llmAdapter.js';

// Shadow-comparison log writer. Controlled by env:
//
//   LLM_SHADOW_MODEL=<model>              global default shadow
//   LLM_SHADOW_MODEL_<OP>=<model|off>     per-op override
//   LLM_COMPARE=1                         backward-compat shortcut for
//                                          LLM_SHADOW_MODEL=deepseek-chat
//
// When a shadow model resolves, every invokeLlm() call fires a
// background call to the shadow model with the SAME prompt and writes
// both responses to llm_comparison_log. The /admin/compare page shows
// them side-by-side so we can judge output quality + cost before
// committing to a provider / model swap.
//
// Shadow is always fire-and-forget: it never blocks the primary
// response, and its errors are caught into a shadow_error column so
// a DeepSeek outage during comparison testing can't break production.
export function resolveShadowModel(operation: string): string | null {
  const perOp = process.env[`LLM_SHADOW_MODEL_${operation.toUpperCase()}`];
  if (perOp === 'off') return null;
  if (perOp) return perOp;
  const global = process.env.LLM_SHADOW_MODEL;
  if (global === 'off') return null;
  if (global) return global;
  // Backward compat — pre-refactor the only option was DeepSeek via
  // a binary flag. Keep that working so existing env setups don't
  // silently stop logging.
  if (process.env.LLM_COMPARE === '1') return 'deepseek-chat';
  return null;
}

export interface CompareContext {
  operation: string;
  prompt: string;
  maxTokens: number;
  jsonMode?: boolean;
  albumMbid?: string | null;
  albumTitle?: string | null;
  primaryModel: string;
  primaryOutput: string;
  primaryInputTokens: number;
  primaryOutputTokens: number;
  primaryLatencyMs: number;
}

export function fireShadowComparison(ctx: CompareContext): void {
  const shadowModel = resolveShadowModel(ctx.operation);
  if (!shadowModel) return;
  // If the shadow model resolves to the same model as primary (e.g.
  // an admin set both LLM_PRIMARY_MODEL_FOO and LLM_SHADOW_MODEL to
  // the same value), skip — comparing against itself is wasted
  // tokens and clutters the log with identical rows.
  if (shadowModel === ctx.primaryModel) return;

  // Detached execution. Runs in the background; primary call has
  // already returned by the time any of this settles.
  void (async () => {
    let shadowModelEchoed = shadowModel;
    let shadowOutput = '';
    let shadowInputTokens = 0;
    let shadowOutputTokens = 0;
    let shadowLatencyMs = 0;
    let shadowError: string | null = null;
    try {
      // Operation tag is suffixed with __shadow so API-console usage
      // rows are clearly labelled as comparison calls, not regular
      // production calls — same cost tracking, but filterable.
      const res = await callLlmByModel({
        operation: `${ctx.operation}__shadow`,
        model: shadowModel,
        prompt: ctx.prompt,
        maxTokens: ctx.maxTokens,
        jsonMode: ctx.jsonMode,
      });
      shadowModelEchoed = res.model;
      shadowOutput = res.text;
      shadowInputTokens = res.inputTokens;
      shadowOutputTokens = res.outputTokens;
      shadowLatencyMs = res.latencyMs;
    } catch (err) {
      shadowError = (err as Error).message;
    }

    try {
      execute(
        `INSERT INTO llm_comparison_log
           (operation, album_mbid, album_title, prompt_preview,
            primary_model, primary_output, primary_input_tokens, primary_output_tokens, primary_latency_ms,
            shadow_model, shadow_output, shadow_input_tokens, shadow_output_tokens, shadow_latency_ms, shadow_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.operation,
          ctx.albumMbid ?? null,
          ctx.albumTitle ?? null,
          ctx.prompt.slice(0, 500),
          ctx.primaryModel,
          ctx.primaryOutput,
          ctx.primaryInputTokens,
          ctx.primaryOutputTokens,
          ctx.primaryLatencyMs,
          shadowModelEchoed,
          shadowOutput,
          shadowInputTokens,
          shadowOutputTokens,
          shadowLatencyMs,
          shadowError,
        ]
      );
    } catch (err) {
      console.warn(
        `[llm-compare] insert failed for ${ctx.operation}:`,
        (err as Error).message
      );
    }
  })();
}

// Deprecated alias. Kept for any code that used the old binary flag
// for other purposes — new code should call resolveShadowModel()
// directly and check for null.
export function isCompareEnabled(): boolean {
  return resolveShadowModel('__probe__') !== null;
}
