// Phase 4 Pre-L0 spot check. The whole local-LLM curation plan was
// parked on 2026-04-27 because no model we tested cleared the bar; this
// script is the surviving testing harness for the day a stronger local
// LLM appears (or for when better hardware lets us run something larger
// than 16GB VRAM allows). Run this first before reviving the rest of
// the Phase 4 scaffolding.
//
// What it does:
//   1. Pulls N existing reviews from the local DB that have BOTH a
//      production excerpt_ko and a non-trivial English excerpt.
//   2. For each sample, sends the English excerpt to every model in
//      OLLAMA_MODELS via Ollama's native /api/chat endpoint, with
//      think:false so reasoning-mode models don't burn the response
//      budget on a <think> block.
//   3. Prints prod (Haiku/DeepSeek) output and each model's output
//      side by side so the gap is visible at a glance.
//
// Usage:
//   cd server && npx tsx scripts/preL0-spot-check.ts                  # 3 samples
//   cd server && npx tsx scripts/preL0-spot-check.ts 5                # 5 samples
//   OLLAMA_MODELS=newmodel:size npx tsx scripts/preL0-spot-check.ts
//
// Defaults:
//   OLLAMA_URL=http://localhost:11434
//   OLLAMA_MODELS=qwen3.6:35b-a3b,exaone3.5:7.8b
//
// Pass-bar (informal): if a model produces a candidate excerpt_ko that
// is better than or comparable to the production Haiku/DeepSeek output
// — same meaning preserved, no mid-word script mixing, no idiom
// directly translated, 130자 ceiling respected — across at least 3 of
// 5 samples, it's worth investing in the next stage. Failure modes
// from the 2026-04-27 round to specifically watch for in any new model:
//   - 음역/transliteration: "Sweden → 스웨인", "Dream Theater → 드림 시터"
//   - 한자어 직역: "gold standard → 금자표", "heavy metal → 중금속"
//   - 관용구 직역: "lightning in a bottle → 병에 담긴 번개"
//   - script-mixing: "만ifesto", "위Kend"
//   - markup leak: `_TITLE_`, `<title>`, `**bold**`
//   - over-compression (especially on smaller models): 50%+ details lost
//   - genre misclassification: blackgaze → 블랙메탈
// If a new model still trips on these after the strengthened prompt
// below, the same plan-pivot logic applies (don't progress to building
// the bench harness or wiring local LLM into the curation pipeline).
// Bench harness scaffold (server routes + /admin/bench page + 4 tables)
// lives in git at c051df8 if a viable model materializes and you want
// to revive the formal blind-evaluation step.

import 'dotenv/config';
import axios from 'axios';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODELS: string[] = (process.env.OLLAMA_MODELS ||
  process.env.OLLAMA_MODEL ||
  'qwen3.6:35b-a3b,exaone3.5:7.8b')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const N = Number(process.argv[2]) || 3;

const dbPath =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'diggershaus.db');

const db = new Database(dbPath, { readonly: true });

interface ReviewSample {
  review_id: number;
  album_title: string;
  artist_name: string | null;
  source_name: string;
  excerpt: string;
  excerpt_ko: string;
}

const samples = db
  .prepare(
    `SELECT r.id AS review_id,
            a.title AS album_title,
            a.artist_name,
            r.source_name,
            r.excerpt,
            r.excerpt_ko
     FROM reviews r
     JOIN albums a ON a.mbid = r.album_mbid
     WHERE r.excerpt IS NOT NULL
       AND r.excerpt_ko IS NOT NULL
       AND length(r.excerpt) BETWEEN 200 AND 1500
       AND length(r.excerpt_ko) BETWEEN 30 AND 200
     ORDER BY random()
     LIMIT ?`
  )
  .all(N) as ReviewSample[];

if (samples.length === 0) {
  console.error(
    'No usable reviews in DB. Need at least one row with excerpt + excerpt_ko populated.'
  );
  process.exit(1);
}

// Mirrors the relevant bits of the production excerptKo rules without the
// JSON extraction wrapper or the score / sourceName fields. We're testing
// translation quality, not JSON adherence.
//
// Hardened iteration after the first spot check round surfaced specific
// failure modes on Qwen3.6 / Qwen3 dense:
//   - "스웨인" (Sweden typo, 35B-A3B)
//   - "저조한" for low-key (semantic flip)
//   - "만ifesto" (mid-word script mixing)
//   - "중금속 음악" (heavy metal literally translated)
//   - 130자 overshoot
// Each of those gets an explicit rule below. Glossary is short on
// purpose — adding too many rare terms inflates input tokens and
// dilutes attention on the genuinely common ones.
function buildPrompt(sample: ReviewSample): string {
  return `당신은 음악 앨범 리뷰 발췌문을 한국어로 번역합니다. 결과는 dig.haus의 앨범 카드에 들어가는 짧은 발췌문이라, 길이와 톤이 깐깐합니다.

영문 원문:
---
${sample.excerpt}
---

# 톤 / 길이
- 1인칭 평서문, "~다" / "~한다"로 끝맺음
- 매체명, 평론가, 리뷰어 언급 금지. "리뷰어는…/필자는…/~라고 평가한다" 같은 3인칭 전달체 금지
- 존댓말 ("~합니다", "~입니다", "~네요") 금지, 반말 ("~해", "~어", "~아") 금지
- 총 길이 130자 이하 (공백 포함). 130자를 넘으면 핵심 한 문장으로 압축
- 최대 2문장

# 음역 / 표기 사전 (반드시 이 표기 사용)
- 메탈 하위 장르는 한국어로 의역하지 말 것. 외래어 그대로: 헤비메탈, 데스메탈, 블랙메탈, 둠메탈, 스래시메탈, 그라인드코어, 그라인드, 크러스트, 파워바이올런스, 하드코어, 슈게이즈, 포스트록, 프로그메탈, 심포닉메탈, 멜로딕데스메탈
- 장르명을 직역하지 말 것: "중금속" / "흑색 금속" / "사망 금속" / "검은 금속" 등 모두 금지
- 지명 표기 정확히: Sweden=스웨덴, Norway=노르웨이, Finland=핀란드, Denmark=덴마크, Germany=독일, UK=영국, Japan=일본 (오타 절대 금지)

# 의미 함정 (자주 틀림)
- "low-key" = 은근한 / 조용한 / 차분한. "저조한" / "침체된" 절대 아님
- "no sophomore slump" = 2집답지 않게 훌륭한. 반대 의미로 가지 말 것
- "ass-whoopin'" / "ass-kicking" = 통쾌한 / 거친 / 난폭한. 욕설 그대로 옮기지 말 것
- "masters of X" = X의 거장 / X의 명인
- "anything but" = 결코 ~이 아닌. 영어 어순 그대로 옮기지 말 것

# 형식
- 한 단어 안에 영문과 한글이 섞이면 안 됨. "만ifesto" / "위Kend" / "Stockholm식" 같은 식 절대 금지. 음역하면 끝까지 한글, 영문 보존하면 끝까지 영문
- 밴드명 / 앨범명은 영문 그대로 두는 것이 기본. 한국어 통용 표기가 분명한 경우 (예: 메탈리카, 슬레이어)에만 한글
- 부연 설명, "번역:", 따옴표, 마크다운 금지. 오직 번역 결과 텍스트만 출력`;
}

async function callOllama(
  model: string,
  prompt: string
): Promise<{ output: string; latencyMs: number; rawSnippet: string }> {
  const t0 = Date.now();
  // Ollama's NATIVE /api/chat (not the OpenAI-compat /v1 endpoint) so
  // we can pass `think: false`. Qwen3 dense models honor a `/no_think`
  // prompt token, but Qwen3.6 MoE (and Qwen3-VL etc) don't — they put
  // their thinking into a separate `reasoning` field and leave content
  // empty. The native `think: false` is the Ollama-side switch that
  // disables thinking across all reasoning-capable models, regardless
  // of how the model was trained to surface it.
  const { data } = await axios.post(
    `${OLLAMA_URL}/api/chat`,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      think: false,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: 800,
      },
    },
    { timeout: 240_000 }
  );
  const latencyMs = Date.now() - t0;
  const output = data?.message?.content ?? '';
  const rawSnippet = JSON.stringify(data?.message ?? data ?? {}).slice(0, 400);
  return { output: String(output).trim(), latencyMs, rawSnippet };
}

// Qwen3 in thinking mode emits <think>…</think> blocks before the answer.
// Strip them for fair display vs production output.
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function bar(ch: string, n: number): string {
  return ch.repeat(n);
}

console.log();
console.log(bar('=', 78));
console.log(
  `Pre-L0 spot check  ·  models: ${OLLAMA_MODELS.join(', ')}  ·  samples: ${samples.length}`
);
console.log(bar('=', 78));

interface ModelResult {
  model: string;
  output: string;
  latencyMs: number;
  error?: string;
}

const aggLatency = new Map<string, { sum: number; n: number }>();
for (const m of OLLAMA_MODELS) aggLatency.set(m, { sum: 0, n: 0 });

for (let i = 0; i < samples.length; i++) {
  const s = samples[i];
  const prompt = buildPrompt(s);
  console.log();
  console.log(`[${i + 1}/${samples.length}] ${s.artist_name || '?'} — ${s.album_title}`);
  console.log(`source: ${s.source_name}  ·  review #${s.review_id}`);
  console.log(bar('-', 78));
  console.log('EN excerpt:');
  console.log(s.excerpt);
  console.log();
  console.log(`PROD excerpt_ko  (${pad(`${s.excerpt_ko.length}자`, 6)}  · Haiku/DeepSeek)`);
  console.log(s.excerpt_ko);

  // Sequential per model — Ollama loads one model at a time on a single
  // GPU and parallel calls would just queue inside the server while
  // confusing the latency numbers. Sequential keeps the timings honest.
  for (const model of OLLAMA_MODELS) {
    process.stdout.write(`\n${pad(model, 22)} ... `);
    let res: ModelResult & { rawSnippet?: string };
    try {
      const r = await callOllama(model, prompt);
      const cleaned = stripThink(r.output);
      res = { model, output: cleaned, latencyMs: r.latencyMs, rawSnippet: r.rawSnippet };
    } catch (err) {
      res = { model, output: '', latencyMs: 0, error: (err as Error).message };
    }
    if (res.error) {
      console.log(`ERROR: ${res.error}`);
      continue;
    }
    const tracker = aggLatency.get(model)!;
    tracker.sum += res.latencyMs;
    tracker.n += 1;
    console.log(`(${pad(`${res.output.length}자`, 6)} · ${res.latencyMs}ms)`);
    if (!res.output && res.rawSnippet) {
      console.log(`  [empty content — raw message: ${res.rawSnippet}]`);
    } else {
      console.log(res.output);
    }
  }
}

console.log();
console.log(bar('-', 78));
console.log('avg latency per model:');
for (const m of OLLAMA_MODELS) {
  const t = aggLatency.get(m)!;
  console.log(`  ${pad(m, 22)} ${t.n > 0 ? Math.round(t.sum / t.n) : '—'}ms`);
}

console.log();
console.log(bar('=', 78));
console.log('eyeball check:');
console.log('  - 직역체? (영문 어순 그대로, "그 음반은", "을 가진", "~ㅁ을 ~함" 등)');
console.log('  - 장르 용어 부자연스러움? ("블랙 메탈" vs "흑색 금속" 같은 직역 사고)');
console.log('  - 길이 폭주? (130자 ↑)');
console.log('  - 톤 일탈? (~합니다 / ~네요 / "리뷰어는…")');
console.log();
console.log('두 개 이상 명확히 어긋나면 plan 피벗 (다른 모델 / 7B + 강한 프롬프팅 / 로컬 포기).');
console.log(bar('=', 78));
