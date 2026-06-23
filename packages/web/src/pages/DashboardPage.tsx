import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';

export function DashboardPage() {
  const { stats, funnel, throughput, fetchStats, fetchFunnel, fetchThroughput, fetchPipelineRuns } = useStore();
  const [rate, setRate] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
    fetchFunnel();
    fetchThroughput();
    fetchPipelineRuns();
  }, []);

  useEffect(() => {
    if (throughput) {
      setRate(throughput.currentRate);
      setMultiplier(throughput.multiplier);
    }
  }, [throughput]);

  const p = stats?.profiles || {};
  const total = p.total || 0;
  const approvalRate = total > 0
    ? Math.round(((p.approved || 0) / (total - (p.pending || 0))) * 100)
    : 0;

  return (
    <div className="page-container">
      {/* Benchmark box */}
      <div className="card benchmark-box">
        <div className="lbl">RITMO ACTUAL VS. REFERENCIA MANUAL (500 perfiles / 4h)</div>
        <div className="big-stat">{rate !== null ? `${rate}/h` : '— sin datos aún'}</div>
        {multiplier && (
          <div className="lbl">
            {parseFloat(multiplier) >= 1 ? '🚀 ' : ''}
            {multiplier}× el ritmo manual (125/h)
          </div>
        )}
        {!multiplier && <div className="lbl">Empezá a revisar perfiles para medir tu ritmo</div>}
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-value">{total}</div>
          <div className="kpi-label">TOTAL EN BASE</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{p.pending || 0}</div>
          <div className="kpi-label">POR REVISAR</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{approvalRate}%</div>
          <div className="kpi-label">TASA APROBACIÓN</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{p.clients || 0}</div>
          <div className="kpi-label">CLIENTES GENERADOS</div>
        </div>
      </div>

      {/* Funnel */}
      <div className="card">
        <h2 className="card-title">Embudo completo</h2>
        {funnel?.steps.map((step, i) => (
          <div key={i} className="funnel-row">
            <div className="funnel-label">
              <span>{step.label}</span>
              <span>{step.value} ({step.pct}%)</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${step.pct}%` }} />
            </div>
          </div>
        ))}
        <div className="funnel-row" style={{ marginTop: 8 }}>
          <div className="funnel-label">
            <span style={{ color: 'var(--danger)' }}>❌ Descartados</span>
            <span>{funnel?.rejected || 0}</span>
          </div>
        </div>
      </div>

      {/* Niche breakdown */}
      <div className="card">
        <h2 className="card-title">Composición por nicho</h2>
        <div className="stats-note">{total} perfiles en base · {stats?.customers || 0} clientes semilla</div>
      </div>

      {/* Auto-filtered */}
      <div className="card">
        <h2 className="card-title">🤖 Pipeline Automático</h2>
        <p className="stats-note">
          El sistema descubre, enriquece y clasifica perfiles automáticamente.
          Revisá la pestaña Lote para ver el estado del pipeline.
        </p>
      </div>
    </div>
  );
}
