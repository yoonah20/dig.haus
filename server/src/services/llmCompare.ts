import { execute } from '../db/index.js';
import { callDeepSeek, isDeepSeekConfigured } from './deepseek.js';

// Shadow-comparison helper. Only active when LLM_COMPARE=1 env is set,
// and only when DeepSeek is configured (otherwise there's no shadow to
// run). Fires a DeepSeek call with the SAME prompt as the primary
// Haiku/Sonnet call, logs both responses into llm_comparison_log for
// the admin /admin/compare page to inspect side-by-side.
//
// Fire-and-forget: the caller awaits the primary, then calls this with
// the primary's captured output/tokens/latency. Shadow runs in the
// background (the returned promise is intentionally NOT awaited by the
// call site). Errors are swallowed into the shadow_error column so a
// DeepSeek outage during comparison testing never breaks the user-
// facing primary path.
export function isCompareEnabled(): boolean {
  return process.env.LLM_COMPARE === '1';
}

export interface CompareContext {
  operation: string;
  prompt: string;
  albumMbid?: string | null;
  albumTitle?: string | null;
  primaryModel: string;
  primaryOutput: string;
  primaryInputTokens: number;
  primaryOutputTokens: number;
  primaryLatencyMs: number;
}

export function fireShadowComparison(ctx: CompareContext): void {
  if (!isCompareEnabled()) return;
  if (!isDeepSeekConfigured()) return;

  // Detached: intentionally no await. The primary path has already
  // returned to the user by the time this settles.
  void (async () => {
    const started = Date.now();
    let shadowOutput = '';
    let shadowModel = 'deepseek-chat';
    let shadowInputTokens = 0;
    let shadowOutputTokens = 0;
    let shadowError: string | null = null;
    try {
      const ds = await callDeepSeek([{ role: 'user', content: ctx.prompt }], {
        maxTokens: 2000,
      });
      shadowOutput = ds.content;
      shadowModel = ds.model;
      shadowInputTokens = ds.inputTokens;
      shadowOutputTokens = ds.outputTokens;
    } catch (err) {
      shadowError = (err as Error).message;
    }
    const latency = Date.now() - started;

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
          shadowModel,
          shadowOutput,
          shadowInputTokens,
          shadowOutputTokens,
          latency,
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
