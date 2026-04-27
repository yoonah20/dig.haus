import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from '../lib/axios';
import { useAuth } from '../contexts/AuthContext';

// Phase 4 L0c blind-bench page. Admin lists candidate local LLMs (Qwen3-14B,
// EXAONE 3.5 7.8B, Qwen2.5-14B baseline, etc), seeds the run with N
// existing reviews as English source text, pastes per-model Korean
// translations as a JSON dump, then scores each output blind. Closing
// the run reveals model names alongside the aggregate per-model
// averages — the whole point is to keep model identity hidden during
// scoring so name recognition doesn't bias the rating.
//
// Server endpoints live in server/src/routes/bench.ts and are mounted
// at /api/admin/bench. None of this UI talks to a local LLM directly;
// integration is the L1 step in docs/phase4-nightly-pipeline.md.

const TAG_OPTIONS = [
  'literal',
  'jargon-error',
  'length-bad',
  'preamble-leak',
  'natural',
] as const;

interface RunSummary {
  id: number;
  name: string;
  models: string[];
  createdAt: string;
  closedAt: string | null;
  sourceCount: number;
  outputCount: number;
  scoreCount: number;
}

interface OutputView {
  id: number;
  displayLabel: string;
  model: string | null;
  output: string;
  latencyMs: number | null;
  score: number | null;
  rank: number | null;
  tags: string | null;
  comment: string | null;
}
interface SourceView {
  id: number;
  albumMbid: string | null;
  albumTitle: string | null;
  sourceReviewId: number | null;
  sourceText: string;
  outputs: OutputView[];
}
interface AggregateRow {
  model: string | null;
  n: number;
  avgScore: number | null;
  avgRank: number | null;
  tagCounts: Record<string, number>;
}
interface RunDetail {
  id: number;
  name: string;
  models: (string | null)[];
  createdAt: string;
  closedAt: string | null;
  sources: SourceView[];
  aggregate: AggregateRow[];
}

export default function Bench() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const selectedId = Number(params.get('run') || 0) || null;

  useEffect(() => {
    if (!loading && (!user || !user.isAdmin)) navigate('/');
  }, [user, loading, navigate]);

  const runsQuery = useQuery<{ runs: RunSummary[] }>({
    queryKey: ['admin-bench-runs'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/bench/runs');
      return data;
    },
    enabled: !!user?.isAdmin,
    staleTime: 10_000,
  });

  const runQuery = useQuery<RunDetail>({
    queryKey: ['admin-bench-run', selectedId],
    queryFn: async () => {
      const { data } = await axios.get(`/api/admin/bench/runs/${selectedId}`);
      return data;
    },
    enabled: !!user?.isAdmin && !!selectedId,
    staleTime: 5_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-bench-runs'] });
    if (selectedId) qc.invalidateQueries({ queryKey: ['admin-bench-run', selectedId] });
  };

  if (loading || !user?.isAdmin) return null;

  const runs = runsQuery.data?.runs ?? [];
  const run = runQuery.data;

  return (
    <main className="flex-1 max-w-[1200px] mx-auto px-4 py-6 font-mono text-sm">
      <header className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
        <h1 className="text-lg text-[#e8a020]">L0c Blind Bench</h1>
        <div className="text-[11px] text-gray-500">
          phase 4 nightly pipeline · model rating harness
        </div>
      </header>

      <RunPickerSection
        runs={runs}
        selectedId={selectedId}
        onSelect={(id) => setParams(id ? { run: String(id) } : {})}
        onCreated={(id) => {
          refresh();
          setParams({ run: String(id) });
        }}
      />

      {selectedId && !run && (
        <div className="text-xs text-gray-500 mt-6">loading run…</div>
      )}

      {run && (
        <>
          <RunHeader run={run} onChanged={refresh} />
          {!run.closedAt && (
            <SetupSection runId={run.id} run={run} onChanged={refresh} />
          )}
          {run.sources.length > 0 && (
            <RateSection run={run} onChanged={refresh} />
          )}
          <AggregateSection run={run} />
        </>
      )}
    </main>
  );
}

// ─── run picker ────────────────────────────────────────────────────

function RunPickerSection({
  runs,
  selectedId,
  onSelect,
  onCreated,
}: {
  runs: RunSummary[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onCreated: (id: number) => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [modelsText, setModelsText] = useState('qwen3-14b\nexaone-3.5-7.8b\nqwen2.5-14b');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const models = modelsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const { data } = await axios.post('/api/admin/bench/runs', { name: name.trim(), models });
      return data as { id: number };
    },
    onSuccess: (data) => {
      setShowNew(false);
      setName('');
      onCreated(data.id);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ||
        '실패';
      setError(msg);
    },
  });

  return (
    <section className="mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">runs</span>
        <select
          value={selectedId ?? ''}
          onChange={(e) => onSelect(Number(e.target.value) || null)}
          className="bg-[#141414] border border-white/10 rounded px-2 py-1 text-xs text-gray-200"
        >
          <option value="">— select —</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              #{r.id} {r.name} {r.closedAt ? '(closed)' : ''} — {r.scoreCount}/{r.outputCount}{' '}
              scored
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="px-2 py-1 text-[11px] border border-white/10 hover:border-[#e8a020]/50 hover:text-[#e8a020] text-gray-400 rounded cursor-pointer"
        >
          {showNew ? '취소' : '+ 새 run'}
        </button>
      </div>

      {showNew && (
        <div className="bg-[#141414] border border-white/10 rounded p-3 space-y-2 max-w-xl">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="L0c-2026-04-27"
              className="w-full mt-1 bg-[#0f0f0f] border border-white/10 rounded px-2 py-1 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              models (한 줄에 하나, 2개 이상)
            </span>
            <textarea
              value={modelsText}
              onChange={(e) => setModelsText(e.target.value)}
              rows={4}
              className="w-full mt-1 bg-[#0f0f0f] border border-white/10 rounded px-2 py-1 text-xs"
            />
          </label>
          {error && <div className="text-[11px] text-red-400">{error}</div>}
          <button
            onClick={() => {
              setError(null);
              createMutation.mutate();
            }}
            disabled={createMutation.isPending || !name.trim()}
            className="px-3 py-1 text-xs border border-[#e8a020]/40 text-[#e8a020] hover:bg-[#e8a020]/10 rounded disabled:opacity-40 cursor-pointer"
          >
            {createMutation.isPending ? '만드는 중…' : '만들기'}
          </button>
        </div>
      )}
    </section>
  );
}

// ─── run header ────────────────────────────────────────────────────

function RunHeader({ run, onChanged }: { run: RunDetail; onChanged: () => void }) {
  const isClosed = !!run.closedAt;
  const closeMutation = useMutation({
    mutationFn: async () => {
      await axios.post(`/api/admin/bench/runs/${run.id}/close`);
    },
    onSuccess: onChanged,
  });
  const reopenMutation = useMutation({
    mutationFn: async () => {
      await axios.post(`/api/admin/bench/runs/${run.id}/reopen`);
    },
    onSuccess: onChanged,
  });
  const deleteMutation = useMutation({
    mutationFn: async () => {
      await axios.delete(`/api/admin/bench/runs/${run.id}`);
    },
    onSuccess: onChanged,
  });

  return (
    <section className="mb-6 bg-[#141414] border border-white/10 rounded px-3 py-2 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <span className="text-[#e8a020]">#{run.id} {run.name}</span>
        <span
          className={`text-[10px] uppercase tracking-wider ${
            isClosed ? 'text-gray-500' : 'text-green-400'
          }`}
        >
          {isClosed ? `closed ${run.closedAt}` : 'active'}
        </span>
        <span className="text-[10px] text-gray-500">
          {run.sources.length}소스 · {run.sources.reduce((a, s) => a + s.outputs.length, 0)}출력
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        {isClosed ? (
          <button
            onClick={() => reopenMutation.mutate()}
            disabled={reopenMutation.isPending}
            className="px-2 py-1 border border-white/10 hover:border-yellow-500/40 hover:text-yellow-400 text-gray-400 rounded cursor-pointer disabled:opacity-40"
          >
            reopen
          </button>
        ) : (
          <button
            onClick={() => {
              if (confirm('run을 닫고 모델 라벨을 공개하시겠어요?')) closeMutation.mutate();
            }}
            disabled={closeMutation.isPending}
            className="px-2 py-1 border border-[#e8a020]/40 text-[#e8a020] hover:bg-[#e8a020]/10 rounded cursor-pointer disabled:opacity-40"
          >
            close & reveal
          </button>
        )}
        <button
          onClick={() => {
            if (confirm('이 run을 영구 삭제하시겠어요? (소스/출력/점수 전부)')) {
              deleteMutation.mutate();
              onChanged();
            }
          }}
          className="px-2 py-1 border border-white/10 hover:border-red-500/40 hover:text-red-400 text-gray-500 rounded cursor-pointer"
        >
          delete
        </button>
      </div>
    </section>
  );
}

// ─── setup ────────────────────────────────────────────────────────

function SetupSection({
  runId,
  run,
  onChanged,
}: {
  runId: number;
  run: RunDetail;
  onChanged: () => void;
}) {
  // The run.models array is null-masked when the run is open; we use
  // the masked length for the UI but need the actual model strings to
  // build the JSON paste template. Since the page only renders SetupSection
  // for OPEN runs, model names are NOT in run.models — we fall back to
  // the sample model list from the runs index instead.
  return (
    <section className="mb-6 space-y-4">
      <SourcesSubsection runId={runId} sources={run.sources} onChanged={onChanged} />
      {run.sources.length > 0 && (
        <ImportOutputsSubsection runId={runId} sources={run.sources} onChanged={onChanged} />
      )}
    </section>
  );
}

function SourcesSubsection({
  runId,
  sources,
  onChanged,
}: {
  runId: number;
  sources: SourceView[];
  onChanged: () => void;
}) {
  const [autoCount, setAutoCount] = useState(10);
  const autoPick = useMutation({
    mutationFn: async () => {
      const { data } = await axios.post(
        `/api/admin/bench/runs/${runId}/sources/auto-pick`,
        { count: autoCount }
      );
      return data as { added: number };
    },
    onSuccess: onChanged,
  });
  const removeSource = useMutation({
    mutationFn: async (id: number) => {
      await axios.delete(`/api/admin/bench/sources/${id}`);
    },
    onSuccess: onChanged,
  });

  return (
    <div className="bg-[#141414] border border-white/10 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          sources ({sources.length})
        </span>
        <div className="flex items-center gap-2 text-[11px]">
          <input
            type="number"
            min={1}
            max={50}
            value={autoCount}
            onChange={(e) => setAutoCount(Number(e.target.value))}
            className="w-16 bg-[#0f0f0f] border border-white/10 rounded px-1 py-0.5 text-xs"
          />
          <button
            onClick={() => autoPick.mutate()}
            disabled={autoPick.isPending}
            className="px-2 py-1 border border-white/10 hover:border-[#e8a020]/40 hover:text-[#e8a020] text-gray-400 rounded cursor-pointer disabled:opacity-40"
          >
            {autoPick.isPending ? '뽑는 중…' : 'auto-pick from existing reviews'}
          </button>
        </div>
      </div>
      {sources.length === 0 ? (
        <div className="text-[11px] text-gray-500">
          소스가 없습니다. auto-pick으로 N개 뽑아오거나 별도 source 추가 API를 호출하세요.
        </div>
      ) : (
        <ul className="divide-y divide-white/5">
          {sources.map((s) => (
            <li key={s.id} className="py-1.5 flex items-center gap-2">
              <span className="text-gray-500 tabular-nums text-[11px] w-8">#{s.id}</span>
              <span className="text-gray-300 truncate flex-1">{s.albumTitle || '(no album)'}</span>
              <span className="text-[10px] text-gray-600">
                {s.outputs.length}/{/* total models */}
              </span>
              <button
                onClick={() => {
                  if (confirm(`소스 #${s.id} 삭제? (소속 출력/점수 cascade)`))
                    removeSource.mutate(s.id);
                }}
                className="text-[10px] text-gray-600 hover:text-red-400 cursor-pointer"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImportOutputsSubsection({
  runId,
  sources,
  onChanged,
}: {
  runId: number;
  sources: SourceView[];
  onChanged: () => void;
}) {
  const [json, setJson] = useState('');
  const [result, setResult] = useState<{ upserted: number; errors: string[] } | null>(null);

  const importMutation = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(json);
      const { data } = await axios.post(
        `/api/admin/bench/runs/${runId}/import-outputs`,
        { outputs: parsed }
      );
      return data as { upserted: number; errors: string[] };
    },
    onSuccess: (data) => {
      setResult(data);
      onChanged();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string }).response?.data
          ?.error ||
        (err as { message?: string }).message ||
        '실패';
      setResult({ upserted: 0, errors: [msg] });
    },
  });

  // Build a copy-paste template so admin can run it on the local LLM
  // server. Each source ID maps to its English text; each model gets
  // an empty object the admin fills with the model's Korean output.
  const template = useMemo(() => {
    const sourcesObj: Record<string, string> = {};
    for (const s of sources) sourcesObj[s.id] = s.sourceText;
    return JSON.stringify(
      {
        '__SOURCES_FOR_REFERENCE__': sourcesObj,
        'qwen3-14b': Object.fromEntries(sources.map((s) => [s.id, ''])),
        'exaone-3.5-7.8b': Object.fromEntries(sources.map((s) => [s.id, ''])),
        'qwen2.5-14b': Object.fromEntries(sources.map((s) => [s.id, ''])),
      },
      null,
      2
    );
  }, [sources]);

  return (
    <div className="bg-[#141414] border border-white/10 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          import outputs (JSON)
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(template);
            alert('템플릿이 클립보드에 복사됐습니다');
          }}
          className="text-[10px] text-gray-500 hover:text-[#e8a020] underline-offset-2 hover:underline cursor-pointer"
        >
          📋 빈 템플릿 복사
        </button>
      </div>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={8}
        placeholder='{ "qwen3-14b": { "<sourceId>": "...", ... }, ... }'
        className="w-full bg-[#0f0f0f] border border-white/10 rounded px-2 py-1 text-[11px] font-mono"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending || !json.trim()}
          className="px-3 py-1 text-xs border border-[#e8a020]/40 text-[#e8a020] hover:bg-[#e8a020]/10 rounded disabled:opacity-40 cursor-pointer"
        >
          {importMutation.isPending ? '가져오는 중…' : 'import'}
        </button>
        {result && (
          <span className="text-[11px] text-gray-500">
            upserted: <span className="text-green-400">{result.upserted}</span>
            {result.errors.length > 0 && (
              <span className="ml-2 text-red-400">errors: {result.errors.length}</span>
            )}
          </span>
        )}
      </div>
      {result?.errors && result.errors.length > 0 && (
        <ul className="mt-2 text-[11px] text-red-400/80 list-disc list-inside max-h-32 overflow-auto">
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-[10px] text-gray-600 leading-relaxed">
        형식: <code className="text-gray-400">{`{ "<model>": { "<sourceId>": "<korean>", ... }, ... }`}</code>
        . 모델 이름은 run 생성 시 등록한 것과 정확히 일치해야 함. 같은 (source, model) 쌍이
        이미 있으면 덮어쓰기. 부분 import 가능 (한 모델만 다시 돌렸을 때 그 키만 넣어도 통과).
      </div>
    </div>
  );
}

// ─── rate ────────────────────────────────────────────────────────

function RateSection({ run, onChanged }: { run: RunDetail; onChanged: () => void }) {
  return (
    <section className="mb-6 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">rate</div>
      {run.sources.map((s) => (
        <SourceRateCard key={s.id} source={s} runClosed={!!run.closedAt} onChanged={onChanged} />
      ))}
    </section>
  );
}

function SourceRateCard({
  source,
  runClosed,
  onChanged,
}: {
  source: SourceView;
  runClosed: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="bg-[#141414] border border-white/10 rounded p-3">
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <span className="text-[#e8a020]/80">
          #{source.id} {source.albumTitle || '(no album)'}
        </span>
        {source.sourceReviewId && (
          <span className="text-[10px] text-gray-600">review #{source.sourceReviewId}</span>
        )}
      </div>
      <details className="text-[11px] text-gray-400 mb-2">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-300">
          📄 source ({source.sourceText.length}자)
        </summary>
        <pre className="whitespace-pre-wrap mt-1 leading-relaxed bg-[#0f0f0f] border border-white/5 rounded p-2 max-h-60 overflow-auto">
          {source.sourceText}
        </pre>
      </details>

      {source.outputs.length === 0 ? (
        <div className="text-[11px] text-gray-500">출력 없음 — import 필요.</div>
      ) : (
        <ul className="space-y-2">
          {source.outputs.map((o) => (
            <OutputRateRow
              key={o.id}
              output={o}
              outputCount={source.outputs.length}
              runClosed={runClosed}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OutputRateRow({
  output,
  outputCount,
  runClosed,
  onChanged,
}: {
  output: OutputView;
  outputCount: number;
  runClosed: boolean;
  onChanged: () => void;
}) {
  const [draftScore, setDraftScore] = useState<number | null>(output.score);
  const [draftRank, setDraftRank] = useState<number | null>(output.rank);
  const [draftTags, setDraftTags] = useState<Set<string>>(
    new Set((output.tags || '').split(',').map((s) => s.trim()).filter(Boolean))
  );
  const [draftComment, setDraftComment] = useState(output.comment || '');

  const saveScore = useMutation({
    mutationFn: async (vars: { score: number; rank: number | null }) => {
      await axios.post(`/api/admin/bench/outputs/${output.id}/score`, {
        score: vars.score,
        rank: vars.rank,
        tags: Array.from(draftTags).join(','),
        comment: draftComment || null,
      });
    },
    onSuccess: onChanged,
  });

  const dirty =
    draftScore !== output.score ||
    draftRank !== output.rank ||
    Array.from(draftTags).sort().join(',') !==
      (output.tags || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .sort()
        .join(',') ||
    draftComment !== (output.comment || '');

  const toggleTag = (tag: string) => {
    setDraftTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    <li className="bg-[#0f0f0f] border border-white/5 rounded p-2">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[#e8a020]">{output.displayLabel}</span>
        {runClosed && output.model && (
          <span className="text-[10px] text-gray-500 tabular-nums">{output.model}</span>
        )}
      </div>
      <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-200 mb-2">
        {output.output}
      </pre>

      {!runClosed && (
        <>
          {/* Score 1-5 */}
          <div className="flex items-center gap-1 text-[11px] mb-1">
            <span className="text-gray-500 mr-1 w-12 shrink-0">score</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setDraftScore(n)}
                className={`w-6 h-6 rounded border text-[11px] cursor-pointer ${
                  draftScore === n
                    ? 'bg-[#e8a020]/20 border-[#e8a020]/60 text-[#e8a020]'
                    : 'bg-[#141414] border-white/10 text-gray-400 hover:border-white/30'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {/* Rank 1..N */}
          <div className="flex items-center gap-1 text-[11px] mb-1">
            <span className="text-gray-500 mr-1 w-12 shrink-0">rank</span>
            {Array.from({ length: outputCount }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setDraftRank(draftRank === n ? null : n)}
                className={`w-6 h-6 rounded border text-[11px] cursor-pointer ${
                  draftRank === n
                    ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
                    : 'bg-[#141414] border-white/10 text-gray-400 hover:border-white/30'
                }`}
              >
                {n}
              </button>
            ))}
            {draftRank != null && (
              <button
                onClick={() => setDraftRank(null)}
                className="text-[10px] text-gray-500 hover:text-red-400 ml-1 cursor-pointer"
              >
                clear
              </button>
            )}
          </div>
          {/* Tags */}
          <div className="flex flex-wrap items-center gap-1 text-[11px] mb-1">
            <span className="text-gray-500 mr-1 w-12 shrink-0">tags</span>
            {TAG_OPTIONS.map((t) => (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                className={`px-1.5 py-0.5 rounded border text-[10px] cursor-pointer ${
                  draftTags.has(t)
                    ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                    : 'bg-[#141414] border-white/10 text-gray-500 hover:border-white/30'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {/* Comment */}
          <input
            value={draftComment}
            onChange={(e) => setDraftComment(e.target.value)}
            placeholder="comment (optional)"
            className="w-full bg-[#141414] border border-white/10 rounded px-2 py-1 text-[11px] mb-1"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (draftScore == null) return;
                saveScore.mutate({ score: draftScore, rank: draftRank });
              }}
              disabled={!dirty || draftScore == null || saveScore.isPending}
              className="px-2 py-0.5 text-[11px] border border-[#e8a020]/40 text-[#e8a020] hover:bg-[#e8a020]/10 rounded cursor-pointer disabled:opacity-40"
            >
              {saveScore.isPending ? '저장 중…' : '저장'}
            </button>
            {output.score != null && (
              <span className="text-[10px] text-gray-500">
                현재: {output.score}점{output.rank != null ? ` · rank ${output.rank}` : ''}
              </span>
            )}
          </div>
        </>
      )}

      {runClosed && (
        <div className="text-[11px] text-gray-500 flex items-center gap-3">
          <span>
            score: <span className="text-[#e8a020]">{output.score ?? '—'}</span>
          </span>
          <span>
            rank: <span className="text-sky-300">{output.rank ?? '—'}</span>
          </span>
          {output.tags && <span>{output.tags}</span>}
          {output.comment && <span className="text-gray-400 italic">"{output.comment}"</span>}
        </div>
      )}
    </li>
  );
}

// ─── aggregate ────────────────────────────────────────────────────

function AggregateSection({ run }: { run: RunDetail }) {
  const isClosed = !!run.closedAt;
  const rows = run.aggregate;
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const t of Object.keys(r.tagCounts)) set.add(t);
    return Array.from(set).sort();
  }, [rows]);

  return (
    <section className="mb-6">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
        aggregate {!isClosed && '(model labels hidden until close)'}
      </div>
      <div className="bg-[#141414] border border-white/10 rounded overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-500 bg-[#0f0f0f]">
              <th className="text-left px-3 py-1.5">model</th>
              <th className="text-right px-3 py-1.5">n scored</th>
              <th className="text-right px-3 py-1.5">avg score</th>
              <th className="text-right px-3 py-1.5">avg rank</th>
              {allTags.map((t) => (
                <th key={t} className="text-right px-2 py-1.5">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r, i) => (
              <tr key={i} className="text-gray-200">
                <td className="px-3 py-1">
                  {isClosed && r.model ? (
                    r.model
                  ) : (
                    <span className="text-gray-500">model {String.fromCharCode(65 + i)}</span>
                  )}
                </td>
                <td className="text-right tabular-nums px-3 py-1 text-gray-400">{r.n}</td>
                <td className="text-right tabular-nums px-3 py-1 text-[#e8a020]">
                  {r.avgScore != null ? r.avgScore.toFixed(2) : '—'}
                </td>
                <td className="text-right tabular-nums px-3 py-1 text-sky-300">
                  {r.avgRank != null ? r.avgRank.toFixed(2) : '—'}
                </td>
                {allTags.map((t) => (
                  <td key={t} className="text-right tabular-nums px-2 py-1 text-gray-500">
                    {r.tagCounts[t] || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
