import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import axios from '../lib/axios';
import { useAuth } from '../contexts/AuthContext';

// Admin-only live view of LLM + Serper spend. Designed for a pinned
// tab alongside real work — auto-refreshes every 15s, shows rolling
// totals at a glance + operation breakdown + a live tail of recent
// calls. Mirrors the numbers the dashboard API-usage card shows but
// without the dashboard chrome around it.

interface Total {
  label: string;
  usd: number;
  calls: number;
}

interface OpBreakdown {
  operation: string;
  calls: number;
  usd: number;
  providers: Record<string, number>;
}

interface RecentCall {
  id: number;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  webSearchCount: number;
  usd: number;
  createdAt: string;
}

interface ApiConsoleData {
  totals: Total[];
  operations: OpBreakdown[];
  recent: RecentCall[];
}

// `embedded` renders the content without the outer <main> wrapper so
// the API tab of the admin dashboard can host the same view alongside
// other tabs. The standalone route (/admin/api-console) still gets
// the wrapper for a pinned-tab / live-console context.
export default function ApiConsole({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (embedded) return;
    if (!loading && (!user || !user.isAdmin)) navigate('/');
  }, [user, loading, navigate, embedded]);

  const { data, isLoading, dataUpdatedAt } = useQuery<ApiConsoleData>({
    queryKey: ['admin-api-console'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/api-console');
      return data;
    },
    enabled: !!user?.isAdmin,
    // Standalone /admin/api-console: live pinned-tab view, polls
    // every 15s WHEN VISIBLE. Embedded inside /admin/api: relies on
    // staleTime + re-entry. Previously the standalone page forced
    // refetchIntervalInBackground: true — which kept the poll
    // running even when the tab was hidden, burning admin requests
    // nobody was looking at. Default (false) respects tab visibility
    // so pinned-but-unfocused tabs stop polling until admin looks.
    refetchInterval: embedded ? false : 15_000,
    staleTime: 30_000,
  });

  if (loading || !user?.isAdmin) return null;

  const body = (
    <div className="font-mono text-sm">
      <header className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
        <h1 className="text-lg text-accent">API Usage Console</h1>
        <div className="text-[11px] text-gray-500">
          {isLoading ? 'loading…' : `last update ${formatTime(new Date(dataUpdatedAt))} · polls every 15s`}
        </div>
      </header>

      {data && (
        <>
          {/* Rolling totals — the headline number bar. */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {data.totals.map((t) => (
              <div
                key={t.label}
                className="bg-[#141414] border border-white/5 rounded-md px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-wider text-gray-500">
                  {t.label}
                </div>
                <div className="text-xl text-white tabular-nums">
                  ${t.usd.toFixed(4)}
                </div>
                <div className="text-[10px] text-gray-600 tabular-nums">
                  {t.calls.toLocaleString()} calls
                </div>
              </div>
            ))}
          </section>

          {/* Operation breakdown — 30d cost by operation, provider mix */}
          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              operations (30d)
            </h2>
            {data.operations.length === 0 ? (
              <div className="text-xs text-gray-600">no calls yet</div>
            ) : (
              <div className="bg-[#141414] border border-white/5 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-500 bg-panel-strong">
                      <th className="text-left px-3 py-2">operation</th>
                      <th className="text-right px-3 py-2">calls</th>
                      <th className="text-right px-3 py-2">usd</th>
                      <th className="text-left px-3 py-2">providers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.operations.map((op) => {
                      const providers = Object.entries(op.providers)
                        .map(([m, n]) => `${shortModel(m)} ×${n}`)
                        .join(' · ');
                      return (
                        <tr key={op.operation} className="text-gray-300">
                          <td className="px-3 py-1.5 text-white">{op.operation}</td>
                          <td className="text-right px-3 py-1.5 tabular-nums">
                            {op.calls.toLocaleString()}
                          </td>
                          <td className="text-right px-3 py-1.5 tabular-nums">
                            ${op.usd.toFixed(4)}
                          </td>
                          <td className="px-3 py-1.5 text-[11px] text-gray-500">
                            {providers}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Live tail — last 30 calls */}
          <section>
            <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              recent calls
            </h2>
            {data.recent.length === 0 ? (
              <div className="text-xs text-gray-600">no calls yet</div>
            ) : (
              <div className="bg-[#141414] border border-white/5 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-500 bg-panel-strong">
                      <th className="text-left px-3 py-2">time</th>
                      <th className="text-left px-3 py-2">operation</th>
                      <th className="text-left px-3 py-2">model</th>
                      <th className="text-right px-3 py-2">in</th>
                      <th className="text-right px-3 py-2">out</th>
                      <th className="text-right px-3 py-2">$</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.recent.map((c) => (
                      <tr key={c.id} className="text-gray-300">
                        <td className="px-3 py-1 text-gray-500 tabular-nums">
                          {formatShortTime(c.createdAt)}
                        </td>
                        <td className="px-3 py-1 text-white">{c.operation}</td>
                        <td className="px-3 py-1 text-gray-500">
                          {shortModel(c.model)}
                        </td>
                        <td className="text-right px-3 py-1 tabular-nums">
                          {c.inputTokens.toLocaleString()}
                        </td>
                        <td className="text-right px-3 py-1 tabular-nums">
                          {c.outputTokens.toLocaleString()}
                        </td>
                        <td className="text-right px-3 py-1 tabular-nums text-accent/80">
                          {c.usd.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );

  if (embedded) return body;
  return (
    <main className="flex-1 max-w-[1200px] mx-auto px-4 py-6">
      {body}
    </main>
  );
}

function shortModel(model: string): string {
  if (model.startsWith('claude-haiku')) return 'haiku';
  if (model.startsWith('claude-sonnet')) return 'sonnet';
  if (model.startsWith('claude-3-haiku')) return 'haiku3';
  if (model === 'deepseek-chat') return 'deepseek';
  return model;
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Server timestamps are UTC ISO-ish strings ("2026-04-20 05:12:33").
// Parse them as UTC and format in local time at HH:mm:ss.
function formatShortTime(iso: string): string {
  const normalised = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalised);
  if (!Number.isFinite(d.getTime())) return iso;
  return formatTime(d);
}
