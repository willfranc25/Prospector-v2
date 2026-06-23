import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import clsx from 'clsx';

export function LotePage() {
  const { generateBatch, fetchPipelineRuns, pipelineRuns, showToast } = useStore();
  const [batch, setBatch] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchPipelineRuns(); }, []);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const r = await generateBatch(14);
      setBatch(r.data);
      showToast('🌱 Lote generado');
    } catch { showToast('⚠️ Error al generar lote'); }
    setLoading(false);
  };

  const copyJson = () => {
    if (batch?.jsonConfig) {
      navigator.clipboard.writeText(batch.jsonConfig);
      showToast('📋 Copiado al portapapeles');
    }
  };

  const statusStyles: Record<string, { dot: string; label: string; color: string }> = {
    completed: { dot: 'completed', label: 'Completado', color: 'var(--success)' },
    running: { dot: 'running', label: 'En ejecución', color: 'var(--info)' },
    failed: { dot: 'failed', label: 'Falló', color: 'var(--danger)' },
    pending: { dot: 'pending', label: 'Pendiente', color: 'var(--text-muted)' }
  };

  return (
    <div className="page-content animate-in">
      <div style={{ marginBottom: 20 }}>
        <h1 className="topbar-title" style={{ margin: 0 }}>Lote</h1>
        <p className="topbar-subtitle" style={{ margin: 0 }}>Generación de semillas y pipeline de descubrimiento</p>
      </div>

      <div className="grid-2">
        {/* Generate Batch */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🌱 Generar lote</span>
          </div>
          <p className="card-subtitle" style={{ marginBottom: 16 }}>
            El sistema selecciona los mejores clientes semilla según la tasa de conversión de cada nicho,
            evitando los usados en los últimos 14 días.
          </p>

          <button onClick={handleGenerate} disabled={loading} className="btn btn-primary btn-lg btn-block">
            {loading ? '⏳ Analizando nichos...' : 'Generar lote recomendado'}
          </button>

          {batch && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{batch.picks?.length || 0} cuentas semilla</span>
              </div>

              <div className="batch-grid">
                {batch.picks?.map((p: any) => (
                  <div key={p.id} className="batch-tag">
                    <span className="batch-tag-user">@{p.username}</span>
                    <span className="batch-tag-niche">{p.nicheId}</span>
                  </div>
                ))}
              </div>

              {batch.jsonConfig && (
                <div style={{ marginTop: 16 }}>
                  <div className="card-title" style={{ marginBottom: 8, fontSize: '0.8rem' }}>Configuración Apify</div>
                  <div className="code-block">{batch.jsonConfig}</div>
                  <button onClick={copyJson} className="btn btn-ghost btn-block" style={{ marginTop: 8 }}>
                    📋 Copiar JSON
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pipeline Runs */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📜 Pipeline</span>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
              {pipelineRuns.length} ejecuciones
            </span>
          </div>
          <p className="card-subtitle" style={{ marginBottom: 16 }}>
            El sistema ejecuta búsquedas automáticas 3× al día (2AM, 10AM, 6PM) + descubrimiento semanal profundo.
          </p>

          {pipelineRuns.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <div className="empty-icon">🔄</div>
              <div className="empty-desc">El pipeline se activa automáticamente. Configurá APIFY_TOKEN en .env para scraping real.</div>
            </div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {pipelineRuns.map(run => {
                const s = statusStyles[run.status] || statusStyles.pending;
                return (
                  <div key={run.id} className="run-item">
                    <div className={clsx('run-status', s.dot)} />
                    <div className="run-info">
                      <div className="run-strategy">{run.strategy}</div>
                      <div className="run-meta">
                        {new Date(run.created_at).toLocaleString('es')}
                        {run.stats?.discovered !== undefined && ` · ${run.stats.discovered} perfiles`}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.65rem', color: s.color, fontWeight: 600 }}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Auto-discovery info */}
      <div className="card" style={{ borderColor: 'var(--border-brand)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: '1.5rem' }}>🤖</span>
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>Descubrimiento automático</div>
            <p className="card-subtitle">
              El sistema usa 10 estrategias de búsqueda combinadas: followers de semillas, hashtags, búsqueda semántica,
              seguidores de competidores, ubicación, cuentas verificadas y expansión por similitud.
              Cada perfil pasa por un pipeline de enriquecimiento → clasificación → scoring antes de llegar a tu cola de revisión.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
