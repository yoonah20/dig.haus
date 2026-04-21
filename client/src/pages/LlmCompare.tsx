import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import axios from '../lib/axios';
import { useAuth } from '../contexts/AuthContext';

// Admin-only shadow-comparison viewer. When LLM_COMPARE=1 is set on
// the server, every Haiku/Sonnet call also fires a DeepSeek shadow
// with the same prompt; this page shows them side-by-side so we can
// judge output quality + cost before committing to a provider swap.
//
// Rows are newest-first. Click a row to expand the full outputs; the
// default view keeps the table compact since outputs can be multi-
// hundred-char JSON / Korean summaries.

interface CompareRow {
  id: number;
  operation: string;
  album_mbid: string | null;
  album_title: string | null;
  prompt_preview: string | null;
  primary_model: string;
  primary_output: string | null;
  primary_input_tokens: number;
  primary_output_tokens: number;
  primary_latency_ms: number;
  shadow_model: string;
  shadow_output: string | null;
  shadow_input_tokens: number;
  shadow_output_tokens: number;
  shadow_latency_ms: number;
  shadow_error: string | null;
  created_at: string;
}

interface OperationCount {
  operation: string;
  n: number;
}

interface CompareResponse {
  rows: CompareRow[];
  total: number;
  operations: OperationCount[];
  enabled: boolean;
}

// Mirrors server PRICING_PER_1M so we can render cost per row without
// expanding the JSON payload. If a new model ID shows up here the
// fallback to claude-haiku-4-5 rates keeps the column non-zero.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

function priceFor(model: string): { input: number; output: number } {
  if (PRICING[model]) return PRICING[model];
  // Prefix-match fallback — handles model-date bumps.
  const prefixes = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (model.startsWith(p)) return PRICING[p];
  }
  return PRICING['claude-haiku-4-5'];
}

function costUsd(model: string, inTok: number, outTok: number): number {
  const p = priceFor(model);
  return (inTok * p.input + outTok * p.output) / 1_000_000;
}

function shortModel(model: string): string {
  if (model.startsWith('claude-haiku')) return 'haiku';
  if (model.startsWith('claude-sonnet')) return 'sonnet';
  if (model.startsWith('claude-3-haiku')) return 'haiku3';
  if (model === 'deepseek-chat') return 'deepseek';
  return model;
}

function formatTime(iso: string): string {
  const normalised = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalised);
  if (!Number.isFinite(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function LlmCompare() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [operation, setOperation] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!loading && (!user || !user.isAdmin)) navigate('/');
  }, [user, loading, navigate]);

  const { data, isLoading } = useQuery<CompareResponse>({
    queryKey: ['admin-llm-compare', operation],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (operation) params.set('operation', operation);
      const { data } = await axios.get(`/api/admin/llm-comparisons?${params.toString()}`);
      return data;
    },
    enabled: !!user?.isAdmin,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await axios.delete('/api/admin/llm-comparisons');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-llm-compare'] });
    },
  });

  if (loading || !user?.isAdmin) return null;

  const toggleExpanded = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Aggregate totals across the currently-displayed rows, so admin can
  // eyeball "how much am I spending on primary vs shadow across the
  // last 100 calls" without opening a calculator.
  const rows = data?.rows ?? [];
  const agg = rows.reduce(
    (acc, r) => {
      acc.primaryUsd += costUsd(r.primary_model, r.primary_input_tokens, r.primary_output_tokens);
      acc.shadowUsd += costUsd(r.shadow_model, r.shadow_input_tokens, r.shadow_output_tokens);
      acc.primaryLatency += r.primary_latency_ms;
      acc.shadowLatency += r.shadow_latency_ms;
      acc.count += 1;
      if (r.shadow_error) acc.shadowErrors += 1;
      return acc;
    },
    { primaryUsd: 0, shadowUsd: 0, primaryLatency: 0, shadowLatency: 0, count: 0, shadowErrors: 0 }
  );

  return (
    <main className="flex-1 max-w-[1400px] mx-auto px-4 py-6 font-mono text-sm">
      <header className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
        <h1 className="text-lg text-[#e8a020]">LLM Shadow Comparison</h1>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span
            className={
              data?.enabled ? 'text-green-400' : 'text-yellow-500'
            }
          >
            {data?.enabled
              ? 'LLM_COMPARE=1 active'
              : 'LLM_COMPARE off — no new rows will be recorded'}
          </span>
          <button
            onClick={() => {
              if (confirm('비교 로그 전부 삭제?')) clearMutation.mutate();
            }}
            disabled={clearMutation.isPending}
            className="px-2 py-1 border border-white/10 hover:border-red-500/50 text-gray-400 hover:text-red-400 rounded transition-colors cursor-pointer disabled:opacity-50"
          >
            {clearMutation.isPending ? '지우는 중…' : '로그 비우기'}
          </button>
        </div>
      </header>

      {/* Operation filter tabs */}
      <div className="flex flex-wrap gap-2 mb-4 text-[11px]">
        <button
          onClick={() => setOperation('')}
          className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
            operation === ''
              ? 'border-[#e8a020] text-[#e8a020] bg-[#e8a020]/10'
              : 'border-white/10 text-gray-400 hover:border-white/30'
          }`}
        >
          전체 {data ? `(${data.total})` : ''}
        </button>
        {data?.operations.map((op) => (
          <button
            key={op.operation}
            onClick={() => setOperation(op.operation)}
            className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
              operation === op.operation
                ? 'border-[#e8a020] text-[#e8a020] bg-[#e8a020]/10'
                : 'border-white/10 text-gray-400 hover:border-white/30'
            }`}
          >
            {op.operation} ({op.n})
          </button>
        ))}
      </div>

      {/* Aggregate bar — primary vs shadow $/latency across displayed rows */}
      {rows.length > 0 && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 text-xs">
          <Kpi
            label={`primary cost (${agg.count}행)`}
            value={`$${agg.primaryUsd.toFixed(4)}`}
            hint={`avg ${(agg.primaryLatency / agg.count).toFixed(0)}ms`}
          />
          <Kpi
            label="shadow cost"
            value={`$${agg.shadowUsd.toFixed(4)}`}
            hint={`avg ${(agg.shadowLatency / agg.count).toFixed(0)}ms`}
          />
          <Kpi
            label="saved if swap"
            value={`$${(agg.primaryUsd - agg.shadowUsd).toFixed(4)}`}
            hint={
              agg.primaryUsd > 0
                ? `${(((agg.primaryUsd - agg.shadowUsd) / agg.primaryUsd) * 100).toFixed(1)}% off`
                : ''
            }
            positive={agg.primaryUsd > agg.shadowUsd}
          />
          <Kpi
            label="shadow errors"
            value={String(agg.shadowErrors)}
            hint={agg.count > 0 ? `${((agg.shadowErrors / agg.count) * 100).toFixed(1)}%` : ''}
            negative={agg.shadowErrors > 0}
          />
        </section>
      )}

      {isLoading && (
        <div className="text-xs text-gray-600">loading…</div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="text-xs text-gray-500 bg-[#141414] border border-white/5 rounded-md px-4 py-6 text-center">
          {data?.enabled
            ? '비교 로그가 없습니다. 자동 큐레이션 또는 앨범 등록을 한 번 돌려보세요.'
            : 'LLM_COMPARE=1 env를 설정한 뒤 서버를 재시작하면 새 호출부터 기록됩니다.'}
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) => {
            const pCost = costUsd(r.primary_model, r.primary_input_tokens, r.primary_output_tokens);
            const sCost = costUsd(r.shadow_model, r.shadow_input_tokens, r.shadow_output_tokens);
            const isOpen = expanded.has(r.id);
            return (
              <div
                key={r.id}
                className="bg-[#141414] border border-white/5 rounded-md overflow-hidden"
              >
                <button
                  onClick={() => toggleExpanded(r.id)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-gray-500 tabular-nums text-[11px]">
                      {formatTime(r.created_at)}
                    </span>
                    <span className="text-[#e8a020]/80">{r.operation}</span>
                    <span className="text-gray-400 truncate min-w-0">
                      {r.album_title || '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px]">
                    <span className="text-gray-500">
                      {shortModel(r.primary_model)} ${pCost.toFixed(4)} · {r.primary_latency_ms}ms
                    </span>
                    <span className="text-gray-600">vs</span>
                    <span
                      className={
                        r.shadow_error ? 'text-red-400' : 'text-sky-300'
                      }
                    >
                      {shortModel(r.shadow_model)} ${sCost.toFixed(4)} · {r.shadow_latency_ms}ms
                    </span>
                    <span className="text-gray-600">{isOpen ? '▾' : '▸'}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-white/5 grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/5">
                    <OutputPane
                      label={`primary · ${shortModel(r.primary_model)}`}
                      meta={`${r.primary_input_tokens} in / ${r.primary_output_tokens} out · $${pCost.toFixed(5)} · ${r.primary_latency_ms}ms`}
                      body={r.primary_output}
                    />
                    <OutputPane
                      label={`shadow · ${shortModel(r.shadow_model)}`}
                      meta={
                        r.shadow_error
                          ? `ERROR: ${r.shadow_error}`
                          : `${r.shadow_input_tokens} in / ${r.shadow_output_tokens} out · $${sCost.toFixed(5)} · ${r.shadow_latency_ms}ms`
                      }
                      body={r.shadow_output}
                      error={!!r.shadow_error}
                    />
                    {r.prompt_preview && (
                      <div className="md:col-span-2 border-t border-white/5 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                          prompt preview (first 500 chars)
                        </div>
                        <pre className="whitespace-pre-wrap text-[11px] text-gray-400 leading-relaxed">
                          {r.prompt_preview}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Kpi({
  label,
  value,
  hint,
  positive,
  negative,
}: {
  label: string;
  value: string;
  hint?: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const valueColor = positive
    ? 'text-green-400'
    : negative
      ? 'text-red-400'
      : 'text-white';
  return (
    <div className="bg-[#141414] border border-white/5 rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className={`text-base tabular-nums ${valueColor}`}>{value}</div>
      {hint && <div className="text-[10px] text-gray-600 tabular-nums">{hint}</div>}
    </div>
  );
}

function OutputPane({
  label,
  meta,
  body,
  error,
}: {
  label: string;
  meta: string;
  body: string | null;
  error?: boolean;
}) {
  return (
    <div className="px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
        {label}
      </div>
      <div className={`text-[10px] mb-2 tabular-nums ${error ? 'text-red-400' : 'text-gray-500'}`}>
        {meta}
      </div>
      <pre className="whitespace-pre-wrap text-[11px] text-gray-200 leading-relaxed break-words">
        {body || '(empty)'}
      </pre>
    </div>
  );
}
