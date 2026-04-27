import { Router } from 'express';
import { execute, queryAll, queryGet } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

// Phase 4 L0c blind-bench harness. The /admin/bench page calls these
// endpoints to compose a comparison run, paste model outputs, score
// them blind, and reveal aggregates after closing the run.
//
// Naming uses "run / source / output / score" to mirror the spec's
// vocabulary in docs/phase4-nightly-pipeline.md L0c. None of this code
// CALLS local LLMs — outputs come in as pasted text from the admin
// running each candidate model on their own machine. The harness is
// pure rating + bookkeeping; integrating an actual local LLM client
// is the L1 step.
const router = Router();

// ─── helpers ───────────────────────────────────────────────────────

interface BenchRunRow {
  id: number;
  name: string;
  models_json: string;
  created_at: string;
  closed_at: string | null;
}
interface SourceRow {
  id: number;
  album_mbid: string | null;
  album_title: string | null;
  source_review_id: number | null;
  source_text: string;
}
interface OutputRow {
  id: number;
  source_id: number;
  model: string;
  output: string;
  latency_ms: number | null;
}
interface ScoreRow {
  output_id: number;
  score: number;
  rank: number | null;
  tags: string | null;
  comment: string | null;
}

function parseModels(json: string): string[] {
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v) && v.every((s) => typeof s === 'string')) return v;
  } catch {}
  return [];
}

// Mulberry32-style deterministic 32-bit hash → seeded shuffle. Used to
// scramble output order per source so the rating UI shows model A/B/C
// in a stable random order (refresh keeps the same order, but the
// admin can't tell which model is which until the run closes).
function seededShuffle<T>(items: T[], seed: number): T[] {
  let s = seed >>> 0;
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    const j = Math.floor(r * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function blindLabel(idx: number): string {
  // A, B, C ... Z, AA, AB ...
  let n = idx;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// ─── runs ──────────────────────────────────────────────────────────

router.post('/runs', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const modelsRaw = req.body?.models;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!Array.isArray(modelsRaw) || modelsRaw.length < 2) {
    return res.status(400).json({ error: 'models must be an array of at least 2 strings' });
  }
  const models: string[] = modelsRaw.map((m: unknown) => String(m).trim()).filter(Boolean);
  if (new Set(models).size !== models.length) {
    return res.status(400).json({ error: 'models must be unique' });
  }
  const result = execute(
    `INSERT INTO bench_runs (name, models_json) VALUES (?, ?)`,
    [name, JSON.stringify(models)]
  );
  const id = Number(result.lastInsertRowid);
  const row = queryGet(`SELECT * FROM bench_runs WHERE id = ?`, [id]) as BenchRunRow | null;
  if (!row) return res.status(500).json({ error: 'insert lookup failed' });
  res.json({
    id: row.id,
    name: row.name,
    models,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  });
});

router.get('/runs', requireAdmin, (_req, res) => {
  const rows = queryAll(
    `SELECT r.*,
            (SELECT COUNT(*) FROM bench_sources s WHERE s.run_id = r.id) AS source_count,
            (SELECT COUNT(*) FROM bench_outputs o
               JOIN bench_sources s ON s.id = o.source_id
               WHERE s.run_id = r.id) AS output_count,
            (SELECT COUNT(*) FROM bench_scores sc
               JOIN bench_outputs o ON o.id = sc.output_id
               JOIN bench_sources s ON s.id = o.source_id
               WHERE s.run_id = r.id) AS score_count
     FROM bench_runs r
     ORDER BY r.id DESC`
  ) as Array<
    BenchRunRow & {
      source_count: number;
      output_count: number;
      score_count: number;
    }
  >;
  res.json({
    runs: rows.map((r) => ({
      id: r.id,
      name: r.name,
      models: parseModels(r.models_json),
      createdAt: r.created_at,
      closedAt: r.closed_at,
      sourceCount: r.source_count,
      outputCount: r.output_count,
      scoreCount: r.score_count,
    })),
  });
});

router.delete('/runs/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  // FK ON DELETE CASCADE handles sources → outputs → scores.
  execute(`DELETE FROM bench_runs WHERE id = ?`, [id]);
  res.json({ ok: true });
});

router.post('/runs/:id/close', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const run = queryGet(`SELECT * FROM bench_runs WHERE id = ?`, [id]) as BenchRunRow | null;
  if (!run) return res.status(404).json({ error: 'not found' });
  if (run.closed_at) return res.json({ ok: true, closedAt: run.closed_at });
  execute(`UPDATE bench_runs SET closed_at = datetime('now') WHERE id = ?`, [id]);
  const fresh = queryGet(`SELECT closed_at FROM bench_runs WHERE id = ?`, [id]) as
    | { closed_at: string }
    | null;
  res.json({ ok: true, closedAt: fresh?.closed_at });
});

router.post('/runs/:id/reopen', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  execute(`UPDATE bench_runs SET closed_at = NULL WHERE id = ?`, [id]);
  res.json({ ok: true });
});

// ─── sources ───────────────────────────────────────────────────────

interface ReviewPick {
  id: number;
  album_mbid: string;
  excerpt: string;
  album_title: string;
}

// Auto-pick N existing reviews to seed a run. One row per album so
// the bench tests on diverse sources, length-bounded so we don't end
// up scoring on truncated stubs or 5000-char essays.
router.post('/runs/:id/sources/auto-pick', requireAdmin, (req, res) => {
  const runId = Number(req.params.id);
  const count = Math.min(Math.max(Number(req.body?.count) || 10, 1), 50);
  const minLen = Number(req.body?.minLen) || 200;
  const maxLen = Number(req.body?.maxLen) || 2500;
  const run = queryGet(`SELECT * FROM bench_runs WHERE id = ?`, [runId]) as BenchRunRow | null;
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (run.closed_at) return res.status(400).json({ error: 'run is closed' });
  const picks = queryAll(
    `SELECT r.id, r.album_mbid, r.excerpt, a.title AS album_title
     FROM reviews r
     JOIN albums a ON a.mbid = r.album_mbid
     JOIN (
       SELECT album_mbid, MIN(id) AS keep_id
       FROM reviews
       WHERE excerpt IS NOT NULL
         AND length(excerpt) BETWEEN ? AND ?
       GROUP BY album_mbid
     ) picks ON picks.keep_id = r.id
     ORDER BY random()
     LIMIT ?`,
    [minLen, maxLen, count]
  ) as ReviewPick[];
  let added = 0;
  for (const p of picks) {
    execute(
      `INSERT INTO bench_sources
         (run_id, album_mbid, album_title, source_review_id, source_text)
       VALUES (?, ?, ?, ?, ?)`,
      [runId, p.album_mbid, p.album_title, p.id, p.excerpt]
    );
    added += 1;
  }
  res.json({ added });
});

// Manual single source add — for cases the auto-pick missed or for
// sources that aren't an existing review (pasted text).
router.post('/runs/:id/sources', requireAdmin, (req, res) => {
  const runId = Number(req.params.id);
  const run = queryGet(`SELECT * FROM bench_runs WHERE id = ?`, [runId]) as BenchRunRow | null;
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (run.closed_at) return res.status(400).json({ error: 'run is closed' });
  const sourceText = String(req.body?.sourceText || '').trim();
  if (!sourceText) return res.status(400).json({ error: 'sourceText required' });
  const albumMbid = req.body?.albumMbid ? String(req.body.albumMbid) : null;
  const albumTitle = req.body?.albumTitle ? String(req.body.albumTitle) : null;
  const sourceReviewId =
    typeof req.body?.sourceReviewId === 'number' ? req.body.sourceReviewId : null;
  const result = execute(
    `INSERT INTO bench_sources
       (run_id, album_mbid, album_title, source_review_id, source_text)
     VALUES (?, ?, ?, ?, ?)`,
    [runId, albumMbid, albumTitle, sourceReviewId, sourceText]
  );
  res.json({ id: Number(result.lastInsertRowid) });
});

router.delete('/sources/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  execute(`DELETE FROM bench_sources WHERE id = ?`, [id]);
  res.json({ ok: true });
});

// ─── outputs ──────────────────────────────────────────────────────

// Bulk import: { outputs: { [model]: { [sourceId]: "text", ... }, ... } }
// Upserts per (source_id, model). Models not in the run's models_json
// are rejected so admin can't accidentally tag outputs to a typo'd
// model name. Sources not belonging to this run are likewise rejected.
router.post('/runs/:id/import-outputs', requireAdmin, (req, res) => {
  const runId = Number(req.params.id);
  const run = queryGet(`SELECT * FROM bench_runs WHERE id = ?`, [runId]) as BenchRunRow | null;
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (run.closed_at) return res.status(400).json({ error: 'run is closed' });
  const allowedModels = new Set(parseModels(run.models_json));
  const payload = req.body?.outputs;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'outputs object required' });
  }
  const validRows = queryAll(`SELECT id FROM bench_sources WHERE run_id = ?`, [runId]) as Array<{
    id: number;
  }>;
  const validSourceIds = new Set(validRows.map((r) => r.id));
  const errors: string[] = [];
  let upserted = 0;
  for (const [model, perSource] of Object.entries(payload)) {
    if (!allowedModels.has(model)) {
      errors.push(`unknown model "${model}" — not in this run's models list`);
      continue;
    }
    if (!perSource || typeof perSource !== 'object' || Array.isArray(perSource)) {
      errors.push(`outputs["${model}"] must be { sourceId: text }`);
      continue;
    }
    for (const [sidStr, textRaw] of Object.entries(perSource as Record<string, unknown>)) {
      const sid = Number(sidStr);
      if (!validSourceIds.has(sid)) {
        errors.push(`source ${sidStr} not in this run`);
        continue;
      }
      const text = String(textRaw ?? '').trim();
      if (!text) {
        errors.push(`outputs["${model}"][${sidStr}] is empty`);
        continue;
      }
      execute(
        `INSERT INTO bench_outputs (source_id, model, output)
         VALUES (?, ?, ?)
         ON CONFLICT(source_id, model) DO UPDATE SET
           output = excluded.output,
           created_at = datetime('now')`,
        [sid, model, text]
      );
      upserted += 1;
    }
  }
  res.json({ upserted, errors });
});

// Single-output paste fallback. Used when the JSON bulk paste isn't
// convenient (re-running just one model on one source).
router.post('/runs/:runId/sources/:sourceId/outputs', requireAdmin, (req, res) => {
  const runId = Number(req.params.runId);
  const sourceId = Number(req.params.sourceId);
  const run = queryGet(`SELECT * FROM bench_runs WHERE id = ?`, [runId]) as BenchRunRow | null;
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (run.closed_at) return res.status(400).json({ error: 'run is closed' });
  const allowedModels = new Set(parseModels(run.models_json));
  const model = String(req.body?.model || '').trim();
  if (!allowedModels.has(model)) {
    return res.status(400).json({ error: `unknown model "${model}"` });
  }
  const text = String(req.body?.output || '').trim();
  if (!text) return res.status(400).json({ error: 'output required' });
  const latency =
    typeof req.body?.latencyMs === 'number' ? Math.max(0, req.body.latencyMs) : null;
  const src = queryGet(`SELECT run_id FROM bench_sources WHERE id = ?`, [sourceId]) as
    | { run_id: number }
    | null;
  if (!src || src.run_id !== runId) {
    return res.status(404).json({ error: 'source not in this run' });
  }
  execute(
    `INSERT INTO bench_outputs (source_id, model, output, latency_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_id, model) DO UPDATE SET
       output = excluded.output,
       latency_ms = excluded.latency_ms,
       created_at = datetime('now')`,
    [sourceId, model, text, latency]
  );
  res.json({ ok: true });
});

// ─── scores ───────────────────────────────────────────────────────

router.post('/outputs/:id/score', requireAdmin, (req, res) => {
  const outputId = Number(req.params.id);
  const score = Number(req.body?.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return res.status(400).json({ error: 'score must be integer 1-5' });
  }
  const rank =
    req.body?.rank == null
      ? null
      : Number.isInteger(req.body.rank) && req.body.rank >= 1
        ? Number(req.body.rank)
        : null;
  const tags = req.body?.tags ? String(req.body.tags).slice(0, 200) : null;
  const comment = req.body?.comment ? String(req.body.comment).slice(0, 1000) : null;

  // Confirm output exists and run is still open. Edits to closed
  // runs are rejected so the aggregate view stays a snapshot.
  const out = queryGet(
    `SELECT o.source_id, r.closed_at AS run_closed
     FROM bench_outputs o
     JOIN bench_sources s ON s.id = o.source_id
     JOIN bench_runs r ON r.id = s.run_id
     WHERE o.id = ?`,
    [outputId]
  ) as { source_id: number; run_closed: string | null } | null;
  if (!out) return res.status(404).json({ error: 'output not found' });
  if (out.run_closed) return res.status(400).json({ error: 'run is closed' });

  // Per-source rank uniqueness: if a rank is being claimed and another
  // output in the same source already holds it, swap them so admin
  // doesn't have to manually clear before re-ranking.
  if (rank != null) {
    const existing = queryGet(
      `SELECT sc.id, sc.output_id, sc.rank AS current_rank
       FROM bench_scores sc
       JOIN bench_outputs o ON o.id = sc.output_id
       WHERE o.source_id = ? AND sc.rank = ? AND sc.output_id != ?`,
      [out.source_id, rank, outputId]
    ) as { id: number; output_id: number; current_rank: number } | null;
    if (existing) {
      // Find this output's previous rank (if any) to swap into the
      // displaced slot. NULL if this is the first time it's being
      // ranked.
      const self = queryGet(`SELECT rank FROM bench_scores WHERE output_id = ?`, [outputId]) as
        | { rank: number | null }
        | null;
      execute(
        `UPDATE bench_scores SET rank = ?, updated_at = datetime('now') WHERE id = ?`,
        [self?.rank ?? null, existing.id]
      );
    }
  }

  execute(
    `INSERT INTO bench_scores (output_id, score, rank, tags, comment)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(output_id) DO UPDATE SET
       score = excluded.score,
       rank = excluded.rank,
       tags = excluded.tags,
       comment = excluded.comment,
       updated_at = datetime('now')`,
    [outputId, score, rank, tags, comment]
  );
  res.json({ ok: true });
});

router.delete('/outputs/:id/score', requireAdmin, (req, res) => {
  const outputId = Number(req.params.id);
  execute(`DELETE FROM bench_scores WHERE output_id = ?`, [outputId]);
  res.json({ ok: true });
});

// ─── full run state ──────────────────────────────────────────────

router.get('/runs/:id', requireAdmin, (req, res) => {
  const runId = Number(req.params.id);
  const run = queryGet(`SELECT * FROM bench_runs WHERE id = ?`, [runId]) as BenchRunRow | null;
  if (!run) return res.status(404).json({ error: 'not found' });
  const isClosed = !!run.closed_at;
  const models = parseModels(run.models_json);

  const sources = queryAll(
    `SELECT id, album_mbid, album_title, source_review_id, source_text
     FROM bench_sources WHERE run_id = ? ORDER BY id ASC`,
    [runId]
  ) as SourceRow[];
  const outputs = queryAll(
    `SELECT o.id, o.source_id, o.model, o.output, o.latency_ms
     FROM bench_outputs o
     JOIN bench_sources s ON s.id = o.source_id
     WHERE s.run_id = ?`,
    [runId]
  ) as OutputRow[];
  const scores = queryAll(
    `SELECT sc.output_id, sc.score, sc.rank, sc.tags, sc.comment
     FROM bench_scores sc
     JOIN bench_outputs o ON o.id = sc.output_id
     JOIN bench_sources s ON s.id = o.source_id
     WHERE s.run_id = ?`,
    [runId]
  ) as ScoreRow[];
  const scoreByOutput = new Map<number, ScoreRow>(
    scores.map((sc) => [sc.output_id, sc] as const)
  );
  const outputsBySource = new Map<number, OutputRow[]>();
  for (const o of outputs) {
    const list = outputsBySource.get(o.source_id) ?? [];
    list.push(o);
    outputsBySource.set(o.source_id, list);
  }

  // Per-source seeded shuffle so display order is stable across
  // refreshes but unpredictable from the model name alone. Open
  // runs hide the model; closed runs reveal it alongside.
  const sourcesOut = sources.map((s) => {
    const ordered = seededShuffle(outputsBySource.get(s.id) ?? [], s.id);
    return {
      id: s.id,
      albumMbid: s.album_mbid,
      albumTitle: s.album_title,
      sourceReviewId: s.source_review_id,
      sourceText: s.source_text,
      outputs: ordered.map((o, idx) => {
        const sc = scoreByOutput.get(o.id);
        return {
          id: o.id,
          displayLabel: blindLabel(idx),
          model: isClosed ? o.model : null,
          output: o.output,
          latencyMs: o.latency_ms,
          score: sc?.score ?? null,
          rank: sc?.rank ?? null,
          tags: sc?.tags ?? null,
          comment: sc?.comment ?? null,
        };
      }),
    };
  });

  // Aggregate per model — only meaningful when run is closed (or
  // partially scored). Always sent so the client can show progress
  // without revealing labels (we strip model names if open).
  const perModel = new Map<
    string,
    {
      n: number;
      scoreSum: number;
      rankSum: number;
      rankN: number;
      tagCounts: Record<string, number>;
    }
  >();
  for (const m of models) {
    perModel.set(m, { n: 0, scoreSum: 0, rankSum: 0, rankN: 0, tagCounts: {} });
  }
  for (const o of outputs) {
    const sc = scoreByOutput.get(o.id);
    if (!sc) continue;
    const bucket = perModel.get(o.model);
    if (!bucket) continue;
    bucket.n += 1;
    bucket.scoreSum += sc.score;
    if (sc.rank != null) {
      bucket.rankSum += sc.rank;
      bucket.rankN += 1;
    }
    if (sc.tags) {
      for (const t of sc.tags
        .split(',')
        .map((tag: string) => tag.trim())
        .filter((tag: string) => tag.length > 0)) {
        bucket.tagCounts[t] = (bucket.tagCounts[t] || 0) + 1;
      }
    }
  }
  const aggregate = Array.from(perModel.entries()).map(([model, b]) => ({
    model: isClosed ? model : null,
    n: b.n,
    avgScore: b.n > 0 ? b.scoreSum / b.n : null,
    avgRank: b.rankN > 0 ? b.rankSum / b.rankN : null,
    tagCounts: b.tagCounts,
  }));

  res.json({
    id: run.id,
    name: run.name,
    models: isClosed ? models : models.map(() => null),
    createdAt: run.created_at,
    closedAt: run.closed_at,
    sources: sourcesOut,
    aggregate,
  });
});

export default router;
