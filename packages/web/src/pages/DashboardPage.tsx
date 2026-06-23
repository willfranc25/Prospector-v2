import { useEffect } from 'react';
import { useStore } from '../lib/store';
import clsx from 'clsx';

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

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
  const { stats, funnel, throughput, niches, fetchStats, fetchFunnel, fetchThroughput, fetchNiches } = useStore();

  useEffect(() => {
    fetchStats(); fetchFunnel(); fetchThroughput(); fetchNiches();
  }, []);

  const p = stats?.profiles || {};
  const total = p.total || 0;
  const reviewed = total - (p.pending || 0);
  const approvalRate = reviewed > 0 ? Math.round(((p.approved || 0) / reviewed) * 100) : 0;
  const rate = throughput?.currentRate;
  const multiplier = throughput?.multiplier;

  return (
    <div className="page-content animate-in">
      {/* Top bar info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 className="topbar-title" style={{ margin: 0 }}>Dashboard</h1>
          <p className="topbar-subtitle" style={{ margin: 0 }}>Métricas y rendimiento del pipeline</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.72rem' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }} />
          Pipeline activo
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <div className="kpi-icon purple">👥</div>
            <span className="kpi-label">Total perfiles</span>
          </div>
          <div className="kpi-value">{fmtNum(total)}</div>
          <div className="kpi-sub">{p.pending || 0} pendientes de revisión</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <div className="kpi-icon green">✅</div>
            <span className="kpi-label">Tasa aprobación</span>
          </div>
          <div className="kpi-value">{approvalRate}%</div>
          <div className={clsx('kpi-sub', approvalRate >= 60 ? 'good' : approvalRate >= 40 ? 'warn' : '')}>
            {reviewed} perfiles revisados
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <div className="kpi-icon amber">⚡</div>
            <span className="kpi-label">Ritmo actual</span>
          </div>
          <div className="kpi-value">{rate ? `${rate}/h` : '—'}</div>
          <div className={clsx('kpi-sub', multiplier && parseFloat(multiplier) >= 1 ? 'good' : '')}>
            {multiplier ? `${multiplier}× ritmo manual` : 'Sin datos aún'}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <div className="kpi-icon blue">💰</div>
            <span className="kpi-label">Clientes</span>
          </div>
          <div className="kpi-value">{p.clients || 0}</div>
          <div className="kpi-sub">{stats?.customers || 0} semillas en base</div>
        </div>
      </div>

      {/* 2-column layout */}
      <div className="grid-2">
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
                  }}>
                    {['🔍','✅','📨','💰'][i]}
                  </div>
                  <div className="funnel-info">
                    <div className="funnel-name">{step.label}</div>
                    <div className="funnel-count">{step.value} de {total} total</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="funnel-value">{fmtNum(step.value)}</div>
                    <div className="funnel-pct">{step.pct}%</div>
                  </div>
                </div>
              ))}
            </div>
            <ProgressRing pct={approvalRate} color={approvalRate >= 60 ? 'var(--success)' : approvalRate >= 40 ? 'var(--warning)' : 'var(--danger)'} />
          </div>
        </div>

        {/* Niche breakdown */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🎯 Nichos principales</span>
            <span className="topbar-subtitle" style={{ margin: 0 }}>Por peso de prioridad</span>
          </div>
          {niches.filter(n => n.id !== 'otro').slice(0, 5).map(n => (
            <div key={n.id} className="niche-item" style={{ padding: '10px 0' }}>
              <div className="niche-top">
                <span className="niche-name">{n.label}</span>
                <span className="niche-weight">Peso {n.weight}</span>
              </div>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${n.weight}%` }} />
              </div>
              <div className="niche-stats">
                {n.profile_count || 0} perfiles
                {n.stats?.approvalRate !== null && ` · ${Math.round((n.stats.approvalRate || 0) * 100)}% aprob.`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
