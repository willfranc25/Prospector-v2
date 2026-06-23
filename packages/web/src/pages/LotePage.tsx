import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';

export function LotePage() {
  const { generateBatch, fetchPipelineRuns, pipelineRuns, showToast } = useStore();
  const [batch, setBatch] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    fetchPipelineRuns().then(r => setRuns(r));
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateBatch(14);
      setBatch(result.data);
    } catch (err: any) {
      showToast('⚠️ Error al generar lote');
    }
    setLoading(false);
  };

  const handleCopyJson = () => {
    if (batch?.jsonConfig) {
      navigator.clipboard.writeText(batch.jsonConfig);
      showToast('📋 Copiado al portapapeles');
    }
  };

  const statusEmoji: Record<string, string> = {
    pending: '⏳', running: '🔄', completed: '✅', failed: '❌'
  };

  return (
    <div className="page-container">
      {/* Generate batch */}
      <div className="card">
        <h2 className="card-title">🌱 Generar lote de descubrimiento</h2>
        <p className="stats-note">
          El sistema elige qué clientes usar como semilla, priorizando nichos de alta
          conversión y evitando los usados recientemente.
        </p>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="btn btn-brand w-full mt-3"
        >
          {loading ? '⏳ Generando...' : 'Generar lote recomendado'}
        </button>

        {batch && (
          <div className="mt-4 space-y-2">
            <h3 className="font-bold text-sm">
              Lote recomendado ({batch.picks?.length || 0} cuentas)
            </h3>
            <div className="batch-list">
              {batch.picks?.map((p: any) => (
                <div key={p.id} className="batch-item">
                  <span>@{p.username}</span>
                  <span className="pill">{p.nicheId}</span>
                </div>
              ))}
            </div>
            {batch.nicheBreakdown && (
              <div className="stats-note mt-2">
                {Object.entries(batch.nicheBreakdown).map(([k, v]) => (
                  <span key={k} className="pill" style={{ marginRight: 4 }}>{k}: {String(v)}</span>
                ))}
              </div>
            )}

            {batch.jsonConfig && (
              <div className="mt-4">
                <h3 className="font-bold text-sm mb-2">Configuración para Apify</h3>
                <pre className="code-block">{batch.jsonConfig}</pre>
                <button onClick={handleCopyJson} className="btn btn-outline w-full mt-2">
                  📋 Copiar configuración
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pipeline runs history */}
      <div className="card">
        <h2 className="card-title">📜 Historial del Pipeline</h2>
        <p className="stats-note">Ejecuciones automáticas de descubrimiento.</p>

        {runs.length === 0 ? (
          <p className="stats-note mt-2 italic">Sin ejecuciones todavía.</p>
        ) : (
          <div className="space-y-2 mt-2">
            {runs.map(run => (
              <div key={run.id} className="pipeline-run-item">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="mr-2">{statusEmoji[run.status] || '❓'}</span>
                    <span className="font-medium text-sm">{run.strategy}</span>
                  </div>
                  <span className={`
                    text-xs px-2 py-0.5 rounded-full
                    ${run.status === 'completed' ? 'bg-green-900 text-green-300' :
                      run.status === 'failed' ? 'bg-red-900 text-red-300' :
                      run.status === 'running' ? 'bg-blue-900 text-blue-300' :
                      'bg-gray-800 text-gray-400'}
                  `}>
                    {run.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(run.created_at).toLocaleString('es')}
                  {run.stats?.discovered !== undefined && (
                    <span> · {run.stats.discovered} perfiles</span>
                  )}
                  {run.error_message && (
                    <span className="text-red-400"> · {run.error_message}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-discovery note */}
      <div className="card border-blue-900">
        <h2 className="card-title">🤖 Descubrimiento Automático</h2>
        <p className="stats-note">
          El sistema ejecuta búsquedas automáticas 3 veces al día (2AM, 10AM, 6PM)
          y un descubrimiento profundo semanal (domingo 3AM).
          Configurá tu token de Apify en el archivo <code>.env</code> para activarlo.
        </p>
      </div>
    </div>
  );
}
