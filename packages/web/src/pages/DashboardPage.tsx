import { useEffect, useState, useCallback } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import clsx from 'clsx';

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

const STRATEGY_ICONS: Record<string, string> = {
  followers_seed: '👥', following_seed: '🔗', hashtag: '#️⃣',
  semantic_search: '🧠', location: '📍', competitor: '🎯',
  verified_small: '✓', lookalike_expansion: '🔄'
};

const STRATEGY_SCHEDULES: Record<string, string> = {
  daily: '3× al día', weekly: '1× por semana', manual: 'Manual'
};

function ProgressRing({ pct, color = 'var(--brand)' }: { pct: number; color?: string }) {
  const r = 34; const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="progress-ring">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle className="progress-ring-bg" cx="40" cy="40" r={r} />
        <circle className="progress-ring-fill" cx="40" cy="40" r={r}
          stroke={color} strokeDasharray={circ} strokeDashoffset={offset} />
      </svg>
      <div className="progress-ring-center">
        <span className="progress-ring-value">{pct}%</span>
        <span className="progress-ring-label">aprob.</span>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { stats, funnel, throughput, niches, fetchStats, fetchFunnel, fetchThroughput, fetchNiches, showToast, fetchPipelineRuns, pipelineRuns } = useStore();
  const [live, setLive] = useState<any>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [runningStrategy, setRunningStrategy] = useState<string | null>(null);
  const [dailyStats, setDailyStats] = useState<any[]>([]);

  const loadLive = useCallback(async () => {
    try {
      const res = await api.get('/pipeline/live');
      setLive(res.data);
      setStrategies(res.data.strategies || []);
    } catch {}
  }, []);

  const loadDailyStats = useCallback(async () => {
    try {
      const res = await api.get('/pipeline/daily-stats', { days: '14' });
      setDailyStats(res.data || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchStats(); fetchFunnel(); fetchThroughput(); fetchNiches(); fetchPipelineRuns(); loadLive(); loadDailyStats();
    const interval = setInterval(() => { loadLive(); loadDailyStats(); }, 15000);
    return () => clearInterval(interval);
  }, []);

  const triggerStrategy = async (strategyId: string) => {
    setRunningStrategy(strategyId);
    try {
      const res = await api.post(`/pipeline/strategies/${strategyId}/run`);
      showToast(`🚀 ${res.data.message}`);
      loadLive();
    } catch { showToast('❌ Error al ejecutar estrategia'); }
    setRunningStrategy(null);
  };

  const toggleStrategy = async (strategyId: string, enabled: boolean) => {
    try {
      await api.put(`/pipeline/strategies/${strategyId}`, { enabled: !enabled });
      loadLive();
      showToast(enabled ? '⏸️ Estrategia pausada' : '▶️ Estrategia activada');
    } catch { showToast('❌ Error'); }
  };

  const p = stats?.profiles || {};
  const total = p.total || 0;
  const reviewed = total - (p.pending || 0);
  const approvalRate = reviewed > 0 ? Math.round(((p.approved || 0) / reviewed) * 100) : 0;
  const rate = throughput?.currentRate;
  const multiplier = throughput?.multiplier;
  const runningCount = live?.running || 0;

  return (
    <div className="page-content animate-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="topbar-title" style={{ margin: 0, fontSize: '1.1rem' }}>Centro de Comando</h1>
          <p className="topbar-subtitle" style={{ margin: 0 }}>Pipeline de descubrimiento · Scoring · Clasificación automática</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: runningCount > 0 ? 'var(--info)' : 'var(--text-muted)',
              boxShadow: runningCount > 0 ? '0 0 8px var(--info)' : 'none',
              animation: runningCount > 0 ? 'pulse 2s infinite' : 'none' }} />
            {runningCount > 0 ? `${runningCount} workers activos` : 'Pipeline en espera'}
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header"><div className="kpi-icon purple">📊</div><span className="kpi-label">Total perfiles</span></div>
          <div className="kpi-value">{fmtNum(total)}</div>
          <div className="kpi-sub">{p.pending || 0} pendientes · {fmtNum(live?.last24h?.reduce((a: number, r: any) => a + r.total_discovered, 0) || 0)} descubiertos hoy</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header"><div className="kpi-icon green">✅</div><span className="kpi-label">Tasa aprobación</span></div>
          <div className="kpi-value">{approvalRate}%</div>
          <div className={clsx('kpi-sub', approvalRate >= 60 ? 'good' : 'warn')}>{reviewed} revisados</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header"><div className="kpi-icon amber">⚡</div><span className="kpi-label">Ritmo</span></div>
          <div className="kpi-value">{rate ? `${rate}/h` : '—'}</div>
          <div className="kpi-sub">{multiplier ? `${multiplier}× manual` : 'Iniciá revisión'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header"><div className="kpi-icon blue">💰</div><span className="kpi-label">Clientes</span></div>
          <div className="kpi-value">{p.clients || 0}</div>
          <div className="kpi-sub">{stats?.customers || 0} semillas</div>
        </div>
      </div>

      {/* Daily Discovery Tracking */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div>
            <span className="card-title">📅 Tracking diario de descubrimiento</span>
            <p className="card-subtitle">
              Perfiles descubiertos por día · Benchmark manual: <b>500/día (125/h × 4h)</b>
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="stat-highlight" style={{ fontSize: '1.8rem' }}>
              {fmtNum(dailyStats.length > 0 ? dailyStats[dailyStats.length - 1]?.discovered || 0 : 0)}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>descubiertos hoy</div>
          </div>
        </div>

        {/* Bar chart */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100, paddingTop: 8 }}>
          {dailyStats.length === 0 ? (
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', height: '100%' }}>
              Sin datos aún — el pipeline se llena solo con el descubrimiento automático
            </div>
          ) : (
            dailyStats.map((day: any, i: number) => {
              const maxVal = Math.max(...dailyStats.map((d: any) => d.discovered || 0), 1);
              const h = Math.max(4, ((day.discovered || 0) / maxVal) * 90);
              const isToday = i === dailyStats.length - 1;
              const benchmarkH = Math.max(2, (500 / maxVal) * 90);
              const dateLabel = new Date(day.date).toLocaleDateString('es', { day: 'numeric', month: 'short' });
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: '0.55rem', color: isToday ? 'var(--brand-light)' : 'var(--text-muted)', fontWeight: isToday ? 700 : 400 }}>
                    {fmtNum(day.discovered || 0)}
                  </span>
                  <div style={{
                    width: '100%', maxWidth: 28, height: h,
                    background: isToday
                      ? 'linear-gradient(180deg, var(--brand-light), var(--brand))'
                      : (day.discovered || 0) >= 500
                        ? 'linear-gradient(180deg, var(--success), rgba(34,197,94,0.4))'
                        : 'linear-gradient(180deg, var(--border-light), var(--border))',
                    borderRadius: '3px 3px 0 0',
                    transition: 'height 0.5s ease',
                    position: 'relative'
                  }}>
                    {/* Benchmark line */}
                    {isToday && (
                      <div style={{
                        position: 'absolute', bottom: benchmarkH, left: -2, right: -2,
                        borderTop: '1px dashed var(--warning)', height: 0
                      }} title="Benchmark manual: 500/día" />
                    )}
                  </div>
                  <span style={{ fontSize: '0.5rem', color: isToday ? 'var(--text-secondary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {dateLabel}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Legend */}
        {dailyStats.length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: '0.62rem', color: 'var(--text-muted)', justifyContent: 'center' }}>
            <span>📊 Barras: perfiles descubiertos por día</span>
            <span style={{ color: 'var(--warning)' }}>- - - Benchmark manual (500)</span>
            <span style={{ color: 'var(--success)' }}>Verde: ≥500 (supera manual)</span>
          </div>
        )}
      </div>

      {/* Live Activity — Running Jobs */}
      {live && live.runningRuns?.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.03)' }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--info)', boxShadow: '0 0 10px var(--info)', animation: 'pulse 1.5s infinite' }} />
              <span className="card-title" style={{ color: 'var(--info)' }}>🔍 Actividad en vivo — {live.runningRuns.length} estrategia{live.runningRuns.length > 1 ? 's' : ''} ejecutándose</span>
            </div>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Actualización cada 15s</span>
          </div>
          {live.runningRuns.map((run: any) => {
            const elapsed = run.started_at ? Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000) : 0;
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            const s = strategies.find((st: any) => st.id === run.strategy);
            return (
              <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '1.2rem' }}>{STRATEGY_ICONS[run.strategy] || '🔄'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{s?.name || run.strategy}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    Ejecutando hace {mins}m {secs}s · Fase: {run.step || 'discovery'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.8rem', animation: 'pulse 1.5s infinite' }}>⏳</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--info)', fontWeight: 600 }}>En progreso</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pipeline Status Bar */}
      {live && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', alignItems: 'center', fontSize: '0.72rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-muted)', marginRight: 8 }}>PIPELINE</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--brand-light)', fontWeight: 700 }}>{fmtNum(live.last24h?.reduce((a: number, r: any) => a + r.total_discovered, 0) || 0)}</span>
            <span style={{ color: 'var(--text-muted)' }}>descubiertos 24h</span>
          </div>
          <span style={{ color: 'var(--border-light)' }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--info)', fontWeight: 700 }}>{runningCount}</span>
            <span style={{ color: 'var(--text-muted)' }}>{runningCount === 1 ? 'activo' : 'activos'}</span>
          </div>
          <span style={{ color: 'var(--border-light)' }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: runningCount === 0 ? 'var(--text-muted)' : 'var(--warning)', fontWeight: 700 }}>{live.pendingJobs || 0}</span>
            <span style={{ color: 'var(--text-muted)' }}>en cola</span>
          </div>
          <span style={{ color: 'var(--border-light)' }}>|</span>
          <span style={{ color: 'var(--text-muted)' }}>
            {['daily', 'weekly', 'manual'].map(sched => {
              const count = strategies.filter((s: any) => s.schedule === sched && s.enabled).length;
              return count > 0 ? `${count} ${sched === 'daily' ? 'diarias' : sched === 'weekly' ? 'semanales' : 'manuales'}  ` : '';
            })}
          </span>
        </div>
      )}

      {/* Main Content: Strategies + Funnel side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
        {/* Search Strategies — Full Width Card */}
        <div className="card">
          <div className="card-header">
            <div>
              <span className="card-title">🔍 Motor de Búsqueda — 10 Estrategias</span>
              <p className="card-subtitle">El sistema combina múltiples fuentes de descubrimiento. Activá/desactivá estrategias o ejecutalas manualmente.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {strategies.map((s: any) => (
              <div key={s.id} style={{
                padding: 14, background: 'var(--bg-secondary)', borderRadius: 'var(--radius)',
                border: `1px solid ${s.enabled ? 'var(--border)' : 'var(--border)'}`,
                opacity: s.enabled ? 1 : 0.5,
                transition: 'all 0.2s'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1.2rem' }}>{STRATEGY_ICONS[s.id] || '🔍'}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{s.name}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{STRATEGY_SCHEDULES[s.schedule] || s.schedule}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleStrategy(s.id, s.enabled)}
                    style={{
                      padding: '3px 10px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 600,
                      border: 'none', cursor: 'pointer',
                      background: s.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)',
                      color: s.enabled ? 'var(--success)' : 'var(--text-muted)',
                    }}
                  >
                    {s.enabled ? 'ACTIVO' : 'PAUSADO'}
                  </button>
                </div>

                <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                  {s.description || 'Estrategia de descubrimiento de perfiles'}
                </p>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: '0.65rem' }}>
                  {s.last_run_at && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      Última: {new Date(s.last_run_at).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {s.last_discovered > 0 && (
                    <span style={{ color: 'var(--brand-light)' }}>{fmtNum(s.last_discovered)} perfiles</span>
                  )}
                  {s.last_status === 'running' && (
                    <span style={{ color: 'var(--info)' }}>⏳ Ejecutando...</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    📦 {(s.config?.resultsLimit || s.config?.limit || 500)}/ejec
                  </span>
                  <button
                    onClick={() => triggerStrategy(s.id)}
                    disabled={runningStrategy === s.id || !s.enabled}
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', fontSize: '0.7rem', flex: 1 }}
                  >
                    {runningStrategy === s.id ? '⏳' : '▶'} Ejecutar ahora
                  </button>
                  {s.schedule === 'manual' && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Solo manual</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pipeline Run History */}
      {pipelineRuns.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div>
              <span className="card-title">📜 Historial de ejecuciones</span>
              <p className="card-subtitle">Últimas ejecuciones del pipeline de descubrimiento</p>
            </div>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {pipelineRuns.slice(0, 15).map((run: any) => {
              const dots: Record<string, string> = { completed: 'completed', running: 'running', failed: 'failed', pending: 'pending' };
              const labels: Record<string, string> = { completed: 'Completado', running: 'En ejecución', failed: 'Falló', pending: 'Pendiente' };
              const colors: Record<string, string> = { completed: 'var(--success)', running: 'var(--info)', failed: 'var(--danger)', pending: 'var(--text-muted)' };
              return (
                <div key={run.id} className="run-item">
                  <div className={clsx('run-status', dots[run.status] || 'pending')} />
                  <div className="run-info">
                    <div className="run-strategy">{run.strategy}</div>
                    <div className="run-meta">
                      {new Date(run.created_at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {run.stats?.discovered > 0 && ` · ${run.stats.discovered} perfiles`}
                      {run.error_message && ` · ${run.error_message}`}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.62rem', color: colors[run.status], fontWeight: 600 }}>{labels[run.status]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom row: Funnel + Niche Breakdown */}
      <div className="grid-2" style={{ marginTop: 16 }}>
        {/* Funnel */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📈 Embudo de conversión</span>
          </div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              {funnel?.steps.map((step: any, i: number) => (
                <div key={i} className="funnel-step">
                  <div className="funnel-icon" style={{
                    background: ['rgba(99,102,241,0.15)','rgba(59,130,246,0.15)','rgba(245,158,11,0.15)','rgba(34,197,94,0.15)'][i]
                  }}>{['🔍','✅','📨','💰'][i]}</div>
                  <div className="funnel-info">
                    <div className="funnel-name">{step.label}</div>
                    <div className="funnel-count">{step.value} de {total}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="funnel-value">{fmtNum(step.value)}</div>
                    <div className="funnel-pct">{step.pct}%</div>
                  </div>
                </div>
              ))}
              <div className="funnel-step">
                <div className="funnel-icon" style={{ background: 'rgba(239,68,68,0.12)' }}>❌</div>
                <div className="funnel-info">
                  <div className="funnel-name" style={{ color: 'var(--danger)' }}>Descartados</div>
                  <div className="funnel-count">Automático + manual</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="funnel-value" style={{ color: 'var(--danger)' }}>{fmtNum(funnel?.rejected || 0)}</div>
                </div>
              </div>
            </div>
            <ProgressRing pct={approvalRate} color={approvalRate >= 60 ? 'var(--success)' : approvalRate >= 40 ? 'var(--warning)' : 'var(--danger)'} />
          </div>
        </div>

        {/* Niches */}
        <div className="card">
          <div className="card-header">
            <div>
              <span className="card-title">🎯 Nichos prioritarios</span>
              <p className="card-subtitle">Peso ajustado automáticamente según conversión</p>
            </div>
          </div>
          {niches.filter(n => n.id !== 'otro').slice(0, 6).map((n, i) => (
            <div key={n.id} className="niche-item" style={{ padding: '10px 0' }}>
              <div className="niche-top">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>#{i + 1}</span>
                  <span className="niche-name">{n.label}</span>
                </span>
                <span className="niche-weight">Peso {n.weight}</span>
              </div>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${n.weight}%`, background: n.weight >= 80 ? 'var(--success)' : n.weight >= 60 ? 'var(--brand)' : n.weight >= 40 ? 'var(--warning)' : 'var(--text-muted)' }} />
              </div>
              <div className="niche-stats">
                {n.profile_count || 0} perfiles
                {n.stats?.approvalRate !== null && ` · ${Math.round((n.stats.approvalRate || 0) * 100)}% aprob.`}
                {n.stats?.conversionRate !== null && ` · ${Math.round((n.stats.conversionRate || 0) * 100)}% clientes`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
